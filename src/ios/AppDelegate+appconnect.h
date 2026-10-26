//
//  AppDelegate+appconnect.h
//  Dataroid Cordova Plugin
//
//  Created by Dataroid Web Team
//

#import <Foundation/Foundation.h>
#import <Cordova/CDVAppDelegate.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * CDVAppDelegate extension for Dataroid Cordova Plugin
 *
 * This extension handles push notification registration and deep linking
 * by forwarding AppDelegate events to the Dataroid SDK.
 *
 * Note: Since cordova-ios 7.x, AppDelegate has been renamed to CDVAppDelegate.
 */
@interface CDVAppDelegate (AppConnect)

@end

NS_ASSUME_NONNULL_END
