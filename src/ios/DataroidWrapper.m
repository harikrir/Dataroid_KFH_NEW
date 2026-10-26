//
//  DataroidWrapper.m
//  Dataroid Cordova Plugin
//
//  Created by Dataroid Web Team
//

#import <DataroidSDK/DataroidSDK.h>
#import "DataroidWrapper.h"

@interface DataroidWrapper ()

// Callback command IDs for persistent listeners
@property (nonatomic, copy) NSString *deeplinkHandlerCommandId;
@property (nonatomic, copy) NSString *contextTriggerCommandId;
@property (nonatomic, copy) NSString *createMessagesCommandId;
@property (nonatomic, copy) NSString *deleteMessagesCommandId;
@property (nonatomic, copy) NSString *updateMessagesCommandId;
@property (nonatomic, copy) NSString *inAppMessageDisplayedCommandId;
@property (nonatomic, copy) NSString *surveyDisplayedCommandId;

- (void)initializeDataroidPlugin;
- (void)clearEngagementDisplayListeners;
- (BOOL)ensureSdkInitializedForCommand:(CDVInvokedUrlCommand *)command;
- (void)sendException:(NSException *)exception forCommand:(CDVInvokedUrlCommand *)command;

@end

@implementation DataroidWrapper

static DataroidWrapper *dataroidWrapper;
static DataroidConfig *dataroidConfig;
static NSString *deeplinkHost;
static NSString *deeplinkScheme;
static NSMutableString *supportedDeeplinkUrl;
static NSString *storedDeeplink;
static BOOL geofencingEnabled = NO;
static NSData *lastRegisteredPushToken = nil;

static NSString *FRAMEWORK = @"CORDOVA";

static void DTRRequireArgument(id value, NSString *name) {
    if (value == nil || value == [NSNull null]) {
        [NSException raise:@"IllegalArgumentException"
                    format:@"%@ is required", name];
    }
}

static NSString *DTRTrimmedSetting(id value) {
    if (![value isKindOfClass:[NSString class]]) {
        return @"";
    }
    return [(NSString *)value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
}

// Values from JavaScript are not guaranteed to be strings. A number, an object or
// NSNull typed as NSString * crashes when it is bridged to a Swift String, and
// @try cannot catch that, so anything that is not a string uses the fallback.
static NSString *DTRStringOrDefault(id value, NSString *fallback) {
    return [value isKindOfClass:[NSString class]] ? (NSString *)value : fallback;
}

// Validate before entering Swift's non-optional [String] / [Int] bridge.
static NSArray *DTRValidatedAttributeArray(id value, BOOL strings) {
    if (![value isKindOfClass:[NSArray class]]) return nil;
    NSMutableArray *validated = [NSMutableArray arrayWithCapacity:[value count]];
    for (id item in value) {
        if (strings) {
            if (![item isKindOfClass:[NSString class]]) return nil;
            [validated addObject:item];
        } else {
            if (![item isKindOfClass:[NSNumber class]] ||
                CFGetTypeID((__bridge CFTypeRef)item) == CFBooleanGetTypeID()) return nil;
            NSNumber *integer = @([item integerValue]);
            if (![item isEqualToNumber:integer]) return nil;
            [validated addObject:integer];
        }
    }
    return validated;
}

static void DTRCopyValue(NSMutableDictionary *target, NSDictionary *source, NSString *key, NSString *outputKey) {
    id value = source[key];
    if (value != nil && value != [NSNull null]) {
        target[outputKey] = value;
    }
}

static BOOL DTRPostHybridMessage(Dataroid *dataroid, NSString *method, NSDictionary *args) {
    if (dataroid == nil || method == nil) {
        return NO;
    }
    NSDictionary *envelope = @{ @"method": method, @"args": args ?: @{} };
    if (![NSJSONSerialization isValidJSONObject:envelope]) {
        return NO;
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (json == nil) {
        return NO;
    }
    [dataroid.internal postMessage:json];
    return YES;
}

static BOOL DTRForwardAutoCaptured(Dataroid *dataroid, NSString *method, NSDictionary *attributes, NSDictionary *screen) {
    if (![[attributes objectForKey:@"ac"] boolValue]) {
        return NO;
    }

    NSString *bridgeMethod = method;
    if ([method isEqualToString:@"collectHttpCall"]) bridgeMethod = @"collectHttpCallEvent";
    if ([method isEqualToString:@"collectNetworkError"]) bridgeMethod = @"collectNetworkErrorEvent";

    NSMutableDictionary *args = [NSMutableDictionary dictionary];
    DTRCopyValue(args, screen, @"viewLabel", @"viewLabel");
    DTRCopyValue(args, screen, @"viewClass", @"viewClass");

    if ([bridgeMethod isEqualToString:@"collectButtonClickEvent"] || [bridgeMethod isEqualToString:@"collectRadioButtonSelectedEvent"]) {
        for (NSString *key in @[@"className", @"label", @"accessibilityLabel", @"componentId", @"coordinates"]) {
            DTRCopyValue(args, attributes, key, key);
        }
    } else if ([bridgeMethod isEqualToString:@"collectTextChangeEvent"]) {
        DTRCopyValue(args, attributes, @"className", @"className");
        DTRCopyValue(args, attributes, @"textValue", @"value");
        for (NSString *key in @[@"placeholder", @"accessibilityLabel", @"componentId", @"coordinates"]) {
            DTRCopyValue(args, attributes, key, key);
        }
    } else if ([bridgeMethod isEqualToString:@"collectToggleChangeEvent"]) {
        for (NSString *key in @[@"className", @"isChecked", @"accessibilityLabel", @"componentId", @"coordinates"]) {
            DTRCopyValue(args, attributes, key, key);
        }
    } else if ([bridgeMethod isEqualToString:@"collectTouchEvent"] ||
               [bridgeMethod isEqualToString:@"collectDoubleTapEvent"] ||
               [bridgeMethod isEqualToString:@"collectLongPressEvent"]) {
        DTRCopyValue(args, attributes, @"touchPoint", @"touchPoint");
    } else if ([bridgeMethod isEqualToString:@"collectSwipeEvent"]) {
        NSDictionary *swipe = attributes[@"swipePoints"];
        DTRCopyValue(args, swipe, @"swipeStart", @"swipeStartPoint");
        DTRCopyValue(args, swipe, @"swipeEnd", @"swipeEndPoint");
    } else if ([bridgeMethod isEqualToString:@"collectHttpCallEvent"]) {
        NSDictionary *mapping = @{
            @"url": @"url", @"method": @"method", @"statusCode": @"statusCode",
            @"duration": @"duration", @"success": @"success",
            @"requestPayloadSize": @"requestSize", @"responsePayloadSize": @"responseSize",
            @"errorType": @"errorType", @"errorCode": @"errorCode",
            @"errorMessage": @"errorMessage", @"customAttributes": @"extras"
        };
        for (NSString *key in mapping) DTRCopyValue(args, attributes, key, mapping[key]);
    } else if ([bridgeMethod isEqualToString:@"collectNetworkErrorEvent"]) {
        NSDictionary *mapping = @{
            @"url": @"url", @"method": @"method", @"duration": @"duration",
            @"exception": @"exception", @"message": @"errorMessage",
            @"type": @"errorType", @"customAttributes": @"extras"
        };
        for (NSString *key in mapping) DTRCopyValue(args, attributes, key, mapping[key]);
    } else {
        return NO;
    }

    args[@"ac"] = @YES;
    return DTRPostHybridMessage(dataroid, bridgeMethod, args);
}

// SDK status tracking
static BOOL sdkInitialized = NO;
static NSString *sdkLastErrorCode = nil;
static NSString *sdkLastErrorMessage = nil;
static NSDate *sdkInitTimestamp = nil;
static NSArray<NSString *> *sdkEnabledModules = nil;

+ (DataroidWrapper *)dataroidWrapper {
    return dataroidWrapper;
}

#pragma mark - Plugin Lifecycle

- (void)pluginInitialize {
    @try {
        [self initializeDataroidPlugin];
    } @catch (NSException *exception) {
        sdkInitialized = NO;
        sdkLastErrorCode = @"DATAROID_E_INIT_RUNTIME";
        sdkLastErrorMessage = [NSString stringWithFormat:@"Dataroid SDK initialization failed (%@).", exception.name ?: @"NSException"];
        NSLog(@"[Dataroid][DATAROID_E_INIT_RUNTIME] %@", sdkLastErrorMessage);
    }
}

- (void)initializeDataroidPlugin {
    dataroidWrapper = self;

    // Read configuration from settings
    NSString *serverUrl = [self.commandDelegate.settings objectForKey:@"dataroid_server_url"];
    NSString *sdkKey = [self.commandDelegate.settings objectForKey:@"dataroid_sdk_key"];
    NSString *languageCode = DTRTrimmedSetting([self.commandDelegate.settings objectForKey:@"dataroid_language_code"]);
    NSString *appGroupIdentifier = DTRTrimmedSetting([self.commandDelegate.settings objectForKey:@"dataroid_app_group_identifier"]);

    deeplinkHost = DTRTrimmedSetting([self.commandDelegate.settings objectForKey:@"dataroid_deeplink_host"]);
    deeplinkScheme = DTRTrimmedSetting([self.commandDelegate.settings objectForKey:@"dataroid_deeplink_scheme"]);

    // Build supported deeplink URL
    if (deeplinkHost && deeplinkScheme && deeplinkScheme.length > 0 && deeplinkHost.length > 0) {
        supportedDeeplinkUrl = [NSMutableString stringWithString:deeplinkScheme];
        [supportedDeeplinkUrl appendString:@"://"];
        [supportedDeeplinkUrl appendString:deeplinkHost];
    }

    // Read feature flags (defaults must match plugin.xml preference defaults)
    BOOL logsEnabled = [[self.commandDelegate.settings objectForKey:@"dataroid_logs_enabled"] boolValue];
    NSString *pushEnabledStr = [self.commandDelegate.settings objectForKey:@"dataroid_push_enabled"];
    BOOL pushEnabled = pushEnabledStr ? [pushEnabledStr boolValue] : NO;
    NSString *inAppMsgStr = [self.commandDelegate.settings objectForKey:@"dataroid_in_app_messaging_enabled"];
    BOOL inAppMessagingEnabled = inAppMsgStr ? [inAppMsgStr boolValue] : YES;
    NSString *apmStr = [self.commandDelegate.settings objectForKey:@"dataroid_apm_enabled"];
    BOOL apmEnabled = apmStr ? [apmStr boolValue] : YES;
    NSString *appInboxStr = [self.commandDelegate.settings objectForKey:@"dataroid_app_inbox_enabled"];
    BOOL appInboxEnabled = appInboxStr ? [appInboxStr boolValue] : YES;
    BOOL geofenceEnabledConfig = [[self.commandDelegate.settings objectForKey:@"dataroid_geofence_enabled"] boolValue];
    NSString *snapshotEnabledStr = [self.commandDelegate.settings objectForKey:@"dataroid_snapshot_enabled"];
    BOOL snapshotEnabled = snapshotEnabledStr ? [snapshotEnabledStr boolValue] : NO;
    NSString *crashReportingStr = [self.commandDelegate.settings objectForKey:@"dataroid_crash_reporting_enabled"];
    BOOL crashReportingEnabled = crashReportingStr ? [crashReportingStr boolValue] : NO;
    NSString *crashThreadStr = [self.commandDelegate.settings objectForKey:@"dataroid_crash_reporting_thread_collection"];
    BOOL crashReportingThreadCollection = crashThreadStr ? [crashThreadStr boolValue] : NO;

    NSString *dbEncryptionKeyHex = [self.commandDelegate.settings objectForKey:@"dataroid_db_encryption_key"];
    NSString *dbEncryptionEnabledStr = [self.commandDelegate.settings objectForKey:@"dataroid_db_encryption_enabled"];
    BOOL dbEncryptionEnabled = dbEncryptionEnabledStr ? [dbEncryptionEnabledStr boolValue] : NO;

    // The native SDK refuses to initialize without an app group, so surface a
    // named error instead of letting it fail with a generic "SDK is disabled".
    if (appGroupIdentifier.length == 0 || [appGroupIdentifier hasPrefix:@"$"]) {
        sdkLastErrorCode = @"DATAROID_E_CONFIG_REQUIRED";
        sdkLastErrorMessage = @"APP_GROUP_IDENTIFIER not configured. Reinstall the plugin with "
                              @"--variable APP_GROUP_IDENTIFIER=group.<your-bundle-id> and enable "
                              @"that App Group capability for the app target in Xcode.";
        NSLog(@"[Dataroid][DATAROID_E_CONFIG_REQUIRED] %@", sdkLastErrorMessage);
        return;
    }

    DatabaseConfig *databaseConfig = [DataroidWrapper buildDatabaseConfig:dbEncryptionKeyHex enabled:dbEncryptionEnabled];

    dataroidConfig = [[DataroidConfig alloc] initWithSdkKey:sdkKey
                                                  serverURL:serverUrl
                                                   appGroup:appGroupIdentifier
                                               languageCode:languageCode
                                             databaseConfig:databaseConfig];

    dataroidConfig.frameworkIdentifier = FRAMEWORK;
    dataroidConfig.inApp.enabled = inAppMessagingEnabled;
    dataroidConfig.apm.enabled = apmEnabled;
    dataroidConfig.apm.autoCollectingEnabled = NO;
    dataroidConfig.appInbox.enabled = appInboxEnabled;
    dataroidConfig.componentInteraction.autoCollectingEnabled = NO;
    dataroidConfig.screenInteraction.autoCollectingEnabled = NO;
    dataroidConfig.screenTracking.autoCollectingEnabled = NO;
    dataroidConfig.notification.enableSwizzling = NO;
    dataroidConfig.notification.openUrlsAutomatically = YES;

    if (logsEnabled) {
        dataroidConfig.logger.logLevel = 5;
        dataroidConfig.logger.writeToFile = YES;
    }

    if (snapshotEnabled) {
        dataroidConfig.snapshot.enabled = YES;
        NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier];
        if (bundleId) {
            dataroidConfig.snapshot.enabledBundleIDs = @[bundleId];
        }
    }

    if (crashReportingEnabled) {
        dataroidConfig.crashReporting.autoCollectingEnabled = crashReportingEnabled;
        dataroidConfig.crashReporting.threadCollection = crashReportingThreadCollection;
    }

    geofencingEnabled = geofenceEnabledConfig;

    // Configure SSL pinning (must be set before initialization)
    NSString *sslPoliciesJson = [self.commandDelegate.settings objectForKey:@"dataroid_ssl_pinning_policies"];
    [DataroidWrapper applySSLPinning:sslPoliciesJson toConfig:dataroidConfig];

    // Initialize Dataroid SDK
    self.dataroid = [Dataroid initializeWithConfig:dataroidConfig];

    if (self.dataroid == nil) {
        sdkLastErrorCode = @"DATAROID_E_INIT_RUNTIME";
        sdkLastErrorMessage = @"Dataroid.initialize returned nil. Check appGroup, SDK key, and server URL configuration.";
        NSLog(@"[Dataroid][DATAROID_E_INIT_RUNTIME] %@", sdkLastErrorMessage);
        return;
    }

    [self.dataroid.appListener didFinishLaunchingWith:nil];
    [self.dataroid.inApp setAlertDeeplinkHandlerDelegate:self];
    [self.dataroid.appInbox setDelegate:self];

    // Setup push notifications
    if (pushEnabled) {
        UIApplication *application = [UIApplication sharedApplication];

        if (@available(iOS 10, *)) {
            UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
            center.delegate = self;

            [center requestAuthorizationWithOptions:(UNAuthorizationOptionSound |
                                                     UNAuthorizationOptionAlert |
                                                     UNAuthorizationOptionBadge)
                                  completionHandler:^(BOOL granted, NSError *_Nullable error) {
                if (!error) {
                    dispatch_async(dispatch_get_main_queue(), ^{
                        [application registerForRemoteNotifications];
                    });
                }
            }];
        }
    }

    // Setup location manager and geofencing
    if (geofencingEnabled) {
        if (self.locationManager == nil) {
            self.locationManager = [[CLLocationManager alloc] init];
            self.locationManager.delegate = self;
        }
        [self.locationManager requestAlwaysAuthorization];

        CLAuthorizationStatus status = [CLLocationManager authorizationStatus];
        if (status == kCLAuthorizationStatusAuthorizedAlways) {
            [self.dataroid enableGeofencing];
        }
    }

    // Track init state for getSdkStatus
    NSMutableArray *modules = [NSMutableArray arrayWithObject:@"analytics"];
    if (pushEnabled) [modules addObject:@"push"];
    if (inAppMessagingEnabled) [modules addObject:@"inAppMessaging"];
    if (apmEnabled) [modules addObject:@"apm"];
    if (appInboxEnabled) [modules addObject:@"appInbox"];
    if (geofencingEnabled) [modules addObject:@"geofence"];
    if (snapshotEnabled) [modules addObject:@"snapshot"];
    if (crashReportingEnabled) [modules addObject:@"crashReporting"];
    sdkEnabledModules = [modules copy];
    sdkInitialized = YES;
    sdkInitTimestamp = [NSDate date];
    sdkLastErrorCode = nil;
    sdkLastErrorMessage = nil;
}

- (void)clearEngagementDisplayListeners {
    self.inAppMessageDisplayedCommandId = nil;
    self.surveyDisplayedCommandId = nil;

    @try {
        [self.dataroid.inApp setInAppMessageListenerDelegate:nil];
    } @catch (NSException *exception) {
        NSLog(@"[DataroidWrapper] Failed to clear in-app displayed listener (%@)", exception.name);
    }

    @try {
        [self.dataroid.survey setSurveyListenerDelegate:nil];
    } @catch (NSException *exception) {
        NSLog(@"[DataroidWrapper] Failed to clear survey displayed listener (%@)", exception.name);
    }
}

- (BOOL)ensureSdkInitializedForCommand:(CDVInvokedUrlCommand *)command {
    if (self.dataroid != nil) {
        return YES;
    }

    NSException *exception = [NSException exceptionWithName:@"IllegalStateException"
                                                     reason:@"Dataroid SDK is not initialised"
                                                   userInfo:nil];
    [self sendException:exception forCommand:command];
    return NO;
}

- (void)sendException:(NSException *)exception forCommand:(CDVInvokedUrlCommand *)command {
    NSDictionary *error = @{
        @"success": @NO,
        @"name": exception.name ?: @"NSException",
        @"message": exception.reason ?: @"Dataroid SDK operation failed"
    };
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                                           messageAsDictionary:error];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)onReset {
    [self clearEngagementDisplayListeners];
    [super onReset];
}

- (void)dispose {
    [self clearEngagementDisplayListeners];
    if (dataroidWrapper == self) {
        dataroidWrapper = nil;
    }
    [super dispose];
}

#pragma mark - Push Notification Handling

- (void)didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken {
    if (lastRegisteredPushToken != nil && [lastRegisteredPushToken isEqualToData:deviceToken]) {
        NSLog(@"[DataroidWrapper] Push token unchanged, skipping duplicate registration");
        return;
    }
    lastRegisteredPushToken = [deviceToken copy];

    [DataroidWrapper.dataroidWrapper.dataroid.appListener didRegisterForRemoteNotificationsWith:deviceToken];
}

- (void)didFailToRegisterForRemoteNotifications:(NSError *)error {
    sdkLastErrorCode = @"DATAROID_E_PUSH_REGISTRATION_FAILED";
    sdkLastErrorMessage = [NSString stringWithFormat:@"Push registration failed: %@", error.localizedDescription];
    NSLog(@"[Dataroid][DATAROID_E_PUSH_REGISTRATION_FAILED] %@", sdkLastErrorMessage);
}

- (void)didReceiveRemoteNotification:(NSDictionary *)userInfo {
    NSString *actionUrl = [userInfo valueForKey:@"action-url"];
    NSString *actionType = [userInfo valueForKey:@"action-type"];

    if ([actionType isEqualToString:@"GO_TO_DEEPLINK"] && actionUrl != nil) {
        storedDeeplink = actionUrl;
        [self callJSDeeplinkHandlerCallback];
    }
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler API_AVAILABLE(ios(10.0)) {
    [DataroidWrapper.dataroidWrapper.dataroid.appListener userNotificationCenterDidReceive:response];
    [DataroidWrapper.dataroidWrapper didReceiveRemoteNotification:[response.notification.request.content userInfo]];
    completionHandler();
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler API_AVAILABLE(ios(10.0)) {
    completionHandler((UNNotificationPresentationOptionAlert |
                       UNNotificationPresentationOptionBadge |
                       UNNotificationPresentationOptionSound));
}

#pragma mark - Location Manager Delegate

- (void)locationManager:(CLLocationManager *)manager didChangeAuthorizationStatus:(CLAuthorizationStatus)status {
    double delayInSeconds = 0.1;
    dispatch_time_t popTime = dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delayInSeconds * NSEC_PER_SEC));
    dispatch_after(popTime, dispatch_get_main_queue(), ^(void) {
        if (geofencingEnabled && (status == kCLAuthorizationStatusAuthorizedAlways || status == kCLAuthorizationStatusAuthorizedWhenInUse)) {
            [DataroidWrapper.dataroidWrapper.dataroid enableGeofencing];
        }
    });
}

#pragma mark - Deeplink Handler Delegate

- (void)shouldHandleDeeplinkWithDeeplink:(NSString *)deeplink {
    if (supportedDeeplinkUrl && [deeplink containsString:supportedDeeplinkUrl]) {
        storedDeeplink = deeplink;
        [self callJSDeeplinkHandlerCallback];
    }
}

- (void)handleDeeplinkUrl:(NSURL *)url {
    if (url) {
        NSString *urlString = [url absoluteString];
        [self shouldHandleDeeplinkWithDeeplink:urlString];
    }
}

- (void)callJSDeeplinkHandlerCallback {
    if (self.deeplinkHandlerCommandId && storedDeeplink) {
        CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:storedDeeplink];
        [result setKeepCallbackAsBool:YES];
        storedDeeplink = nil;
        [self.commandDelegate sendPluginResult:result callbackId:self.deeplinkHandlerCommandId];
    }
}

#pragma mark - App Inbox Delegate

- (void)inbox:(id)inbox didUpdate:(DTRInboxMessage *)message {
    if (self.updateMessagesCommandId) {
        NSDictionary *messageDict = [DataroidWrapper mapInboxMessageToDictionary:message];
        if (messageDict) {
            CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:messageDict];
            [result setKeepCallbackAsBool:YES];
            [self.commandDelegate sendPluginResult:result callbackId:self.updateMessagesCommandId];
        }
    }
}

- (void)inbox:(id)inbox didDeleteMessages:(NSArray<NSNumber *> *)ids {
    if (self.deleteMessagesCommandId && [ids count] > 0) {
        NSString *messageId = [[ids objectAtIndex:0] stringValue];
        CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:messageId];
        [result setKeepCallbackAsBool:YES];
        [self.commandDelegate sendPluginResult:result callbackId:self.deleteMessagesCommandId];
    }
}

#pragma mark - Context Trigger Delegate

- (void)contextTriggeredWithContext:(TriggeredContext *)context {
    if (self.contextTriggerCommandId) {
        @try {
            NSError *error;
            NSDictionary *jsonDict = @{
                @"contextTriggerId": context.contextTriggerId,
                @"machineOutput": context.attributes ?: @{}
            };

            NSData *jsonData = [NSJSONSerialization dataWithJSONObject:jsonDict options:0 error:&error];
            NSString *jsonString = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];

            CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:jsonString];
            [result setKeepCallbackAsBool:YES];
            [self.commandDelegate sendPluginResult:result callbackId:self.contextTriggerCommandId];
        } @catch (NSException *e) {
            NSLog(@"[DataroidWrapper] Exception in contextTriggeredWithContext: %@", e);
        }
    }
}

#pragma mark - Database Encryption

+ (DatabaseConfig *)buildDatabaseConfig:(NSString *)hexKey enabled:(BOOL)enabled {
    if (hexKey == nil || hexKey.length == 0 || [hexKey hasPrefix:@"$"] || [hexKey isEqualToString:@" "]) {
        return nil;
    }

    NSArray<NSNumber *> *keyBytes = [DataroidWrapper hexStringToBytes:hexKey];
    if (keyBytes == nil || keyBytes.count != 32) {
        NSLog(@"[Dataroid] DB_ENCRYPTION_KEY must be a 64-character hex string (32 bytes / 256 bits). Got %lu chars.",
              (unsigned long)hexKey.length);
        return nil;
    }

    DatabaseConfig *dbConfig = [[DatabaseConfig alloc] initWithDatabaseEncryptionKey:keyBytes
                                                            databaseEncryptionEnabled:enabled];
    NSLog(@"[Dataroid] Database %@ configured", enabled ? @"encryption" : @"decryption");
    return dbConfig;
}

+ (NSArray<NSNumber *> *)hexStringToBytes:(NSString *)hex {
    NSString *cleaned = [hex stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (cleaned.length % 2 != 0) return nil;

    NSMutableArray<NSNumber *> *bytes = [NSMutableArray arrayWithCapacity:cleaned.length / 2];
    for (NSUInteger i = 0; i < cleaned.length; i += 2) {
        unsigned int byte;
        NSString *byteStr = [cleaned substringWithRange:NSMakeRange(i, 2)];
        NSScanner *scanner = [NSScanner scannerWithString:byteStr];
        if (![scanner scanHexInt:&byte]) return nil;
        [bytes addObject:@(byte)];
    }
    return bytes;
}

- (void)setDatabaseEncryption:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *config = [command argumentAtIndex:0 withDefault:nil];
        if (config == nil || ![config isKindOfClass:[NSDictionary class]]) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                                        messageAsDictionary:@{@"success": @NO, @"message": @"config object with encryptionKey and enabled is required"}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        NSString *hexKey = [config valueForKey:@"encryptionKey"];
        BOOL enabled = [[config valueForKey:@"enabled"] boolValue];

        if (enabled && (![hexKey isKindOfClass:[NSString class]] || hexKey.length != 64)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                                        messageAsDictionary:@{@"success": @NO, @"message": @"encryptionKey must be a 64-character hex string (256-bit AES key)"}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        NSLog(@"[Dataroid] setDatabaseEncryption called at runtime — encryption must be configured before SDK initialization via the DB_ENCRYPTION_KEY plugin variable for it to take effect.");
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                                    messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - SSL Pinning

+ (void)applySSLPinning:(NSString *)jsonString toConfig:(DataroidConfig *)config {
    if (jsonString == nil || jsonString.length == 0 || [jsonString hasPrefix:@"$"] || [jsonString isEqualToString:@" "]) {
        return;
    }

    @try {
        NSData *data = [jsonString dataUsingEncoding:NSUTF8StringEncoding];
        NSArray *policies = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![policies isKindOfClass:[NSArray class]]) {
            NSLog(@"[Dataroid] SSL_PINNING_POLICIES must be a JSON array");
            return;
        }

        NSMutableArray *trustPolicies = [NSMutableArray array];

        for (NSDictionary *policyDict in policies) {
            if (![policyDict isKindOfClass:[NSDictionary class]]) continue;

            NSString *endpoint = [policyDict valueForKey:@"endpoint"];
            NSArray *certsArray = [policyDict valueForKey:@"certificates"];

            if (![endpoint isKindOfClass:[NSString class]] || endpoint.length == 0) continue;
            if (![certsArray isKindOfClass:[NSArray class]] || certsArray.count == 0) continue;

            NSMutableArray *certificates = [NSMutableArray array];

            for (id certEntry in certsArray) {
                if ([certEntry isKindOfClass:[NSString class]]) {
                    DTRCertificate *cert = [DTRCertificate base64:(NSString *)certEntry];
                    if (cert) [certificates addObject:cert];
                } else if ([certEntry isKindOfClass:[NSDictionary class]]) {
                    NSDictionary *certDict = (NSDictionary *)certEntry;
                    NSString *type = [certDict valueForKey:@"type"];
                    NSString *value = [certDict valueForKey:@"value"];

                    if ([type isEqualToString:@"base64"] && [value isKindOfClass:[NSString class]]) {
                        DTRCertificate *cert = [DTRCertificate base64:value];
                        if (cert) [certificates addObject:cert];
                    } else if ([type isEqualToString:@"file"]) {
                        NSString *fileName = [certDict valueForKey:@"fileName"];
                        NSString *fileExtension = [certDict valueForKey:@"fileExtension"];
                        if ([fileName isKindOfClass:[NSString class]] && [fileExtension isKindOfClass:[NSString class]]) {
                            DTRCertificateFile *certFile = [[DTRCertificateFile alloc] initWithBundle:[NSBundle mainBundle]
                                                                                            fileName:fileName
                                                                                       fileExtension:fileExtension];
                            DTRCertificate *cert = [DTRCertificate file:certFile];
                            if (cert) [certificates addObject:cert];
                        }
                    }
                }
            }

            if (certificates.count > 0) {
                DTRTrustPolicy *trustPolicy = [[DTRTrustPolicy alloc] initWithEndpoint:endpoint
                                                                          certificates:certificates];
                [trustPolicies addObject:trustPolicy];
            }
        }

        if (trustPolicies.count > 0) {
            config.network.trustPolicies = trustPolicies;
            NSLog(@"[Dataroid] SSL pinning configured for %lu endpoint(s)", (unsigned long)trustPolicies.count);
        }
    } @catch (NSException *e) {
        NSLog(@"[Dataroid] Failed to parse SSL_PINNING_POLICIES: %@", e.reason);
    }
}

- (void)setSSLPinning:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSArray *policies = [command argumentAtIndex:0 withDefault:nil];
        if (policies == nil || ![policies isKindOfClass:[NSArray class]]) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                                        messageAsDictionary:@{@"success": @NO, @"message": @"trustPolicies array is required"}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        NSData *jsonData = [NSJSONSerialization dataWithJSONObject:policies options:0 error:nil];
        NSString *jsonString = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
        [DataroidWrapper applySSLPinning:jsonString toConfig:dataroidConfig];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                                    messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - Helper Methods

+ (DTRProduct *)buildProduct:(NSDictionary *)productObject {
    DTRProduct *product = [[DTRProduct alloc]
                           initWithId:[productObject valueForKey:@"id"]
                           name:[productObject valueForKey:@"name"]
                           quantity:[[productObject valueForKey:@"quantity"] integerValue]
                           price:[[productObject valueForKey:@"price"] decimalValue]
                           currency:[productObject valueForKey:@"currency"]];

    NSString *description = [productObject valueForKey:@"description"];
    NSString *brand = [productObject valueForKey:@"brand"];
    NSString *variant = [productObject valueForKey:@"variant"];
    NSString *category = [productObject valueForKey:@"category"];

    if ([description isKindOfClass:[NSString class]]) {
        [product setProductDescription:description];
    }
    if ([brand isKindOfClass:[NSString class]]) {
        [product setBrand:brand];
    }
    if ([variant isKindOfClass:[NSString class]]) {
        [product setVariant:variant];
    }
    if ([category isKindOfClass:[NSString class]]) {
        [product setCategory:category];
    }

    return product;
}

+ (void)addCustomAttributesToEvent:(DTRAttributes *)attributes fromDictionary:(NSDictionary *)customAttributes {
    if (customAttributes == nil) return;

    for (NSString *attributeKey in customAttributes) {
        NSDictionary *attributeData = [customAttributes valueForKey:attributeKey];
        NSString *attributeDataType = [attributeData valueForKey:@"type"];

        if ([attributeDataType isEqualToString:@"string"]) {
            [attributes addString:[attributeData valueForKey:@"value"] forKey:attributeKey];
        } else if ([attributeDataType isEqualToString:@"number"]) {
            [attributes addInt:[[attributeData valueForKey:@"value"] intValue] forKey:attributeKey];
        } else if ([attributeDataType isEqualToString:@"amount"] || [attributeDataType isEqualToString:@"float"]) {
            [attributes addDouble:[[attributeData valueForKey:@"value"] doubleValue] forKey:attributeKey];
            NSString *currency = [attributeData valueForKey:@"currency"];
            if (currency) {
                [attributes addString:currency forKey:@"currency"];
            }
        } else if ([attributeDataType isEqualToString:@"date"]) {
            NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
            [dateFormatter setDateFormat:@"yyyy-MM-dd'T'HH:mm:ss.SSSZ"];
            NSDate *attributeValue = [dateFormatter dateFromString:[attributeData valueForKey:@"value"]];
            if (attributeValue) {
                [attributes addDate:attributeValue forKey:attributeKey];
            }
        } else if ([attributeDataType isEqualToString:@"boolean"]) {
            [attributes addBool:[[attributeData valueForKey:@"value"] boolValue] forKey:attributeKey];
        } else if ([attributeDataType isEqualToString:@"number-array"]) {
            NSArray *values = DTRValidatedAttributeArray([attributeData valueForKey:@"value"], NO);
            if (values) [attributes addIntArray:values forKey:attributeKey];
            else NSLog(@"[Dataroid] Ignoring invalid number-array event attribute; expected an array of integers.");
        } else if ([attributeDataType isEqualToString:@"string-array"]) {
            NSArray *values = DTRValidatedAttributeArray([attributeData valueForKey:@"value"], YES);
            if (values) [attributes addStringArray:values forKey:attributeKey];
            else NSLog(@"[Dataroid] Ignoring invalid string-array event attribute; expected an array of strings.");
        }
    }
}

+ (DTRViewTrackingExtras *)getViewTrackingExtraAttributes:(NSDictionary *)customAttributes {
    if (customAttributes == nil) return nil;

    DTRViewTrackingExtras *extras = [DTRViewTrackingExtras new];

    for (NSString *attributeKey in customAttributes) {
        NSDictionary *attributeData = [customAttributes valueForKey:attributeKey];
        NSString *attributeDataType = [attributeData valueForKey:@"type"];

        if ([attributeDataType isEqualToString:@"string"]) {
            [extras addString:[attributeData valueForKey:@"value"] forKey:attributeKey];
        } else if ([attributeDataType isEqualToString:@"number"]) {
            [extras addInt:[[attributeData valueForKey:@"value"] intValue] forKey:attributeKey];
        } else if ([attributeDataType isEqualToString:@"float"]) {
            [extras addDouble:[[attributeData valueForKey:@"value"] doubleValue] forKey:attributeKey];
        } else if ([attributeDataType isEqualToString:@"date"]) {
            NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
            [dateFormatter setDateFormat:@"yyyy-MM-dd'T'HH:mm:ss.SSSZ"];
            NSDate *attributeValue = [dateFormatter dateFromString:[attributeData valueForKey:@"value"]];
            if (attributeValue) {
                [extras addDate:attributeValue forKey:attributeKey];
            }
        } else if ([attributeDataType isEqualToString:@"boolean"]) {
            [extras addBool:[[attributeData valueForKey:@"value"] boolValue] forKey:attributeKey];
        } else if ([attributeDataType isEqualToString:@"number-array"]) {
            [extras addIntArray:[attributeData valueForKey:@"value"] forKey:attributeKey];
        } else if ([attributeDataType isEqualToString:@"string-array"]) {
            [extras addStringArray:[attributeData valueForKey:@"value"] forKey:attributeKey];
        }
    }

    return extras;
}

+ (DTRUIViewPixelCoordinate *)getCoordinatesFromDictionary:(NSDictionary *)coordinates {
    int left = [[coordinates valueForKey:@"left"] integerValue];
    int top = [[coordinates valueForKey:@"top"] integerValue];
    int right = [[coordinates valueForKey:@"right"] integerValue];
    int bottom = [[coordinates valueForKey:@"bottom"] integerValue];

    return [[DTRUIViewPixelCoordinate alloc] initWithFrame:CGRectMake(left, top, right - left, bottom - top)];
}

+ (DTRTouchPoint *)getTouchPointFromDictionary:(NSDictionary *)touchPoint {
    int x = [[touchPoint valueForKey:@"x"] integerValue];
    int y = [[touchPoint valueForKey:@"y"] integerValue];

    return [[DTRTouchPoint alloc] initWithPoint:CGPointMake(x, y)];
}

+ (DTRHTTPMethod)getHTTPMethodEnum:(NSString *)method {
    if ([method isEqualToString:@"GET"]) return DTRHTTPMethodGET;
    if ([method isEqualToString:@"HEAD"]) return DTRHTTPMethodHEAD;
    if ([method isEqualToString:@"POST"]) return DTRHTTPMethodPOST;
    if ([method isEqualToString:@"PUT"]) return DTRHTTPMethodPUT;
    if ([method isEqualToString:@"DELETE"]) return DTRHTTPMethodDELETE;
    if ([method isEqualToString:@"CONNECT"]) return DTRHTTPMethodCONNECT;
    if ([method isEqualToString:@"OPTIONS"]) return DTRHTTPMethodOPTIONS;
    if ([method isEqualToString:@"TRACE"]) return DTRHTTPMethodTRACE;
    if ([method isEqualToString:@"PATCH"]) return DTRHTTPMethodPATCH;
    return DTRHTTPMethodGET;
}

+ (DTRNetworkErrorType *)getNetworkErrorType:(NSString *)error {
    if ([error isEqualToString:@"NO_CONNECTION_ERROR"]) return DTRNetworkErrorType.noConnection;
    if ([error isEqualToString:@"SSL_ERROR"]) return DTRNetworkErrorType.ssl;
    if ([error isEqualToString:@"TIMEOUT_ERROR"]) return DTRNetworkErrorType.timeout;
    return DTRNetworkErrorType.unknown;
}

+ (NSMutableDictionary *)mapInboxMessageToDictionary:(DTRInboxMessage *)message {
    @try {
        NSMutableDictionary *messageDictionary = [[NSMutableDictionary alloc] init];
        NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
        [dateFormatter setDateFormat:@"yyyy-MM-dd'T'HH:mm:ss.SSSX"];
        [dateFormatter setTimeZone:[NSTimeZone timeZoneWithName:@"UTC"]];

        NSString *type = nil;
        NSString *status = nil;

        switch (message.type) {
            case DTRInboxMessageTypePush: type = @"PUSH_MESSAGE"; break;
            case DTRInboxMessageTypeInApp: type = @"INAPP_MESSAGE"; break;
            case DTRInboxMessageTypeGeofence: type = @"GEOFENCE_MESSAGE"; break;
            case DTRInboxMessageTypeActionBased: type = @"ACTION_BASED_MESSAGE"; break;
            default: break;
        }

        switch (message.status) {
            case DTRInboxMessageStatusUnread: status = @"UNREAD"; break;
            case DTRInboxMessageStatusRead: status = @"READ"; break;
            case DTRInboxMessageStatusDismissed: status = @"DISMISSED"; break;
            default: break;
        }

        [messageDictionary setValue:type forKey:@"type"];
        [messageDictionary setValue:[dateFormatter stringFromDate:message.receivedDate] forKey:@"receivedDate"];
        if (message.expirationDate) {
            [messageDictionary setValue:[dateFormatter stringFromDate:message.expirationDate] forKey:@"expirationDate"];
        }
        [messageDictionary setValue:message.userId forKey:@"customerId"];
        [messageDictionary setValue:status forKey:@"status"];
        [messageDictionary setValue:[@(message.id) stringValue] forKey:@"id"];

        [DataroidWrapper extractMessageDetailsForType:message.type payload:message.payload toDictionary:messageDictionary];

        return messageDictionary;
    } @catch (NSException *e) {
        return nil;
    }
}

// Inbox message details follow the React Native SDK, which parses the stored
// payload JSON so that iOS returns the same keys as Android.
+ (void)extractMessageDetailsForType:(DTRInboxMessageType)type payload:(id)payload toDictionary:(NSMutableDictionary *)messageDictionary {
    switch (type) {
        case DTRInboxMessageTypePush:
        case DTRInboxMessageTypeGeofence:
            [DataroidWrapper extractPushEventDetailsForType:type payload:payload toDictionary:messageDictionary];
            break;
        case DTRInboxMessageTypeInApp:
            [DataroidWrapper extractInAppMessageDetailsFromPayload:payload toDictionary:messageDictionary];
            break;
        case DTRInboxMessageTypeActionBased:
            [DataroidWrapper extractActionBasedMessageDetailsFromPayload:payload toDictionary:messageDictionary];
            break;
        default:
            break;
    }
}

// Returns the payload as a dictionary. Sets *parseFailed when a string payload is not valid JSON.
+ (NSDictionary *)inboxPayloadDictionary:(id)payload parseFailed:(BOOL *)parseFailed {
    if (parseFailed) *parseFailed = NO;

    if ([payload isKindOfClass:[NSDictionary class]]) {
        return (NSDictionary *)payload;
    }

    if ([payload isKindOfClass:[NSString class]]) {
        NSData *data = [(NSString *)payload dataUsingEncoding:NSUTF8StringEncoding];
        if (data) {
            NSError *err = nil;
            id obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
            if (err != nil) {
                if (parseFailed) *parseFailed = YES;
                return nil;
            }
            if ([obj isKindOfClass:[NSDictionary class]]) {
                return (NSDictionary *)obj;
            }
        }
    }

    return nil;
}

+ (BOOL)isPresent:(id)value {
    return value != nil && ![value isEqual:[NSNull null]];
}

+ (void)extractPushEventDetailsForType:(DTRInboxMessageType)type payload:(id)rawPayload toDictionary:(NSMutableDictionary *)messageDictionary {
    NSMutableDictionary *pushEvent = [[NSMutableDictionary alloc] init];
    NSDictionary *payload = [DataroidWrapper inboxPayloadDictionary:rawPayload parseFailed:NULL];

    if (payload) {
        // The alert and sound live in the "aps" dictionary of an iOS push payload.
        NSDictionary *aps = payload[@"aps"];
        if ([aps isKindOfClass:[NSDictionary class]]) {
            id apsAlert = aps[@"alert"];
            if ([apsAlert isKindOfClass:[NSDictionary class]]) {
                NSDictionary *alertDict = (NSDictionary *)apsAlert;
                NSMutableDictionary *alert = [[NSMutableDictionary alloc] init];

                if ([DataroidWrapper isPresent:alertDict[@"title"]]) {
                    [alert setValue:alertDict[@"title"] forKey:@"title"];
                }
                if ([DataroidWrapper isPresent:alertDict[@"body"]]) {
                    [alert setValue:alertDict[@"body"] forKey:@"body"];
                }
                if (alert.count > 0) {
                    [pushEvent setValue:alert forKey:@"alert"];
                }
            } else if ([apsAlert isKindOfClass:[NSString class]]) {
                [pushEvent setValue:@{@"title": @"", @"body": apsAlert} forKey:@"alert"];
            }

            if ([DataroidWrapper isPresent:aps[@"sound"]]) {
                [pushEvent setValue:aps[@"sound"] forKey:@"soundName"];
            }
        }

        if ([DataroidWrapper isPresent:payload[@"push-id"]]) {
            [pushEvent setValue:payload[@"push-id"] forKey:@"pushId"];
        }
        if ([DataroidWrapper isPresent:payload[@"schedule-id"]]) {
            [pushEvent setValue:payload[@"schedule-id"] forKey:@"scheduleId"];
        }
        if ([DataroidWrapper isPresent:payload[@"media-url"]]) {
            [pushEvent setValue:payload[@"media-url"] forKey:@"mediaURL"];
        } else if ([DataroidWrapper isPresent:payload[@"image-url"]]) {
            [pushEvent setValue:payload[@"image-url"] forKey:@"mediaURL"];
        }
        if ([DataroidWrapper isPresent:payload[@"action-url"]]) {
            [pushEvent setValue:payload[@"action-url"] forKey:@"targetURL"];
        }
        if ([DataroidWrapper isPresent:payload[@"action-type"]]) {
            [pushEvent setValue:payload[@"action-type"] forKey:@"actionType"];
        }
    }

    if (pushEvent.count > 0) {
        NSString *key = type == DTRInboxMessageTypeGeofence ? @"geofenceEvent" : @"pushEvent";
        [messageDictionary setValue:pushEvent forKey:key];
    }
}

+ (void)extractInAppMessageDetailsFromPayload:(id)rawPayload toDictionary:(NSMutableDictionary *)messageDictionary {
    BOOL parseFailed = NO;
    NSDictionary *payload = [DataroidWrapper inboxPayloadDictionary:rawPayload parseFailed:&parseFailed];
    if (parseFailed) return;

    if (payload[@"messageId"]) {
        [messageDictionary setValue:@{@"messageId": payload[@"messageId"]} forKey:@"inAppMessage"];
    }
}

+ (void)extractActionBasedMessageDetailsFromPayload:(id)rawPayload toDictionary:(NSMutableDictionary *)messageDictionary {
    NSMutableDictionary *actionBasedMessage = [[NSMutableDictionary alloc] init];

    BOOL parseFailed = NO;
    NSDictionary *payload = [DataroidWrapper inboxPayloadDictionary:rawPayload parseFailed:&parseFailed];
    if (parseFailed) return;

    if (payload) {
        // Content is stored per language in contentMap. Prefer the default language, then the
        // first language in sorted order so the result is stable, then the root level.
        NSDictionary *content = nil;
        if ([payload[@"contentMap"] isKindOfClass:[NSDictionary class]]) {
            NSDictionary *contentMap = payload[@"contentMap"];
            id defaultLanguage = payload[@"defaultLanguage"];
            if ([defaultLanguage isKindOfClass:[NSString class]] && [contentMap[defaultLanguage] isKindOfClass:[NSDictionary class]]) {
                content = contentMap[defaultLanguage];
            } else {
                NSArray *languages = [[contentMap allKeys] sortedArrayUsingSelector:@selector(compare:)];
                for (id language in languages) {
                    if ([contentMap[language] isKindOfClass:[NSDictionary class]]) {
                        content = contentMap[language];
                        break;
                    }
                }
            }
        }
        NSDictionary *sourceData = content ?: payload;
        id text = sourceData[@"text"] ?: sourceData[@"body"];

        if (sourceData[@"title"]) {
            [actionBasedMessage setValue:sourceData[@"title"] forKey:@"title"];
        }
        if (text) {
            [actionBasedMessage setValue:text forKey:@"text"];
        }
        if (payload[@"sound"]) {
            [actionBasedMessage setValue:payload[@"sound"] forKey:@"sound"];
        }
        if (payload[@"pushId"] || payload[@"notificationId"]) {
            [actionBasedMessage setValue:(payload[@"pushId"] ?: payload[@"notificationId"]) forKey:@"pushId"];
        }
        if (payload[@"scheduleId"]) {
            [actionBasedMessage setValue:payload[@"scheduleId"] forKey:@"scheduleId"];
        }
        if (sourceData[@"actionTargetUrl"] || sourceData[@"actionUrl"]) {
            [actionBasedMessage setValue:(sourceData[@"actionTargetUrl"] ?: sourceData[@"actionUrl"]) forKey:@"actionTargetUrl"];
        }

        NSString *actionType = sourceData[@"actionType"];
        if (actionType) {
            [actionBasedMessage setValue:actionType forKey:@"actionType"];

            int actionTypeIndex = 0;
            if ([actionType isEqual:@"OPEN_APP"]) {
                actionTypeIndex = 1;
            } else if ([actionType isEqual:@"GO_TO_URL"]) {
                actionTypeIndex = 2;
            } else if ([actionType isEqual:@"GO_TO_DEEPLINK"]) {
                actionTypeIndex = 3;
            }
            [actionBasedMessage setValue:@(actionTypeIndex) forKey:@"actionTypeIndex"];
        }

        // Same alert structure as Android.
        NSMutableDictionary *alert = [[NSMutableDictionary alloc] init];
        if (sourceData[@"title"]) {
            [alert setValue:sourceData[@"title"] forKey:@"title"];
        }
        if (text) {
            [alert setValue:text forKey:@"body"];
        }
        if (alert.count > 0) {
            [actionBasedMessage setValue:alert forKey:@"alert"];
        }

        if (payload[@"parameters"] || payload[@"customParameters"]) {
            [actionBasedMessage setValue:(payload[@"parameters"] ?: payload[@"customParameters"]) forKey:@"parameters"];
        }
    }

    [messageDictionary setValue:actionBasedMessage forKey:@"actionBasedMessage"];
}

+ (NSMutableArray *)mapInboxMessagesToArray:(NSArray *)inboxMessages {
    NSMutableArray *messagesArray = [[NSMutableArray alloc] init];

    if (inboxMessages != nil) {
        for (DTRInboxMessage *message in inboxMessages) {
            NSMutableDictionary *messageDictionary = [DataroidWrapper mapInboxMessageToDictionary:message];
            if (messageDictionary != nil) {
                [messagesArray addObject:messageDictionary];
            }
        }
    }

    return messagesArray;
}

#pragma mark - Screen Tracking

- (void)viewStarted:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *viewLabel = [command argumentAtIndex:0];
        DTRRequireArgument(viewLabel, @"viewLabel");
        [DataroidWrapper.dataroidWrapper.dataroid.screenTracking viewStartWithView:self.viewController viewLabel:viewLabel];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)viewStopped:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *viewLabel = [command argumentAtIndex:0];
        [DataroidWrapper.dataroidWrapper.dataroid.screenTracking viewStopWithView:self.viewController viewLabel:viewLabel];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)viewStartedWithViewClass:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *viewClass = [command argumentAtIndex:0];
        NSString *viewLabel = [command argumentAtIndex:1 withDefault:nil];
        [DataroidWrapper.dataroidWrapper.dataroid.screenTracking viewStartWithViewClass:viewClass viewLabel:viewLabel];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)viewStoppedWithViewClass:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *viewClass = [command argumentAtIndex:0];
        NSString *viewLabel = [command argumentAtIndex:1 withDefault:nil];
        [DataroidWrapper.dataroidWrapper.dataroid.screenTracking viewStopWithViewClass:viewClass viewLabel:viewLabel];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)viewStartedWithViewClassAutoCaptured:(CDVInvokedUrlCommand *)command {
    [self forwardAutoCapturedScreen:command method:@"screenTracker.viewStarted" includeFlag:YES];
}

- (void)viewStoppedWithViewClassAutoCaptured:(CDVInvokedUrlCommand *)command {
    [self forwardAutoCapturedScreen:command method:@"screenTracker.viewStopped" includeFlag:NO];
}

- (void)forwardAutoCapturedScreen:(CDVInvokedUrlCommand *)command method:(NSString *)method includeFlag:(BOOL)includeFlag {
    CDVPluginResult *pluginResult;
    @try {
        NSString *viewClass = [command argumentAtIndex:0];
        NSString *viewLabel = [command argumentAtIndex:1 withDefault:nil];
        NSMutableDictionary *args = [NSMutableDictionary dictionary];
        if (viewClass != nil) args[@"viewClass"] = viewClass;
        if (viewLabel != nil) args[@"viewLabel"] = viewLabel;
        if (includeFlag) args[@"ac"] = @YES;
        if (!DTRPostHybridMessage(DataroidWrapper.dataroidWrapper.dataroid, method, args)) {
            [NSException raise:@"HybridBridgeException" format:@"Failed to forward auto-captured screen event"];
        }
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)viewStartedWithExtras:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *viewClass = [command argumentAtIndex:0];
        NSString *viewLabel = [command argumentAtIndex:1 withDefault:nil];
        NSDictionary *customAttributes = [command argumentAtIndex:2 withDefault:nil];

        DTRViewTrackingExtras *extras = [DataroidWrapper getViewTrackingExtraAttributes:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.screenTracking viewStartWithViewClass:viewClass viewLabel:viewLabel extras:extras];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)viewStoppedWithExtras:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *viewClass = [command argumentAtIndex:0];
        NSString *viewLabel = [command argumentAtIndex:1 withDefault:nil];
        // SDK 4.x does not support extras on viewStop; extras are only used on viewStart
        [DataroidWrapper.dataroidWrapper.dataroid.screenTracking viewStopWithViewClass:viewClass viewLabel:viewLabel];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - Event Collection

- (void)collectEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *eventName = [command argumentAtIndex:0];
        DTRRequireArgument(eventName, @"eventName");
        NSDictionary *eventAttributes = [command argumentAtIndex:1 withDefault:nil];

        DTRAttributes *attributes = [[DTRAttributes alloc] init];
        [DataroidWrapper addCustomAttributesToEvent:attributes fromDictionary:eventAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid collectEventWithName:eventName attributes:attributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - User Management

- (void)setUser:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *userData = [command argumentAtIndex:0];
        if (![userData isKindOfClass:[NSDictionary class]]) {
            [NSException raise:@"IllegalArgumentException" format:@"userData.customerId is required"];
        }
        NSDictionary *extraData = [command argumentAtIndex:1 withDefault:nil];

        id customerId = [userData objectForKey:@"customerId"];
        if (![customerId isKindOfClass:[NSString class]]
                || DTRTrimmedSetting(customerId).length == 0) {
            [NSException raise:@"IllegalArgumentException" format:@"userData.customerId is required"];
        }
        DataroidUser *dataroidUser = [[DataroidUser alloc] initWithUserId:customerId];

        NSString *email = [userData valueForKey:@"email"];
        NSString *phoneNumber = [userData valueForKey:@"phoneNumber"];
        NSString *nationalId = [userData valueForKey:@"nationalId"];
        NSString *firstName = [userData valueForKey:@"firstName"];
        NSString *lastName = [userData valueForKey:@"lastName"];
        NSString *gender = [userData valueForKey:@"gender"];
        NSString *dateOfBirth = [userData valueForKey:@"dateOfBirth"];

        if ([email isKindOfClass:[NSString class]]) [dataroidUser setEmail:email];
        if ([phoneNumber isKindOfClass:[NSString class]]) [dataroidUser setPhone:phoneNumber];
        if ([nationalId isKindOfClass:[NSString class]]) [dataroidUser setNationalId:nationalId];
        if ([firstName isKindOfClass:[NSString class]]) [dataroidUser setFirstName:firstName];
        if ([lastName isKindOfClass:[NSString class]]) [dataroidUser setLastName:lastName];

        if ([gender isKindOfClass:[NSString class]]) {
            NSInteger genderEnumValue = DTRGenderUndefined;
            if ([gender isEqualToString:@"MALE"]) genderEnumValue = DTRGenderMale;
            else if ([gender isEqualToString:@"FEMALE"]) genderEnumValue = DTRGenderFemale;
            else if ([gender isEqualToString:@"NON_BINARY"]) genderEnumValue = DTRGenderNonBinary;
            else if ([gender isEqualToString:@"UNKNOWN"]) genderEnumValue = DTRGenderUnknown;
            [dataroidUser setGender:genderEnumValue];
        }

        if ([dateOfBirth isKindOfClass:[NSString class]]) {
            NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
            [dateFormatter setDateFormat:@"yyyy-MM-dd"];
            NSDate *dateOfBirthValue = [dateFormatter dateFromString:dateOfBirth];
            if (dateOfBirthValue) [dataroidUser setDateOfBirth:dateOfBirthValue];
        }

        if (extraData != nil) {
            DTRUserAttributes *userAttributes = [[DTRUserAttributes alloc] init];

            for (NSString *attributeKey in extraData) {
                NSDictionary *attributeData = [extraData valueForKey:attributeKey];
                NSString *attributeDataType = [attributeData valueForKey:@"type"];

                if ([attributeDataType isEqualToString:@"string"]) {
                    [userAttributes addString:[attributeData valueForKey:@"value"] forKey:attributeKey];
                } else if ([attributeDataType isEqualToString:@"number"]) {
                    [userAttributes addInt:[[attributeData valueForKey:@"value"] intValue] forKey:attributeKey];
                } else if ([attributeDataType isEqualToString:@"amount"]) {
                    [userAttributes addDouble:[[attributeData valueForKey:@"value"] doubleValue] forKey:attributeKey];
                    NSString *currency = [attributeData valueForKey:@"currency"];
                    if (currency) [userAttributes addString:currency forKey:@"currency"];
                } else if ([attributeDataType isEqualToString:@"date"]) {
                    NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
                    [dateFormatter setDateFormat:@"yyyy-MM-dd'T'HH:mm:ss.SSSZ"];
                    NSDate *attributeValue = [dateFormatter dateFromString:[attributeData valueForKey:@"value"]];
                    if (attributeValue) [userAttributes addDate:attributeValue forKey:attributeKey];
                } else if ([attributeDataType isEqualToString:@"boolean"]) {
                    [userAttributes addBool:[[attributeData valueForKey:@"value"] boolValue] forKey:attributeKey];
                }
            }

            [dataroidUser setAttributes:userAttributes];
        }

        [DataroidWrapper.dataroidWrapper.dataroid setUser:dataroidUser];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)clearUser:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        [DataroidWrapper.dataroidWrapper.dataroid clearUser];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - Commerce Events

- (void)purchase:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSArray *products = [command argumentAtIndex:0 withDefault:nil];
        NSDictionary *purchaseData = [command argumentAtIndex:1];
        NSDictionary *customAttributes = [command argumentAtIndex:2 withDefault:nil];

        NSMutableArray *productList = nil;
        if (products != nil) {
            productList = [[NSMutableArray alloc] init];
            for (NSDictionary *product in products) {
                [productList addObject:[DataroidWrapper buildProduct:product]];
            }
        }

        NSDecimal value = [[purchaseData valueForKey:@"value"] decimalValue];
        NSString *currency = [purchaseData valueForKey:@"currency"];
        BOOL success = [[purchaseData valueForKey:@"success"] boolValue];

        DTRPurchaseEventAttributes *purchaseAttributes = [[DTRPurchaseEventAttributes alloc]
                                                          initWithCurrency:currency
                                                          value:value
                                                          products:productList
                                                          success:success];

        if ([[purchaseData valueForKey:@"quantity"] isKindOfClass:[NSNumber class]]) [purchaseAttributes addQuantity:[[purchaseData valueForKey:@"quantity"] integerValue]];
        if ([[purchaseData valueForKey:@"tax"] isKindOfClass:[NSNumber class]]) [purchaseAttributes addTax:[[purchaseData valueForKey:@"tax"] decimalValue]];
        if ([[purchaseData valueForKey:@"ship"] isKindOfClass:[NSNumber class]]) [purchaseAttributes addShip:[[purchaseData valueForKey:@"ship"] decimalValue]];
        if ([[purchaseData valueForKey:@"discount"] isKindOfClass:[NSNumber class]]) [purchaseAttributes addDiscount:[[purchaseData valueForKey:@"discount"] decimalValue]];
        if ([[purchaseData valueForKey:@"coupon"] isKindOfClass:[NSString class]]) [purchaseAttributes addCoupon:[purchaseData valueForKey:@"coupon"]];
        if ([[purchaseData valueForKey:@"trxId"] isKindOfClass:[NSString class]]) [purchaseAttributes addTrxId:[purchaseData valueForKey:@"trxId"]];
        if ([[purchaseData valueForKey:@"paymentMethod"] isKindOfClass:[NSString class]]) [purchaseAttributes addPaymentMethod:[purchaseData valueForKey:@"paymentMethod"]];
        if ([[purchaseData valueForKey:@"errorCode"] isKindOfClass:[NSString class]]) [purchaseAttributes addErrorCode:[purchaseData valueForKey:@"errorCode"]];
        if ([[purchaseData valueForKey:@"errorMessage"] isKindOfClass:[NSString class]]) [purchaseAttributes addErrorMessage:[purchaseData valueForKey:@"errorMessage"]];

        [DataroidWrapper addCustomAttributesToEvent:purchaseAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectPurchase:purchaseAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)search:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *query = [command argumentAtIndex:0];
        NSDictionary *customAttributes = [command argumentAtIndex:1 withDefault:nil];

        DTRSearchEventAttributes *searchAttributes = [[DTRSearchEventAttributes alloc] initWithQuery:query];
        [DataroidWrapper addCustomAttributesToEvent:searchAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectSearch:searchAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)viewProduct:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *productData = [command argumentAtIndex:0];
        NSDictionary *customAttributes = [command argumentAtIndex:1 withDefault:nil];

        DTRProduct *product = [DataroidWrapper buildProduct:productData];
        DTRViewProductEventAttributes *viewProductEventAttributes = [[DTRViewProductEventAttributes alloc] initWithProduct:product];
        [DataroidWrapper addCustomAttributesToEvent:viewProductEventAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectViewProduct:viewProductEventAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)viewCategory:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *category = [command argumentAtIndex:0];
        NSDictionary *customAttributes = [command argumentAtIndex:1 withDefault:nil];

        DTRViewCategoryEventAttributes *viewCategoryEventAttributes = [[DTRViewCategoryEventAttributes alloc] initWithCategory:category];
        [DataroidWrapper addCustomAttributesToEvent:viewCategoryEventAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectViewCategory:viewCategoryEventAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)addToCart:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *productData = [command argumentAtIndex:0];
        NSNumber *value = [command argumentAtIndex:1 withDefault:@0];
        NSNumber *totalCartValue = [command argumentAtIndex:2 withDefault:@0];
        NSDictionary *customAttributes = [command argumentAtIndex:3 withDefault:nil];

        DTRProduct *product = [DataroidWrapper buildProduct:productData];
        DTRAddToCartEventAttributes *addToCartEventAttributes = [[DTRAddToCartEventAttributes alloc] initWithProduct:product];
        [addToCartEventAttributes addValue:[value decimalValue]];
        [addToCartEventAttributes addTotalCartValue:[totalCartValue decimalValue]];
        [DataroidWrapper addCustomAttributesToEvent:addToCartEventAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectAddToCart:addToCartEventAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)removeFromCart:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *productData = [command argumentAtIndex:0];
        NSNumber *value = [command argumentAtIndex:1 withDefault:@0];
        NSNumber *totalCartValue = [command argumentAtIndex:2 withDefault:@0];
        NSDictionary *customAttributes = [command argumentAtIndex:3 withDefault:nil];

        DTRProduct *product = [DataroidWrapper buildProduct:productData];
        DTRRemoveFromCartEventAttributes *removeFromCartEventAttributes = [[DTRRemoveFromCartEventAttributes alloc] initWithProduct:product];
        [removeFromCartEventAttributes addValue:[value decimalValue]];
        [removeFromCartEventAttributes addTotalCartValue:[totalCartValue decimalValue]];
        [DataroidWrapper addCustomAttributesToEvent:removeFromCartEventAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectRemoveFromCart:removeFromCartEventAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)clearCart:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *customAttributes = [command argumentAtIndex:0 withDefault:nil];

        DTRClearCartEventAttributes *clearCartEventAttributes = [[DTRClearCartEventAttributes alloc] init];
        [DataroidWrapper addCustomAttributesToEvent:clearCartEventAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectClearCart:clearCartEventAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)startCheckout:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSNumber *value = [command argumentAtIndex:0];
        NSString *currency = [command argumentAtIndex:1];
        NSNumber *quantity = [command argumentAtIndex:2 withDefault:@0];
        NSDictionary *customAttributes = [command argumentAtIndex:3 withDefault:nil];

        DTRStartCheckoutEventAttributes *startCheckoutEventAttributes = [[DTRStartCheckoutEventAttributes alloc] initWithValue:[value decimalValue] currency:currency];
        [startCheckoutEventAttributes addQuantity:[quantity integerValue]];
        [DataroidWrapper addCustomAttributesToEvent:startCheckoutEventAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectStartCheckout:startCheckoutEventAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)addToWishList:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *productData = [command argumentAtIndex:0];
        NSDictionary *customAttributes = [command argumentAtIndex:1 withDefault:nil];

        DTRProduct *product = [DataroidWrapper buildProduct:productData];
        DTRAddToWishListEventAttributes *addToWishListAttributes = [[DTRAddToWishListEventAttributes alloc] initWithProduct:product];
        [DataroidWrapper addCustomAttributesToEvent:addToWishListAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectAddToWishList:addToWishListAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)removeFromWishList:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *productData = [command argumentAtIndex:0];
        NSDictionary *customAttributes = [command argumentAtIndex:1 withDefault:nil];

        DTRProduct *product = [DataroidWrapper buildProduct:productData];
        DTRRemoveFromWishListEventAttributes *removeFromWishListAttributes = [[DTRRemoveFromWishListEventAttributes alloc] initWithProduct:product];
        [DataroidWrapper addCustomAttributesToEvent:removeFromWishListAttributes fromDictionary:customAttributes];
        [DataroidWrapper.dataroidWrapper.dataroid.commerce collectRemoveFromWishList:removeFromWishListAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - Settings & Configuration

- (void)setDebugEnabled:(CDVInvokedUrlCommand *)command {
    BOOL enabled = [[command.arguments objectAtIndex:0] boolValue];
    if (enabled) {
        dataroidConfig.logger.logLevel = 5;
        dataroidConfig.logger.writeToFile = YES;
        NSLog(@"[DataroidWrapper] Debug logging enabled (logLevel=5, writeToFile=YES)");
    } else {
        dataroidConfig.logger.logLevel = 0;
        dataroidConfig.logger.writeToFile = NO;
        NSLog(@"[DataroidWrapper] Debug logging disabled (logLevel=0, writeToFile=NO)");
    }
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)enableEventCollecting:(CDVInvokedUrlCommand *)command {
    [DataroidWrapper.dataroidWrapper.dataroid resumeEventCollection];
    dataroidConfig.eventCollectingEnabled = YES;
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)disableEventCollecting:(CDVInvokedUrlCommand *)command {
    [DataroidWrapper.dataroidWrapper.dataroid pauseEventCollection];
    dataroidConfig.eventCollectingEnabled = NO;
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)enableInAppMessaging:(CDVInvokedUrlCommand *)command {
    dataroidConfig.inApp.enabled = YES;
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)disableInAppMessaging:(CDVInvokedUrlCommand *)command {
    dataroidConfig.inApp.enabled = NO;
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)setSessionDropDuration:(CDVInvokedUrlCommand *)command {
    NSNumber *duration = [command argumentAtIndex:0];
    dataroidConfig.session.timeout = [duration doubleValue];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)enableAPMEvents:(CDVInvokedUrlCommand *)command {
    dataroidConfig.apm.enabled = YES;
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)disableAPMEvents:(CDVInvokedUrlCommand *)command {
    dataroidConfig.apm.enabled = NO;
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)updateLanguage:(CDVInvokedUrlCommand *)command {
    NSString *languageCode = [command argumentAtIndex:0];
    [DataroidWrapper.dataroidWrapper.dataroid updateLanguage:languageCode];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

#pragma mark - APM

- (void)collectNetworkError:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *errorData = [command argumentAtIndex:0];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectNetworkError", errorData, nil)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        NSString *url = [errorData valueForKey:@"url"];
        DTRHTTPMethod method = [DataroidWrapper getHTTPMethodEnum:[errorData valueForKey:@"method"]];
        double duration = [[errorData valueForKey:@"duration"] doubleValue];
        DTRNetworkErrorType *type = [DataroidWrapper getNetworkErrorType:[errorData valueForKey:@"type"]];
        NSString *exception = [errorData valueForKey:@"exception"];

        DTRNetworkErrorAttributes *attributes = [[DTRNetworkErrorAttributes alloc] initWithUrl:url method:method duration:duration errorType:type exception:exception];

        if ([[errorData valueForKey:@"message"] isKindOfClass:[NSString class]]) {
            [attributes setErrorMessage:[errorData valueForKey:@"message"]];
        }

        [DataroidWrapper.dataroidWrapper.dataroid.apm collectNetworkError:attributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)collectHttpCall:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *httpData = [command argumentAtIndex:0];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectHttpCall", httpData, nil)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        NSString *url = [httpData valueForKey:@"url"];
        DTRHTTPMethod method = [DataroidWrapper getHTTPMethodEnum:[httpData valueForKey:@"method"]];
        NSInteger statusCode = [[httpData valueForKey:@"statusCode"] integerValue];
        double duration = [[httpData valueForKey:@"duration"] doubleValue];
        BOOL success = [[httpData valueForKey:@"success"] boolValue];

        DTRHTTPCallAttributes *attributes = [[DTRHTTPCallAttributes alloc] initWithUrl:url method:method statusCode:statusCode duration:duration success:success];

        if ([[httpData valueForKey:@"errorType"] isKindOfClass:[NSString class]]) {
            [attributes setErrorType:[httpData valueForKey:@"errorType"]];
        }
        if ([[httpData valueForKey:@"errorCode"] isKindOfClass:[NSString class]]) {
            [attributes setErrorCode:[httpData valueForKey:@"errorCode"]];
        }
        if ([[httpData valueForKey:@"errorMessage"] isKindOfClass:[NSString class]]) {
            [attributes setErrorMessage:[httpData valueForKey:@"errorMessage"]];
        }

        [DataroidWrapper.dataroidWrapper.dataroid.apm collectHTTPCall:attributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - Deeplinks

- (void)handleDeeplink:(CDVInvokedUrlCommand *)command {
    self.deeplinkHandlerCommandId = command.callbackId;
    [self callJSDeeplinkHandlerCallback];
}

- (void)deeplinkLaunched:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *deeplinkUrl = [command argumentAtIndex:0];
        NSURL *url = [NSURL URLWithString:deeplinkUrl];

        DTRDeeplinkAttributes *deepLinkAttributes = [[DTRDeeplinkAttributes alloc] initWithUrl:url];
        [DataroidWrapper.dataroidWrapper.dataroid collectDeeplink:deepLinkAttributes];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - Geolocation

- (void)setCountry:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *country = [command argumentAtIndex:0];
        [DataroidWrapper.dataroidWrapper.dataroid.geolocation setCountry:country];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)clearCountry:(CDVInvokedUrlCommand *)command {
    [DataroidWrapper.dataroidWrapper.dataroid.geolocation clearCountry];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)setCity:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *city = [command argumentAtIndex:0];
        [DataroidWrapper.dataroidWrapper.dataroid.geolocation setCity:city];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)clearCity:(CDVInvokedUrlCommand *)command {
    [DataroidWrapper.dataroidWrapper.dataroid.geolocation clearCity];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)setRegion:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *region = [command argumentAtIndex:0];
        [DataroidWrapper.dataroidWrapper.dataroid.geolocation setRegion:region];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)clearRegion:(CDVInvokedUrlCommand *)command {
    [DataroidWrapper.dataroidWrapper.dataroid.geolocation clearRegion];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)setContinent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *continent = [command argumentAtIndex:0];
        [DataroidWrapper.dataroidWrapper.dataroid.geolocation setContinent:continent];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)clearContinent:(CDVInvokedUrlCommand *)command {
    [DataroidWrapper.dataroidWrapper.dataroid.geolocation clearContinent];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)setCoordinates:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        double latitude = [[command argumentAtIndex:0] doubleValue];
        double longitude = [[command argumentAtIndex:1] doubleValue];
        [DataroidWrapper.dataroidWrapper.dataroid.geolocation setCoordinatesWithLatitude:latitude longitude:longitude];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)clearCoordinates:(CDVInvokedUrlCommand *)command {
    [DataroidWrapper.dataroidWrapper.dataroid.geolocation clearCoordinates];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

#pragma mark - Geofencing

- (void)enableGeofence:(CDVInvokedUrlCommand *)command {
    geofencingEnabled = YES;
    dispatch_async(dispatch_get_main_queue(), ^{
        [DataroidWrapper.dataroidWrapper.dataroid enableGeofencing];
    });
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)disableGeofence:(CDVInvokedUrlCommand *)command {
    geofencingEnabled = NO;
    dispatch_async(dispatch_get_main_queue(), ^{
        [DataroidWrapper.dataroidWrapper.dataroid disableGeofencing];
    });
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

#pragma mark - Component Interaction Tracking

- (void)collectButtonClickEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *attributes = [command argumentAtIndex:0];
        NSDictionary *screenAttributes = [command argumentAtIndex:1 withDefault:nil];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectButtonClickEvent", attributes, screenAttributes)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        NSString *className = [attributes valueForKey:@"className"];
        NSString *label = [attributes valueForKey:@"label"];
        NSString *accessibilityLabel = [attributes valueForKey:@"accessibilityLabel"];
        NSString *componentId = [attributes valueForKey:@"componentId"];

        DTRUIViewPixelCoordinate *coordinates = nil;
        if ([attributes valueForKey:@"coordinates"]) {
            coordinates = [DataroidWrapper getCoordinatesFromDictionary:[attributes valueForKey:@"coordinates"]];
        }

        NSString *viewLabel = [screenAttributes valueForKey:@"viewLabel"];
        NSString *viewClass = [screenAttributes valueForKey:@"viewClass"];

        DTRButtonTrackingAttributes *buttonAttributes = [[DTRButtonTrackingAttributes alloc]
                                                         initWithClassName:className
                                                         label:label
                                                         accessibilityLabel:accessibilityLabel
                                                         componentId:componentId
                                                         coordinates:coordinates
                                                         viewLabel:viewLabel
                                                         viewClass:viewClass];

        [DataroidWrapper.dataroidWrapper.dataroid.componentInteraction collectButtonClick:buttonAttributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)collectTextChangeEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *attributes = [command argumentAtIndex:0];
        NSDictionary *screenAttributes = [command argumentAtIndex:1 withDefault:nil];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectTextChangeEvent", attributes, screenAttributes)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        NSString *className = [attributes valueForKey:@"className"];
        NSString *textValue = [attributes valueForKey:@"textValue"];
        NSString *placeholder = [attributes valueForKey:@"placeholder"];
        NSString *accessibilityLabel = [attributes valueForKey:@"accessibilityLabel"];
        NSString *componentId = [attributes valueForKey:@"componentId"];

        DTRUIViewPixelCoordinate *coordinates = nil;
        if ([attributes valueForKey:@"coordinates"]) {
            coordinates = [DataroidWrapper getCoordinatesFromDictionary:[attributes valueForKey:@"coordinates"]];
        }

        NSString *viewLabel = [screenAttributes valueForKey:@"viewLabel"];
        NSString *viewClass = [screenAttributes valueForKey:@"viewClass"];

        DTRTextFieldTrackingAttributes *textFieldAttributes = [[DTRTextFieldTrackingAttributes alloc]
                                                               initWithClassName:className
                                                               value:textValue
                                                               placeholder:placeholder
                                                               accessibilityLabel:accessibilityLabel
                                                               componentId:componentId
                                                               coordinates:coordinates
                                                               viewLabel:viewLabel
                                                               viewClass:viewClass];

        [DataroidWrapper.dataroidWrapper.dataroid.componentInteraction collectTextChange:textFieldAttributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)collectRadioButtonSelectedEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;
    @try {
        NSDictionary *attributes = [command argumentAtIndex:0];
        NSDictionary *screen = [command argumentAtIndex:1 withDefault:nil];
        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectRadioButtonSelectedEvent", attributes, screen)) {
            result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
        } else {
            result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Radio auto-capture requires ac:true and an initialized SDK"];
        }
    } @catch (NSException *e) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:e.reason];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)collectToggleChangeEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *attributes = [command argumentAtIndex:0];
        NSDictionary *screenAttributes = [command argumentAtIndex:1 withDefault:nil];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectToggleChangeEvent", attributes, screenAttributes)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        NSString *className = [attributes valueForKey:@"className"];
        BOOL isChecked = [[attributes valueForKey:@"isChecked"] boolValue];
        NSString *accessibilityLabel = [attributes valueForKey:@"accessibilityLabel"];
        NSString *componentId = [attributes valueForKey:@"componentId"];

        DTRUIViewPixelCoordinate *coordinates = nil;
        if ([attributes valueForKey:@"coordinates"]) {
            coordinates = [DataroidWrapper getCoordinatesFromDictionary:[attributes valueForKey:@"coordinates"]];
        }

        NSString *viewLabel = [screenAttributes valueForKey:@"viewLabel"];
        NSString *viewClass = [screenAttributes valueForKey:@"viewClass"];

        DTRSwitchButtonTrackingAttributes *switchButtonAttributes = [[DTRSwitchButtonTrackingAttributes alloc]
                                                                     initWithClassName:className
                                                                     isChecked:isChecked
                                                                     accessibilityLabel:accessibilityLabel
                                                                     componentId:componentId
                                                                     coordinates:coordinates
                                                                     viewLabel:viewLabel
                                                                     viewClass:viewClass];

        [DataroidWrapper.dataroidWrapper.dataroid.componentInteraction collectToggleChange:switchButtonAttributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)collectTouchEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *attributes = [command argumentAtIndex:0];
        NSDictionary *screenAttributes = [command argumentAtIndex:1 withDefault:nil];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectTouchEvent", attributes, screenAttributes)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        DTRTouchPoint *touchPoint = nil;
        if ([attributes valueForKey:@"touchPoint"]) {
            touchPoint = [DataroidWrapper getTouchPointFromDictionary:[attributes valueForKey:@"touchPoint"]];
        }

        NSString *viewLabel = [screenAttributes valueForKey:@"viewLabel"];
        NSString *viewClass = [screenAttributes valueForKey:@"viewClass"];

        DTRTapTrackingAttributes *tapAttributes = [[DTRTapTrackingAttributes alloc]
                                                   initWithTouchPoint:touchPoint
                                                   viewLabel:viewLabel
                                                   viewClass:viewClass];

        [DataroidWrapper.dataroidWrapper.dataroid.screenInteraction collectTouch:tapAttributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)collectSwipeEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *attributes = [command argumentAtIndex:0];
        NSDictionary *screenAttributes = [command argumentAtIndex:1 withDefault:nil];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectSwipeEvent", attributes, screenAttributes)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        CGPoint startPoint = CGPointZero;
        CGPoint endPoint = CGPointZero;

        if ([attributes valueForKey:@"swipePoints"]) {
            NSDictionary *swipePoints = [attributes valueForKey:@"swipePoints"];
            NSDictionary *swipeStart = [swipePoints valueForKey:@"swipeStart"];
            NSDictionary *swipeEnd = [swipePoints valueForKey:@"swipeEnd"];

            if (swipeStart && swipeEnd) {
                startPoint = CGPointMake([[swipeStart valueForKey:@"x"] integerValue], [[swipeStart valueForKey:@"y"] integerValue]);
                endPoint = CGPointMake([[swipeEnd valueForKey:@"x"] integerValue], [[swipeEnd valueForKey:@"y"] integerValue]);
            }
        }

        NSString *viewLabel = [screenAttributes valueForKey:@"viewLabel"];
        NSString *viewClass = [screenAttributes valueForKey:@"viewClass"];

        DTRSwipeTrackingAttributes *swipeAttributes = [[DTRSwipeTrackingAttributes alloc]
                                                       initWithStartPoint:startPoint
                                                       endPoint:endPoint
                                                       viewLabel:viewLabel
                                                       viewClass:viewClass];

        [DataroidWrapper.dataroidWrapper.dataroid.screenInteraction collectSwipe:swipeAttributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)collectDoubleTapEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *attributes = [command argumentAtIndex:0];
        NSDictionary *screenAttributes = [command argumentAtIndex:1 withDefault:nil];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectDoubleTapEvent", attributes, screenAttributes)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        DTRTouchPoint *touchPoint = nil;
        if ([attributes valueForKey:@"touchPoint"]) {
            touchPoint = [DataroidWrapper getTouchPointFromDictionary:[attributes valueForKey:@"touchPoint"]];
        }

        NSString *viewLabel = [screenAttributes valueForKey:@"viewLabel"];
        NSString *viewClass = [screenAttributes valueForKey:@"viewClass"];

        DTRDoubleTapTrackingAttributes *doubleTapAttributes = [[DTRDoubleTapTrackingAttributes alloc]
                                                               initWithTouchPoint:touchPoint
                                                               viewLabel:viewLabel
                                                               viewClass:viewClass];

        [DataroidWrapper.dataroidWrapper.dataroid.screenInteraction collectDoubleTap:doubleTapAttributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)collectLongPressEvent:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *attributes = [command argumentAtIndex:0];
        NSDictionary *screenAttributes = [command argumentAtIndex:1 withDefault:nil];

        if (DTRForwardAutoCaptured(DataroidWrapper.dataroidWrapper.dataroid, @"collectLongPressEvent", attributes, screenAttributes)) {
            pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
            return;
        }

        DTRTouchPoint *touchPoint = nil;
        if ([attributes valueForKey:@"touchPoint"]) {
            touchPoint = [DataroidWrapper getTouchPointFromDictionary:[attributes valueForKey:@"touchPoint"]];
        }

        NSString *viewLabel = [screenAttributes valueForKey:@"viewLabel"];
        NSString *viewClass = [screenAttributes valueForKey:@"viewClass"];

        DTRLongPressTrackingAttributes *longPressAttributes = [[DTRLongPressTrackingAttributes alloc]
                                                               initWithTouchPoint:touchPoint
                                                               viewLabel:viewLabel
                                                               viewClass:viewClass];

        [DataroidWrapper.dataroidWrapper.dataroid.screenInteraction collectLongPress:longPressAttributes];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - Super Attributes

- (void)getAllSuperAttributes:(CDVInvokedUrlCommand *)command {
    NSDictionary *attrs = [DataroidWrapper.dataroidWrapper.dataroid getAllSuperAttributes];
    NSDictionary *attrDict = attrs ? attrs : @{};
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES, @"attributes": attrDict}] callbackId:command.callbackId];
}

- (void)setSuperAttribute:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *attributeData = [command argumentAtIndex:0];
        NSString *attributeKey = [attributeData valueForKey:@"key"];
        NSString *attributeType = [attributeData valueForKey:@"type"];

        if ([attributeType isEqualToString:@"string"]) {
            [DataroidWrapper.dataroidWrapper.dataroid setSuperAttributeWithKey:attributeKey value:[attributeData valueForKey:@"value"]];
        } else if ([attributeType isEqualToString:@"number"]) {
            [DataroidWrapper.dataroidWrapper.dataroid setSuperAttributeWithKey:attributeKey intValue:[[attributeData valueForKey:@"value"] integerValue]];
        } else if ([attributeType isEqualToString:@"float"]) {
            [DataroidWrapper.dataroidWrapper.dataroid setSuperAttributeWithKey:attributeKey doubleValue:[[attributeData valueForKey:@"value"] doubleValue]];
        } else if ([attributeType isEqualToString:@"date"]) {
            NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
            [dateFormatter setDateFormat:@"yyyy-MM-dd'T'HH:mm:ss.SSSZ"];
            NSDate *attributeValue = [dateFormatter dateFromString:[attributeData valueForKey:@"value"]];
            if (attributeValue) {
                [DataroidWrapper.dataroidWrapper.dataroid setSuperAttributeWithKey:attributeKey dateValue:attributeValue];
            }
        } else if ([attributeType isEqualToString:@"boolean"]) {
            [DataroidWrapper.dataroidWrapper.dataroid setSuperAttributeWithKey:attributeKey boolValue:[[attributeData valueForKey:@"value"] boolValue]];
        }

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)clearSuperAttribute:(CDVInvokedUrlCommand *)command {
    NSString *attributeKey = [command argumentAtIndex:0];
    [DataroidWrapper.dataroidWrapper.dataroid clearSuperAttributeWithKey:attributeKey];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)clearAllSuperAttributes:(CDVInvokedUrlCommand *)command {
    [DataroidWrapper.dataroidWrapper.dataroid clearAllSuperAttributes];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

#pragma mark - App Inbox

- (void)getAppInboxMessages:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSDictionary *query = [command argumentAtIndex:0 withDefault:nil];
        NSArray<DTRInboxMessage *> *inboxMessages = nil;

        if (query != nil && query.count > 0) {
            DTRAppInboxQuery *fetchQuery = [[DTRAppInboxQuery alloc] init];
            NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
            [dateFormatter setDateFormat:@"yyyy-MM-dd'T'HH:mm:ss.SSSZ"];

            if ([query objectForKey:@"type"] != nil) {
                NSString *type = [query valueForKey:@"type"];
                if ([type isEqualToString:@"PUSH_MESSAGE"]) [fetchQuery messageType:DTRInboxMessageTypePush];
                else if ([type isEqualToString:@"INAPP_MESSAGE"]) [fetchQuery messageType:DTRInboxMessageTypeInApp];
                else if ([type isEqualToString:@"GEOFENCE_MESSAGE"]) [fetchQuery messageType:DTRInboxMessageTypeGeofence];
                else if ([type isEqualToString:@"ACTION_BASED_MESSAGE"]) [fetchQuery messageType:DTRInboxMessageTypeActionBased];
            }

            if ([query objectForKey:@"status"] != nil) {
                NSString *status = [query valueForKey:@"status"];
                if ([status isEqualToString:@"UNREAD"]) [fetchQuery status:DTRInboxMessageStatusUnread];
                else if ([status isEqualToString:@"READ"]) [fetchQuery status:DTRInboxMessageStatusRead];
                else if ([status isEqualToString:@"DISMISSED"]) [fetchQuery status:DTRInboxMessageStatusDismissed];
            }

            if ([query objectForKey:@"from"] != nil) {
                [fetchQuery from:[dateFormatter dateFromString:[query valueForKey:@"from"]]];
            }
            if ([query objectForKey:@"to"] != nil) {
                [fetchQuery to:[dateFormatter dateFromString:[query valueForKey:@"to"]]];
            }
            if ([query objectForKey:@"anonymous"] != nil) {
                [fetchQuery anonymous:[[query valueForKey:@"anonymous"] boolValue]];
            }

            inboxMessages = [DataroidWrapper.dataroidWrapper.dataroid.appInbox fetchMessagesWithQuery:fetchQuery];
        } else {
            inboxMessages = [DataroidWrapper.dataroidWrapper.dataroid.appInbox fetchMessages];
        }

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES, @"messages": [DataroidWrapper mapInboxMessagesToArray:inboxMessages]}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name ?: @"", @"message": e.reason ?: @""}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)deleteAppInboxMessage:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *messageId = [command argumentAtIndex:0];
        NSNumber *id = [NSNumber numberWithLongLong:[messageId longLongValue]];
        [DataroidWrapper.dataroidWrapper.dataroid.appInbox deleteMessagesWithIds:@[id]];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name ?: @"", @"message": e.reason ?: @""}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)readAppInboxMessage:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        NSString *messageId = [command argumentAtIndex:0];
        NSNumber *id = [NSNumber numberWithLongLong:[messageId longLongValue]];
        [DataroidWrapper.dataroidWrapper.dataroid.appInbox readMessagesWithIds:@[id]];
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name ?: @"", @"message": e.reason ?: @""}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)subscribeToCreateMessages:(CDVInvokedUrlCommand *)command {
    self.createMessagesCommandId = command.callbackId;
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
    [result setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)subscribeToDeleteMessages:(CDVInvokedUrlCommand *)command {
    self.deleteMessagesCommandId = command.callbackId;
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
    [result setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)subscribeToUpdateMessages:(CDVInvokedUrlCommand *)command {
    self.updateMessagesCommandId = command.callbackId;
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
    [result setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)enableAppInbox:(CDVInvokedUrlCommand *)command {
    DataroidWrapper.dataroidWrapper.dataroid.config.appInbox.enabled = YES;
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

- (void)disableAppInbox:(CDVInvokedUrlCommand *)command {
    DataroidWrapper.dataroidWrapper.dataroid.config.appInbox.enabled = NO;
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

#pragma mark - Context Triggers

- (void)subscribeToContextTriggerResults:(CDVInvokedUrlCommand *)command {
    self.contextTriggerCommandId = command.callbackId;
    [DataroidWrapper.dataroidWrapper.dataroid setContextTriggerListenerDelegate:self];

    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
    [result setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)unsubscribeFromContextTriggerResults:(CDVInvokedUrlCommand *)command {
    self.contextTriggerCommandId = nil;
    [DataroidWrapper.dataroidWrapper.dataroid setContextTriggerListenerDelegate:nil];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
}

#pragma mark - Engagement Display Callbacks

- (void)subscribeToInAppMessageDisplayedResults:(CDVInvokedUrlCommand *)command {
    @try {
        if (![self ensureSdkInitializedForCommand:command]) {
            return;
        }

        [self.dataroid.inApp setInAppMessageListenerDelegate:self];
        self.inAppMessageDisplayedCommandId = command.callbackId;

        CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
        [result setKeepCallbackAsBool:YES];
        [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
    } @catch (NSException *exception) {
        [self sendException:exception forCommand:command];
    }
}

- (void)willShowInApp:(DTRInAppDisplayInfo *)inappDisplayInfo {
    if (self.inAppMessageDisplayedCommandId == nil) return;

    @try {
        NSMutableDictionary *body = [NSMutableDictionary dictionary];
        if (inappDisplayInfo.inappId != nil) body[@"inAppMessageId"] = inappDisplayInfo.inappId;
        if (inappDisplayInfo.triggerEvent != nil) body[@"triggerEvent"] = inappDisplayInfo.triggerEvent;
        if (inappDisplayInfo.location != nil) body[@"location"] = inappDisplayInfo.location;
        if (inappDisplayInfo.horizontalLocation != nil) body[@"horizontalLocation"] = inappDisplayInfo.horizontalLocation;
        if (inappDisplayInfo.dynamicAttributes != nil) body[@"dynamicAttributes"] = inappDisplayInfo.dynamicAttributes;

        CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:body];
        [result setKeepCallbackAsBool:YES];
        [self.commandDelegate sendPluginResult:result callbackId:self.inAppMessageDisplayedCommandId];
    } @catch (NSException *e) {
        NSLog(@"[DataroidWrapper] Failed to emit in-app displayed result: %@", e);
    }
}

- (void)unsubscribeFromInAppMessageDisplayedResults:(CDVInvokedUrlCommand *)command {
    @try {
        if (![self ensureSdkInitializedForCommand:command]) {
            return;
        }

        [self.dataroid.inApp setInAppMessageListenerDelegate:nil];
        self.inAppMessageDisplayedCommandId = nil;
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
    } @catch (NSException *exception) {
        [self sendException:exception forCommand:command];
    }
}

- (void)subscribeToSurveyDisplayedResults:(CDVInvokedUrlCommand *)command {
    @try {
        if (![self ensureSdkInitializedForCommand:command]) {
            return;
        }

        [self.dataroid.survey setSurveyListenerDelegate:self];
        self.surveyDisplayedCommandId = command.callbackId;

        CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
        [result setKeepCallbackAsBool:YES];
        [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
    } @catch (NSException *exception) {
        [self sendException:exception forCommand:command];
    }
}

- (void)willShowSurvey:(DTRSurveyDisplayInfo *)surveyDisplayInfo {
    if (self.surveyDisplayedCommandId == nil) return;

    @try {
        NSMutableDictionary *body = [NSMutableDictionary dictionary];
        if (surveyDisplayInfo.surveyId != nil) body[@"surveyId"] = surveyDisplayInfo.surveyId;
        if (surveyDisplayInfo.triggerEvent != nil) body[@"triggerEvent"] = surveyDisplayInfo.triggerEvent;
        if (surveyDisplayInfo.location != nil) body[@"location"] = surveyDisplayInfo.location;
        if (surveyDisplayInfo.horizontalLocation != nil) body[@"horizontalLocation"] = surveyDisplayInfo.horizontalLocation;
        if (surveyDisplayInfo.dynamicAttributes != nil) body[@"dynamicAttributes"] = surveyDisplayInfo.dynamicAttributes;

        CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:body];
        [result setKeepCallbackAsBool:YES];
        [self.commandDelegate sendPluginResult:result callbackId:self.surveyDisplayedCommandId];
    } @catch (NSException *e) {
        NSLog(@"[DataroidWrapper] Failed to emit survey displayed result: %@", e);
    }
}

- (void)unsubscribeFromSurveyDisplayedResults:(CDVInvokedUrlCommand *)command {
    @try {
        if (![self ensureSdkInitializedForCommand:command]) {
            return;
        }

        [self.dataroid.survey setSurveyListenerDelegate:nil];
        self.surveyDisplayedCommandId = nil;
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}] callbackId:command.callbackId];
    } @catch (NSException *exception) {
        [self sendException:exception forCommand:command];
    }
}

#pragma mark - Crash Reporting

- (void)collectError:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        // Without this check a message to a nil SDK does nothing and success is
        // returned, while Android reports that the SDK is not initialized.
        if (![self ensureSdkInitializedForCommand:command]) {
            return;
        }

        NSDictionary *payload = [command argumentAtIndex:0];
        NSString *exceptionType = DTRStringOrDefault(payload[@"exceptionType"], @"Error");
        NSString *exceptionReason = DTRStringOrDefault(payload[@"exceptionReason"], @"Unknown error");

        [DataroidWrapper.dataroidWrapper.dataroid collectExternalExceptionWithExceptionName:exceptionType
                                                                                   reason:exceptionReason
                                                                              crashSource:@"javascript"];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)collectCrash:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult;

    @try {
        // Without this check a message to a nil SDK does nothing and success is
        // returned, while Android reports that the SDK is not initialized.
        if (![self ensureSdkInitializedForCommand:command]) {
            return;
        }

        NSDictionary *payload = [command argumentAtIndex:0];
        NSString *uuid = DTRStringOrDefault(payload[@"uuid"], @"");
        NSString *exceptionType = DTRStringOrDefault(payload[@"exceptionType"], @"Error");
        NSString *exceptionReason = DTRStringOrDefault(payload[@"exceptionReason"], @"Unknown error");
        id framesArray = payload[@"frames"];

        NSMutableArray<ExternalExceptionFrame *> *frames = [NSMutableArray array];
        if ([framesArray isKindOfClass:[NSArray class]]) {
            for (id frame in (NSArray *)framesArray) {
                if (![frame isKindOfClass:[NSDictionary class]]) continue;
                NSString *file = DTRStringOrDefault(frame[@"file"], nil);
                if (file == nil) continue;

                NSString *methodName = DTRStringOrDefault(frame[@"methodName"], @"");
                id lineValue = frame[@"line"];
                id columnValue = frame[@"column"];
                NSInteger line = [lineValue isKindOfClass:[NSNumber class]] ? [lineValue integerValue] : 0;
                NSInteger column = [columnValue isKindOfClass:[NSNumber class]] ? [columnValue integerValue] : 0;

                ExternalExceptionFrame *exceptionFrame =
                    [[ExternalExceptionFrame alloc] initWithLine:line
                                                           file:file
                                                     methodName:methodName
                                                         column:column
                                                      inProject:YES];
                [frames addObject:exceptionFrame];
            }
        }

        [DataroidWrapper.dataroidWrapper.dataroid collectExternalErrorWithUuid:uuid
                                                                 exceptionType:exceptionType
                                                                        reason:exceptionReason
                                                                        frames:[frames copy]
                                                                   crashSource:@"javascript"];

        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{@"success": @YES}];
    } @catch (NSException *e) {
        pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:@{@"success": @NO, @"name": e.name, @"message": e.reason}];
    }

    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

#pragma mark - SDK Status

- (void)getSdkStatus:(CDVInvokedUrlCommand *)command {
    NSMutableDictionary *status = [NSMutableDictionary dictionary];
    status[@"initialized"] = @(sdkInitialized);

    NSString *sdkVersion = nil;
    status[@"sdkVersion"] = sdkVersion ?: [NSNull null];
    status[@"framework"] = FRAMEWORK;
    status[@"enabledModules"] = sdkEnabledModules ?: @[];
    status[@"lastErrorCode"] = sdkLastErrorCode ?: [NSNull null];
    status[@"lastErrorMessage"] = sdkLastErrorMessage ?: [NSNull null];

    if (sdkInitTimestamp != nil) {
        NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
        formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss'Z'";
        formatter.timeZone = [NSTimeZone timeZoneWithAbbreviation:@"UTC"];
        formatter.locale = [[NSLocale alloc] initWithLocaleIdentifier:@"en_US_POSIX"];
        status[@"lastInitTimestamp"] = [formatter stringFromDate:sdkInitTimestamp];
    } else {
        status[@"lastInitTimestamp"] = [NSNull null];
    }

    NSDictionary *response = @{@"success": @YES, @"status": status};
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:response] callbackId:command.callbackId];
}

@end
