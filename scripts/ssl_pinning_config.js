"use strict";

const fs = require("fs");
const path = require("path");
const { CODES, fail } = require("./errors");
const { findIosProjectDir } = require("./utils");
const PLUGIN_ID = "cordova-plugin-dataroid-sdk";

function escapeXml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

function readPolicies(projectRoot, platform) {
  for (const file of [
    path.join(projectRoot, "platforms", platform, platform + ".json"),
    path.join(projectRoot, "plugins", platform + ".json"),
    path.join(projectRoot, "package.json"),
  ]) {
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const variables =
      data.installed_plugins?.[PLUGIN_ID] || data.cordova?.plugins?.[PLUGIN_ID];
    if (
      variables &&
      Object.prototype.hasOwnProperty.call(variables, "SSL_PINNING_POLICIES")
    ) {
      const raw = String(variables.SSL_PINNING_POLICIES);
      if (!raw.trim()) return " ";
      try {
        return JSON.stringify(JSON.parse(raw));
      } catch (_) {
        // Accept the XML escaping previously needed by the installation guide.
        const decoded = raw
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&");
        try {
          return JSON.stringify(JSON.parse(decoded));
        } catch (_) {
          console.warn(
            `[Dataroid] Invalid SSL_PINNING_POLICIES JSON for ${platform}. Certificate pinning may not be applied; fix the install-time configuration before release.`,
          );
          return raw;
        }
      }
    }
  }
  return " ";
}

function settingPattern(tag, name) {
  return new RegExp(
    `<${tag}\\b[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*?(?:/\\s*>|>[\\s\\S]*?</${tag}\\s*>)`,
    "gi",
  );
}

function replaceSetting(file, tag, name, value, parent) {
  if (!fs.existsSync(file)) return;
  const original = fs.readFileSync(file, "utf8");
  const text =
    tag === "string"
      ? value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'")
      : value;
  const fragment =
    tag === "string"
      ? `<string name="${name}">${escapeXml(text)}</string>`
      : `<preference name="${name}" value="${escapeXml(text)}" />`;
  const pattern = settingPattern(tag, name);
  let found = false;
  let updated = original.replace(pattern, () => {
    if (found) return "";
    found = true;
    return fragment;
  });
  if (!found)
    updated = updated.replace(`</${parent}>`, `${fragment}\n</${parent}>`);
  if (updated !== original) fs.writeFileSync(file, updated, "utf8");
}

module.exports = function configureSslPinning(context) {
  const projectRoot = context.opts.projectRoot;
  const platform = context.opts.plugin?.platform;
  const requestedPlatforms = context.opts.cordova?.platforms;
  const platforms = platform
    ? [platform]
    : requestedPlatforms?.length
      ? requestedPlatforms
      : ["android", "ios"];
  for (const target of platforms) {
    const root = path.join(projectRoot, "platforms", target);
    if (!fs.existsSync(root)) continue;
    const value =
      context.hook === "before_plugin_uninstall"
        ? " "
        : readPolicies(projectRoot, target);
    if (target === "ios") {
      const projectDir = findIosProjectDir(root, context);
      if (!projectDir) {
        // Never build without pinning when policies are configured.
        if (value.trim()) {
          fail(
            CODES.DATAROID_E_CONFIG_REQUIRED,
            "SSL_PINNING_POLICIES is set, but the iOS project config.xml was not found under " +
              root +
              ". Certificate pinning cannot be applied; check that the iOS platform was added correctly.",
          );
        }
        continue;
      }
      replaceSetting(
        path.join(projectDir, "config.xml"),
        "preference",
        "DATAROID_SSL_PINNING_POLICIES",
        value,
        "widget",
      );
    } else if (target === "android") {
      const values = path.join(root, "app", "src", "main", "res", "values");
      const name = "dataroid_ssl_pinning_policies";
      const candidates = ["cdv_strings.xml", "strings.xml"]
        .map((file) => path.join(values, file))
        .filter((file) => fs.existsSync(file));
      const file =
        candidates.find((candidate) =>
          settingPattern("string", name).test(
            fs.readFileSync(candidate, "utf8"),
          ),
        ) || candidates[0];
      if (!file) continue;
      // Remove stale duplicates left by earlier hook versions in the other file.
      for (const candidate of candidates.filter(
        (candidate) => candidate !== file,
      )) {
        const original = fs.readFileSync(candidate, "utf8");
        const updated = original.replace(settingPattern("string", name), "");
        if (updated !== original) fs.writeFileSync(candidate, updated, "utf8");
      }
      replaceSetting(
        file,
        "string",
        "dataroid_ssl_pinning_policies",
        value,
        "resources",
      );
    }
  }
};
