#!/usr/bin/env node

/**
 * Dataroid Cordova Plugin - iOS After Plugin Install Hook
 *
 * This script performs read-only validation when the plugin is installed:
 *   1. Validates that SDK_KEY and SERVER_URL are present and valid.
 *   2. Detects legacy/manual Dataroid framework references that would
 *      conflict with the CocoaPods-managed SDK.
 *   3. Detects Podfile directives incompatible with the SDK's requirements
 *      (e.g. use_modular_headers!, static linkage).
 *
 * All Xcode project configuration (Notification Service Extension, Info.plist
 * background modes, entitlements, deep link schemes, etc.) is the
 * responsibility of the host app developer.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { CODES, fail, warn } = require("./errors");
const { findIosProjectDir } = require("./utils");

const SDK_POD_NAME = "DataroidCore";
const SDK_DEFAULT_VERSION = "4.6.4";

module.exports = function iosAfterPluginInstall(context) {
  const projectRoot = context.opts.projectRoot;
  const platformRoot = path.join(projectRoot, "platforms", "ios");
  const podfilePath = path.join(platformRoot, "Podfile");

  console.log("[Dataroid] Running iOS after_plugin_install hook...");

  if (!fs.existsSync(platformRoot)) {
    console.log("[Dataroid] iOS platform not found, skipping...");
    return;
  }

  const projectDir = findIosProjectDir(platformRoot, context);
  if (!projectDir) {
    console.warn(
      "[Dataroid] iOS project config.xml not found under " +
        platformRoot +
        ". Skipping iOS install validation; check that the iOS platform was added correctly.",
    );
    return;
  }

  validateRequiredConfig(platformRoot, projectDir);
  detectLegacyConflicts(platformRoot);
  detectPodConflicts(podfilePath);

  console.log("[Dataroid] iOS validation complete.");
};

// =====================================================================
// Validation
// =====================================================================

/**
 * Validate that SDK_KEY, SERVER_URL and APP_GROUP_IDENTIFIER are present
 * and valid. Fails the build with DATAROID_E_CONFIG_REQUIRED if missing.
 * SERVER_URL must be a valid HTTPS URL. APP_GROUP_IDENTIFIER is required
 * because the native iOS SDK refuses to initialize without an app group.
 */
function validateRequiredConfig(platformRoot, projectDir) {
  const sdkKey = readPreference(platformRoot, "DATAROID_SDK_KEY", projectDir);
  const serverUrl = readPreference(
    platformRoot,
    "DATAROID_SERVER_URL",
    projectDir,
  );
  const appGroup = readPreference(
    platformRoot,
    "DATAROID_APP_GROUP_IDENTIFIER",
    projectDir,
  );

  if (!sdkKey || sdkKey.startsWith("$")) {
    fail(
      CODES.DATAROID_E_CONFIG_REQUIRED,
      "SDK_KEY is required. Add --variable SDK_KEY=<your-key> to the cordova plugin add command.",
    );
  }

  if (!serverUrl || serverUrl.startsWith("$")) {
    fail(
      CODES.DATAROID_E_CONFIG_REQUIRED,
      "SERVER_URL is required. Add --variable SERVER_URL=<your-url> to the cordova plugin add command.",
    );
  }

  if (!serverUrl.startsWith("https://")) {
    fail(
      CODES.DATAROID_E_CONFIG_REQUIRED,
      "SERVER_URL must use HTTPS. Got: " +
        serverUrl +
        ". Use --variable SERVER_URL=https://your-server.example.com",
    );
  }

  if (!appGroup || appGroup.startsWith("$")) {
    fail(
      CODES.DATAROID_E_CONFIG_REQUIRED,
      "APP_GROUP_IDENTIFIER is required on iOS. The native SDK does not " +
        "initialize without an app group. Add " +
        "--variable APP_GROUP_IDENTIFIER=group.<your-bundle-id> to the " +
        "cordova plugin add command, and enable that App Group capability " +
        "for the app target in Xcode.",
    );
  }
}

// =====================================================================
// Conflict detection
// =====================================================================

/**
 * Detect legacy/manual Dataroid integration that would conflict with
 * the plugin's CocoaPods-managed SDK.
 *
 * Checks manual Dataroid framework references in pbxproj. The Podfile is
 * not checked here: by the time this hook runs, cordova-ios has already
 * written the plugin's own DataroidCore pod into it.
 */
function detectLegacyConflicts(platformRoot) {
  var pbxprojPath = findPbxprojPath(platformRoot);
  if (pbxprojPath) {
    var pbxproj = fs.readFileSync(pbxprojPath, "utf8");
    // CocoaPods adds Pods_<target>.framework, which contains the app name
    // (e.g. Pods_Dataroid_Demo.framework on cordova-ios 7); it is not a manual link.
    var manualFramework = (pbxproj.match(/PBXFileReference;[^}]*/g) || []).some(
      function (entry) {
        var m = entry.match(/\bpath = "?([^";]+)"?;/);
        var name = m ? path.basename(m[1]) : "";
        return (
          !/^Pods_/.test(name) &&
          /(?:AppConnect|Dataroid)[^/]*\.framework$/i.test(name)
        );
      },
    );
    if (manualFramework) {
      fail(
        CODES.DATAROID_E_LEGACY_CONFLICT,
        "Manual AppConnect/Dataroid framework reference found in Xcode project. " +
          "This conflicts with the plugin's CocoaPods-managed SDK. " +
          "Remove the manually linked framework from your Xcode project's " +
          "'Frameworks, Libraries, and Embedded Content' section.",
      );
    }
  }
}

/**
 * Detect Podfile directives that conflict with the plugin's requirements.
 *
 * The DataroidCore SDK is distributed as an XCFramework and requires
 * use_frameworks! with dynamic linkage. Conflicting directives like
 * use_modular_headers! or static linkage will cause build failures.
 */
function detectPodConflicts(podfilePath) {
  if (!fs.existsSync(podfilePath)) return;

  var podfile = fs.readFileSync(podfilePath, "utf8");

  if (/^\s*use_modular_headers!\s*$/m.test(podfile)) {
    fail(
      CODES.DATAROID_E_IOS_POD_CONFLICT,
      "Podfile contains 'use_modular_headers!' which conflicts with the " +
        "plugin's requirement for 'use_frameworks!'. The DataroidCore SDK " +
        "is distributed as an XCFramework and requires dynamic frameworks. " +
        "Remove 'use_modular_headers!' from your Podfile.",
    );
  }

  if (/use_frameworks!\s*:linkage\s*=>\s*:static/.test(podfile)) {
    fail(
      CODES.DATAROID_E_IOS_POD_CONFLICT,
      "Podfile specifies 'use_frameworks! :linkage => :static' which may " +
        "conflict with the DataroidCore XCFramework distribution. " +
        "Use 'use_frameworks!' (dynamic linkage) instead, or verify that " +
        "the SDK supports static linkage with your Xcode version.",
    );
  }

  // Manually added pods (Notification Service Extension DataroidCore,
  // DataroidSnapshot) must use the same version as the plugin's DataroidCore.
  var podPinRE =
    /pod\s+['"](DataroidCore|DataroidSnapshot)['"]\s*,\s*['"]([^'"]+)['"]/g;
  var podPin;
  while ((podPin = podPinRE.exec(podfile)) !== null) {
    var podName = podPin[1];
    var podVersion = podPin[2];
    if (podVersion !== SDK_DEFAULT_VERSION) {
      warn(
        CODES.DATAROID_E_IOS_POD_CONFLICT,
        "'" +
          podName +
          "' is pinned to '" +
          podVersion +
          "' in the Podfile, but the plugin uses " +
          SDK_POD_NAME +
          " '" +
          SDK_DEFAULT_VERSION +
          "'. Update it to '" +
          SDK_DEFAULT_VERSION +
          "' so all Dataroid pods use the same version.",
      );
    }
  }
}

// =====================================================================
// Utilities
// =====================================================================

function readPreference(platformRoot, prefName, projectDir) {
  const dir = projectDir || findIosProjectDir(platformRoot);
  if (!dir) return null;
  const configPath = path.join(dir, "config.xml");
  if (!fs.existsSync(configPath)) return null;

  const content = fs.readFileSync(configPath, "utf8");
  const re = new RegExp(
    'name="' + escapeRegex(prefName) + '"\\s+value="([^"]*)"',
  );
  const m = content.match(re);
  return m ? m[1].trim() || null : null;
}

function findPbxprojPath(platformRoot) {
  let iosFiles;
  try {
    iosFiles = fs.readdirSync(platformRoot);
  } catch (e) {
    return null;
  }
  for (const file of iosFiles) {
    if (file.endsWith(".xcodeproj")) {
      const p = path.join(platformRoot, file, "project.pbxproj");
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports._testing = {
  validateRequiredConfig,
  detectLegacyConflicts,
  detectPodConflicts,
  readPreference,
  findPbxprojPath,
  escapeRegex,
};
