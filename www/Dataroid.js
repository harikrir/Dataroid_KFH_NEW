/**
 * Dataroid Cordova Plugin SDK
 *
 * A complete analytics, push notifications, and in-app messaging SDK for Cordova.
 * This plugin provides API parity with the Dataroid React Native SDK.
 *
 * Features:
 * - Promise-based API with backward-compatible callbacks
 * - Screen tracking and event collection
 * - User profile management
 * - E-commerce events
 * - Push notifications and in-app messaging
 * - App Inbox
 * - Context triggers
 * - APM (Application Performance Monitoring)
 * - Geofencing
 * - Super attributes
 *
 * @author Dataroid SDK Team
 */

"use strict";

var exec = require("cordova/exec");

// Event name constants (matching React Native SDK)
var EVENT_NAMES = {
  DEEPLINK: "DATAROID_DEEPLINK_EVENT",
  CREATE_MESSAGE: "DATAROID_CREATE_MESSAGE_EVENT",
  DELETE_MESSAGE: "DATAROID_DELETE_MESSAGE_EVENT",
  UPDATE_MESSAGE: "DATAROID_UPDATE_MESSAGE_EVENT",
  CONTEXT_TRIGGER: "DATAROID_CONTEXT_TRIGGER_EVENT",
};

// Plugin name for native bridge
var PLUGIN_NAME = "Dataroid";

// Crash reporting module-level state
var _crashReportingEnabled = false;
var _sourceMapUuid = null;
var _errorHandler = null;
var _rejectionHandler = null;

var UUID_FILENAME = "sourceMapUUID.js";
var UUID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
var SCRIPT_ERROR_REGEX = /^Script error\.?$/;
var MAX_EXCEPTION_KEYS = 10;

function discoverSourceMapUuid() {
  if (
    typeof window !== "undefined" &&
    typeof window.SOURCEMAP_UUID === "string" &&
    window.SOURCEMAP_UUID
  ) {
    return Promise.resolve(window.SOURCEMAP_UUID);
  }

  // WKWebView cannot read local files with XHR when the app uses the file://
  // scheme, so fall back to loading the file as a script.
  return readSourceMapUuidWithXhr().catch(function (error) {
    return loadSourceMapUuidScript().catch(function () {
      throw error;
    });
  });
}

function readSourceMapUuidWithXhr() {
  return new Promise(function (resolve, reject) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", (_appRootUrl || "") + UUID_FILENAME, true);
      xhr.onload = function () {
        if (xhr.status === 200 || xhr.status === 0) {
          var match = xhr.responseText.match(UUID_REGEX);
          if (match) {
            resolve(match[0]);
          } else {
            reject(new Error("Could not extract UUID from " + UUID_FILENAME));
          }
        } else {
          reject(
            new Error(
              'Source map UUID not found. Run "dataroid-crash-reporting prepare --output-dir www" during your build.',
            ),
          );
        }
      };
      xhr.onerror = function () {
        reject(
          new Error(
            'Source map UUID not found. Run "dataroid-crash-reporting prepare --output-dir www" during your build.',
          ),
        );
      };
      xhr.send();
    } catch (e) {
      reject(
        new Error(
          'Source map UUID not found. Run "dataroid-crash-reporting prepare --output-dir www" during your build.',
        ),
      );
    }
  });
}

/**
 * Loads sourceMapUUID.js with a script tag, which defines window.SOURCEMAP_UUID.
 * @returns {Promise<string>}
 */
function loadSourceMapUuidScript() {
  return new Promise(function (resolve, reject) {
    var script;
    function cleanup() {
      if (!script) return;
      script.onload = null;
      script.onerror = null;
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    try {
      if (typeof document === "undefined" || !document.createElement) {
        reject(new Error("No document to load " + UUID_FILENAME));
        return;
      }
      script = document.createElement("script");
      script.src = (_appRootUrl || "") + UUID_FILENAME;
      script.onload = function () {
        cleanup();
        var value =
          typeof window !== "undefined" ? window.SOURCEMAP_UUID : undefined;
        var match = typeof value === "string" ? value.match(UUID_REGEX) : null;
        if (match) {
          resolve(match[0]);
        } else {
          reject(new Error("Could not extract UUID from " + UUID_FILENAME));
        }
      };
      script.onerror = function () {
        cleanup();
        reject(new Error("Could not load " + UUID_FILENAME));
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Validates that a value is a non-empty string
 * @param {*} value - Value to validate
 * @param {string} name - Parameter name for error messages
 * @returns {boolean}
 */
function isValidString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  return true;
}

/**
 * Creates a validation error object
 * @param {string} message - Error message
 * @returns {Object}
 */
function createValidationError(message) {
  return {
    success: false,
    name: "ValidationError",
    message: message,
  };
}

/**
 * Normalizes success result
 * @param {*} result - Raw result from native
 * @returns {Object}
 */
function normalizeSuccess(result) {
  var normalized = { success: true };

  if (result && typeof result === "object") {
    Object.keys(result).forEach(function (key) {
      normalized[key] = result[key];
    });
  }

  return normalized;
}

/**
 * Normalizes error result
 * @param {*} error - Raw error from native
 * @returns {Object}
 */
function normalizeError(error) {
  var normalized = {
    success: false,
    name: "Error",
    message: "Unknown error",
  };

  if (error && typeof error === "object") {
    normalized.name = error.name || "Error";
    normalized.message = error.message || JSON.stringify(error);
  } else if (typeof error === "string") {
    normalized.message = error;
  }

  return normalized;
}

/**
 * Converts plain attribute values into the typed { type, value } format
 * expected by native (iOS/Android). Already-typed entries are passed through.
 *
 * @param {Object|null} attrs - Raw attributes map
 * @returns {Object|null} Formatted attributes or null
 */
function formatAttributes(attrs) {
  if (!attrs || typeof attrs !== "object") {
    return null;
  }

  var formatted = {};
  var keys = Object.keys(attrs);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = attrs[key];

    if (
      val !== null &&
      typeof val === "object" &&
      typeof val.type === "string"
    ) {
      formatted[key] = val;
      continue;
    }

    if (typeof val === "string") {
      formatted[key] = { type: "string", value: val };
    } else if (typeof val === "number") {
      formatted[key] = Number.isInteger(val)
        ? { type: "number", value: val }
        : { type: "float", value: val };
    } else if (typeof val === "boolean") {
      formatted[key] = { type: "boolean", value: val };
    } else if (val instanceof Date) {
      formatted[key] = { type: "date", value: val.toISOString() };
    } else if (val !== null && val !== undefined) {
      formatted[key] = { type: "string", value: String(val) };
    }
  }

  return formatted;
}

var ERROR_HEADER_RE = /\S*Error: /;
var MAX_LINE_LENGTH = 1024;
var FRAME_LIMIT = 50;

/**
 * Parse a JS stack trace string into structured frames.
 * Supports Chrome/V8 and Safari/JSC formats with hardened parsing:
 * error header skip, native code filtering, ReDoS protection (1024 char limit),
 * frame limit (50), case-insensitive matching, optional column numbers,
 * and safe @ handling for scoped packages in URLs.
 * @param {string} stack - Raw stack trace string
 * @returns {Array<{file: string, methodName: string, line: number, column: number}>}
 */
function parseStackTrace(stack) {
  if (!stack || typeof stack !== "string") {
    return [];
  }

  var frames = [];
  var lines = stack.split("\n");

  var chromeRe =
    /^\s*at\s+(?:(.+?)\s+\((.+?)(?::(\d+))?(?::(\d+))?\)|(.+?)(?::(\d+))?(?::(\d+))?)\s*$/i;
  var safariRe =
    /^\s*(.*?)(?:\((.*?)\))?(?:^|@)((?:[-a-z]+:\/\/|\/|\.{0,2}\/).+?)(?::(\d+))?(?::(\d+))?\s*$/i;

  for (var i = 0; i < lines.length && frames.length < FRAME_LIMIT; i++) {
    var line = lines[i];
    if (!line || !line.trim()) continue;
    if (ERROR_HEADER_RE.test(line)) continue;
    if (line.indexOf("[native code]") !== -1) continue;
    if (line.indexOf("(native)") !== -1) continue;
    if (line.length > MAX_LINE_LENGTH) line = line.slice(0, MAX_LINE_LENGTH);

    var match = chromeRe.exec(line);
    if (match) {
      // V8 reports built-ins without a script location, e.g. "at JSON.parse (<anonymous>)"
      // or "at async Promise.all (index 0)". They have no source map to symbolicate with,
      // so skip them like Safari's [native code] frames.
      if (match[2] && match[2].indexOf("/") !== -1) {
        frames.push({
          file: match[2],
          methodName: match[1] || "<anonymous>",
          line: match[3] ? parseInt(match[3], 10) : 0,
          column: match[4] ? parseInt(match[4], 10) : 0,
        });
      } else if (match[5] && match[5].indexOf("/") !== -1) {
        frames.push({
          file: match[5],
          methodName: "<anonymous>",
          line: match[6] ? parseInt(match[6], 10) : 0,
          column: match[7] ? parseInt(match[7], 10) : 0,
        });
      }
      continue;
    }
    match = safariRe.exec(line);
    if (match && match[3]) {
      frames.push({
        file: match[3],
        methodName: match[1] || "<anonymous>",
        line: match[4] ? parseInt(match[4], 10) : 0,
        column: match[5] ? parseInt(match[5], 10) : 0,
      });
    }
  }
  return frames;
}

function isLocalUrl(url) {
  return (
    /^file:\/\//i.test(url) ||
    /^(?:capacitor|ionic|app):\/\//i.test(url) ||
    /^https?:\/\/localhost(?::\d+)?(?:\/|$)/i.test(url) ||
    /^https?:\/\/(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(url)
  );
}

/**
 * Finds the URL of the app's www root from the cordova.js script, which every
 * Cordova app loads from its www root. This works for any WebView scheme and
 * hostname (for example a custom "hostname" or "scheme" preference).
 * @returns {string|null} Root URL ending with "/", or null when unavailable
 */
function findAppRootUrl() {
  try {
    if (typeof document === "undefined" || !document.getElementsByTagName) {
      return null;
    }
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = (scripts[i] && scripts[i].src) || "";
      src = src.replace(/[?#].*$/, "");
      if (/^[a-z][a-z0-9+.-]*:\/\/.*\/cordova\.js$/i.test(src)) {
        return src.slice(0, -"cordova.js".length);
      }
    }
  } catch (e) {
    // Fall back to the scheme-based normalization.
  }
  return null;
}

// Resolved once at load time: script.src resolves against the current page URL,
// which client-side routing can change later.
var _appRootUrl = findAppRootUrl();

function normalizeFrameUrl(url) {
  if (!url || typeof url !== "string") return url;

  if (_appRootUrl) {
    var withoutQuery = url.replace(/[?#].*$/, "");
    if (withoutQuery.indexOf(_appRootUrl) === 0) {
      var relative = withoutQuery.slice(_appRootUrl.length);
      try {
        return decodeURIComponent(relative);
      } catch (e) {
        return relative;
      }
    }
  }

  if (!isLocalUrl(url)) return url;

  url = url.replace(/[?#].*$/, "");
  url = url.replace(/^(?:https?|file|capacitor|ionic|app):\/\//i, "");
  url = url.replace(/^\/*(?:localhost|[\d.]+)(?::\d+)?/, "");

  var wwwIdx = url.indexOf("/www/");
  if (wwwIdx !== -1) {
    url = url.slice(wwwIdx + 4);
  }

  url = url.replace(/^\/+/, "");

  return url;
}

// collectError rejects when reporting fails. If the app leaves that rejection
// unhandled, the SDK's own unhandledrejection handler must not report it back as a
// fatal crash, so these rejections carry a hidden flag.
var COLLECT_ERROR_REJECTION_FLAG = "__dataroidCollectErrorRejection";

function markCollectErrorRejection(error) {
  if (error && typeof error === "object") {
    try {
      Object.defineProperty(error, COLLECT_ERROR_REJECTION_FLAG, {
        value: true,
      });
    } catch (e) {
      // A frozen object cannot be flagged; it is then reported like any rejection
    }
  }
  return error;
}

function isCollectErrorRejection(value) {
  return (
    !!value &&
    typeof value === "object" &&
    value[COLLECT_ERROR_REJECTION_FLAG] === true
  );
}

/**
 * Converts a crash field to a string before it crosses the bridge. iOS passes
 * these values to Swift as strings, and a number or an object there crashes the
 * app. Empty values use the fallback.
 */
function textOrDefault(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch (e) {
    return fallback;
  }
}

function isErrorLike(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  if (typeof Error !== "undefined" && value instanceof Error) return true;
  return (
    typeof value.message === "string" ||
    typeof value.name === "string" ||
    typeof value.stack === "string"
  );
}

/**
 * Describes a thrown or rejected value that is not an Error, so the report keeps
 * what was thrown. Objects are described by their keys only, as their values may
 * hold user data.
 */
function describeNonErrorValue(value, isRejection) {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function")
  ) {
    var keys = [];
    try {
      keys = Object.keys(value);
    } catch (e) {
      // Keep the description without keys
    }
    var description =
      "Object captured as " + (isRejection ? "promise rejection" : "exception");
    if (keys.length === 0) return description + " with no keys";
    var shown = keys.slice(0, MAX_EXCEPTION_KEYS).join(", ");
    if (keys.length > MAX_EXCEPTION_KEYS) shown += ", ...";
    return description + " with keys: " + shown;
  }
  var text;
  try {
    text = String(value);
  } catch (e) {
    text = typeof value;
  }
  return (
    (isRejection
      ? "Non-Error promise rejection captured with value: "
      : "Non-Error exception captured with value: ") + text
  );
}

/**
 * Builds a single frame from the location the WebView reported for an error
 * event, for errors that carry no stack. A stack captured here would only point
 * at this handler.
 */
function framesFromEventLocation(event) {
  return typeof event.filename === "string" &&
    event.filename.indexOf("/") !== -1
    ? [
        {
          file: event.filename,
          methodName: "<anonymous>",
          line: event.lineno || 0,
          column: event.colno || 0,
        },
      ]
    : [];
}

function handleCrashEvent(event) {
  try {
    if (isCollectErrorRejection(event.reason)) return;
    // An unhandledrejection event carries the rejected value in `reason`, which can
    // be any value, including undefined.
    var isRejection = event.error == null && "reason" in event;
    var value = isRejection ? event.reason : event.error;
    var error;
    var frames;
    if (isErrorLike(value)) {
      error = value;
      frames = parseStackTrace(error.stack);
    } else if (isRejection || value != null) {
      // A string, number or plain object was thrown or rejected.
      error = {
        name: "Error",
        message: describeNonErrorValue(value, isRejection),
      };
      frames = isRejection ? [] : framesFromEventLocation(event);
    } else {
      var message = event.message || "Unknown error";
      frames = framesFromEventLocation(event);
      // The WebView hides errors from scripts it treats as another origin (every
      // file:// script on iOS): the message becomes "Script error." and the
      // location is removed. Drop only these, which carry nothing to report.
      if (frames.length === 0 && SCRIPT_ERROR_REGEX.test(message)) return;
      error = { name: "Error", message: message };
    }

    for (var i = 0; i < frames.length; i++) {
      frames[i].file = normalizeFrameUrl(frames[i].file);
    }

    var payload = {
      uuid: _sourceMapUuid,
      exceptionType: textOrDefault(error.name, "Error"),
      exceptionReason: textOrDefault(error.message, "Unknown error"),
      frames: frames,
    };
    Dataroid._collectCrash(payload);
  } catch (e) {
    // Handler must never throw
  }
}

/**
 * Creates a promisified exec call with optional callback support
 * @param {string} action - Native action to call
 * @param {Array} args - Arguments to pass
 * @param {Function} [callback] - Optional callback (if provided, returns undefined instead of Promise)
 * @returns {Promise|undefined}
 */
function execAsync(action, args, callback) {
  var hasCallback = typeof callback === "function";

  if (hasCallback) {
    // Callback mode - backward compatible
    exec(
      function (result) {
        callback(normalizeSuccess(result));
      },
      function (error) {
        callback(normalizeError(error));
      },
      PLUGIN_NAME,
      action,
      args || [],
    );
    return;
  }

  // Promise mode
  return new Promise(function (resolve, reject) {
    exec(
      function (result) {
        resolve(normalizeSuccess(result));
      },
      function (error) {
        reject(normalizeError(error));
      },
      PLUGIN_NAME,
      action,
      args || [],
    );
  });
}

/**
 * Handles validation and execution
 * @param {Function} validator - Validation function returning error object or null
 * @param {string} action - Native action
 * @param {Array} args - Arguments
 * @param {Function} [callback] - Optional callback
 * @returns {Promise|undefined}
 */
function validateAndExec(validator, action, args, callback) {
  var validationError = validator();

  if (validationError) {
    if (typeof callback === "function") {
      callback(validationError);
      return;
    }
    return Promise.reject(validationError);
  }

  return execAsync(action, args, callback);
}

// ============================================
// DATAROID SDK MAIN OBJECT
// ============================================

var Dataroid = {
  /**
   * Debug logging flag
   * @type {boolean}
   */
  _debug: false,

  /**
   * Context trigger subscriptions
   * @type {Array}
   */
  _contextTriggerSubscriptions: [],

  /**
   * Whether the single native context trigger listener is registered. The
   * native layer keeps one callback context, so every JS handler is served from
   * one registration and the fan-out happens here.
   */
  _contextTriggerListenerRegistered: false,

  /**
   * App Inbox subscriptions
   * @type {Object}
   */
  _inboxSubscriptions: {
    create: [],
    update: [],
    delete: [],
  },

  /** Engagement display subscriptions */
  _displaySubscriptions: {
    inApp: [],
    survey: [],
  },

  /**
   * Whether the single native listener behind each display subscription is
   * registered. Tracked separately from the handler list: a registration that
   * failed (for example before the SDK finished initializing) must be retried
   * by the next subscribe call, and the handler count cannot express that.
   */
  _displayListenerRegistered: {
    inApp: false,
    survey: false,
  },

  _formatAttributes: formatAttributes,

  // ============================================
  // INITIALIZATION & CONFIGURATION
  // ============================================

  /**
   * Enable or disable debug logging for both JS and native SDK layers.
   * JS debug logging is toggled immediately; native SDK log level is set
   * to VERBOSE (enabled) or default (disabled) via the native bridge.
   * @param {boolean} enabled - Whether debug logging is enabled
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setDebugEnabled: function (enabled, callback) {
    var self = this;
    self._debug = !!enabled;
    if (self._debug) {
      console.log("[Dataroid] Debug logging enabled");
    }
    return execAsync("setDebugEnabled", [!!enabled], callback);
  },

  /**
   * Log a debug message (if debug is enabled)
   * @param {string} message - Message to log
   * @private
   */
  _log: function (message) {
    if (this._debug) {
      console.log("[Dataroid] " + message);
    }
  },

  // ============================================
  // SCREEN TRACKING
  // ============================================

  /**
   * Track screen view started (legacy method - use viewStartedWithViewClass)
   * @deprecated Use viewStartedWithViewClass instead
   * @param {string} viewLabel - Screen label/name
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  viewStarted: function (viewLabel, callback) {
    var self = this;
    self._log("viewStarted: " + viewLabel);

    return validateAndExec(
      function () {
        if (!isValidString(viewLabel)) {
          return createValidationError("viewLabel is required");
        }
        return null;
      },
      "viewStarted",
      [viewLabel],
      callback,
    );
  },

  /**
   * Track screen view stopped (legacy method - use viewStoppedWithViewClass)
   * @deprecated Use viewStoppedWithViewClass instead
   * @param {string} viewLabel - Screen label/name
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  viewStopped: function (viewLabel, callback) {
    var self = this;
    self._log("viewStopped: " + viewLabel);

    return validateAndExec(
      function () {
        if (!isValidString(viewLabel)) {
          return createValidationError("viewLabel is required");
        }
        return null;
      },
      "viewStopped",
      [viewLabel],
      callback,
    );
  },

  /**
   * Track screen view started with view class
   * @param {string} viewClass - View class name
   * @param {string|null} viewLabel - Optional screen label
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  viewStartedWithViewClass: function (viewClass, viewLabel, callback) {
    var self = this;
    self._log("viewStartedWithViewClass: " + viewClass + ", " + viewLabel);

    return validateAndExec(
      function () {
        if (!isValidString(viewClass)) {
          return createValidationError("viewClass is required");
        }
        return null;
      },
      "viewStartedWithViewClass",
      [viewClass, viewLabel || null],
      callback,
    );
  },

  /**
   * Track screen view stopped with view class
   * @param {string} viewClass - View class name
   * @param {string|null} viewLabel - Optional screen label
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  viewStoppedWithViewClass: function (viewClass, viewLabel, callback) {
    var self = this;
    self._log("viewStoppedWithViewClass: " + viewClass + ", " + viewLabel);

    return validateAndExec(
      function () {
        if (!isValidString(viewClass)) {
          return createValidationError("viewClass is required");
        }
        return null;
      },
      "viewStoppedWithViewClass",
      [viewClass, viewLabel || null],
      callback,
    );
  },

  _viewStartedWithViewClassAutoCaptured: function (viewClass, viewLabel) {
    return execAsync(
      "viewStartedWithViewClassAutoCaptured",
      [viewClass, viewLabel || null],
      null,
    );
  },

  _viewStoppedWithViewClassAutoCaptured: function (viewClass, viewLabel) {
    return execAsync(
      "viewStoppedWithViewClassAutoCaptured",
      [viewClass, viewLabel || null],
      null,
    );
  },

  /**
   * Track screen view started with extra attributes
   * @param {string} viewClass - View class name
   * @param {string|null} viewLabel - Optional screen label
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  viewStartedWithExtras: function (
    viewClass,
    viewLabel,
    customAttributes,
    callback,
  ) {
    var self = this;
    self._log("viewStartedWithExtras: " + viewClass);

    return validateAndExec(
      function () {
        if (!isValidString(viewClass)) {
          return createValidationError("viewClass is required");
        }
        return null;
      },
      "viewStartedWithExtras",
      [viewClass, viewLabel || null, formatAttributes(customAttributes)],
      callback,
    );
  },

  /**
   * Track screen view stopped with extra attributes
   * @param {string} viewClass - View class name
   * @param {string|null} viewLabel - Optional screen label
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  viewStoppedWithExtras: function (
    viewClass,
    viewLabel,
    customAttributes,
    callback,
  ) {
    var self = this;
    self._log("viewStoppedWithExtras: " + viewClass);

    return validateAndExec(
      function () {
        if (!isValidString(viewClass)) {
          return createValidationError("viewClass is required");
        }
        return null;
      },
      "viewStoppedWithExtras",
      [viewClass, viewLabel || null, formatAttributes(customAttributes)],
      callback,
    );
  },

  // ============================================
  // EVENT COLLECTION
  // ============================================

  /**
   * Collect a custom event
   * @param {string} eventName - Event name
   * @param {Object|null} eventAttributes - Event attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectEvent: function (eventName, eventAttributes, callback) {
    var self = this;
    self._log("collectEvent: " + eventName);

    return validateAndExec(
      function () {
        if (!isValidString(eventName)) {
          return createValidationError("eventName is required");
        }
        return null;
      },
      "collectEvent",
      [eventName, formatAttributes(eventAttributes)],
      callback,
    );
  },

  // ============================================
  // USER MANAGEMENT
  // ============================================

  /**
   * Create or update a user profile using the same non-empty customerId.
   * @param {Object} userData - User data object with customerId and optional fields
   * @param {Object|null} extraData - Additional custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setUser: function (userData, extraData, callback) {
    var self = this;
    self._log("setUser: " + (userData && userData.customerId));

    return validateAndExec(
      function () {
        if (!userData || !isValidString(userData.customerId)) {
          return createValidationError("userData.customerId is required");
        }
        return null;
      },
      "setUser",
      [userData, formatAttributes(extraData)],
      callback,
    );
  },

  /**
   * Clear current user
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearUser: function (callback) {
    var self = this;
    self._log("clearUser");
    return execAsync("clearUser", [], callback);
  },

  // ============================================
  // COMMERCE EVENTS
  // ============================================

  /**
   * Track purchase event
   * @param {Array|null} products - Array of product objects
   * @param {Object} purchaseData - Purchase data (value, currency, success, etc.)
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  purchase: function (products, purchaseData, customAttributes, callback) {
    var self = this;
    self._log("purchase");

    return validateAndExec(
      function () {
        if (
          !purchaseData ||
          typeof purchaseData.value !== "number" ||
          !purchaseData.currency
        ) {
          return createValidationError(
            "purchaseData with value and currency is required",
          );
        }
        return null;
      },
      "purchase",
      [products || null, purchaseData, formatAttributes(customAttributes)],
      callback,
    );
  },

  /**
   * Track search event
   * @param {string} query - Search query
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  search: function (query, customAttributes, callback) {
    var self = this;
    self._log("search: " + query);

    return validateAndExec(
      function () {
        if (!isValidString(query)) {
          return createValidationError("query is required");
        }
        return null;
      },
      "search",
      [query, formatAttributes(customAttributes)],
      callback,
    );
  },

  /**
   * Track product view event
   * @param {Object} product - Product object
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  viewProduct: function (product, customAttributes, callback) {
    var self = this;
    self._log("viewProduct: " + (product && product.id));

    return validateAndExec(
      function () {
        if (!product || !product.id) {
          return createValidationError("product with id is required");
        }
        return null;
      },
      "viewProduct",
      [product, formatAttributes(customAttributes)],
      callback,
    );
  },

  /**
   * Track category view event
   * @param {string} category - Category name
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  viewCategory: function (category, customAttributes, callback) {
    var self = this;
    self._log("viewCategory: " + category);

    return validateAndExec(
      function () {
        if (!isValidString(category)) {
          return createValidationError("category is required");
        }
        return null;
      },
      "viewCategory",
      [category, formatAttributes(customAttributes)],
      callback,
    );
  },

  /**
   * Track add to cart event
   * @param {Object} product - Product object
   * @param {number} value - Value added
   * @param {number} totalCartValue - Total cart value
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  addToCart: function (
    product,
    value,
    totalCartValue,
    customAttributes,
    callback,
  ) {
    var self = this;
    self._log("addToCart: " + (product && product.id));

    return validateAndExec(
      function () {
        if (!product || !product.id) {
          return createValidationError("product with id is required");
        }
        return null;
      },
      "addToCart",
      [
        product,
        value || 0,
        totalCartValue || 0,
        formatAttributes(customAttributes),
      ],
      callback,
    );
  },

  /**
   * Track remove from cart event
   * @param {Object} product - Product object
   * @param {number} value - Value removed
   * @param {number} totalCartValue - Total cart value
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  removeFromCart: function (
    product,
    value,
    totalCartValue,
    customAttributes,
    callback,
  ) {
    var self = this;
    self._log("removeFromCart: " + (product && product.id));

    return validateAndExec(
      function () {
        if (!product || !product.id) {
          return createValidationError("product with id is required");
        }
        return null;
      },
      "removeFromCart",
      [
        product,
        value || 0,
        totalCartValue || 0,
        formatAttributes(customAttributes),
      ],
      callback,
    );
  },

  /**
   * Track clear cart event
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearCart: function (customAttributes, callback) {
    var self = this;
    self._log("clearCart");
    return execAsync(
      "clearCart",
      [formatAttributes(customAttributes)],
      callback,
    );
  },

  /**
   * Track start checkout event
   * @param {number} value - Checkout value
   * @param {string} currency - Currency code
   * @param {number} quantity - Item quantity
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  startCheckout: function (
    value,
    currency,
    quantity,
    customAttributes,
    callback,
  ) {
    var self = this;
    self._log("startCheckout");

    return validateAndExec(
      function () {
        if (typeof value !== "number" || !isValidString(currency)) {
          return createValidationError("value and currency are required");
        }
        return null;
      },
      "startCheckout",
      [value, currency, quantity || 0, formatAttributes(customAttributes)],
      callback,
    );
  },

  /**
   * Track add to wishlist event
   * @param {Object} product - Product object
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  addToWishList: function (product, customAttributes, callback) {
    var self = this;
    self._log("addToWishList: " + (product && product.id));

    return validateAndExec(
      function () {
        if (!product || !product.id) {
          return createValidationError("product with id is required");
        }
        return null;
      },
      "addToWishList",
      [product, formatAttributes(customAttributes)],
      callback,
    );
  },

  /**
   * Track remove from wishlist event
   * @param {Object} product - Product object
   * @param {Object|null} customAttributes - Custom attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  removeFromWishList: function (product, customAttributes, callback) {
    var self = this;
    self._log("removeFromWishList: " + (product && product.id));

    return validateAndExec(
      function () {
        if (!product || !product.id) {
          return createValidationError("product with id is required");
        }
        return null;
      },
      "removeFromWishList",
      [product, formatAttributes(customAttributes)],
      callback,
    );
  },

  // ============================================
  // DATABASE ENCRYPTION
  // ============================================

  /**
   * Configure database encryption for the Dataroid SDK.
   *
   * The Dataroid SDK stores collected events in a local SQLite database.
   * Encryption is disabled by default. When enabled, the database is
   * encrypted with AES-256 using the provided key.
   *
   * **Important:** For encryption to take effect, use the plugin variables
   * `DB_ENCRYPTION_KEY` and `DB_ENCRYPTION_ENABLED` at install time.
   * This runtime method serves as a programmatic alternative but encryption
   * must be configured before SDK initialization.
   *
   * @example
   * Dataroid.setDatabaseEncryption({
   *   encryptionKey: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
   *   enabled: true
   * });
   *
   * @param {Object} config - Encryption configuration
   * @param {string} config.encryptionKey - 64-character hex string (256-bit AES key)
   * @param {boolean} config.enabled - Whether database encryption is enabled
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setDatabaseEncryption: function (config, callback) {
    var self = this;
    self._log("setDatabaseEncryption");

    return validateAndExec(
      function () {
        if (!config || typeof config !== "object") {
          return createValidationError(
            "config object with encryptionKey and enabled is required",
          );
        }
        if (typeof config.enabled !== "boolean") {
          return createValidationError("config.enabled must be a boolean");
        }
        if (config.enabled) {
          if (
            typeof config.encryptionKey !== "string" ||
            config.encryptionKey.length !== 64
          ) {
            return createValidationError(
              "config.encryptionKey must be a 64-character hex string (256-bit AES key)",
            );
          }
          if (!/^[0-9a-fA-F]{64}$/.test(config.encryptionKey)) {
            return createValidationError(
              "config.encryptionKey must contain only hexadecimal characters",
            );
          }
        }
        return null;
      },
      "setDatabaseEncryption",
      [config],
      callback,
    );
  },

  // ============================================
  // SSL PINNING
  // ============================================

  /**
   * Configure SSL public key pinning for the Dataroid SDK.
   *
   * For install-time configuration (recommended), pass the same JSON as the
   * SSL_PINNING_POLICIES plugin variable. This method can also be called at
   * runtime, but SSL policies set after SDK initialization may only take effect
   * if the native SDK has not yet established its first network connection.
   *
   * Each policy object describes one endpoint and its trusted certificates.
   * Certificates can be provided as plain base64 strings or as typed objects.
   *
   * @example
   * Dataroid.setSSLPinning([
   *   {
   *     endpoint: 'api.example.com',
   *     certificates: ['MIIBij...base64...'],   // iOS: base64 DER certs
   *     pins: ['sha256/AAAA...']                 // Android: SPKI pin hashes
   *   },
   *   {
   *     endpoint: 'cdn.example.com',
   *     certificates: [
   *       { type: 'base64', value: 'MIIBij...base64...' },
   *       { type: 'file', fileName: 'cdn-cert', fileExtension: 'der' }
   *     ],
   *     pins: ['sha256/BBBB...', 'sha256/CCCC...']
   *   }
   * ]);
   *
   * @param {Array<Object>} trustPolicies - Array of trust policy objects
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setSSLPinning: function (trustPolicies, callback) {
    var self = this;
    self._log("setSSLPinning");

    return validateAndExec(
      function () {
        if (!Array.isArray(trustPolicies) || trustPolicies.length === 0) {
          return createValidationError(
            "trustPolicies must be a non-empty array",
          );
        }
        for (var i = 0; i < trustPolicies.length; i++) {
          var policy = trustPolicies[i];
          if (
            !policy ||
            typeof policy.endpoint !== "string" ||
            policy.endpoint.trim() === ""
          ) {
            return createValidationError(
              "each policy must have a non-empty endpoint string",
            );
          }
          var hasCerts =
            Array.isArray(policy.certificates) &&
            policy.certificates.length > 0;
          var hasPins = Array.isArray(policy.pins) && policy.pins.length > 0;
          if (!hasCerts && !hasPins) {
            return createValidationError(
              "each policy must have a non-empty certificates (iOS) or pins (Android) array",
            );
          }
        }
        return null;
      },
      "setSSLPinning",
      [trustPolicies],
      callback,
    );
  },

  // ============================================
  // SETTINGS & CONFIGURATION (RUNTIME)
  // ============================================

  /**
   * Enable event collection
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  enableEventCollecting: function (callback) {
    var self = this;
    self._log("enableEventCollecting");
    return execAsync("enableEventCollecting", [], callback);
  },

  /**
   * Disable event collection
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  disableEventCollecting: function (callback) {
    var self = this;
    self._log("disableEventCollecting");
    return execAsync("disableEventCollecting", [], callback);
  },

  /**
   * Enable in-app messaging
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  enableInAppMessaging: function (callback) {
    var self = this;
    self._log("enableInAppMessaging");
    return execAsync("enableInAppMessaging", [], callback);
  },

  /**
   * Disable in-app messaging
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  disableInAppMessaging: function (callback) {
    var self = this;
    self._log("disableInAppMessaging");
    return execAsync("disableInAppMessaging", [], callback);
  },

  /**
   * Set session drop duration
   * @param {number} duration - Duration in seconds
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setSessionDropDuration: function (duration, callback) {
    var self = this;
    self._log("setSessionDropDuration: " + duration);

    return validateAndExec(
      function () {
        if (typeof duration !== "number" || duration < 0) {
          return createValidationError("duration must be a positive number");
        }
        return null;
      },
      "setSessionDropDuration",
      [duration],
      callback,
    );
  },

  /**
   * Enable APM (Application Performance Monitoring) events
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  enableAPMEvents: function (callback) {
    var self = this;
    self._log("enableAPMEvents");
    return execAsync("enableAPMEvents", [], callback);
  },

  /**
   * Disable APM events
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  disableAPMEvents: function (callback) {
    var self = this;
    self._log("disableAPMEvents");
    return execAsync("disableAPMEvents", [], callback);
  },

  /**
   * Update SDK language
   * @param {string} languageCode - ISO language code
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  updateLanguage: function (languageCode, callback) {
    var self = this;
    self._log("updateLanguage: " + languageCode);

    return validateAndExec(
      function () {
        if (!isValidString(languageCode)) {
          return createValidationError("languageCode is required");
        }
        return null;
      },
      "updateLanguage",
      [languageCode],
      callback,
    );
  },

  // ============================================
  // APM (APPLICATION PERFORMANCE MONITORING)
  // ============================================

  /**
   * Collect network error
   * @param {Object} networkErrorData - Network error data
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectNetworkError: function (networkErrorData, callback) {
    var self = this;
    self._log("collectNetworkError");

    return validateAndExec(
      function () {
        if (!networkErrorData || !networkErrorData.url) {
          return createValidationError("networkErrorData with url is required");
        }
        return null;
      },
      "collectNetworkError",
      [networkErrorData],
      callback,
    );
  },

  /**
   * Collect HTTP call
   * @param {Object} httpCallData - HTTP call data
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectHttpCall: function (httpCallData, callback) {
    var self = this;
    self._log("collectHttpCall");

    return validateAndExec(
      function () {
        if (!httpCallData || !httpCallData.url) {
          return createValidationError("httpCallData with url is required");
        }
        return null;
      },
      "collectHttpCall",
      [httpCallData],
      callback,
    );
  },

  // ============================================
  // DEEPLINKS
  // ============================================

  /**
   * Track deeplink launch
   * @param {string} deeplink - Deeplink URL
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  deeplinkLaunched: function (deeplink, callback) {
    var self = this;
    self._log("deeplinkLaunched: " + deeplink);

    return validateAndExec(
      function () {
        if (!isValidString(deeplink)) {
          return createValidationError("deeplink is required");
        }
        return null;
      },
      "deeplinkLaunched",
      [deeplink],
      callback,
    );
  },

  /**
   * Register deeplink handler
   * Note: In Cordova, the callback is persistent and will be called each time a deeplink is received
   * @param {Function} callback - Callback function that receives deeplink URL (required)
   */
  handleDeeplink: function (callback) {
    var self = this;
    self._log("handleDeeplink - registering handler");

    if (typeof callback !== "function") {
      console.warn("[Dataroid] handleDeeplink requires a callback function");
      return;
    }

    // Register persistent callback with native
    exec(
      function (deeplink) {
        self._log("Received deeplink: " + deeplink);
        callback(deeplink);
      },
      function (error) {
        console.warn("[Dataroid] Deeplink handler error:", error);
      },
      PLUGIN_NAME,
      "handleDeeplink",
      [],
    );
  },

  // ============================================
  // GEOLOCATION
  // ============================================

  /**
   * Set country for geolocation. Must be a valid ISO 3166 Alpha 2 country code.
   * @param {string} country - ISO 3166 Alpha 2 country code (e.g. "CA", "TR", "US")
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setCountry: function (country, callback) {
    var self = this;
    self._log("setCountry: " + country);

    return validateAndExec(
      function () {
        if (!isValidString(country)) {
          return createValidationError(
            "country is required and must be a non-empty string",
          );
        }
        return null;
      },
      "setCountry",
      [country],
      callback,
    );
  },

  /**
   * Clear country geolocation attribute.
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearCountry: function (callback) {
    var self = this;
    self._log("clearCountry");
    return execAsync("clearCountry", [], callback);
  },

  /**
   * Set city for geolocation.
   * @param {string} city - City name (e.g. "Ontario", "Istanbul")
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setCity: function (city, callback) {
    var self = this;
    self._log("setCity: " + city);

    return validateAndExec(
      function () {
        if (!isValidString(city)) {
          return createValidationError(
            "city is required and must be a non-empty string",
          );
        }
        return null;
      },
      "setCity",
      [city],
      callback,
    );
  },

  /**
   * Clear city geolocation attribute.
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearCity: function (callback) {
    var self = this;
    self._log("clearCity");
    return execAsync("clearCity", [], callback);
  },

  /**
   * Set region for geolocation.
   * @param {string} region - Region or state name (e.g. "Central Canada")
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setRegion: function (region, callback) {
    var self = this;
    self._log("setRegion: " + region);

    return validateAndExec(
      function () {
        if (!isValidString(region)) {
          return createValidationError(
            "region is required and must be a non-empty string",
          );
        }
        return null;
      },
      "setRegion",
      [region],
      callback,
    );
  },

  /**
   * Clear region geolocation attribute.
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearRegion: function (callback) {
    var self = this;
    self._log("clearRegion");
    return execAsync("clearRegion", [], callback);
  },

  /**
   * Set continent for geolocation.
   * @param {string} continent - Continent name (e.g. "North America")
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setContinent: function (continent, callback) {
    var self = this;
    self._log("setContinent: " + continent);

    return validateAndExec(
      function () {
        if (!isValidString(continent)) {
          return createValidationError(
            "continent is required and must be a non-empty string",
          );
        }
        return null;
      },
      "setContinent",
      [continent],
      callback,
    );
  },

  /**
   * Clear continent geolocation attribute.
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearContinent: function (callback) {
    var self = this;
    self._log("clearContinent");
    return execAsync("clearContinent", [], callback);
  },

  /**
   * Set coordinates for geolocation.
   * @param {number} latitude - Latitude value, must be in range [-90, 90]
   * @param {number} longitude - Longitude value, must be in range [-180, 180]
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setCoordinates: function (latitude, longitude, callback) {
    var self = this;
    self._log("setCoordinates: " + latitude + ", " + longitude);

    return validateAndExec(
      function () {
        if (typeof latitude !== "number" || typeof longitude !== "number") {
          return createValidationError(
            "latitude and longitude must be numbers",
          );
        }
        if (latitude < -90 || latitude > 90) {
          return createValidationError("latitude must be in range [-90, 90]");
        }
        if (longitude < -180 || longitude > 180) {
          return createValidationError(
            "longitude must be in range [-180, 180]",
          );
        }
        return null;
      },
      "setCoordinates",
      [latitude, longitude],
      callback,
    );
  },

  /**
   * Clear coordinates geolocation attribute.
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearCoordinates: function (callback) {
    var self = this;
    self._log("clearCoordinates");
    return execAsync("clearCoordinates", [], callback);
  },

  // ============================================
  // GEOFENCING
  // ============================================

  /**
   * Enable geofencing
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  enableGeofence: function (callback) {
    var self = this;
    self._log("enableGeofence");
    return execAsync("enableGeofence", [], callback);
  },

  /**
   * Disable geofencing
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  disableGeofence: function (callback) {
    var self = this;
    self._log("disableGeofence");
    return execAsync("disableGeofence", [], callback);
  },

  // ============================================
  // COMPONENT INTERACTION TRACKING
  // ============================================

  /**
   * Collect button click event
   * @param {Object} attributes - Button attributes
   * @param {Object|null} screenAttributes - Screen attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectButtonClickEvent: function (attributes, screenAttributes, callback) {
    var self = this;
    self._log("collectButtonClickEvent");

    return validateAndExec(
      function () {
        if (!attributes || !attributes.className) {
          return createValidationError("attributes with className is required");
        }
        return null;
      },
      "collectButtonClickEvent",
      [attributes, screenAttributes || null],
      callback,
    );
  },

  /**
   * Collect text change event
   * @param {Object} attributes - Text field attributes
   * @param {Object|null} screenAttributes - Screen attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectTextChangeEvent: function (attributes, screenAttributes, callback) {
    var self = this;
    self._log("collectTextChangeEvent");

    return validateAndExec(
      function () {
        if (!attributes || !attributes.className) {
          return createValidationError("attributes with className is required");
        }
        return null;
      },
      "collectTextChangeEvent",
      [attributes, screenAttributes || null],
      callback,
    );
  },

  // Internal auto-capture route; radio has no new manual collection API.
  _collectRadioButtonSelectedEventAutoCaptured: function (
    attributes,
    screenAttributes,
  ) {
    return execAsync(
      "collectRadioButtonSelectedEvent",
      [attributes, screenAttributes || null],
      null,
    );
  },

  /**
   * Collect toggle change event
   * @param {Object} attributes - Toggle attributes
   * @param {Object|null} screenAttributes - Screen attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectToggleChangeEvent: function (attributes, screenAttributes, callback) {
    var self = this;
    self._log("collectToggleChangeEvent");

    return validateAndExec(
      function () {
        if (!attributes || !attributes.className) {
          return createValidationError("attributes with className is required");
        }
        return null;
      },
      "collectToggleChangeEvent",
      [attributes, screenAttributes || null],
      callback,
    );
  },

  /**
   * Collect touch event
   * @param {Object} attributes - Touch attributes
   * @param {Object|null} screenAttributes - Screen attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectTouchEvent: function (attributes, screenAttributes, callback) {
    var self = this;
    self._log("collectTouchEvent");

    return validateAndExec(
      function () {
        if (!attributes || !attributes.className) {
          return createValidationError("attributes with className is required");
        }
        return null;
      },
      "collectTouchEvent",
      [attributes, screenAttributes || null],
      callback,
    );
  },

  /**
   * Collect swipe event
   * @param {Object} attributes - Swipe attributes
   * @param {Object|null} screenAttributes - Screen attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectSwipeEvent: function (attributes, screenAttributes, callback) {
    var self = this;
    self._log("collectSwipeEvent");

    return validateAndExec(
      function () {
        if (!attributes || !attributes.className) {
          return createValidationError("attributes with className is required");
        }
        return null;
      },
      "collectSwipeEvent",
      [attributes, screenAttributes || null],
      callback,
    );
  },

  /**
   * Collect double tap event
   * @param {Object} attributes - Touch attributes
   * @param {Object|null} screenAttributes - Screen attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectDoubleTapEvent: function (attributes, screenAttributes, callback) {
    var self = this;
    self._log("collectDoubleTapEvent");

    return validateAndExec(
      function () {
        if (!attributes || !attributes.className) {
          return createValidationError("attributes with className is required");
        }
        return null;
      },
      "collectDoubleTapEvent",
      [attributes, screenAttributes || null],
      callback,
    );
  },

  /**
   * Collect long press event
   * @param {Object} attributes - Touch attributes
   * @param {Object|null} screenAttributes - Screen attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectLongPressEvent: function (attributes, screenAttributes, callback) {
    var self = this;
    self._log("collectLongPressEvent");

    return validateAndExec(
      function () {
        if (!attributes || !attributes.className) {
          return createValidationError("attributes with className is required");
        }
        return null;
      },
      "collectLongPressEvent",
      [attributes, screenAttributes || null],
      callback,
    );
  },

  // ============================================
  // SUPER ATTRIBUTES
  // ============================================

  /**
   * Get all super attributes
   * @param {Function} [callback] - Optional callback function with attributes array
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  getAllSuperAttributes: function (callback) {
    var self = this;
    self._log("getAllSuperAttributes");
    return execAsync("getAllSuperAttributes", [], callback);
  },

  /**
   * Set a super attribute
   * @param {Object} attributeData - Attribute data with key, type, and value
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  setSuperAttribute: function (attributeData, callback) {
    var self = this;
    self._log("setSuperAttribute: " + (attributeData && attributeData.key));

    return validateAndExec(
      function () {
        if (!attributeData || !attributeData.key || !attributeData.type) {
          return createValidationError(
            "attributeData with key and type is required",
          );
        }
        return null;
      },
      "setSuperAttribute",
      [attributeData],
      callback,
    );
  },

  /**
   * Clear a super attribute
   * @param {string} attributeKey - Attribute key to clear
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearSuperAttribute: function (attributeKey, callback) {
    var self = this;
    self._log("clearSuperAttribute: " + attributeKey);

    return validateAndExec(
      function () {
        if (!isValidString(attributeKey)) {
          return createValidationError("attributeKey is required");
        }
        return null;
      },
      "clearSuperAttribute",
      [attributeKey],
      callback,
    );
  },

  /**
   * Clear all super attributes
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  clearAllSuperAttributes: function (callback) {
    var self = this;
    self._log("clearAllSuperAttributes");
    return execAsync("clearAllSuperAttributes", [], callback);
  },

  // ============================================
  // APP INBOX
  // ============================================

  /**
   * Get app inbox messages
   * @param {Object|null} query - Query filter (type, status, from, to, anonymous)
   * @param {Function} [callback] - Optional callback function with messages array
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  getAppInboxMessages: function (query, callback) {
    var self = this;
    self._log("getAppInboxMessages");
    return execAsync("getAppInboxMessages", [query || null], callback);
  },

  /**
   * Delete an app inbox message
   * @param {string} messageId - Message ID to delete
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  deleteAppInboxMessage: function (messageId, callback) {
    var self = this;
    self._log("deleteAppInboxMessage: " + messageId);

    return validateAndExec(
      function () {
        if (!isValidString(messageId)) {
          return createValidationError("messageId is required");
        }
        return null;
      },
      "deleteAppInboxMessage",
      [messageId],
      callback,
    );
  },

  /**
   * Mark an app inbox message as read
   * @param {string} messageId - Message ID to mark as read
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  readAppInboxMessage: function (messageId, callback) {
    var self = this;
    self._log("readAppInboxMessage: " + messageId);

    return validateAndExec(
      function () {
        if (!isValidString(messageId)) {
          return createValidationError("messageId is required");
        }
        return null;
      },
      "readAppInboxMessage",
      [messageId],
      callback,
    );
  },

  /**
   * Subscribe to new app inbox messages
   * @param {Function} callback - Callback function that receives new messages (required)
   */
  subscribeToCreateAppInboxMessages: function (callback) {
    var self = this;
    self._log("subscribeToCreateAppInboxMessages");

    if (typeof callback !== "function") {
      console.warn(
        "[Dataroid] subscribeToCreateAppInboxMessages requires a callback function",
      );
      return;
    }

    self._inboxSubscriptions.create.push(callback);

    exec(
      function (result) {
        self._log("Received new inbox message");
        try {
          var message =
            typeof result === "string" ? JSON.parse(result) : result;
          callback(message);
        } catch (e) {
          console.warn("[Dataroid] Error parsing inbox create message:", e);
        }
      },
      function (error) {
        console.warn("[Dataroid] Create inbox subscription error:", error);
      },
      PLUGIN_NAME,
      "subscribeToCreateMessages",
      [],
    );
  },

  /**
   * Subscribe to deleted app inbox messages
   * @param {Function} callback - Callback function that receives deleted message ID (required)
   */
  subscribeToDeleteAppInboxMessages: function (callback) {
    var self = this;
    self._log("subscribeToDeleteAppInboxMessages");

    if (typeof callback !== "function") {
      console.warn(
        "[Dataroid] subscribeToDeleteAppInboxMessages requires a callback function",
      );
      return;
    }

    self._inboxSubscriptions.delete.push(callback);

    exec(
      function (messageId) {
        self._log("Received deleted message notification: " + messageId);
        callback(messageId);
      },
      function (error) {
        console.warn("[Dataroid] Delete inbox subscription error:", error);
      },
      PLUGIN_NAME,
      "subscribeToDeleteMessages",
      [],
    );
  },

  /**
   * Subscribe to updated app inbox messages
   * @param {Function} callback - Callback function that receives updated messages (required)
   */
  subscribeToUpdateAppInboxMessages: function (callback) {
    var self = this;
    self._log("subscribeToUpdateAppInboxMessages");

    if (typeof callback !== "function") {
      console.warn(
        "[Dataroid] subscribeToUpdateAppInboxMessages requires a callback function",
      );
      return;
    }

    self._inboxSubscriptions.update.push(callback);

    exec(
      function (result) {
        self._log("Received updated inbox message");
        try {
          var message =
            typeof result === "string" ? JSON.parse(result) : result;
          callback(message);
        } catch (e) {
          console.warn("[Dataroid] Error parsing inbox update message:", e);
        }
      },
      function (error) {
        console.warn("[Dataroid] Update inbox subscription error:", error);
      },
      PLUGIN_NAME,
      "subscribeToUpdateMessages",
      [],
    );
  },

  /**
   * Enable app inbox
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  enableAppInbox: function (callback) {
    var self = this;
    self._log("enableAppInbox");
    return execAsync("enableAppInbox", [], callback);
  },

  /**
   * Disable app inbox
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  disableAppInbox: function (callback) {
    var self = this;
    self._log("disableAppInbox");
    return execAsync("disableAppInbox", [], callback);
  },

  // ============================================
  // CONTEXT TRIGGERS
  // ============================================

  /**
   * Subscribe to context trigger events
   * @param {Function} callback - Callback function that receives context trigger results (required)
   */
  subscribeContextTrigger: function (callback) {
    var self = this;
    self._log("subscribeContextTrigger");

    if (typeof callback !== "function") {
      console.warn(
        "[Dataroid] subscribeContextTrigger requires a callback function",
      );
      return;
    }

    self._contextTriggerSubscriptions.push(callback);
    if (self._contextTriggerListenerRegistered) return;
    self._contextTriggerListenerRegistered = true;

    exec(
      function (result) {
        var parsed;
        try {
          parsed = typeof result === "string" ? JSON.parse(result) : result;
        } catch (e) {
          console.warn("[Dataroid] Error parsing context trigger result:", e);
          return;
        }
        self._contextTriggerSubscriptions.slice().forEach(function (handler) {
          handler(parsed);
        });
      },
      function (error) {
        // Registration failed, so let the next subscribe call try again.
        self._contextTriggerListenerRegistered = false;
        console.warn("[Dataroid] Context trigger subscription error:", error);
      },
      PLUGIN_NAME,
      "subscribeToContextTriggerResults",
      [],
    );
  },

  /**
   * Unsubscribe from context trigger events
   * @param {Function} callback - The callback to unsubscribe
   */
  unsubscribeContextTrigger: function (callback) {
    var self = this;
    self._log("unsubscribeContextTrigger");

    var previousCount = self._contextTriggerSubscriptions.length;
    self._contextTriggerSubscriptions =
      self._contextTriggerSubscriptions.filter(function (handler) {
        return handler !== callback;
      });

    // Release the native listener once the last handler is gone.
    if (previousCount > 0 && self._contextTriggerSubscriptions.length === 0) {
      self._contextTriggerListenerRegistered = false;
      exec(
        function () {},
        function (error) {
          console.warn(
            "[Dataroid] Context trigger unsubscription error:",
            error,
          );
        },
        PLUGIN_NAME,
        "unsubscribeFromContextTriggerResults",
        [],
      );
    }
  },

  /**
   * Subscribe to callbacks invoked immediately before an in-app message is displayed.
   * @param {Function} callback - Receives the in-app display details
   */
  subscribeToInAppMessageDisplayed: function (callback) {
    var self = this;
    if (typeof callback !== "function") {
      console.warn(
        "[Dataroid] subscribeToInAppMessageDisplayed requires a callback function",
      );
      return;
    }

    self._displaySubscriptions.inApp.push(callback);
    if (self._displayListenerRegistered.inApp) return;
    self._displayListenerRegistered.inApp = true;

    exec(
      function (event) {
        self._displaySubscriptions.inApp.slice().forEach(function (handler) {
          handler(event);
        });
      },
      function (error) {
        // Registration failed, so let the next subscribe call try again.
        self._displayListenerRegistered.inApp = false;
        console.warn("[Dataroid] In-app display subscription error:", error);
      },
      PLUGIN_NAME,
      "subscribeToInAppMessageDisplayedResults",
      [],
    );
  },

  /** Unsubscribe a previously registered in-app display callback. */
  unsubscribeFromInAppMessageDisplayed: function (callback) {
    var self = this;
    var previousCount = self._displaySubscriptions.inApp.length;
    self._displaySubscriptions.inApp = self._displaySubscriptions.inApp.filter(
      function (handler) {
        return handler !== callback;
      },
    );

    if (previousCount > 0 && self._displaySubscriptions.inApp.length === 0) {
      self._displayListenerRegistered.inApp = false;
      execAsync("unsubscribeFromInAppMessageDisplayedResults", []).catch(
        function (error) {
          console.warn(
            "[Dataroid] Failed to unsubscribe the in-app display listener:",
            error,
          );
        },
      );
    }
  },

  /**
   * Subscribe to callbacks invoked immediately before a survey is displayed.
   * @param {Function} callback - Receives the survey display details
   */
  subscribeToSurveyDisplayed: function (callback) {
    var self = this;
    if (typeof callback !== "function") {
      console.warn(
        "[Dataroid] subscribeToSurveyDisplayed requires a callback function",
      );
      return;
    }

    self._displaySubscriptions.survey.push(callback);
    if (self._displayListenerRegistered.survey) return;
    self._displayListenerRegistered.survey = true;

    exec(
      function (event) {
        self._displaySubscriptions.survey.slice().forEach(function (handler) {
          handler(event);
        });
      },
      function (error) {
        // Registration failed, so let the next subscribe call try again.
        self._displayListenerRegistered.survey = false;
        console.warn("[Dataroid] Survey display subscription error:", error);
      },
      PLUGIN_NAME,
      "subscribeToSurveyDisplayedResults",
      [],
    );
  },

  /** Unsubscribe a previously registered survey display callback. */
  unsubscribeFromSurveyDisplayed: function (callback) {
    var self = this;
    var previousCount = self._displaySubscriptions.survey.length;
    self._displaySubscriptions.survey =
      self._displaySubscriptions.survey.filter(function (handler) {
        return handler !== callback;
      });

    if (previousCount > 0 && self._displaySubscriptions.survey.length === 0) {
      self._displayListenerRegistered.survey = false;
      execAsync("unsubscribeFromSurveyDisplayedResults", []).catch(
        function (error) {
          console.warn(
            "[Dataroid] Failed to unsubscribe the survey display listener:",
            error,
          );
        },
      );
    }
  },

  // ============================================
  // CRASH REPORTING
  // ============================================

  _parseStackTrace: parseStackTrace,
  _normalizeFrameUrl: normalizeFrameUrl,
  _handleCrashEvent: handleCrashEvent,

  _collectCrash: function (payload) {
    try {
      exec(
        function () {},
        function () {},
        PLUGIN_NAME,
        "collectCrash",
        [payload],
      );
    } catch (e) {
      // Must never throw
    }
  },

  enableCrashReporting: function (callback) {
    var self = this;
    self._log("enableCrashReporting");

    var hasCallback = typeof callback === "function";

    return discoverSourceMapUuid()
      .then(function (uuid) {
        if (_crashReportingEnabled && typeof window !== "undefined") {
          window.removeEventListener("error", _errorHandler);
          window.removeEventListener("unhandledrejection", _rejectionHandler);
        }

        _sourceMapUuid = uuid;
        _errorHandler = handleCrashEvent;
        _rejectionHandler = handleCrashEvent;

        if (typeof window !== "undefined") {
          window.addEventListener("error", _errorHandler);
          window.addEventListener("unhandledrejection", _rejectionHandler);
        }

        _crashReportingEnabled = true;

        var result = { success: true };
        if (hasCallback) {
          callback(result);
        }
        return result;
      })
      .catch(function (err) {
        if (hasCallback) {
          callback(err);
          return;
        }
        throw err;
      });
  },

  disableCrashReporting: function (callback) {
    var self = this;
    self._log("disableCrashReporting");

    var hasCallback = typeof callback === "function";

    if (_crashReportingEnabled && typeof window !== "undefined") {
      window.removeEventListener("error", _errorHandler);
      window.removeEventListener("unhandledrejection", _rejectionHandler);
    }

    _crashReportingEnabled = false;
    _sourceMapUuid = null;
    _errorHandler = null;
    _rejectionHandler = null;

    var result = { success: true };
    if (hasCallback) {
      callback(result);
      return;
    }
    return Promise.resolve(result);
  },

  // ============================================
  // ERROR COLLECTION
  // ============================================

  /**
   * Collect a manually caught error. Accepts an Error object (or Error-like
   * object with at least a `message` property). Reports a non-fatal exception,
   * separately from automatically captured crashes, as in the RN/Flutter SDKs.
   * @param {Error} error - Error object to report
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  collectError: function (error, callback) {
    var self = this;
    self._log("collectError");

    var hasCallback = typeof callback === "function";

    if (
      !error ||
      (typeof error !== "object" && typeof error !== "function") ||
      !error.message
    ) {
      var err = createValidationError(
        "argument must be an Error object or Error-like object with a message property",
      );
      if (hasCallback) {
        callback(err);
        return;
      }
      return Promise.reject(markCollectErrorRejection(err));
    }

    var payload = {
      exceptionType: textOrDefault(error.name, "Error"),
      exceptionReason: textOrDefault(error.message, "Unknown error"),
    };

    if (hasCallback) {
      return execAsync("collectError", [payload], callback);
    }
    return execAsync("collectError", [payload]).catch(function (failure) {
      throw markCollectErrorRejection(failure);
    });
  },

  // ============================================
  // SDK STATUS
  // ============================================

  /**
   * Get SDK initialization status and diagnostic information
   * @param {Function} [callback] - Optional callback function
   * @returns {Promise<Object>|undefined} Promise if no callback provided
   */
  getSdkStatus: function (callback) {
    var self = this;
    self._log("getSdkStatus");
    return execAsync("getSdkStatus", [], callback);
  },

  // ============================================
  // AUTO-CAPTURE
  // ============================================

  /**
   * Enables WebView auto-capture. Features not disabled in the config are turned
   * on. Calling this again applies the new configuration.
   * @param {Object} [config] - Auto-capture configuration
   */
  enableAutoCapture: function (config) {
    this._log("enableAutoCapture");
    require("./DataroidAutoCapture").enable(config);
  },

  /** Disables WebView auto-capture and restores the patched browser APIs. */
  disableAutoCapture: function () {
    this._log("disableAutoCapture");
    require("./DataroidAutoCapture").disable();
  },

  /**
   * Turns individual auto-capture features on or off at runtime. Only the keys
   * present in the argument change.
   * @param {Object} features - Any subset of networkTracking, screenTracking,
   *   componentInteractions and gestures
   */
  setAutoCaptureFeatures: function (features) {
    this._log("setAutoCaptureFeatures");
    require("./DataroidAutoCapture").setFeatures(features);
  },
};

// Export the module
module.exports = Dataroid;
