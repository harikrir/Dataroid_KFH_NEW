/**
 * Dataroid Cordova Plugin SDK Type Definitions
 *
 * @author Dataroid SDK Team
 */

declare namespace DataroidTypes {
  // ============================================
  // CALLBACK RESULTS
  // ============================================

  /**
   * Standard callback result
   */
  interface CallbackResult {
    success: boolean;
    name?: string;
    message?: string;
  }

  /**
   * Super attributes callback result
   */
  interface SuperAttributesResult extends CallbackResult {
    attributes?: Record<string, any>;
  }

  /**
   * SDK status information
   */
  interface SdkStatus {
    initialized: boolean;
    sdkVersion: string | null;
    framework: string;
    enabledModules: string[];
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    lastInitTimestamp: string | null;
  }

  /**
   * SDK status callback result
   */
  interface SdkStatusResult extends CallbackResult {
    status?: SdkStatus;
  }

  /**
   * Inbox messages callback result
   */
  interface InboxMessagesResult extends CallbackResult {
    messages?: InboxMessage[];
  }

  /** Auto-capture feature switches, usable at runtime. */
  interface AutoCaptureFeatures {
    networkTracking?: boolean;
    screenTracking?: boolean;
    componentInteractions?: boolean;
    gestures?: boolean;
  }

  /** WebView auto-capture configuration. */
  interface AutoCaptureConfig {
    networkTracking?: boolean;
    screenTracking?: boolean;
    componentInteractions?: boolean;
    gestures?: boolean;
    trackedDomains?: string[];
    ignoredUrls?: (string | RegExp)[];
    ignoredScreens?: (string | RegExp)[];
    labelAttribute?: string;
    redactTextValues?: boolean;
    screenNameMapper?: (path: string, location: Location) => string | null;
  }

  // ============================================
  // DATABASE ENCRYPTION
  // ============================================

  /**
   * Database encryption configuration.
   */
  interface DatabaseEncryptionConfig {
    /** 64-character hex string representing a 256-bit AES encryption key. */
    encryptionKey: string;
    /** Whether database encryption is enabled. */
    enabled: boolean;
  }

  // ============================================
  // SSL PINNING
  // ============================================

  /**
   * An SSL certificate for public key pinning.
   * - A plain string is treated as a base64-encoded certificate.
   * - An object with type "base64" provides the base64-encoded certificate data.
   * - An object with type "file" references a DER certificate bundled in the app.
   */
  type SSLCertificate =
    | string
    | { type: "base64"; value: string }
    | { type: "file"; fileName: string; fileExtension: string };

  /**
   * A trust policy that pins one or more certificates to an endpoint.
   * The endpoint should be a host or URL (e.g. "api.example.com").
   * Wildcards are not supported on iOS; Android supports *.example.com.
   *
   * - `certificates` (iOS): base64 DER certificates or file references.
   * - `pins` (Android): SPKI pin hashes prefixed with "sha256/" or "sha1/".
   *
   * Provide both fields for cross-platform support.
   */
  interface SSLTrustPolicy {
    endpoint: string;
    certificates?: SSLCertificate[];
    pins?: string[];
  }

  // ============================================
  // CALLBACK TYPES
  // ============================================

  /**
   * Standard callback function
   */
  type Callback = (result: CallbackResult) => void;

  /**
   * Super attributes callback function
   */
  type SuperAttributesCallback = (result: SuperAttributesResult) => void;

  /**
   * Inbox messages callback function
   */
  type InboxMessagesCallback = (result: InboxMessagesResult) => void;

  /**
   * SDK status callback function
   */
  type SdkStatusCallback = (result: SdkStatusResult) => void;

  /**
   * Deeplink callback function
   */
  type DeeplinkCallback = (deeplinkUrl: string) => void;

  /**
   * Context trigger callback function
   */
  type ContextTriggerCallback = (result: ContextTriggerResult) => void;

  interface InAppMessageDisplayedEvent {
    inAppMessageId?: string;
    triggerEvent?: string;
    location?: string;
    horizontalLocation?: string;
    dynamicAttributes?: Record<string, unknown>;
  }

  interface SurveyDisplayedEvent {
    surveyId?: string;
    triggerEvent?: string;
    location?: string;
    horizontalLocation?: string;
    /** Auto-close duration in milliseconds. Android only. */
    displayDuration?: number;
    dynamicAttributes?: Record<string, unknown>;
  }

  type InAppMessageDisplayedCallback = (
    event: InAppMessageDisplayedEvent,
  ) => void;

  type SurveyDisplayedCallback = (event: SurveyDisplayedEvent) => void;

  /**
   * Inbox message callback function
   */
  type InboxMessageCallback = (message: InboxMessage) => void;

  /**
   * Inbox message ID callback function
   */
  type InboxMessageIdCallback = (messageId: string) => void;

  // ============================================
  // ATTRIBUTE TYPES
  // ============================================

  /**
   * Attribute data types
   */
  type AttributeType =
    | "string"
    | "number"
    | "float"
    | "boolean"
    | "date"
    | "amount"
    | "string-array"
    | "number-array";

  /**
   * Attribute value structure
   */
  interface AttributeValue {
    type: AttributeType;
    value: string | number | boolean | string[] | number[];
    currency?: string;
  }

  /**
   * Custom attributes dictionary
   */
  interface CustomAttributes {
    [key: string]: AttributeValue;
  }

  // ============================================
  // USER DATA
  // ============================================

  /**
   * Gender options
   */
  type Gender = "MALE" | "FEMALE" | "NON_BINARY" | "UNKNOWN" | "UNDEFINED";

  /**
   * User data structure
   */
  interface UserData {
    customerId: string;
    email?: string;
    phoneNumber?: string;
    nationalId?: string;
    firstName?: string;
    lastName?: string;
    gender?: Gender;
    dateOfBirth?: string;
  }

  // ============================================
  // PRODUCT & COMMERCE
  // ============================================

  /**
   * Product structure
   */
  interface Product {
    id: string;
    name: string;
    quantity: number;
    price: number;
    currency: string;
    description?: string;
    brand?: string;
    variant?: string;
    category?: string;
  }

  /**
   * Purchase data structure
   */
  interface PurchaseData {
    value: number;
    currency: string;
    success: boolean;
    quantity?: number;
    tax?: number;
    ship?: number;
    discount?: number;
    coupon?: string;
    trxId?: string;
    paymentMethod?: string;
    errorCode?: string;
    errorMessage?: string;
  }

  // ============================================
  // SCREEN & COMPONENT TRACKING
  // ============================================

  /**
   * Screen attributes structure
   */
  interface ScreenAttributes {
    viewClass?: string;
    viewLabel?: string;
  }

  /**
   * Coordinates structure
   */
  interface Coordinates {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  /**
   * Touch point structure
   */
  interface TouchPoint {
    x: number;
    y: number;
  }

  /**
   * Swipe points structure
   */
  interface SwipePoints {
    swipeStart: TouchPoint;
    swipeEnd: TouchPoint;
  }

  /**
   * Base component attributes
   */
  interface BaseComponentAttributes {
    className: string;
    accessibilityLabel?: string;
    componentId?: string;
    coordinates?: Coordinates;
  }

  /**
   * Button click attributes
   */
  interface ButtonClickAttributes extends BaseComponentAttributes {
    label?: string;
  }

  /**
   * Text change attributes
   */
  interface TextChangeAttributes extends BaseComponentAttributes {
    textValue?: string;
    placeholder?: string;
  }

  /**
   * Toggle change attributes
   */
  interface ToggleChangeAttributes extends BaseComponentAttributes {
    isChecked: boolean;
  }

  /**
   * Touch attributes
   */
  interface TouchAttributes {
    className: string;
    touchPoint?: TouchPoint;
  }

  /**
   * Swipe attributes
   */
  interface SwipeAttributes {
    className: string;
    swipePoints?: SwipePoints;
  }

  // ============================================
  // SUPER ATTRIBUTES
  // ============================================

  /**
   * Super attribute types
   */
  type SuperAttributeType = "string" | "number" | "float" | "boolean" | "date";

  /**
   * Super attribute structure
   */
  interface SuperAttribute {
    key: string;
    type: SuperAttributeType;
    value: string | number | boolean;
  }

  // ============================================
  // APP INBOX
  // ============================================

  /**
   * Inbox message types
   */
  type InboxMessageType =
    | "PUSH_MESSAGE"
    | "INAPP_MESSAGE"
    | "GEOFENCE_MESSAGE"
    | "ACTION_BASED_MESSAGE";

  /**
   * Inbox message status
   */
  type InboxMessageStatus = "UNREAD" | "READ" | "DISMISSED";

  /**
   * Inbox query structure
   */
  interface InboxQuery {
    type?: InboxMessageType;
    status?: InboxMessageStatus;
    from?: string;
    to?: string;
    anonymous?: boolean;
  }

  /**
   * Push event structure
   */
  interface PushEvent {
    alert?: {
      title?: string;
      body?: string;
    };
    soundName?: string;
    pushId?: string;
    scheduleId?: string;
    mediaURL?: string;
    targetURL?: string;
    actionType?: string;
  }

  /**
   * In-app message data
   */
  interface InAppMessageData {
    messageId?: string;
  }

  /**
   * Action-based message structure
   */
  interface ActionBasedMessage {
    title?: string;
    text?: string;
    sound?: string;
    pushId?: string;
    scheduleId?: string;
    imageUrl?: string;
    actionTargetUrl?: string;
    actionType?: string;
    actionTypeIndex?: number;
    parameters?: Record<string, unknown>;
    alert?: {
      title?: string;
      body?: string;
    };
  }

  /**
   * Inbox message structure
   */
  interface InboxMessage {
    id: string;
    type: InboxMessageType;
    status: InboxMessageStatus;
    receivedDate: string;
    expirationDate?: string;
    customerId?: string;
    pushEvent?: PushEvent;
    inAppMessage?: InAppMessageData;
    geofenceEvent?: PushEvent;
    actionBasedMessage?: ActionBasedMessage;
  }

  // ============================================
  // CONTEXT TRIGGERS
  // ============================================

  /**
   * Context trigger result
   */
  interface ContextTriggerResult {
    contextTriggerId: string;
    machineOutput?: Record<string, unknown>;
  }

  // ============================================
  // APM (Application Performance Monitoring)
  // ============================================

  /**
   * HTTP call data
   */
  interface HttpCallData {
    url: string;
    method: string;
    statusCode: number;
    duration: number;
    success: boolean;
    errorType?: string;
    errorCode?: string;
    errorMessage?: string;
  }

  /**
   * Network error types
   */
  type NetworkErrorType =
    | "NO_CONNECTION_ERROR"
    | "SSL_ERROR"
    | "TIMEOUT_ERROR"
    | "UNKNOWN";

  /**
   * Network error data
   */
  interface NetworkErrorData {
    url: string;
    method: string;
    duration: number;
    type: NetworkErrorType;
    exception: string;
    message?: string;
  }

  // ============================================
  // ERROR COLLECTION
  // ============================================

  /**
   * Stack trace frame from crash reporting
   */
  interface CrashFrame {
    file: string;
    methodName?: string;
    line?: number;
    column?: number;
  }
}

/**
 * Dataroid Cordova Plugin SDK
 *
 * All methods support both callback and Promise-based invocation:
 * - With callback: `Dataroid.method(args, callback)` - returns undefined
 * - Without callback: `Dataroid.method(args)` - returns Promise
 */
interface DataroidStatic {
  // ============================================
  // INTERNAL PROPERTIES
  // ============================================

  /** Debug logging flag */
  _debug: boolean;

  /** Context trigger subscriptions */
  _contextTriggerSubscriptions: DataroidTypes.ContextTriggerCallback[];

  /** Whether the single native context trigger listener is registered */
  _contextTriggerListenerRegistered: boolean;

  /** App Inbox subscriptions */
  _inboxSubscriptions: {
    create: DataroidTypes.InboxMessageCallback[];
    update: DataroidTypes.InboxMessageCallback[];
    delete: DataroidTypes.InboxMessageIdCallback[];
  };

  /** Engagement display subscriptions */
  _displaySubscriptions: {
    inApp: DataroidTypes.InAppMessageDisplayedCallback[];
    survey: DataroidTypes.SurveyDisplayedCallback[];
  };

  /** Whether the native listener behind each display subscription is registered */
  _displayListenerRegistered: {
    inApp: boolean;
    survey: boolean;
  };

  // ============================================
  // DEBUG & CONFIGURATION
  // ============================================

  /**
   * Enable or disable debug logging for both JS and native SDK layers.
   * JS debug logging is toggled immediately; native SDK log level is set
   * to VERBOSE (enabled) or default (disabled) via the native bridge.
   * @param enabled - Whether debug logging is enabled
   */
  setDebugEnabled(enabled: boolean): Promise<DataroidTypes.CallbackResult>;
  setDebugEnabled(enabled: boolean, callback: DataroidTypes.Callback): void;

  // ============================================
  // SCREEN TRACKING
  // ============================================

  /**
   * Track screen view started (legacy method)
   * @deprecated Use viewStartedWithViewClass instead
   */
  viewStarted(viewLabel: string): Promise<DataroidTypes.CallbackResult>;
  viewStarted(viewLabel: string, callback: DataroidTypes.Callback): void;

  /**
   * Track screen view stopped (legacy method)
   * @deprecated Use viewStoppedWithViewClass instead
   */
  viewStopped(viewLabel: string): Promise<DataroidTypes.CallbackResult>;
  viewStopped(viewLabel: string, callback: DataroidTypes.Callback): void;

  /**
   * Track screen view started with view class
   */
  viewStartedWithViewClass(
    viewClass: string,
    viewLabel: string | null,
  ): Promise<DataroidTypes.CallbackResult>;
  viewStartedWithViewClass(
    viewClass: string,
    viewLabel: string | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track screen view stopped with view class
   */
  viewStoppedWithViewClass(
    viewClass: string,
    viewLabel: string | null,
  ): Promise<DataroidTypes.CallbackResult>;
  viewStoppedWithViewClass(
    viewClass: string,
    viewLabel: string | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track screen view started with extra attributes
   */
  viewStartedWithExtras(
    viewClass: string,
    viewLabel: string | null,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  viewStartedWithExtras(
    viewClass: string,
    viewLabel: string | null,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track screen view stopped with extra attributes
   */
  viewStoppedWithExtras(
    viewClass: string,
    viewLabel: string | null,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  viewStoppedWithExtras(
    viewClass: string,
    viewLabel: string | null,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  // ============================================
  // EVENT COLLECTION
  // ============================================

  /**
   * Collect a custom event
   */
  collectEvent(
    eventName: string,
    eventAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  collectEvent(
    eventName: string,
    eventAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  // ============================================
  // USER MANAGEMENT
  // ============================================

  /**
   * Create or update a user profile using the same non-empty customerId.
   */
  setUser(
    userData: DataroidTypes.UserData,
    extraData: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  setUser(
    userData: DataroidTypes.UserData,
    extraData: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Clear current user
   */
  clearUser(): Promise<DataroidTypes.CallbackResult>;
  clearUser(callback: DataroidTypes.Callback): void;

  // ============================================
  // COMMERCE EVENTS
  // ============================================

  /**
   * Track purchase event
   */
  purchase(
    products: DataroidTypes.Product[] | null,
    purchaseData: DataroidTypes.PurchaseData,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  purchase(
    products: DataroidTypes.Product[] | null,
    purchaseData: DataroidTypes.PurchaseData,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track search event
   */
  search(
    query: string,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  search(
    query: string,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track product view event
   */
  viewProduct(
    product: DataroidTypes.Product,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  viewProduct(
    product: DataroidTypes.Product,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track category view event
   */
  viewCategory(
    category: string,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  viewCategory(
    category: string,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track add to cart event
   */
  addToCart(
    product: DataroidTypes.Product,
    value: number,
    totalCartValue: number,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  addToCart(
    product: DataroidTypes.Product,
    value: number,
    totalCartValue: number,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track remove from cart event
   */
  removeFromCart(
    product: DataroidTypes.Product,
    value: number,
    totalCartValue: number,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  removeFromCart(
    product: DataroidTypes.Product,
    value: number,
    totalCartValue: number,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track clear cart event
   */
  clearCart(
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  clearCart(
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track start checkout event
   */
  startCheckout(
    value: number,
    currency: string,
    quantity: number,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  startCheckout(
    value: number,
    currency: string,
    quantity: number,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track add to wishlist event
   */
  addToWishList(
    product: DataroidTypes.Product,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  addToWishList(
    product: DataroidTypes.Product,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Track remove from wishlist event
   */
  removeFromWishList(
    product: DataroidTypes.Product,
    customAttributes: DataroidTypes.CustomAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  removeFromWishList(
    product: DataroidTypes.Product,
    customAttributes: DataroidTypes.CustomAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  // ============================================
  // DATABASE ENCRYPTION
  // ============================================

  /**
   * Configure database encryption for the Dataroid SDK.
   *
   * For install-time configuration (recommended), use the DB_ENCRYPTION_KEY
   * and DB_ENCRYPTION_ENABLED plugin variables. This method can also be called
   * at runtime, but encryption must be configured before SDK initialization.
   *
   * @param config - Encryption configuration with a 64-char hex key and enabled flag
   */
  setDatabaseEncryption(
    config: DataroidTypes.DatabaseEncryptionConfig,
  ): Promise<DataroidTypes.CallbackResult>;
  setDatabaseEncryption(
    config: DataroidTypes.DatabaseEncryptionConfig,
    callback: DataroidTypes.Callback,
  ): void;

  // ============================================
  // SSL PINNING
  // ============================================

  /**
   * Configure SSL public key pinning for the Dataroid SDK.
   *
   * For install-time configuration (recommended), use the SSL_PINNING_POLICIES
   * plugin variable. This method can also be called at runtime, but policies
   * set after SDK initialization may only apply if the native SDK has not yet
   * established its first network connection.
   *
   * @param trustPolicies - Array of trust policy objects
   */
  setSSLPinning(
    trustPolicies: DataroidTypes.SSLTrustPolicy[],
  ): Promise<DataroidTypes.CallbackResult>;
  setSSLPinning(
    trustPolicies: DataroidTypes.SSLTrustPolicy[],
    callback: DataroidTypes.Callback,
  ): void;

  // ============================================
  // SETTINGS & CONFIGURATION
  // ============================================

  /**
   * Enable event collection
   */
  enableEventCollecting(): Promise<DataroidTypes.CallbackResult>;
  enableEventCollecting(callback: DataroidTypes.Callback): void;

  /**
   * Disable event collection
   */
  disableEventCollecting(): Promise<DataroidTypes.CallbackResult>;
  disableEventCollecting(callback: DataroidTypes.Callback): void;

  /**
   * Enable in-app messaging
   */
  enableInAppMessaging(): Promise<DataroidTypes.CallbackResult>;
  enableInAppMessaging(callback: DataroidTypes.Callback): void;

  /**
   * Disable in-app messaging
   */
  disableInAppMessaging(): Promise<DataroidTypes.CallbackResult>;
  disableInAppMessaging(callback: DataroidTypes.Callback): void;

  /**
   * Set session drop duration
   */
  setSessionDropDuration(
    duration: number,
  ): Promise<DataroidTypes.CallbackResult>;
  setSessionDropDuration(
    duration: number,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Enable APM (Application Performance Monitoring) events
   */
  enableAPMEvents(): Promise<DataroidTypes.CallbackResult>;
  enableAPMEvents(callback: DataroidTypes.Callback): void;

  /**
   * Disable APM events
   */
  disableAPMEvents(): Promise<DataroidTypes.CallbackResult>;
  disableAPMEvents(callback: DataroidTypes.Callback): void;

  /**
   * Update SDK language
   */
  updateLanguage(languageCode: string): Promise<DataroidTypes.CallbackResult>;
  updateLanguage(languageCode: string, callback: DataroidTypes.Callback): void;

  // ============================================
  // APM (Application Performance Monitoring)
  // ============================================

  /**
   * Collect network error
   */
  collectNetworkError(
    networkErrorData: DataroidTypes.NetworkErrorData,
  ): Promise<DataroidTypes.CallbackResult>;
  collectNetworkError(
    networkErrorData: DataroidTypes.NetworkErrorData,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Collect HTTP call
   */
  collectHttpCall(
    httpCallData: DataroidTypes.HttpCallData,
  ): Promise<DataroidTypes.CallbackResult>;
  collectHttpCall(
    httpCallData: DataroidTypes.HttpCallData,
    callback: DataroidTypes.Callback,
  ): void;

  // ============================================
  // DEEPLINKS
  // ============================================

  /**
   * Track deeplink launch
   */
  deeplinkLaunched(deeplink: string): Promise<DataroidTypes.CallbackResult>;
  deeplinkLaunched(deeplink: string, callback: DataroidTypes.Callback): void;

  /**
   * Register deeplink handler (persistent callback)
   * Note: This method only supports callback mode as it needs to receive multiple events
   */
  handleDeeplink(callback: DataroidTypes.DeeplinkCallback): void;

  // ============================================
  // GEOLOCATION
  // ============================================

  /**
   * Set country for geolocation. Must be a valid ISO 3166 Alpha 2 country code.
   */
  setCountry(country: string): Promise<DataroidTypes.CallbackResult>;
  setCountry(country: string, callback: DataroidTypes.Callback): void;

  /**
   * Clear country geolocation attribute.
   */
  clearCountry(): Promise<DataroidTypes.CallbackResult>;
  clearCountry(callback: DataroidTypes.Callback): void;

  /**
   * Set city for geolocation.
   */
  setCity(city: string): Promise<DataroidTypes.CallbackResult>;
  setCity(city: string, callback: DataroidTypes.Callback): void;

  /**
   * Clear city geolocation attribute.
   */
  clearCity(): Promise<DataroidTypes.CallbackResult>;
  clearCity(callback: DataroidTypes.Callback): void;

  /**
   * Set region for geolocation.
   */
  setRegion(region: string): Promise<DataroidTypes.CallbackResult>;
  setRegion(region: string, callback: DataroidTypes.Callback): void;

  /**
   * Clear region geolocation attribute.
   */
  clearRegion(): Promise<DataroidTypes.CallbackResult>;
  clearRegion(callback: DataroidTypes.Callback): void;

  /**
   * Set continent for geolocation.
   */
  setContinent(continent: string): Promise<DataroidTypes.CallbackResult>;
  setContinent(continent: string, callback: DataroidTypes.Callback): void;

  /**
   * Clear continent geolocation attribute.
   */
  clearContinent(): Promise<DataroidTypes.CallbackResult>;
  clearContinent(callback: DataroidTypes.Callback): void;

  /**
   * Set coordinates for geolocation.
   * @param latitude - Must be in range [-90, 90]
   * @param longitude - Must be in range [-180, 180]
   */
  setCoordinates(
    latitude: number,
    longitude: number,
  ): Promise<DataroidTypes.CallbackResult>;
  setCoordinates(
    latitude: number,
    longitude: number,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Clear coordinates geolocation attribute.
   */
  clearCoordinates(): Promise<DataroidTypes.CallbackResult>;
  clearCoordinates(callback: DataroidTypes.Callback): void;

  // ============================================
  // GEOFENCING
  // ============================================

  /**
   * Enable geofencing
   */
  enableGeofence(): Promise<DataroidTypes.CallbackResult>;
  enableGeofence(callback: DataroidTypes.Callback): void;

  /**
   * Disable geofencing
   */
  disableGeofence(): Promise<DataroidTypes.CallbackResult>;
  disableGeofence(callback: DataroidTypes.Callback): void;

  // ============================================
  // COMPONENT INTERACTION TRACKING
  // ============================================

  /**
   * Collect button click event
   */
  collectButtonClickEvent(
    attributes: DataroidTypes.ButtonClickAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  collectButtonClickEvent(
    attributes: DataroidTypes.ButtonClickAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Collect text change event
   */
  collectTextChangeEvent(
    attributes: DataroidTypes.TextChangeAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  collectTextChangeEvent(
    attributes: DataroidTypes.TextChangeAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Collect toggle change event
   */
  collectToggleChangeEvent(
    attributes: DataroidTypes.ToggleChangeAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  collectToggleChangeEvent(
    attributes: DataroidTypes.ToggleChangeAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Collect touch event
   */
  collectTouchEvent(
    attributes: DataroidTypes.TouchAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  collectTouchEvent(
    attributes: DataroidTypes.TouchAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Collect swipe event
   */
  collectSwipeEvent(
    attributes: DataroidTypes.SwipeAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  collectSwipeEvent(
    attributes: DataroidTypes.SwipeAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Collect double tap event
   */
  collectDoubleTapEvent(
    attributes: DataroidTypes.TouchAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  collectDoubleTapEvent(
    attributes: DataroidTypes.TouchAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Collect long press event
   */
  collectLongPressEvent(
    attributes: DataroidTypes.TouchAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
  ): Promise<DataroidTypes.CallbackResult>;
  collectLongPressEvent(
    attributes: DataroidTypes.TouchAttributes,
    screenAttributes: DataroidTypes.ScreenAttributes | null,
    callback: DataroidTypes.Callback,
  ): void;

  // ============================================
  // SUPER ATTRIBUTES
  // ============================================

  /**
   * Get all super attributes
   */
  getAllSuperAttributes(): Promise<DataroidTypes.SuperAttributesResult>;
  getAllSuperAttributes(callback: DataroidTypes.SuperAttributesCallback): void;

  /**
   * Set a super attribute
   */
  setSuperAttribute(
    attributeData: DataroidTypes.SuperAttribute,
  ): Promise<DataroidTypes.CallbackResult>;
  setSuperAttribute(
    attributeData: DataroidTypes.SuperAttribute,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Clear a super attribute
   */
  clearSuperAttribute(
    attributeKey: string,
  ): Promise<DataroidTypes.CallbackResult>;
  clearSuperAttribute(
    attributeKey: string,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Clear all super attributes
   */
  clearAllSuperAttributes(): Promise<DataroidTypes.CallbackResult>;
  clearAllSuperAttributes(callback: DataroidTypes.Callback): void;

  // ============================================
  // APP INBOX
  // ============================================

  /**
   * Get app inbox messages
   */
  getAppInboxMessages(
    query: DataroidTypes.InboxQuery | null,
  ): Promise<DataroidTypes.InboxMessagesResult>;
  getAppInboxMessages(
    query: DataroidTypes.InboxQuery | null,
    callback: DataroidTypes.InboxMessagesCallback,
  ): void;

  /**
   * Delete an app inbox message
   */
  deleteAppInboxMessage(
    messageId: string,
  ): Promise<DataroidTypes.CallbackResult>;
  deleteAppInboxMessage(
    messageId: string,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Mark an app inbox message as read
   */
  readAppInboxMessage(messageId: string): Promise<DataroidTypes.CallbackResult>;
  readAppInboxMessage(
    messageId: string,
    callback: DataroidTypes.Callback,
  ): void;

  /**
   * Subscribe to new app inbox messages (persistent callback)
   */
  subscribeToCreateAppInboxMessages(
    callback: DataroidTypes.InboxMessageCallback,
  ): void;

  /**
   * Subscribe to deleted app inbox messages (persistent callback)
   */
  subscribeToDeleteAppInboxMessages(
    callback: DataroidTypes.InboxMessageIdCallback,
  ): void;

  /**
   * Subscribe to updated app inbox messages (persistent callback)
   */
  subscribeToUpdateAppInboxMessages(
    callback: DataroidTypes.InboxMessageCallback,
  ): void;

  /**
   * Enable app inbox
   */
  enableAppInbox(): Promise<DataroidTypes.CallbackResult>;
  enableAppInbox(callback: DataroidTypes.Callback): void;

  /**
   * Disable app inbox
   */
  disableAppInbox(): Promise<DataroidTypes.CallbackResult>;
  disableAppInbox(callback: DataroidTypes.Callback): void;

  // ============================================
  // CONTEXT TRIGGERS
  // ============================================

  /**
   * Subscribe to context trigger events (persistent callback)
   */
  subscribeContextTrigger(callback: DataroidTypes.ContextTriggerCallback): void;

  /**
   * Unsubscribe from context trigger events
   */
  unsubscribeContextTrigger(
    callback: DataroidTypes.ContextTriggerCallback,
  ): void;

  /** Subscribe to the event emitted immediately before an in-app message is shown. */
  subscribeToInAppMessageDisplayed(
    callback: DataroidTypes.InAppMessageDisplayedCallback,
  ): void;

  /** Unsubscribe a previously registered in-app display callback. */
  unsubscribeFromInAppMessageDisplayed(
    callback: DataroidTypes.InAppMessageDisplayedCallback,
  ): void;

  /** Subscribe to the event emitted immediately before a survey is shown. */
  subscribeToSurveyDisplayed(
    callback: DataroidTypes.SurveyDisplayedCallback,
  ): void;

  /** Unsubscribe a previously registered survey display callback. */
  unsubscribeFromSurveyDisplayed(
    callback: DataroidTypes.SurveyDisplayedCallback,
  ): void;

  // ============================================
  // CRASH REPORTING
  // ============================================

  /**
   * Enable JavaScript crash reporting with source map correlation.
   * Installs global error handlers to capture unhandled errors.
   * UUID is auto-discovered from window.SOURCEMAP_UUID or sourceMapUUID.js.
   * Run "dataroid-crash-reporting prepare --output-dir www" during build to generate the UUID file.
   */
  enableCrashReporting(): Promise<DataroidTypes.CallbackResult>;
  enableCrashReporting(callback: DataroidTypes.Callback): void;

  /**
   * Disable JavaScript crash reporting.
   * Removes global error handlers.
   */
  disableCrashReporting(): Promise<DataroidTypes.CallbackResult>;
  disableCrashReporting(callback: DataroidTypes.Callback): void;

  // ============================================
  // ERROR COLLECTION
  // ============================================

  /**
   * Report a manually caught non-fatal error. Sends its name and message via
   * the collectError bridge, without source-map UUID or stack frames.
   * @param error - Error object or Error-like object with a message property
   */
  collectError(error: Error): Promise<DataroidTypes.CallbackResult>;
  collectError(error: Error, callback: DataroidTypes.Callback): void;

  // ============================================
  // SDK STATUS
  // ============================================

  /**
   * Get SDK initialization status and diagnostic information
   */
  getSdkStatus(): Promise<DataroidTypes.SdkStatusResult>;
  getSdkStatus(callback: DataroidTypes.SdkStatusCallback): void;

  /**
   * Enable WebView network, screen, component, and gesture auto-capture.
   * Calling this again applies the new configuration.
   */
  enableAutoCapture(config?: DataroidTypes.AutoCaptureConfig): void;

  /** Disable WebView auto-capture and restore patched browser APIs. */
  disableAutoCapture(): void;

  /** Turn individual auto-capture features on or off at runtime. */
  setAutoCaptureFeatures(features: DataroidTypes.AutoCaptureFeatures): void;
}

/**
 * Global Dataroid SDK instance
 */
declare var Dataroid: DataroidStatic;

/**
 * Module export for CommonJS/ES modules
 */
declare module "cordova-plugin-dataroid-sdk" {
  export = Dataroid;
}

/**
 * Re-export types for external use
 */
export { DataroidTypes };
