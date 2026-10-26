#!/usr/bin/env node

/**
 * Dataroid Cordova Plugin - Standardized Error Codes
 *
 * Provides consistent error codes and messaging for all hook scripts.
 * All error codes follow the DATAROID_E_* naming convention.
 *
 * Why: Without standardized error codes, plugin install/prepare failures
 * produce inconsistent messages that are hard to diagnose. This module
 * ensures every failure has a machine-readable code, a human-readable
 * message, and a deterministic exit behavior (fatal vs. warning).
 */

"use strict";

/**
 * Error codes used across all Dataroid Cordova Plugin hook scripts.
 * Each code maps to a specific failure scenario with documented remediation.
 */
const CODES = {
  /** SDK_KEY or SERVER_URL is missing or empty. */
  DATAROID_E_CONFIG_REQUIRED: "DATAROID_E_CONFIG_REQUIRED",

  /** google-services.json is missing when PUSH_ENABLED=true. */
  DATAROID_E_FIREBASE_MISSING: "DATAROID_E_FIREBASE_MISSING",

  /** Manual/legacy Dataroid SDK integration detected that conflicts with the plugin. */
  DATAROID_E_LEGACY_CONFLICT: "DATAROID_E_LEGACY_CONFLICT",

  /** Podfile contains directives incompatible with the plugin's requirements. */
  DATAROID_E_IOS_POD_CONFLICT: "DATAROID_E_IOS_POD_CONFLICT",

  /** Rollback of partial hook mutations failed; manual cleanup required. */
  DATAROID_E_ROLLBACK_FAILED: "DATAROID_E_ROLLBACK_FAILED",

  /** SDK failed to initialize at runtime (e.g. invalid SERVER_URL scheme). */
  DATAROID_E_INIT_RUNTIME: "DATAROID_E_INIT_RUNTIME",

  /** iOS push notification registration failed (surfaced via getSdkStatus). */
  DATAROID_E_PUSH_REGISTRATION_FAILED: "DATAROID_E_PUSH_REGISTRATION_FAILED",
};

/**
 * Format a log line with the standard Dataroid prefix and error code.
 * @param {string} code - One of the DATAROID_E_* constants
 * @param {string} message - Human-readable description
 * @returns {string} Formatted message
 */
function formatMessage(code, message) {
  return `[Dataroid][${code}] ${message}`;
}

/**
 * Emit a fatal error and terminate the process.
 * Use this when the plugin cannot proceed safely (e.g. missing required config).
 *
 * @param {string} code - One of the DATAROID_E_* constants
 * @param {string} message - Human-readable description of the failure
 */
function fail(code, message) {
  const formatted = formatMessage(code, message);
  console.error(formatted);
  process.exit(1);
}

/**
 * Emit a non-fatal warning.
 * Use this for degraded-but-recoverable situations (e.g. optional config missing).
 *
 * @param {string} code - One of the DATAROID_E_* constants
 * @param {string} message - Human-readable description of the concern
 */
function warn(code, message) {
  const formatted = formatMessage(code, message);
  console.warn(formatted);
}

module.exports = {
  CODES,
  fail,
  warn,
  formatMessage,
};
