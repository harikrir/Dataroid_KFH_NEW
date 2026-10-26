#!/usr/bin/env node

/**
 * Dataroid Cordova Plugin - Android After Plugin Install Hook
 *
 * This script performs validation when the plugin is installed:
 *   1. Validates that SDK_KEY and SERVER_URL are present and valid.
 *   2. Validates Firebase artifacts when PUSH_ENABLED=true and copies
 *      google-services.json to platforms/android/app/ when it is missing there.
 *   3. Validates minSdkVersion meets feature requirements.
 *   4. Detects legacy/manual Dataroid framework references that would
 *      conflict with the plugin's managed dependencies.
 *
 * All other Android project configuration (permissions, deep link
 * intent-filter, Google Services Gradle plugin) is the responsibility of the
 * host app developer.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { CODES, fail } = require("./errors");
const { copyFile, isTrue } = require("./utils");

module.exports = function androidAfterPluginInstall(context) {
  const projectRoot = context.opts.projectRoot;
  const platformRoot = path.join(projectRoot, "platforms", "android");

  if (context.hook === "after_prepare") {
    afterPrepare(context, projectRoot, platformRoot);
    return;
  }

  console.log("[Dataroid] Running Android after_plugin_install hook...");

  if (!fs.existsSync(platformRoot)) {
    console.log("[Dataroid] Android platform not found, skipping...");
    return;
  }

  const config = readAndroidConfig(platformRoot);

  validateRequiredConfig(config);

  // config.xml <resource-file> entries may not be copied yet at install time
  // (e.g. `cordova build` restoring the platform), so a missing file is only
  // a warning here; after_prepare enforces it.
  if (isTrue(config.dataroid_push_enabled)) {
    validateFirebaseArtifacts(projectRoot, platformRoot, { required: false });
  }

  validateMinSdkForFeatures(platformRoot, config);

  detectLegacyConflicts(platformRoot);

  console.log("[Dataroid] Android validation complete.");
};

/**
 * after_prepare: runs after Cordova has copied config.xml <resource-file>
 * entries, so google-services.json is checked and refreshed on every
 * prepare and build, not only when the plugin is installed.
 */
function afterPrepare(context, projectRoot, platformRoot) {
  const platforms =
    (context.opts.cordova && context.opts.cordova.platforms) || [];
  if (platforms.length && platforms.indexOf("android") === -1) return;
  if (!fs.existsSync(platformRoot)) return;

  if (isTrue(readAndroidConfig(platformRoot).dataroid_push_enabled)) {
    validateFirebaseArtifacts(projectRoot, platformRoot);
    validateGoogleServicesPluginEnabled(platformRoot);
  }
}

/**
 * Without the Google Services Gradle plugin, google-services.json is never
 * processed and push fails silently at runtime. Cordova writes the
 * GradlePluginGoogleServicesEnabled preference to cdv-gradle-config.json
 * during prepare; the plugin leaves enabling it to the app (config.xml).
 */
function validateGoogleServicesPluginEnabled(platformRoot) {
  // cordova-android 12+ always writes this file; without it the setting
  // cannot be verified, so fail instead of letting push break silently.
  const gradleConfigPath = path.join(platformRoot, "cdv-gradle-config.json");
  let gradleConfig = null;
  try {
    gradleConfig = JSON.parse(fs.readFileSync(gradleConfigPath, "utf8"));
  } catch (e) {
    gradleConfig = null;
  }
  if (
    gradleConfig === null ||
    typeof gradleConfig !== "object" ||
    Array.isArray(gradleConfig)
  ) {
    fail(
      CODES.DATAROID_E_CONFIG_REQUIRED,
      "Could not read the Google Services setting from " +
        gradleConfigPath +
        ". The file is missing or is not a JSON object; re-add the Android " +
        "platform with `cordova platform rm android && cordova platform add android`.",
    );
  }
  if (gradleConfig.IS_GRADLE_PLUGIN_GOOGLE_SERVICES_ENABLED === true) return;

  fail(
    CODES.DATAROID_E_CONFIG_REQUIRED,
    "PUSH_ENABLED=true requires the Google Services Gradle plugin, which is " +
      "disabled. Without it google-services.json is not processed and push " +
      "notifications do not work. Add " +
      '<preference name="GradlePluginGoogleServicesEnabled" value="true" /> ' +
      "to config.xml (on OutSystems, add it as an Android preference in the " +
      "Extensibility Configurations), or set PUSH_ENABLED=false.",
  );
}

// =====================================================================
// Configuration reading
// =====================================================================

/**
 * Read the dataroid_* values from strings.xml and cdv_strings.xml key by
 * key, as plugin.gradle does. cordova-android 15 keeps Cordova's strings in
 * cdv_strings.xml while the plugin's entries may be in strings.xml. A key
 * with different values in the two files fails the install.
 */
function readAndroidConfig(platformRoot) {
  const valuesDir = path.join(
    platformRoot,
    "app",
    "src",
    "main",
    "res",
    "values",
  );
  const config = {};
  const sources = {};
  ["strings.xml", "cdv_strings.xml"].forEach(function (fileName) {
    const values = readStringsConfig(path.join(valuesDir, fileName));
    Object.keys(values).forEach(function (name) {
      if (sources[name] && config[name] !== values[name]) {
        // Values are not printed: dataroid_db_encryption_key is a secret.
        fail(
          CODES.DATAROID_E_CONFIG_REQUIRED,
          name +
            " has different values in " +
            sources[name] +
            " and " +
            fileName +
            ". Keep a single definition.",
        );
      }
      config[name] = values[name];
      sources[name] = fileName;
    });
  });
  return config;
}

/**
 * Read Dataroid config values from an Android string resource file
 * (strings.xml on cordova-android <= 14, cdv_strings.xml on >= 15).
 * Returns an object with key-value pairs for all dataroid_* entries.
 */
function readStringsConfig(stringsXmlPath) {
  const config = {};
  if (!fs.existsSync(stringsXmlPath)) {
    return config;
  }

  const content = fs.readFileSync(stringsXmlPath, "utf8");
  const re = /<string name="(dataroid_[^"]+)">([^<]*)<\/string>/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    config[m[1]] = m[2].trim();
  }
  return config;
}

/**
 * Read the Android app package name from AndroidManifest.xml.
 * Returns null if it cannot be determined.
 */
function readAppPackageName(platformRoot) {
  var manifestPath = path.join(
    platformRoot,
    "app",
    "src",
    "main",
    "AndroidManifest.xml",
  );
  if (!fs.existsSync(manifestPath)) return null;

  var manifest = fs.readFileSync(manifestPath, "utf8");
  var m = manifest.match(/<manifest[^>]*package="([^"]*)"/);
  return m ? m[1] : null;
}

// =====================================================================
// Validation
// =====================================================================

/**
 * Validate that SDK_KEY and SERVER_URL are present and valid.
 * Fails the build with DATAROID_E_CONFIG_REQUIRED if missing.
 * SERVER_URL must be a valid HTTPS URL (PRD Req 39).
 */
function validateRequiredConfig(config) {
  const sdkKey = config.dataroid_sdk_key;
  const serverUrl = config.dataroid_server_url;

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
}

/**
 * Locations searched for google-services.json, in order. The developer's
 * copies (project root, then www/ for build services such as OutSystems MABS)
 * come first, so a cached platforms/ folder cannot keep a stale file. The
 * Android app directory is last: it is where the Google Services Gradle
 * plugin reads the file, and where config.xml <resource-file> entries put it.
 */
function googleServicesCandidates(projectRoot, platformRoot) {
  return [
    path.join(projectRoot, "google-services.json"),
    path.join(projectRoot, "www", "google-services.json"),
    path.join(platformRoot, "app", "google-services.json"),
  ];
}

/**
 * Return the first existing google-services.json path, or null.
 */
function findGoogleServicesJson(projectRoot, platformRoot) {
  var candidates = googleServicesCandidates(projectRoot, platformRoot);
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  return null;
}

/**
 * Validate that google-services.json exists, is valid JSON, and contains
 * the expected structure when PUSH_ENABLED=true, then copy it to
 * platforms/android/app/ when it was found elsewhere.
 * Fails the build with DATAROID_E_FIREBASE_MISSING if malformed, or if
 * absent unless `options.required` is false (then it only warns).
 *
 * PRD Req 33: "Firebase policy is enforced with deterministic path/variant
 * validation and standardized failure messages."
 */
function validateFirebaseArtifacts(projectRoot, platformRoot, options) {
  const required = !options || options.required !== false;
  const googleServicesPath = findGoogleServicesJson(projectRoot, platformRoot);

  if (!googleServicesPath && !required) {
    console.warn(
      "[Dataroid] google-services.json not found yet. Searched: " +
        googleServicesCandidates(projectRoot, platformRoot).join(", ") +
        ". It is checked again after cordova prepare.",
    );
    return;
  }

  // The app directory copy may be a stale file in a cached platforms/ folder
  // that a <resource-file> entry replaces during prepare; check it then.
  if (
    !required &&
    path.resolve(googleServicesPath) ===
      path.resolve(platformRoot, "app", "google-services.json")
  ) {
    console.log(
      "[Dataroid] google-services.json in " +
        googleServicesPath +
        " is checked after cordova prepare.",
    );
    return;
  }

  if (!googleServicesPath) {
    fail(
      CODES.DATAROID_E_FIREBASE_MISSING,
      "google-services.json not found. Searched: " +
        googleServicesCandidates(projectRoot, platformRoot).join(", ") +
        ". " +
        "Push notifications require Firebase configuration. " +
        "Download google-services.json from the Firebase Console and place it " +
        "in your Cordova project root, or set PUSH_ENABLED=false.",
    );
  }

  var content = fs.readFileSync(googleServicesPath, "utf8");
  var parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    fail(
      CODES.DATAROID_E_FIREBASE_MISSING,
      "google-services.json is not valid JSON: " +
        e.message +
        ". " +
        "Download a fresh copy from the Firebase Console.",
    );
  }

  if (!parsed.project_info || !parsed.client || !Array.isArray(parsed.client)) {
    fail(
      CODES.DATAROID_E_FIREBASE_MISSING,
      "google-services.json is missing required fields (project_info, client). " +
        "The file may be corrupted or incomplete. " +
        "Download a fresh copy from the Firebase Console.",
    );
  }

  if (parsed.client.length === 0) {
    fail(
      CODES.DATAROID_E_FIREBASE_MISSING,
      "google-services.json has an empty 'client' array. " +
        "Register your Android app in the Firebase Console to generate a valid configuration.",
    );
  }

  var appPackageName = readAppPackageName(platformRoot);
  if (appPackageName) {
    var hasMatchingClient = parsed.client.some(function (c) {
      return (
        c.client_info &&
        c.client_info.android_client_info &&
        c.client_info.android_client_info.package_name === appPackageName
      );
    });
    if (!hasMatchingClient) {
      var firebasePackages = parsed.client
        .map(function (c) {
          return (
            c.client_info &&
            c.client_info.android_client_info &&
            c.client_info.android_client_info.package_name
          );
        })
        .filter(Boolean);
      fail(
        CODES.DATAROID_E_FIREBASE_MISSING,
        "google-services.json does not contain a client entry for package '" +
          appPackageName +
          "'. " +
          "Found packages: [" +
          firebasePackages.join(", ") +
          "]. " +
          "Register '" +
          appPackageName +
          "' in your Firebase project, " +
          "download an updated google-services.json, and place it in the project root.",
      );
    }
  }

  copyGoogleServicesToApp(googleServicesPath, platformRoot);
}

/**
 * Copy google-services.json to platforms/android/app/, where the Google
 * Services Gradle plugin reads it. No-op when the source already is that file.
 */
function copyGoogleServicesToApp(sourcePath, platformRoot) {
  var destPath = path.join(platformRoot, "app", "google-services.json");
  if (path.resolve(sourcePath) === path.resolve(destPath)) {
    console.log("[Dataroid] Using google-services.json from " + destPath);
    return;
  }
  if (
    fs.existsSync(destPath) &&
    fs.readFileSync(destPath, "utf8") === fs.readFileSync(sourcePath, "utf8")
  ) {
    console.log("[Dataroid] google-services.json is up to date in " + destPath);
    return;
  }

  try {
    copyFile(sourcePath, destPath);
  } catch (e) {
    fail(
      CODES.DATAROID_E_FIREBASE_MISSING,
      "Could not copy google-services.json from " +
        sourcePath +
        " to " +
        destPath +
        ": " +
        e.message,
    );
  }
  console.log(
    "[Dataroid] Copied google-services.json from " +
      sourcePath +
      " to " +
      destPath,
  );
}

// =====================================================================
// Legacy conflict detection (PRD Req 31)
// =====================================================================

/**
 * Detect legacy/manual Dataroid SDK integration that conflicts with the plugin.
 * Hard-fails with DATAROID_E_LEGACY_CONFLICT when conflicts are found.
 *
 * Checks:
 *  - Existing non-Dataroid android:name on <application> in AndroidManifest.xml
 *  - Manual dataroid-android-sdk (or legacy appconnect-android-sdk) dependency in the app's build.gradle
 */
function detectLegacyConflicts(platformRoot) {
  var manifestPath = path.join(
    platformRoot,
    "app",
    "src",
    "main",
    "AndroidManifest.xml",
  );
  if (fs.existsSync(manifestPath)) {
    var manifest = fs.readFileSync(manifestPath, "utf8");
    var appNameMatch = manifest.match(
      /<application[^>]*android:name="([^"]*)"/,
    );
    if (appNameMatch) {
      var appName = appNameMatch[1];
      if (/dataroid|appconnect|MainApplication/i.test(appName)) {
        fail(
          CODES.DATAROID_E_LEGACY_CONFLICT,
          'AndroidManifest.xml contains android:name="' +
            appName +
            '" ' +
            "which conflicts with the plugin's provider-based auto-initialization. " +
            "Remove the android:name attribute from <application> in your manifest. " +
            "The plugin now initializes via DataroidInitProvider (ContentProvider) " +
            "and no longer requires a custom Application class.",
        );
      }
    }
  }

  var appBuildGradlePath = path.join(platformRoot, "app", "build.gradle");
  if (fs.existsSync(appBuildGradlePath)) {
    var appGradle = fs.readFileSync(appBuildGradlePath, "utf8");
    if (
      /implementation\s+['"]com\.commencis:appconnect-android-sdk/.test(
        appGradle,
      ) ||
      /implementation\s+['"]com\.dataroid:dataroid-android-sdk/.test(appGradle)
    ) {
      fail(
        CODES.DATAROID_E_LEGACY_CONFLICT,
        "Manual Dataroid SDK dependency found in app/build.gradle. " +
          "This conflicts with the plugin's managed dependency. " +
          "Remove the 'com.dataroid:dataroid-android-sdk' (or legacy 'com.commencis:appconnect-android-sdk') " +
          "dependency from your app's build.gradle — the plugin manages this via plugin.gradle.",
      );
    }
  }
}

// =====================================================================
// Feature-specific minSdk validation (PRD Req 9)
// =====================================================================

/**
 * Validate that the host project's minSdkVersion meets feature requirements.
 * Geofencing requires API 21+ and background location requires API 29+.
 * Fails fast per PRD Req 9: feature-specific native constraints must fail
 * with explicit guidance.
 */
function validateMinSdkForFeatures(platformRoot, config) {
  const geofenceEnabled = isTrue(config.dataroid_geofence_enabled);
  if (!geofenceEnabled) return;

  const appBuildGradlePath = path.join(platformRoot, "app", "build.gradle");
  if (!fs.existsSync(appBuildGradlePath)) return;

  const appGradle = fs.readFileSync(appBuildGradlePath, "utf8");
  const minSdkMatch = appGradle.match(/minSdkVersion\s+(\d+)/);
  if (!minSdkMatch) return;

  const minSdk = parseInt(minSdkMatch[1], 10);
  if (isNaN(minSdk)) return;

  if (minSdk < 21) {
    fail(
      CODES.DATAROID_E_CONFIG_REQUIRED,
      "GEOFENCE_ENABLED=true requires minSdkVersion >= 21 (API 21+). " +
        "Current minSdkVersion is " +
        minSdk +
        ". " +
        "Either increase your minSdkVersion to 21 or higher, or set GEOFENCE_ENABLED=false.",
    );
  }
}

module.exports._testing = {
  readStringsConfig,
  readAndroidConfig,
  validateGoogleServicesPluginEnabled,
  readAppPackageName,
  validateRequiredConfig,
  findGoogleServicesJson,
  validateFirebaseArtifacts,
  detectLegacyConflicts,
  validateMinSdkForFeatures,
};
