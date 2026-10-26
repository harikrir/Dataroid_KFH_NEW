//
//  DataroidWrapper.h
//  Dataroid Cordova Plugin
//
//  Created by Dataroid Web Team
//

#import <Cordova/CDVPlugin.h>
#import <UserNotifications/UserNotifications.h>
#import <CoreLocation/CoreLocation.h>
@import DataroidSDK;

NS_ASSUME_NONNULL_BEGIN

/**
 * Dataroid Cordova Plugin Wrapper
 * 
 * This class provides the bridge between the JavaScript API and the native iOS Dataroid SDK.
 * It handles all SDK functionality including event tracking, user management, push notifications,
 * in-app messaging, geofencing, and more.
 */
@interface DataroidWrapper : CDVPlugin <UNUserNotificationCenterDelegate,
                                      CLLocationManagerDelegate,
                                      DTRInAppMessageAlertDeeplinkHandler,
                                      DTRAppInboxDelegate,
                                      ContextTriggerListenerDelegate,
                                      DTRInAppMessageListener,
                                      DTRSurveyListener>

/// The Dataroid SDK instance
@property (strong, nonatomic) Dataroid *dataroid;

/// Location manager for geofencing
@property (strong, nonatomic) CLLocationManager *locationManager;

/**
 * Get the shared DataroidWrapper instance
 * @return The shared instance
 */
+ (DataroidWrapper *)dataroidWrapper;

// Push notification handling
- (void)didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken;
- (void)didFailToRegisterForRemoteNotifications:(NSError *)error;
- (void)didReceiveRemoteNotification:(NSDictionary *)userInfo;

// Deep link handling (called from AppDelegate swizzling)
- (void)handleDeeplinkUrl:(NSURL *)url;

// Screen Tracking
- (void)viewStarted:(CDVInvokedUrlCommand *)command;
- (void)viewStopped:(CDVInvokedUrlCommand *)command;
- (void)viewStartedWithViewClass:(CDVInvokedUrlCommand *)command;
- (void)viewStoppedWithViewClass:(CDVInvokedUrlCommand *)command;
- (void)viewStartedWithViewClassAutoCaptured:(CDVInvokedUrlCommand *)command;
- (void)viewStoppedWithViewClassAutoCaptured:(CDVInvokedUrlCommand *)command;
- (void)viewStartedWithExtras:(CDVInvokedUrlCommand *)command;
- (void)viewStoppedWithExtras:(CDVInvokedUrlCommand *)command;

// Event Collection
- (void)collectEvent:(CDVInvokedUrlCommand *)command;

// User Management
- (void)setUser:(CDVInvokedUrlCommand *)command;
- (void)clearUser:(CDVInvokedUrlCommand *)command;

// Commerce Events
- (void)purchase:(CDVInvokedUrlCommand *)command;
- (void)search:(CDVInvokedUrlCommand *)command;
- (void)viewProduct:(CDVInvokedUrlCommand *)command;
- (void)viewCategory:(CDVInvokedUrlCommand *)command;
- (void)addToCart:(CDVInvokedUrlCommand *)command;
- (void)removeFromCart:(CDVInvokedUrlCommand *)command;
- (void)clearCart:(CDVInvokedUrlCommand *)command;
- (void)startCheckout:(CDVInvokedUrlCommand *)command;
- (void)addToWishList:(CDVInvokedUrlCommand *)command;
- (void)removeFromWishList:(CDVInvokedUrlCommand *)command;

// Settings & Configuration
- (void)setDebugEnabled:(CDVInvokedUrlCommand *)command;
- (void)enableEventCollecting:(CDVInvokedUrlCommand *)command;
- (void)disableEventCollecting:(CDVInvokedUrlCommand *)command;
- (void)enableInAppMessaging:(CDVInvokedUrlCommand *)command;
- (void)disableInAppMessaging:(CDVInvokedUrlCommand *)command;
- (void)setSessionDropDuration:(CDVInvokedUrlCommand *)command;
- (void)enableAPMEvents:(CDVInvokedUrlCommand *)command;
- (void)disableAPMEvents:(CDVInvokedUrlCommand *)command;
- (void)updateLanguage:(CDVInvokedUrlCommand *)command;

// APM
- (void)collectNetworkError:(CDVInvokedUrlCommand *)command;
- (void)collectHttpCall:(CDVInvokedUrlCommand *)command;

// Deeplinks
- (void)handleDeeplink:(CDVInvokedUrlCommand *)command;
- (void)deeplinkLaunched:(CDVInvokedUrlCommand *)command;

// Geolocation
- (void)setCountry:(CDVInvokedUrlCommand *)command;
- (void)clearCountry:(CDVInvokedUrlCommand *)command;
- (void)setCity:(CDVInvokedUrlCommand *)command;
- (void)clearCity:(CDVInvokedUrlCommand *)command;
- (void)setRegion:(CDVInvokedUrlCommand *)command;
- (void)clearRegion:(CDVInvokedUrlCommand *)command;
- (void)setContinent:(CDVInvokedUrlCommand *)command;
- (void)clearContinent:(CDVInvokedUrlCommand *)command;
- (void)setCoordinates:(CDVInvokedUrlCommand *)command;
- (void)clearCoordinates:(CDVInvokedUrlCommand *)command;

// Geofencing
- (void)enableGeofence:(CDVInvokedUrlCommand *)command;
- (void)disableGeofence:(CDVInvokedUrlCommand *)command;

// Component Interaction Tracking
- (void)collectButtonClickEvent:(CDVInvokedUrlCommand *)command;
- (void)collectTextChangeEvent:(CDVInvokedUrlCommand *)command;
- (void)collectRadioButtonSelectedEvent:(CDVInvokedUrlCommand *)command;
- (void)collectToggleChangeEvent:(CDVInvokedUrlCommand *)command;
- (void)collectTouchEvent:(CDVInvokedUrlCommand *)command;
- (void)collectSwipeEvent:(CDVInvokedUrlCommand *)command;
- (void)collectDoubleTapEvent:(CDVInvokedUrlCommand *)command;
- (void)collectLongPressEvent:(CDVInvokedUrlCommand *)command;

// Super Attributes
- (void)getAllSuperAttributes:(CDVInvokedUrlCommand *)command;
- (void)setSuperAttribute:(CDVInvokedUrlCommand *)command;
- (void)clearSuperAttribute:(CDVInvokedUrlCommand *)command;
- (void)clearAllSuperAttributes:(CDVInvokedUrlCommand *)command;

// App Inbox
- (void)getAppInboxMessages:(CDVInvokedUrlCommand *)command;
- (void)deleteAppInboxMessage:(CDVInvokedUrlCommand *)command;
- (void)readAppInboxMessage:(CDVInvokedUrlCommand *)command;
- (void)subscribeToCreateMessages:(CDVInvokedUrlCommand *)command;
- (void)subscribeToDeleteMessages:(CDVInvokedUrlCommand *)command;
- (void)subscribeToUpdateMessages:(CDVInvokedUrlCommand *)command;
- (void)enableAppInbox:(CDVInvokedUrlCommand *)command;
- (void)disableAppInbox:(CDVInvokedUrlCommand *)command;

// Context Triggers
- (void)subscribeToContextTriggerResults:(CDVInvokedUrlCommand *)command;
- (void)unsubscribeFromContextTriggerResults:(CDVInvokedUrlCommand *)command;

// Engagement display callbacks
- (void)subscribeToInAppMessageDisplayedResults:(CDVInvokedUrlCommand *)command;
- (void)unsubscribeFromInAppMessageDisplayedResults:(CDVInvokedUrlCommand *)command;
- (void)subscribeToSurveyDisplayedResults:(CDVInvokedUrlCommand *)command;
- (void)unsubscribeFromSurveyDisplayedResults:(CDVInvokedUrlCommand *)command;

// Database Encryption
- (void)setDatabaseEncryption:(CDVInvokedUrlCommand *)command;

// SSL Pinning
- (void)setSSLPinning:(CDVInvokedUrlCommand *)command;

// Crash Reporting
- (void)collectCrash:(CDVInvokedUrlCommand *)command;
- (void)collectError:(CDVInvokedUrlCommand *)command;

// SDK Status
- (void)getSdkStatus:(CDVInvokedUrlCommand *)command;

@end

NS_ASSUME_NONNULL_END
