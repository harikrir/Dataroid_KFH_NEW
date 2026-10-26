package com.commencis.cordova.plugin.dataroid;

import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.res.Resources;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.dataroid.sdk.Dataroid;
import com.dataroid.sdk.DataroidSessionConfig;
import com.dataroid.sdk.apm.DataroidAPMConfig;
import com.dataroid.sdk.autocollect.DataroidComponentInteractionConfig;
import com.dataroid.sdk.autocollect.DataroidScreenInteractionConfig;
import com.dataroid.sdk.analytics.screentracking.DataroidScreenTrackingConfig;
import com.dataroid.sdk.iamessaging.DataroidInAppMessagingConfig;
import com.dataroid.sdk.inbox.DataroidInboxConfig;
import com.dataroid.sdk.network.networkconfig.DataroidCertificatePinningConfig;
import com.dataroid.sdk.crashreporting.CrashReportingConfig;
import com.dataroid.sdk.network.networkconfig.DataroidNetworkConfig;
import com.dataroid.sdk.util.DataroidLogConfig;
import com.dataroid.sdk.util.LogLevel;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Dataroid SDK Auto-Initialization Provider
 *
 * Initializes the Dataroid SDK automatically during application startup,
 * before Application.onCreate() runs. Does NOT replace the host app's
 * Application class.
 *
 * ContentProvider.onCreate() is called by the Android framework during
 * process initialization, making it the standard mechanism for library
 * auto-initialization (used by Firebase, WorkManager, etc.).
 *
 * Configuration is read from string resources injected by plugin.xml
 * (strings.xml on cordova-android <= 14, cdv_strings.xml on >= 15).
 *
 * To disable auto-initialization (e.g., for custom init timing), add this
 * to your AndroidManifest.xml:
 *   <provider
 *       android:name="com.commencis.cordova.plugin.dataroid.DataroidInitProvider"
 *       tools:node="remove" />
 * Then call DataroidInitProvider.initializeSdk(context) manually.
 */
public class DataroidInitProvider extends ContentProvider {
    private static final String TAG = "DataroidInitProvider";
    private static final String FRAMEWORK = "CORDOVA";

    private static volatile boolean sInitialized = false;
    private static volatile Dataroid sDataroidInstance;
    private static volatile String sLastErrorCode;
    private static volatile String sLastErrorMessage;
    private static volatile long sInitTimestamp;
    private static volatile List<String> sEnabledModules = Collections.emptyList();
    private static volatile boolean sPushEnabled = false;

    @Override
    public boolean onCreate() {
        Context context = getContext();
        if (context == null) {
            Log.e(TAG, "ContentProvider context is null; cannot initialize SDK");
            return false;
        }
        initializeSdk(context);
        return true;
    }

    /**
     * Returns the Dataroid instance, or null if not yet initialized.
     */
    public static Dataroid getDataroidInstance() {
        return sDataroidInstance;
    }

    /**
     * Returns true if the SDK was successfully initialized.
     */
    public static boolean isInitialized() {
        return sInitialized;
    }

    /**
     * Returns the error code from the last initialization attempt, or null.
     */
    public static String getLastErrorCode() {
        return sLastErrorCode;
    }

    /**
     * Returns the error message from the last initialization attempt, or null.
     */
    public static String getLastErrorMessage() {
        return sLastErrorMessage;
    }

    /**
     * Returns the epoch millis timestamp of successful init, or 0.
     */
    public static long getInitTimestamp() {
        return sInitTimestamp;
    }

    /**
     * Returns the list of enabled module names (e.g., "analytics", "push", "inAppMessaging").
     */
    public static List<String> getEnabledModules() {
        return sEnabledModules;
    }

    /**
     * Returns true if push was enabled via the PUSH_ENABLED plugin variable.
     * DataroidPlugin calls enablePush() during Activity lifecycle when this
     * returns true, since Firebase is guaranteed to be ready by then.
     */
    public static boolean isPushConfigured() {
        return sPushEnabled;
    }

    /**
     * Initialize the Dataroid SDK. Idempotent: safe to call multiple times.
     * Also serves as a lazy fallback from DataroidPlugin if the provider
     * was disabled via tools:node="remove".
     *
     * @param context Any valid Context (Application, Activity, or ContentProvider context)
     */
    public static synchronized void initializeSdk(Context context) {
        if (sInitialized) {
            Log.d(TAG, "Dataroid SDK already initialized");
            return;
        }

        try {
            Context appContext = context.getApplicationContext();
            Resources resources = appContext.getResources();
            String packageName = appContext.getPackageName();

            String sdkKey = getStringResource(resources, packageName, "dataroid_sdk_key");
            String serverUrl = getStringResource(resources, packageName, "dataroid_server_url");
            String languageCode = getStringResource(resources, packageName, "dataroid_language_code", "").trim();
            boolean logsEnabled = getBooleanResource(resources, packageName, "dataroid_logs_enabled", false);
            boolean pushEnabled = getBooleanResource(resources, packageName, "dataroid_push_enabled", false);
            boolean inAppMessagingEnabled = getBooleanResource(resources, packageName, "dataroid_in_app_messaging_enabled", true);
            boolean apmEnabled = getBooleanResource(resources, packageName, "dataroid_apm_enabled", true);
            boolean appInboxEnabled = getBooleanResource(resources, packageName, "dataroid_app_inbox_enabled", true);
            boolean geofenceEnabled = getBooleanResource(resources, packageName, "dataroid_geofence_enabled", false);
            boolean snapshotEnabled = getBooleanResource(resources, packageName, "dataroid_snapshot_enabled", false);
            String sslPoliciesJson = getStringResource(resources, packageName, "dataroid_ssl_pinning_policies");
            String dbEncryptionKeyHex = getStringResource(resources, packageName, "dataroid_db_encryption_key");
            boolean dbEncryptionEnabled = getBooleanResource(resources, packageName, "dataroid_db_encryption_enabled", false);
            boolean crashReportingEnabled = getBooleanResource(resources, packageName, "dataroid_crash_reporting_enabled", false);
            boolean crashReportingThreadCollection = getBooleanResource(resources, packageName, "dataroid_crash_reporting_thread_collection", false);

            // The native SDK rejects a server URL that does not end with '/'
            // (DataroidUrlValidator). Cordova passes the install-time variable
            // through verbatim, so normalize it here.
            if (serverUrl != null && !serverUrl.isEmpty() && !serverUrl.endsWith("/")) {
                serverUrl = serverUrl + "/";
            }

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
                Log.w(TAG, "[Dataroid] Running on API " + Build.VERSION.SDK_INT +
                        " where cleartext traffic is allowed by default. " +
                        "Dataroid SDK uses HTTPS only. To block all cleartext traffic app-wide, " +
                        "add android:usesCleartextTraffic=\"false\" to your <application> tag.");
            }

            Log.d(TAG, "Initializing Dataroid SDK...");
            Log.d(TAG, "Server URL: " + serverUrl);
            Log.d(TAG, "Language: " + (languageCode.isEmpty() ? "automatic" : languageCode));
            Log.d(TAG, "Logs: " + logsEnabled);
            Log.d(TAG, "Push: " + pushEnabled);
            Log.d(TAG, "In-App Messaging: " + inAppMessagingEnabled);
            Log.d(TAG, "APM: " + apmEnabled);
            Log.d(TAG, "App Inbox: " + appInboxEnabled);
            Log.d(TAG, "Geofence: " + geofenceEnabled);
            Log.d(TAG, "Snapshot: " + snapshotEnabled);
            Log.d(TAG, "Crash Reporting: " + crashReportingEnabled);
            Log.d(TAG, "Crash Reporting Thread Collection: " + crashReportingThreadCollection);

            Application application;
            if (appContext instanceof Application) {
                application = (Application) appContext;
            } else {
                setError("DATAROID_E_INIT_RUNTIME",
                        "Cannot obtain Application instance from context: " + appContext.getClass().getName());
                return;
            }

            ensureWorkManagerInitialized(appContext);

            DataroidLogConfig logConfig = new DataroidLogConfig("CORDOVA_SDK");
            if (logsEnabled) {
                logConfig.withLogLevel(LogLevel.VERBOSE);
                logConfig.withFileLogging(application.getExternalFilesDir(null), "Dataroid_Cordova_SDK_Logs");
            }

            DataroidComponentInteractionConfig componentInteractionConfig = new DataroidComponentInteractionConfig()
                    .withAutoCollectingEnabled(false);

            DataroidScreenInteractionConfig screenInteractionConfig = new DataroidScreenInteractionConfig()
                    .withAutoCollectingEnabled(false);

            DataroidScreenTrackingConfig screenTrackingConfig = new DataroidScreenTrackingConfig()
                    .setAutoCollectingEnabled(false);

            DataroidAPMConfig apmConfig = new DataroidAPMConfig();
            apmConfig.setEnabled(apmEnabled);
            apmConfig.setAutoCollectingEnabled(false);

            DataroidInAppMessagingConfig inAppMessagingConfig = new DataroidInAppMessagingConfig();
            inAppMessagingConfig.setEnabled(inAppMessagingEnabled);

            DataroidInboxConfig inboxConfig = new DataroidInboxConfig();
            inboxConfig.setEnabled(appInboxEnabled);

            Dataroid.Builder builder = new Dataroid.Builder(application, sdkKey)
                    .withUrl(serverUrl)
                    .withFramework(FRAMEWORK)
                    .withLogConfig(logConfig)
                    .withComponentInteractionConfig(componentInteractionConfig)
                    .withScreenInteractionConfig(screenInteractionConfig)
                    .withScreenTrackingConfig(screenTrackingConfig)
                    .withAPMConfig(apmConfig)
                    .withInAppMessagingConfig(inAppMessagingConfig)
                    .withInboxConfig(inboxConfig);

            if (!languageCode.isEmpty()) {
                builder.withLanguage(new Locale(languageCode));
            }

            // DB encryption
            if (dbEncryptionKeyHex != null && dbEncryptionKeyHex.length() == 64) {
                byte[] keyBytes = hexStringToBytes(dbEncryptionKeyHex);
                if (keyBytes != null && keyBytes.length == 32) {
                    builder.withEncryptedDatabase(dbEncryptionEnabled, keyBytes);
                    Log.d(TAG, dbEncryptionEnabled ? "Database encryption configured" : "Database decryption configured");
                } else {
                    Log.w(TAG, "DB_ENCRYPTION_KEY must be a valid 64-character hex string (256-bit)");
                }
            }

            // SSL pinning
            DataroidNetworkConfig networkConfig = buildNetworkConfig(sslPoliciesJson);
            if (networkConfig != null) {
                builder.withNetworkConfig(networkConfig);
            }

            if (snapshotEnabled) {
                configureSnapshot(builder, packageName);
            }

            if (crashReportingEnabled) {
                configureCrashReporting(builder, crashReportingEnabled, crashReportingThreadCollection);
            }

            sDataroidInstance = builder.build();

            if (pushEnabled) {
                sPushEnabled = true;
            }

            if (geofenceEnabled && sDataroidInstance.getGeofenceClient() != null) {
                sDataroidInstance.getGeofenceClient().enableGeoFencing();
            }

            List<String> modules = new ArrayList<>();
            modules.add("analytics");
            if (pushEnabled) modules.add("push");
            if (inAppMessagingEnabled) modules.add("inAppMessaging");
            if (apmEnabled) modules.add("apm");
            if (appInboxEnabled) modules.add("appInbox");
            if (geofenceEnabled) modules.add("geofence");
            if (snapshotEnabled) modules.add("snapshot");
            if (crashReportingEnabled) modules.add("crashReporting");
            sEnabledModules = Collections.unmodifiableList(modules);

            sInitialized = true;
            sInitTimestamp = System.currentTimeMillis();
            sLastErrorCode = null;
            sLastErrorMessage = null;
            Log.d(TAG, "Dataroid SDK initialized successfully");

        } catch (Exception e) {
            setError("DATAROID_E_INIT_RUNTIME", "Failed to initialize Dataroid SDK: " + e.getMessage());
            Log.e(TAG, "Failed to initialize Dataroid SDK", e);
        }
    }

    /**
     * Safety net: ensures WorkManager is initialized before Dataroid SDK
     * tries to use its internal WorkManagerJobScheduler.
     */
    private static void ensureWorkManagerInitialized(Context context) {
        try {
            Class<?> wmClass = Class.forName("androidx.work.WorkManager");
            Method getInstance = wmClass.getMethod("getInstance", Context.class);
            getInstance.invoke(null, context);
        } catch (Exception e) {
            Log.d(TAG, "WorkManager not yet initialized, bootstrapping with default configuration");
            try {
                Class<?> wmClass = Class.forName("androidx.work.WorkManager");
                Class<?> configClass = Class.forName("androidx.work.Configuration");
                Class<?> builderClass = Class.forName("androidx.work.Configuration$Builder");

                Object builder = builderClass.getConstructor().newInstance();
                Method buildMethod = builderClass.getMethod("build");
                Object config = buildMethod.invoke(builder);

                Method initialize = wmClass.getMethod("initialize", Context.class, configClass);
                initialize.invoke(null, context, config);
            } catch (Exception ignored) {
                Log.w(TAG, "Could not bootstrap WorkManager: " + ignored.getMessage());
            }
        }
    }

    /**
     * Configure snapshot via reflection so the code compiles even when the
     * optional snapshot module is not on the classpath.
     */
    private static void configureSnapshot(Dataroid.Builder builder, String packageName) {
        try {
            Class<?> snapshotConfigClass = Class.forName(
                    "com.dataroid.sdk.snapshot.DataroidSnapshotConfig");
            Constructor<?> ctor = snapshotConfigClass.getConstructor(String[].class);
            Object snapshotConfig = ctor.newInstance((Object) new String[]{packageName});

            Method withEnabled = snapshotConfigClass.getMethod("withEnabled", boolean.class);
            withEnabled.invoke(snapshotConfig, true);

            Method withSnapshotConfig = Dataroid.Builder.class.getMethod(
                    "withSnapshotConfig", snapshotConfigClass);
            withSnapshotConfig.invoke(builder, snapshotConfig);

            Log.d(TAG, "Snapshot configured for package: " + packageName);
        } catch (ClassNotFoundException e) {
            Log.e(TAG, "Snapshot dependency not found. Add 'dataroid-android-sdk-snapshot' " +
                    "to your dependencies. Snapshot will be disabled.");
        } catch (Exception e) {
            Log.e(TAG, "Failed to configure snapshot: " + e.getMessage(), e);
        }
    }

    /**
     * Parse the SSL_PINNING_POLICIES JSON and build a DataroidNetworkConfig.
     * Returns null if no valid policies are found.
     */
    private static DataroidNetworkConfig buildNetworkConfig(String jsonString) {
        if (jsonString == null || jsonString.isEmpty() || jsonString.startsWith("$") || jsonString.trim().isEmpty()) {
            return null;
        }

        try {
            JSONArray policies = new JSONArray(jsonString);
            if (policies.length() == 0) return null;

            DataroidCertificatePinningConfig pinningConfig = new DataroidCertificatePinningConfig();
            int pinCount = 0;

            for (int i = 0; i < policies.length(); i++) {
                JSONObject policy = policies.getJSONObject(i);
                String endpoint = policy.optString("endpoint", "");
                if (endpoint.isEmpty()) continue;

                JSONArray pins = policy.optJSONArray("pins");
                if (pins != null) {
                    for (int j = 0; j < pins.length(); j++) {
                        String pin = pins.optString(j, "");
                        if (!pin.isEmpty()) {
                            pinningConfig.addCertificate(endpoint, pin);
                            pinCount++;
                        }
                    }
                }
            }

            if (pinCount > 0) {
                DataroidNetworkConfig networkConfig = new DataroidNetworkConfig();
                networkConfig.setCertificatePinning(pinningConfig);
                Log.d(TAG, "SSL pinning configured with " + pinCount + " pin(s)");
                return networkConfig;
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to parse SSL_PINNING_POLICIES: " + e.getMessage());
        }
        return null;
    }

    /**
     * Convert a hex string to a byte array.
     */
    static byte[] hexStringToBytes(String hex) {
        if (hex == null || hex.length() % 2 != 0) return null;
        String cleaned = hex.trim();
        byte[] bytes = new byte[cleaned.length() / 2];
        for (int i = 0; i < cleaned.length(); i += 2) {
            int high = Character.digit(cleaned.charAt(i), 16);
            int low = Character.digit(cleaned.charAt(i + 1), 16);
            if (high == -1 || low == -1) return null;
            bytes[i / 2] = (byte) ((high << 4) | low);
        }
        return bytes;
    }

    private static void configureCrashReporting(Dataroid.Builder builder, boolean enabled, boolean threadCollection) {
        try {
            CrashReportingConfig crashConfig = new CrashReportingConfig(enabled, threadCollection, null);
            builder.withCrashReportingConfig(crashConfig);
            Log.d(TAG, "Crash reporting configured: enabled=" + enabled + ", threadCollection=" + threadCollection);
        } catch (Exception e) {
            Log.e(TAG, "Failed to configure crash reporting: " + e.getMessage(), e);
        }
    }

    private static void setError(String code, String message) {
        sLastErrorCode = code;
        sLastErrorMessage = message;
        Log.e(TAG, "[Dataroid][" + code + "] " + message);
    }

    private static String getStringResource(Resources resources, String packageName, String name) {
        return getStringResource(resources, packageName, name, null);
    }

    private static String getStringResource(Resources resources, String packageName, String name, String defaultValue) {
        try {
            int resId = resources.getIdentifier(name, "string", packageName);
            if (resId != 0) {
                String value = resources.getString(resId);
                if (value != null && !value.isEmpty() && !value.startsWith("$")) {
                    return value;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to get string resource: " + name, e);
        }
        return defaultValue;
    }

    private static boolean getBooleanResource(Resources resources, String packageName, String name, boolean defaultValue) {
        String value = getStringResource(resources, packageName, name, null);
        if (value != null) {
            return "true".equalsIgnoreCase(value.trim());
        }
        return defaultValue;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection,
                      String[] selectionArgs) {
        return 0;
    }
}
