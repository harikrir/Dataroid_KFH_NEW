/**
 * Dataroid Cordova Auto-Capture Module
 *
 * Provides automatic capture of:
 * - Network requests (XHR + fetch)
 * - Screen/page transitions (History API + hashchange)
 * - Component interactions (click, input, change via DOM delegation)
 * - Gestures (touch, swipe, double-tap, long-press)
 */

"use strict";

var Dataroid = require("./Dataroid");

// ============================================
// STATE
// ============================================

var _config = {};
var _state = {
  network: {
    xhrOpen: null,
    xhrSend: null,
    originalFetch: null,
    patched: false,
  },
  screen: {
    currentView: null,
    pushState: null,
    replaceState: null,
    patched: false,
  },
  component: { patched: false },
  gesture: {
    patched: false,
    lastTap: null,
    longPressTimer: null,
    activePointer: null,
  },
};

// ============================================
// CONSTANTS
// ============================================

var SWIPE_THRESHOLD_DISTANCE = 50;
var SWIPE_THRESHOLD_VELOCITY = 0.3;
var DOUBLE_TAP_DELAY = 300;
var LONG_PRESS_DURATION = 500;
var TOUCH_SLOP = 10;
var TEXT_CHANGE_DEBOUNCE_MS = 500;
var MAX_PLACEHOLDER_LENGTH = 120;
var _textChangeTimers = {};
// Debounce keys for elements that carry neither an id nor a name. The key must
// stay stable across events for the same element, otherwise every keystroke
// gets its own timer and the debounce never coalesces.
var _elementKeys = new WeakMap();
var _elementKeyCounter = 0;

// ============================================
// UTILITIES
// ============================================

function shouldTrackUrl(url) {
  if (!url) return false;
  var ignored = _config.ignoredUrls || [];
  for (var i = 0; i < ignored.length; i++) {
    var pattern = ignored[i];
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      if (pattern.test(url)) return false;
    } else if (typeof pattern === "string") {
      if (url.indexOf(pattern) !== -1) return false;
    }
  }
  var tracked = _config.trackedDomains || [];
  if (tracked.length === 0) return true;

  var hostname = getUrlHostname(url);
  if (!hostname) return false;

  for (var j = 0; j < tracked.length; j++) {
    if (typeof tracked[j] !== "string") continue;
    var domain = tracked[j].trim().toLowerCase().replace(/\.$/, "");
    if (!domain) continue;
    if (hostname === domain || hostname.endsWith("." + domain)) return true;
  }
  return false;
}

function getUrlHostname(url) {
  try {
    var UrlConstructor =
      typeof URL !== "undefined"
        ? URL
        : typeof window !== "undefined"
          ? window.URL
          : null;
    if (!UrlConstructor) return null;

    var baseUrl =
      typeof document !== "undefined" && document.baseURI
        ? document.baseURI
        : typeof window !== "undefined" && window.location
          ? window.location.href
          : undefined;
    var parsed = baseUrl
      ? new UrlConstructor(String(url), baseUrl)
      : new UrlConstructor(String(url));
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch (_) {
    return null;
  }
}

function sanitizeTrackedUrl(url) {
  var value = typeof url === "string" ? url : String(url || "");
  // Resolve using the same base as the WebView before removing private parts.
  try {
    var UrlConstructor = typeof URL !== "undefined" ? URL : window.URL;
    var base =
      typeof document !== "undefined" && document.baseURI
        ? document.baseURI
        : window.location && window.location.href;
    if (UrlConstructor)
      value = base
        ? new UrlConstructor(value, base).href
        : new UrlConstructor(value).href;
  } catch (_) {
    // Invalid/unsupported URLs still follow the original request's behavior.
  }
  var queryIndex = value.indexOf("?");
  var fragmentIndex = value.indexOf("#");
  var endIndex = value.length;

  if (queryIndex !== -1) endIndex = Math.min(endIndex, queryIndex);
  if (fragmentIndex !== -1) endIndex = Math.min(endIndex, fragmentIndex);

  return value.substring(0, endIndex);
}

function getElementIdentifier(el, skipTextContent) {
  if (!el || !el.tagName) return { className: "Unknown" };

  var customAttr = _config.labelAttribute || "data-dataroid-label";
  var label =
    el.getAttribute(customAttr) ||
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    el.id ||
    null;

  var textContent = null;
  // Editable content is a value, not a stable label. Never let it bypass
  // text redaction through identifier metadata.
  if (!label && !skipTextContent && !isTextInput(el)) {
    textContent = (el.textContent || "").trim();
    if (textContent.length > 50) textContent = textContent.substring(0, 50);
    if (textContent) label = textContent;
  }

  var className = el.tagName.toLowerCase();
  if (el.className && typeof el.className === "string") {
    var classes = el.className
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(".");
    if (classes) className = el.tagName.toLowerCase() + "." + classes;
  }

  var rect = null;
  try {
    var domRect = el.getBoundingClientRect();
    rect = {
      left: Math.round(domRect.left),
      top: Math.round(domRect.top),
      right: Math.round(domRect.right),
      bottom: Math.round(domRect.bottom),
    };
  } catch (e) {
    // getBoundingClientRect throws for a detached element; rect stays null.
  }

  return {
    ac: true,
    className: className,
    accessibilityLabel: el.getAttribute("aria-label") || undefined,
    componentId: el.id || undefined,
    label: label || undefined,
    coordinates: rect,
  };
}

function isButtonElement(el) {
  if (!el) return false;
  var tag = el.tagName.toLowerCase();
  if (tag === "button" || tag === "a") return true;
  if (tag === "input") {
    var type = (el.type || "").toLowerCase();
    return type === "submit" || type === "button" || type === "reset";
  }
  if (el.getAttribute("role") === "button") return true;
  return false;
}

function isTextInput(el) {
  if (!el) return false;
  var tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    var type = (el.type || "text").toLowerCase();
    return (
      ["text", "email", "password", "search", "tel", "url", "number"].indexOf(
        type,
      ) !== -1
    );
  }
  if (el.isContentEditable) return true;
  return false;
}

function isPasswordInput(el) {
  return (
    el.tagName.toLowerCase() === "input" &&
    (el.type || "").toLowerCase() === "password"
  );
}

function isSensitiveElement(el) {
  if (isPasswordInput(el)) return true;
  var current = el;
  while (current) {
    if (
      typeof current.hasAttribute === "function" &&
      current.hasAttribute("data-dataroid-sensitive")
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

// Component masking is separate from gesture identifiers and manual APIs.
function omitSensitiveLabels(id) {
  id.label = undefined;
  id.accessibilityLabel = undefined;
}

function getComponentIdentifier(el) {
  var sensitive = isSensitiveElement(el);
  var id = getElementIdentifier(el, sensitive);
  if (sensitive) omitSensitiveLabels(id);
  return id;
}

function isRadioElement(el) {
  return (
    el &&
    el.tagName.toLowerCase() === "input" &&
    (el.type || "").toLowerCase() === "radio"
  );
}

function isNativeToggleElement(el) {
  if (!el) return false;
  var tag = el.tagName.toLowerCase();
  if (tag === "input") {
    var type = (el.type || "").toLowerCase();
    return type === "checkbox";
  }
  return false;
}

function isToggleElement(el) {
  if (!el) return false;
  if (isNativeToggleElement(el)) return true;
  var role = el.getAttribute("role");
  if (role === "switch" || role === "checkbox") return true;
  return false;
}

function findInteractiveAncestor(el) {
  var current = el;
  var depth = 0;
  while (current && depth < 10) {
    if (isRadioElement(current)) return { el: current, type: "radio" };
    if (isToggleElement(current)) return { el: current, type: "toggle" };
    if (isButtonElement(current)) return { el: current, type: "button" };
    if (isTextInput(current)) return { el: current, type: "textInput" };
    current = current.parentElement;
    depth++;
  }
  return null;
}

function getScreenContext() {
  if (!_state.screen.currentView) return null;
  return {
    viewClass: _state.screen.currentView,
    viewLabel: _state.screen.currentView,
  };
}

function classifyNetworkError(error) {
  // Cancellation is not a timeout or a connectivity failure, even offline.
  if (error && error.name === "AbortError") return "UNKNOWN";
  if (error && error.name === "TimeoutError") return "TIMEOUT_ERROR";
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return "NO_CONNECTION_ERROR";
  if (error && error.message) {
    if (/timeout|timed\s+out/i.test(error.message)) return "TIMEOUT_ERROR";
    if (/ssl|certificate/i.test(error.message)) return "SSL_ERROR";
  }
  return "UNKNOWN";
}

function normalizePayloadSize(value) {
  var size = Number(value);
  return isFinite(size) && size >= 0 ? size : 0;
}

function sanitizeTextValue(value) {
  if (_config.redactTextValues !== false) return "";
  return value || "";
}

function fireAndForget(method, args) {
  try {
    var result = method.apply(Dataroid, args || []);
    if (result && typeof result.catch === "function") {
      result.catch(function () {});
    }
  } catch (_) {
    // Auto-capture must never affect the host application's control flow.
  }
}

function viewStartedAutoCaptured(viewClass, viewLabel) {
  var method = Object.prototype.hasOwnProperty.call(
    Dataroid,
    "_viewStartedWithViewClassAutoCaptured",
  )
    ? Dataroid._viewStartedWithViewClassAutoCaptured
    : Dataroid.viewStartedWithViewClass;
  fireAndForget(method, [viewClass, viewLabel]);
}

function viewStoppedAutoCaptured(viewClass, viewLabel) {
  var method = Object.prototype.hasOwnProperty.call(
    Dataroid,
    "_viewStoppedWithViewClassAutoCaptured",
  )
    ? Dataroid._viewStoppedWithViewClassAutoCaptured
    : Dataroid.viewStoppedWithViewClass;
  fireAndForget(method, [viewClass, viewLabel]);
}

// ============================================
// NETWORK AUTO-CAPTURE
// ============================================

function enableNetworkCapture() {
  if (_state.network.patched) return;

  // Patch XMLHttpRequest
  _state.network.xhrOpen = XMLHttpRequest.prototype.open;
  _state.network.xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    var previous = this._dataroidTracking;
    // OPENED callbacks may send synchronously, so publish the new tracking
    // before native open. If open rejects, restore the original request.
    var next = {
      method: (method || "GET").toUpperCase(),
      url: typeof url === "string" ? url : String(url),
      trackedUrl: sanitizeTrackedUrl(url),
      startTime: 0,
    };
    this._dataroidTracking = next;
    var result;
    try {
      result = _state.network.xhrOpen.apply(this, arguments);
    } catch (error) {
      if (next.detach) next.detach();
      this._dataroidTracking = previous;
      throw error;
    }
    if (previous && previous.detach) previous.detach();
    return result;
  };

  XMLHttpRequest.prototype.send = function (body) {
    var tracking = this._dataroidTracking;
    var detach;
    // A second send on an active request throws natively; do not attach another
    // set of listeners or discard the first send's valid tracking.
    if (
      tracking &&
      !tracking.detach &&
      !tracking.completed &&
      shouldTrackUrl(tracking.url)
    ) {
      tracking.startTime = Date.now();
      tracking.completed = false;
      tracking.requestSize = body
        ? typeof body === "string"
          ? body.length
          : body.byteLength || body.size || 0
        : 0;

      var xhr = this;
      var completeOnce = function () {
        if (tracking.completed) return false;
        tracking.completed = true;
        tracking.detach = null;
        xhr.removeEventListener("loadend", onLoadEnd);
        xhr.removeEventListener("error", onError);
        xhr.removeEventListener("timeout", onTimeout);
        xhr.removeEventListener("abort", onAbort);
        // Old listeners may fire during a synchronous send from a new open's
        // OPENED callback. Detach them without reporting the replaced request.
        return xhr._dataroidTracking === tracking;
      };
      detach = tracking.detach = completeOnce;
      var onLoadEnd = function () {
        if (!completeOnce()) return;
        var duration = Date.now() - tracking.startTime;
        var statusCode = xhr.status;
        var responseSize = 0;
        try {
          var contentLength = xhr.getResponseHeader("content-length");
          responseSize = contentLength
            ? parseInt(contentLength, 10)
            : xhr.responseText
              ? xhr.responseText.length
              : 0;
        } catch (_) {}

        if (statusCode === 0) {
          fireAndForget(Dataroid.collectNetworkError, [
            {
              ac: true,
              url: tracking.trackedUrl,
              method: tracking.method,
              duration: duration,
              type: classifyNetworkError(),
              exception: "NetworkError",
              message: "Request failed with status 0",
            },
          ]);
        } else {
          var success = statusCode >= 200 && statusCode < 400;
          fireAndForget(Dataroid.collectHttpCall, [
            {
              ac: true,
              url: tracking.trackedUrl,
              method: tracking.method,
              statusCode: statusCode,
              duration: duration,
              success: success,
              requestPayloadSize: normalizePayloadSize(tracking.requestSize),
              responsePayloadSize: normalizePayloadSize(responseSize),
              errorType: success ? undefined : "HTTP_ERROR",
              errorCode: success ? undefined : String(statusCode),
              errorMessage: success ? undefined : xhr.statusText || "",
            },
          ]);
        }
      };

      var onError = function () {
        if (!completeOnce()) return;
        fireAndForget(Dataroid.collectNetworkError, [
          {
            ac: true,
            url: tracking.trackedUrl,
            method: tracking.method,
            duration: Date.now() - tracking.startTime,
            type: classifyNetworkError(),
            exception: "NetworkError",
            message: "Request failed",
          },
        ]);
      };

      var onTimeout = function () {
        if (!completeOnce()) return;
        fireAndForget(Dataroid.collectNetworkError, [
          {
            ac: true,
            url: tracking.trackedUrl,
            method: tracking.method,
            duration: Date.now() - tracking.startTime,
            type: "TIMEOUT_ERROR",
            exception: "TimeoutError",
            message: "Request timed out",
          },
        ]);
      };

      var onAbort = function () {
        if (!completeOnce()) return;
        fireAndForget(Dataroid.collectNetworkError, [
          {
            ac: true,
            url: tracking.trackedUrl,
            method: tracking.method,
            duration: Date.now() - tracking.startTime,
            type: classifyNetworkError({ name: "AbortError" }),
            exception: "AbortError",
            message: "Request aborted",
          },
        ]);
      };

      this.addEventListener("loadend", onLoadEnd);
      this.addEventListener("error", onError);
      this.addEventListener("timeout", onTimeout);
      this.addEventListener("abort", onAbort);
    }
    try {
      return _state.network.xhrSend.apply(this, arguments);
    } catch (error) {
      if (detach) detach();
      throw error;
    }
  };

  // Patch fetch
  if (typeof window.fetch === "function") {
    _state.network.originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var url =
        typeof input === "string"
          ? input
          : input && input.url
            ? input.url
            : String(input);
      var method =
        (init && init.method) ||
        (input && typeof input.method === "string" && input.method) ||
        "GET";
      method = String(method).toUpperCase();

      if (!shouldTrackUrl(url)) {
        return _state.network.originalFetch.apply(window, arguments);
      }

      var trackedUrl = sanitizeTrackedUrl(url);
      var startTime = Date.now();
      var requestBody = init && init.body;
      var fetchRequestSize = requestBody
        ? typeof requestBody === "string"
          ? requestBody.length
          : requestBody.byteLength || requestBody.size || 0
        : 0;

      return _state.network.originalFetch.apply(window, arguments).then(
        function (response) {
          var duration = Date.now() - startTime;
          var success = response.status >= 200 && response.status < 400;
          var contentLength =
            response.headers && response.headers.get("content-length");
          var fetchResponseSize = contentLength
            ? parseInt(contentLength, 10)
            : 0;
          fireAndForget(Dataroid.collectHttpCall, [
            {
              ac: true,
              url: trackedUrl,
              method: method,
              statusCode: response.status,
              duration: duration,
              success: success,
              requestPayloadSize: normalizePayloadSize(fetchRequestSize),
              responsePayloadSize: normalizePayloadSize(fetchResponseSize),
              errorType: success ? undefined : "HTTP_ERROR",
              errorCode: success ? undefined : String(response.status),
              errorMessage: success ? undefined : response.statusText,
            },
          ]);
          return response;
        },
        function (error) {
          var duration = Date.now() - startTime;
          fireAndForget(Dataroid.collectNetworkError, [
            {
              ac: true,
              url: trackedUrl,
              method: method,
              duration: duration,
              type: classifyNetworkError(error),
              exception: (error && error.name) || "FetchError",
              message: (error && error.message) || "Fetch failed",
            },
          ]);
          throw error;
        },
      );
    };
  }

  _state.network.patched = true;
}

function disableNetworkCapture() {
  if (!_state.network.patched) return;
  if (_state.network.xhrOpen)
    XMLHttpRequest.prototype.open = _state.network.xhrOpen;
  if (_state.network.xhrSend)
    XMLHttpRequest.prototype.send = _state.network.xhrSend;
  if (_state.network.originalFetch) window.fetch = _state.network.originalFetch;
  _state.network = {
    xhrOpen: null,
    xhrSend: null,
    originalFetch: null,
    patched: false,
  };
}

// ============================================
// SCREEN TRACKING AUTO-CAPTURE
// ============================================

function extractViewName() {
  var path;
  if (window.location.hash) {
    path = window.location.hash.replace(/^#\/?/, "") || "home";
  } else {
    path = window.location.pathname.replace(/^\//, "");
    if (window.location.protocol === "file:") {
      // Keep paths relative to the standard Cordova app bundle, including
      // nested pages. Other file URLs use only the filename, not a device path.
      var bundledPath = path.match(
        /(?:\.app\/www\/|^android_asset\/www\/)(.*)$/,
      );
      path = bundledPath
        ? bundledPath[1]
        : path.substring(path.lastIndexOf("/") + 1);
    }
    path = path || "home";
  }

  path = path.split("?")[0];

  if (
    _config.screenNameMapper &&
    typeof _config.screenNameMapper === "function"
  ) {
    var mapped = _config.screenNameMapper(path, window.location);
    if (mapped) return mapped;
  }

  return path;
}

function trackScreenChange() {
  var newView = extractViewName();
  if (newView === _state.screen.currentView) return;

  var ignored = _config.ignoredScreens || [];
  for (var i = 0; i < ignored.length; i++) {
    var pattern = ignored[i];
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      if (pattern.test(newView)) return;
    }
    if (typeof pattern === "string" && newView === pattern) return;
  }

  if (_state.screen.currentView) {
    viewStoppedAutoCaptured(
      _state.screen.currentView,
      _state.screen.currentView,
    );
  }

  _state.screen.currentView = newView;
  viewStartedAutoCaptured(newView, newView);
}

function onHashChange() {
  trackScreenChange();
}
function onPopState() {
  trackScreenChange();
}

function enableScreenCapture() {
  if (_state.screen.patched) return;

  trackScreenChange();

  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("popstate", onPopState);

  _state.screen.pushState = history.pushState;
  _state.screen.replaceState = history.replaceState;

  history.pushState = function () {
    _state.screen.pushState.apply(history, arguments);
    trackScreenChange();
  };
  history.replaceState = function () {
    _state.screen.replaceState.apply(history, arguments);
    trackScreenChange();
  };

  _state.screen.patched = true;
}

function disableScreenCapture() {
  if (!_state.screen.patched) return;
  window.removeEventListener("hashchange", onHashChange);
  window.removeEventListener("popstate", onPopState);
  if (_state.screen.pushState) history.pushState = _state.screen.pushState;
  if (_state.screen.replaceState)
    history.replaceState = _state.screen.replaceState;

  if (_state.screen.currentView) {
    viewStoppedAutoCaptured(
      _state.screen.currentView,
      _state.screen.currentView,
    );
  }
  _state.screen = {
    currentView: null,
    pushState: null,
    replaceState: null,
    patched: false,
  };
}

// ============================================
// COMPONENT INTERACTION AUTO-CAPTURE
// ============================================

function onClickCapture(event) {
  var target = event.target;
  var interactive = findInteractiveAncestor(target);
  if (!interactive) return;

  var el = interactive.el;
  if (interactive.type === "radio") return;
  // Native controls emit change for committed updates, including keyboard
  // interaction. Their click must not produce a second component event.
  if (interactive.type === "toggle") {
    if (isNativeToggleElement(el)) return;
    // A custom wrapper delegates its state to its native control. Label
    // activation also dispatches an input click/change, which owns the event.
    if (
      typeof el.querySelector === "function" &&
      el.querySelector('input[type="checkbox"], input[type="radio"]')
    )
      return;
  }
  var id = getComponentIdentifier(el);

  if (interactive.type === "toggle") {
    var ctx = getScreenContext();
    setTimeout(function () {
      // A marker added by the application click handler must also apply.
      if (isSensitiveElement(el)) omitSensitiveLabels(id);
      var ariaChecked = el.getAttribute("aria-checked");
      id.isChecked =
        ariaChecked !== null
          ? ariaChecked === "true"
          : el.checked !== undefined
            ? el.checked
            : undefined;
      fireAndForget(Dataroid.collectToggleChangeEvent, [id, ctx]);
    }, 0);
  } else if (interactive.type === "button") {
    fireAndForget(Dataroid.collectButtonClickEvent, [id, getScreenContext()]);
  }
}

function textChangeKey(el) {
  if (el.id) return "id:" + el.id;
  if (el.name) return "name:" + el.name;

  var key = _elementKeys.get(el);
  if (!key) {
    key = "el:" + ++_elementKeyCounter;
    _elementKeys.set(el, key);
  }
  return key;
}

function onInputCapture(event) {
  var el = event.target;
  if (!isTextInput(el)) return;

  var elId = textChangeKey(el);
  var previous = _textChangeTimers[elId];
  // Once an input in this debounce window is sensitive, removing its marker
  // or revealing its password must not expose the accumulated text.
  var sensitive =
    isSensitiveElement(el) ||
    !!(previous && previous.element === el && previous.sensitive);
  if (previous) clearTimeout(previous.timer);

  var pending = { element: el, sensitive: sensitive, timer: null };
  pending.timer = setTimeout(function () {
    delete _textChangeTimers[elId];
    var redactSensitive = sensitive || isSensitiveElement(el);
    var id = getElementIdentifier(el, redactSensitive);
    if (redactSensitive) id.accessibilityLabel = undefined;
    id.textValue = redactSensitive
      ? ""
      : sanitizeTextValue(el.isContentEditable ? el.textContent : el.value);
    id.placeholder = redactSensitive
      ? undefined
      : (el.placeholder || "").substring(0, MAX_PLACEHOLDER_LENGTH) ||
        undefined;
    fireAndForget(Dataroid.collectTextChangeEvent, [id, getScreenContext()]);
  }, TEXT_CHANGE_DEBOUNCE_MS);
  _textChangeTimers[elId] = pending;
}

function onChangeCapture(event) {
  var el = event.target;
  if (isRadioElement(el)) {
    // Native change only reports the newly selected option. Ignore deselection.
    if (!el.checked) return;
    var radioId = getComponentIdentifier(el);
    if (!isSensitiveElement(el)) {
      radioId.label =
        el.getAttribute(_config.labelAttribute || "data-dataroid-label") ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.value ||
        undefined;
    }
    fireAndForget(Dataroid._collectRadioButtonSelectedEventAutoCaptured, [
      radioId,
      getScreenContext(),
    ]);
  } else if (isToggleElement(el)) {
    var id = getComponentIdentifier(el);
    id.isChecked = el.checked !== undefined ? el.checked : undefined;
    fireAndForget(Dataroid.collectToggleChangeEvent, [id, getScreenContext()]);
  }
}

function enableComponentCapture() {
  if (_state.component.patched) return;
  document.addEventListener("click", onClickCapture, {
    capture: true,
    passive: true,
  });
  document.addEventListener("input", onInputCapture, {
    capture: true,
    passive: true,
  });
  document.addEventListener("change", onChangeCapture, {
    capture: true,
    passive: true,
  });
  _state.component.patched = true;
}

function disableComponentCapture() {
  if (!_state.component.patched) return;
  document.removeEventListener("click", onClickCapture, { capture: true });
  document.removeEventListener("input", onInputCapture, { capture: true });
  document.removeEventListener("change", onChangeCapture, { capture: true });
  Object.keys(_textChangeTimers).forEach(function (k) {
    clearTimeout(_textChangeTimers[k].timer);
  });
  _textChangeTimers = {};
  _state.component.patched = false;
}

// ============================================
// GESTURE AUTO-CAPTURE
// ============================================

function onTouchStart(event) {
  var touch = event.touches[0];
  if (!touch) return;

  if (_state.gesture.longPressTimer)
    clearTimeout(_state.gesture.longPressTimer);

  _state.gesture.activePointer = {
    startX: touch.clientX,
    startY: touch.clientY,
    startTime: Date.now(),
    moved: false,
    longPressFired: false,
    target: event.target,
  };

  _state.gesture.longPressTimer = setTimeout(function () {
    var ptr = _state.gesture.activePointer;
    if (ptr && !ptr.moved) {
      ptr.longPressFired = true;
      var id = getElementIdentifier(ptr.target);
      id.touchPoint = { x: Math.round(ptr.startX), y: Math.round(ptr.startY) };
      fireAndForget(Dataroid.collectLongPressEvent, [id, getScreenContext()]);
    }
  }, LONG_PRESS_DURATION);
}

function onTouchMove(event) {
  var ptr = _state.gesture.activePointer;
  if (!ptr) return;
  var touch = event.touches[0];
  if (!touch) return;

  var dx = Math.abs(touch.clientX - ptr.startX);
  var dy = Math.abs(touch.clientY - ptr.startY);
  if (dx > TOUCH_SLOP || dy > TOUCH_SLOP) {
    ptr.moved = true;
    if (_state.gesture.longPressTimer) {
      clearTimeout(_state.gesture.longPressTimer);
      _state.gesture.longPressTimer = null;
    }
  }
}

function onTouchEnd(event) {
  if (_state.gesture.longPressTimer) {
    clearTimeout(_state.gesture.longPressTimer);
    _state.gesture.longPressTimer = null;
  }

  var ptr = _state.gesture.activePointer;
  if (!ptr) return;

  var touch = event.changedTouches[0];
  if (!touch) {
    _state.gesture.activePointer = null;
    return;
  }

  var endX = touch.clientX;
  var endY = touch.clientY;
  var endTime = Date.now();
  var duration = endTime - ptr.startTime;
  var dx = endX - ptr.startX;
  var dy = endY - ptr.startY;
  var distance = Math.sqrt(dx * dx + dy * dy);
  var velocity = duration > 0 ? distance / duration : 0;

  if (ptr.longPressFired) {
    _state.gesture.activePointer = null;
    return;
  }

  var screenAttrs = getScreenContext();
  var id = getElementIdentifier(ptr.target);

  if (
    distance >= SWIPE_THRESHOLD_DISTANCE &&
    velocity >= SWIPE_THRESHOLD_VELOCITY
  ) {
    id.swipePoints = {
      swipeStart: { x: Math.round(ptr.startX), y: Math.round(ptr.startY) },
      swipeEnd: { x: Math.round(endX), y: Math.round(endY) },
    };
    fireAndForget(Dataroid.collectSwipeEvent, [id, screenAttrs]);
    _state.gesture.lastTap = null;
  } else if (!ptr.moved) {
    var lastTap = _state.gesture.lastTap;
    if (
      lastTap &&
      endTime - lastTap.time < DOUBLE_TAP_DELAY &&
      Math.abs(endX - lastTap.x) < TOUCH_SLOP * 2 &&
      Math.abs(endY - lastTap.y) < TOUCH_SLOP * 2
    ) {
      id.touchPoint = { x: Math.round(endX), y: Math.round(endY) };
      fireAndForget(Dataroid.collectDoubleTapEvent, [id, screenAttrs]);
      _state.gesture.lastTap = null;
    } else {
      _state.gesture.lastTap = { x: endX, y: endY, time: endTime };
      id.touchPoint = { x: Math.round(endX), y: Math.round(endY) };
      fireAndForget(Dataroid.collectTouchEvent, [id, screenAttrs]);
    }
  }

  _state.gesture.activePointer = null;
}

function onTouchCancel() {
  if (_state.gesture.longPressTimer) {
    clearTimeout(_state.gesture.longPressTimer);
    _state.gesture.longPressTimer = null;
  }
  _state.gesture.activePointer = null;
  _state.gesture.lastTap = null;
}

function enableGestureCapture() {
  if (_state.gesture.patched) return;
  document.addEventListener("touchstart", onTouchStart, {
    capture: true,
    passive: true,
  });
  document.addEventListener("touchmove", onTouchMove, {
    capture: true,
    passive: true,
  });
  document.addEventListener("touchend", onTouchEnd, {
    capture: true,
    passive: true,
  });
  document.addEventListener("touchcancel", onTouchCancel, {
    capture: true,
    passive: true,
  });
  _state.gesture.patched = true;
}

function disableGestureCapture() {
  if (!_state.gesture.patched) return;
  document.removeEventListener("touchstart", onTouchStart, { capture: true });
  document.removeEventListener("touchmove", onTouchMove, { capture: true });
  document.removeEventListener("touchend", onTouchEnd, { capture: true });
  document.removeEventListener("touchcancel", onTouchCancel, { capture: true });
  if (_state.gesture.longPressTimer)
    clearTimeout(_state.gesture.longPressTimer);
  _state.gesture = {
    patched: false,
    lastTap: null,
    longPressTimer: null,
    activePointer: null,
  };
}

// ============================================
// PUBLIC API
// ============================================

function resolveFeatures(config) {
  return {
    networkTracking: config.networkTracking !== false,
    screenTracking: config.screenTracking !== false,
    componentInteractions: config.componentInteractions !== false,
    gestures: config.gestures !== false,
  };
}

// Brings every feature to the requested state, so one call can turn a feature on
// and another off. Each enable/disable is a no-op when already in that state.
function applyFeatures(features) {
  if (features.networkTracking) enableNetworkCapture();
  else disableNetworkCapture();

  if (features.screenTracking) enableScreenCapture();
  else disableScreenCapture();

  if (features.componentInteractions) enableComponentCapture();
  else disableComponentCapture();

  if (features.gestures) enableGestureCapture();
  else disableGestureCapture();
}

var DataroidAutoCapture = {
  /**
   * Enables auto-capture. Every feature not explicitly disabled in the config is
   * turned on. Calling this again replaces the configuration: features are
   * brought to the requested state, so it doubles as a reconfigure.
   */
  enable: function (config) {
    _config = config || {};
    var features = resolveFeatures(_config);
    applyFeatures(features);

    if (Dataroid._debug) {
      console.log("[Dataroid AutoCapture] Enabled with features:", features);
    }
  },

  /**
   * Turns individual features on or off while auto-capture is running. Only the
   * keys present in the argument change; the rest keep their current state.
   * @param {Object} features - Any subset of the feature flags
   */
  setFeatures: function (features) {
    if (!features || typeof features !== "object") {
      console.warn("[Dataroid AutoCapture] setFeatures requires an object");
      return;
    }

    // The target state starts from what is actually running, not from the
    // config: an absent key means "leave as is" here, while for enable() an
    // absent key means "on".
    var target = {
      networkTracking: _state.network.patched,
      screenTracking: _state.screen.patched,
      componentInteractions: _state.component.patched,
      gestures: _state.gesture.patched,
    };

    Object.keys(target).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(features, key)) {
        target[key] = features[key] !== false;
      }
    });

    _config = Object.assign({}, _config, features);
    applyFeatures(target);

    if (Dataroid._debug) {
      console.log("[Dataroid AutoCapture] Features updated:", target);
    }
  },

  /** Turns every feature off. */
  disable: function () {
    applyFeatures({
      networkTracking: false,
      screenTracking: false,
      componentInteractions: false,
      gestures: false,
    });
    _config = {};
  },

  /** True while at least one feature is capturing. */
  isEnabled: function () {
    return (
      _state.network.patched ||
      _state.screen.patched ||
      _state.component.patched ||
      _state.gesture.patched
    );
  },

  enableNetworkTracking: function (config) {
    _config = Object.assign(_config, config || {}, { networkTracking: true });
    enableNetworkCapture();
  },

  disableNetworkTracking: function () {
    _config.networkTracking = false;
    disableNetworkCapture();
  },

  enableScreenTracking: function (config) {
    _config = Object.assign(_config, config || {}, { screenTracking: true });
    enableScreenCapture();
  },

  disableScreenTracking: function () {
    _config.screenTracking = false;
    disableScreenCapture();
  },

  enableComponentTracking: function (config) {
    _config = Object.assign(_config, config || {}, {
      componentInteractions: true,
    });
    enableComponentCapture();
  },

  disableComponentTracking: function () {
    _config.componentInteractions = false;
    disableComponentCapture();
  },

  enableGestureTracking: function (config) {
    _config = Object.assign(_config, config || {}, { gestures: true });
    enableGestureCapture();
  },

  disableGestureTracking: function () {
    _config.gestures = false;
    disableGestureCapture();
  },
};

module.exports = DataroidAutoCapture;
