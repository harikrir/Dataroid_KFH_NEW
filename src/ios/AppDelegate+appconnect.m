//
//  AppDelegate+appconnect.m
//  Dataroid Cordova Plugin
//
//  Created by Dataroid Web Team
//

#import "AppDelegate+appconnect.h"
#import "DataroidWrapper.h"
#import <objc/runtime.h>

// Track which selectors had a real original implementation (not just added by us).
// When class_addMethod succeeds it means the class did NOT have the method before,
// so calling the "original" after swizzle would hit an invalid/nil IMP.
static BOOL _dataroid_hasOriginal_didRegister = NO;
static BOOL _dataroid_hasOriginal_didReceive = NO;
static BOOL _dataroid_hasOriginal_didFail = NO;
static BOOL _dataroid_hasOriginal_openURL = NO;
static BOOL _dataroid_hasOriginal_continueUserActivity = NO;

@implementation CDVAppDelegate (AppConnect)

+ (void)load {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Class class = [self class];
        
        // Helper macro-style swizzle
        // Swizzle didRegisterForRemoteNotificationsWithDeviceToken
        {
            SEL orig = @selector(application:didRegisterForRemoteNotificationsWithDeviceToken:);
            SEL swiz = @selector(dataroid_application:didRegisterForRemoteNotificationsWithDeviceToken:);
            Method origM = class_getInstanceMethod(class, orig);
            Method swizM = class_getInstanceMethod(class, swiz);
            if (class_addMethod(class, orig, method_getImplementation(swizM), method_getTypeEncoding(swizM))) {
                if (origM) {
                    class_replaceMethod(class, swiz, method_getImplementation(origM), method_getTypeEncoding(origM));
                    _dataroid_hasOriginal_didRegister = YES;
                }
            } else {
                method_exchangeImplementations(origM, swizM);
                _dataroid_hasOriginal_didRegister = YES;
            }
        }
        
        // Swizzle didReceiveRemoteNotification:fetchCompletionHandler:
        {
            SEL orig = @selector(application:didReceiveRemoteNotification:fetchCompletionHandler:);
            SEL swiz = @selector(dataroid_application:didReceiveRemoteNotification:fetchCompletionHandler:);
            Method origM = class_getInstanceMethod(class, orig);
            Method swizM = class_getInstanceMethod(class, swiz);
            if (class_addMethod(class, orig, method_getImplementation(swizM), method_getTypeEncoding(swizM))) {
                if (origM) {
                    class_replaceMethod(class, swiz, method_getImplementation(origM), method_getTypeEncoding(origM));
                    _dataroid_hasOriginal_didReceive = YES;
                }
            } else {
                method_exchangeImplementations(origM, swizM);
                _dataroid_hasOriginal_didReceive = YES;
            }
        }
        
        // Swizzle didFailToRegisterForRemoteNotificationsWithError
        {
            SEL orig = @selector(application:didFailToRegisterForRemoteNotificationsWithError:);
            SEL swiz = @selector(dataroid_application:didFailToRegisterForRemoteNotificationsWithError:);
            Method origM = class_getInstanceMethod(class, orig);
            Method swizM = class_getInstanceMethod(class, swiz);
            if (class_addMethod(class, orig, method_getImplementation(swizM), method_getTypeEncoding(swizM))) {
                if (origM) {
                    class_replaceMethod(class, swiz, method_getImplementation(origM), method_getTypeEncoding(origM));
                    _dataroid_hasOriginal_didFail = YES;
                }
            } else {
                method_exchangeImplementations(origM, swizM);
                _dataroid_hasOriginal_didFail = YES;
            }
        }
        
        // Swizzle openURL for deep linking
        {
            SEL orig = @selector(application:openURL:options:);
            SEL swiz = @selector(dataroid_application:openURL:options:);
            Method origM = class_getInstanceMethod(class, orig);
            Method swizM = class_getInstanceMethod(class, swiz);
            if (class_addMethod(class, orig, method_getImplementation(swizM), method_getTypeEncoding(swizM))) {
                if (origM) {
                    class_replaceMethod(class, swiz, method_getImplementation(origM), method_getTypeEncoding(origM));
                    _dataroid_hasOriginal_openURL = YES;
                }
            } else {
                method_exchangeImplementations(origM, swizM);
                _dataroid_hasOriginal_openURL = YES;
            }
        }
        
        // Swizzle continueUserActivity for Universal Links
        {
            SEL orig = @selector(application:continueUserActivity:restorationHandler:);
            SEL swiz = @selector(dataroid_application:continueUserActivity:restorationHandler:);
            Method origM = class_getInstanceMethod(class, orig);
            Method swizM = class_getInstanceMethod(class, swiz);
            if (class_addMethod(class, orig, method_getImplementation(swizM), method_getTypeEncoding(swizM))) {
                if (origM) {
                    class_replaceMethod(class, swiz, method_getImplementation(origM), method_getTypeEncoding(origM));
                    _dataroid_hasOriginal_continueUserActivity = YES;
                }
            } else {
                method_exchangeImplementations(origM, swizM);
                _dataroid_hasOriginal_continueUserActivity = YES;
            }
        }
    });
}

#pragma mark - Swizzled Methods

- (void)dataroid_application:(UIApplication *)application
didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken {
    // Forward to Dataroid SDK
    [[DataroidWrapper dataroidWrapper] didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
    
    // Call the original (pre-swizzle) implementation only if one actually existed.
    // After swizzling, dataroid_application:... points to the original IMP.
    // Using respondsToSelector: would always return YES (since this method exists
    // on self as a category method), causing infinite recursion.
    if (_dataroid_hasOriginal_didRegister) {
        [self dataroid_application:application didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
    }
}

- (void)dataroid_application:(UIApplication *)application
didReceiveRemoteNotification:(NSDictionary *)userInfo
      fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler {
    // Forward to Dataroid SDK
    [[DataroidWrapper dataroidWrapper] didReceiveRemoteNotification:userInfo];
    
    // Call original implementation if it exists
    if (_dataroid_hasOriginal_didReceive) {
        [self dataroid_application:application didReceiveRemoteNotification:userInfo fetchCompletionHandler:completionHandler];
    } else {
        completionHandler(UIBackgroundFetchResultNewData);
    }
}

- (void)dataroid_application:(UIApplication *)application
didFailToRegisterForRemoteNotificationsWithError:(NSError *)error {
    // Forward to Dataroid SDK so the error is surfaced via getSdkStatus()
    if ([DataroidWrapper dataroidWrapper]) {
        [[DataroidWrapper dataroidWrapper] didFailToRegisterForRemoteNotifications:error];
    }

    // Call original implementation if it exists
    if (_dataroid_hasOriginal_didFail) {
        [self dataroid_application:application didFailToRegisterForRemoteNotificationsWithError:error];
    }
}

- (BOOL)dataroid_application:(UIApplication *)application
                     openURL:(NSURL *)url
                     options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options {
    
    // Call original implementation if it exists
    if (_dataroid_hasOriginal_openURL) {
        return [self dataroid_application:application openURL:url options:options];
    }
    
    return YES;
}

- (BOOL)dataroid_application:(UIApplication *)application
        continueUserActivity:(NSUserActivity *)userActivity
          restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>> * _Nullable))restorationHandler {
    // Handle Universal Links
    if ([userActivity.activityType isEqualToString:NSUserActivityTypeBrowsingWeb]) {
        NSURL *url = userActivity.webpageURL;
        if (url && [DataroidWrapper dataroidWrapper]) {
            [[DataroidWrapper dataroidWrapper] handleDeeplinkUrl:url];
        }
    }
    
    // Call original implementation if it exists
    if (_dataroid_hasOriginal_continueUserActivity) {
        return [self dataroid_application:application continueUserActivity:userActivity restorationHandler:restorationHandler];
    }
    
    return YES;
}

@end
