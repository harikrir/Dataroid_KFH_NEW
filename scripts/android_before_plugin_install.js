#!/usr/bin/env node

/**
 * Dataroid Cordova Plugin - Android Before Plugin Install Hook
 *
 * cordova-android >= 15 renamed res/values/strings.xml to
 * res/values/cdv_strings.xml.  The plugin's <config-file> directive
 * still targets strings.xml so it can work with cordova-android 12-14.
 *
 * This hook runs BEFORE Cordova processes the plugin's config-file
 * entries.  If strings.xml does not exist (v15+), a minimal shim is
 * created so Cordova can append the Dataroid configuration entries.
 * Android's resource merger combines all XML files in res/values/
 * regardless of filename, so the shim coexists safely with
 * cdv_strings.xml.
 */

"use strict";

const fs = require("fs");
const path = require("path");

module.exports = function androidBeforePluginInstall(context) {
  const projectRoot = context.opts.projectRoot;
  const platformRoot = path.join(projectRoot, "platforms", "android");

  if (!fs.existsSync(platformRoot)) {
    return;
  }

  const stringsXmlPath = path.join(
    platformRoot,
    "app",
    "src",
    "main",
    "res",
    "values",
    "strings.xml",
  );

  if (fs.existsSync(stringsXmlPath)) {
    return;
  }

  console.log(
    "[Dataroid] strings.xml not found (cordova-android >= 15); creating shim for config-file compatibility...",
  );

  fs.writeFileSync(
    stringsXmlPath,
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n',
    "utf8",
  );
};

module.exports._testing = {
  STRINGS_XML_SHIM:
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n',
};
