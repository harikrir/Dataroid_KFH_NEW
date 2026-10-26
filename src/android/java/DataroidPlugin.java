package com.commencis.cordova.plugin.dataroid;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.core.util.Pair;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.dataroid.sdk.Dataroid;
import com.dataroid.sdk.autocollect.component.Coordinates;
import com.dataroid.sdk.autocollect.gesture.TouchPoint;
import com.dataroid.sdk.core.event.AttributeBuilder;
import com.dataroid.sdk.core.event.Attributes;
import com.dataroid.sdk.core.event.ButtonClickAttributes;
import com.dataroid.sdk.core.event.CartAttributes;
import com.dataroid.sdk.core.event.ClearCartAttributes;
import com.dataroid.sdk.core.event.UserAttributes;
import com.dataroid.sdk.core.event.DeeplinkLaunchedAttributes;
import com.dataroid.sdk.core.event.DoubleTapAttributes;
import com.dataroid.sdk.core.event.HttpCallAttributes;
import com.dataroid.sdk.core.event.LongPressAttributes;
import com.dataroid.sdk.core.event.NetworkErrorAttributes;
import com.dataroid.sdk.core.event.Product;
import com.dataroid.sdk.core.event.PurchaseAttributes;
import com.dataroid.sdk.core.event.ScreenTrackingAttributes;
import com.dataroid.sdk.core.event.SearchAttributes;
import com.dataroid.sdk.core.event.StartCheckoutAttributes;
import com.dataroid.sdk.core.event.SwipeAttributes;
import com.dataroid.sdk.core.event.TextChangeAttributes;
import com.dataroid.sdk.core.event.ToggleChangeAttributes;
import com.dataroid.sdk.core.event.TouchAttributes;
import com.dataroid.sdk.core.event.ViewCategoryAttributes;
import com.dataroid.sdk.core.event.ViewProductAttributes;
import com.dataroid.sdk.core.event.WishListAttributes;
import com.dataroid.sdk.ctxtrigger.CtxTriggerResult;
import com.dataroid.sdk.iamessaging.InAppMessageDisplayedListener;
import com.dataroid.sdk.iamessaging.InAppMessageDisplayedResult;
import com.dataroid.sdk.inbox.InboxMessage;
import com.dataroid.sdk.inbox.InboxQuery;
import com.dataroid.sdk.inbox.InAppInboxModel;
import com.dataroid.sdk.network.models.InAppMessage;
import com.dataroid.sdk.network.models.PushNotification;
import com.dataroid.sdk.push.InboxMessageType;
import com.dataroid.sdk.survey.SurveyDisplayedListener;
import com.dataroid.sdk.survey.SurveyDisplayedResult;
import com.dataroid.sdk.crashreporting.ExternalExceptionFrame;
import com.dataroid.sdk.util.DataroidLogConfig;
import com.dataroid.sdk.util.LogLevel;
import com.dataroid.sdk.util.subscription.Subscriber;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PermissionHelper;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.math.BigDecimal;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * Dataroid Cordova Plugin
 * Provides full API parity with the React Native SDK
 */
public class DataroidPlugin extends CordovaPlugin {
    private static final String TAG = "DataroidPlugin";
    private static final String FRAMEWORK = "CORDOVA";
    private static final int REQUEST_CODE_POST_NOTIFICATIONS = 11001;
    
    // Dataroid instance reference
    private Dataroid dataroidInstance;
    
    // Configuration
    private String deeplinkHost;
    private String deeplinkScheme;
    
    // Callback contexts for persistent listeners
    private CallbackContext deeplinkHandlerCallbackContext;
    private CallbackContext contextTriggerCallbackContext;
    private CallbackContext createMessagesCallbackContext;
    private CallbackContext deleteMessagesCallbackContext;
    private CallbackContext updateMessagesCallbackContext;
    private CallbackContext inAppMessageDisplayedCallbackContext;
    private CallbackContext surveyDisplayedCallbackContext;
    private CallbackContext notificationPermissionCallbackContext;
    private boolean notificationPermissionRequestedThisSession;
    
    // Stored state
    private String storedDeeplink;
    private Subscriber<CtxTriggerResult> contextTriggerSubscriber;
    
    /**
     * Gets the Dataroid instance from DataroidInitProvider.
     * Returns cached instance if available, otherwise attempts lazy initialization
     * as a fallback (e.g., if the provider was disabled via tools:node="remove").
     * Throws IllegalStateException if SDK cannot be initialized.
     */
    private Dataroid getDataroid() {
        if (dataroidInstance == null) {
            dataroidInstance = DataroidInitProvider.getDataroidInstance();
        }
        if (dataroidInstance == null) {
            Log.w(TAG, "SDK not initialized by DataroidInitProvider; attempting lazy init...");
            DataroidInitProvider.initializeSdk(cordova.getActivity().getApplicationContext());
            dataroidInstance = DataroidInitProvider.getDataroidInstance();
        }
        if (dataroidInstance == null) {
            throw new IllegalStateException(
                "Dataroid SDK is not initialized. Ensure SDK_KEY and SERVER_URL are configured correctly. "
                + "Last error: " + DataroidInitProvider.getLastErrorCode()
                + " - " + DataroidInitProvider.getLastErrorMessage());
        }
        return dataroidInstance;
    }
    
    @Override
    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        
        try {
            int deeplinkHostResId = cordova.getActivity().getResources()
                    .getIdentifier("dataroid_deeplink_host", "string", cordova.getActivity().getPackageName());
            int deeplinkSchemeResId = cordova.getActivity().getResources()
                    .getIdentifier("dataroid_deeplink_scheme", "string", cordova.getActivity().getPackageName());
            
            if (deeplinkHostResId != 0) {
                deeplinkHost = cordova.getActivity().getString(deeplinkHostResId);
            }
            if (deeplinkSchemeResId != 0) {
                deeplinkScheme = cordova.getActivity().getString(deeplinkSchemeResId);
            }
            
            if (DataroidInitProvider.isPushConfigured()) {
                try {
                    getDataroid().enablePush(result -> {
                        Log.d(TAG, "Push enabled with result: " + result);
                    });
                } catch (Exception e) {
                    Log.e(TAG, "Failed to enable push: " + e.getMessage());
                }
            }
            
            handleIntent(cordova.getActivity().getIntent());
        } catch (Exception e) {
            Log.e(TAG, "Error initializing plugin", e);
        }
    }
    
    @Override
    public void onNewIntent(Intent intent) {
        handleIntent(intent);
    }
    
    @Override
    public void onResume(boolean multitasking) {
        super.onResume(multitasking);
        if (DataroidInitProvider.isPushConfigured()) {
            requestNotificationPermissionIfNeeded();
        }
        callJSDeeplinkHandlerCallback();
    }

    @Override
    public void onReset() {
        clearEngagementDisplayListeners();
        super.onReset();
    }

    @Override
    public void onDestroy() {
        clearEngagementDisplayListeners();
        super.onDestroy();
    }

    private void clearEngagementDisplayListeners() {
        inAppMessageDisplayedCallbackContext = null;
        surveyDisplayedCallbackContext = null;

        Dataroid instance = dataroidInstance != null
                ? dataroidInstance
                : DataroidInitProvider.getDataroidInstance();
        if (instance == null) return;

        try {
            instance.getInAppMessaging().setOnInAppMessageDisplayedListener(null);
        } catch (Exception e) {
            Log.w(TAG, "Failed to clear in-app displayed listener", e);
        }

        try {
            instance.getSurveyClient().setOnSurveyDisplayedListener(null);
        } catch (Exception e) {
            Log.w(TAG, "Failed to clear survey displayed listener", e);
        }
    }
    
    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        if (action == null) {
            return false;
        }

        switch (action) {
            // Screen Tracking
            case "viewStarted":
                viewStarted(args, callbackContext);
                return true;
            case "viewStopped":
                viewStopped(args, callbackContext);
                return true;
            case "viewStartedWithViewClass":
                viewStartedWithViewClass(args, callbackContext);
                return true;
            case "viewStoppedWithViewClass":
                viewStoppedWithViewClass(args, callbackContext);
                return true;
            case "viewStartedWithViewClassAutoCaptured":
                viewWithViewClassAutoCaptured(args, callbackContext, true);
                return true;
            case "viewStoppedWithViewClassAutoCaptured":
                viewWithViewClassAutoCaptured(args, callbackContext, false);
                return true;
            case "viewStartedWithExtras":
                viewStartedWithExtras(args, callbackContext);
                return true;
            case "viewStoppedWithExtras":
                viewStoppedWithExtras(args, callbackContext);
                return true;
                
            // Event Collection
            case "collectEvent":
                collectEvent(args, callbackContext);
                return true;
                
            // User Management
            case "setUser":
                setUser(args, callbackContext);
                return true;
            case "clearUser":
                clearUser(callbackContext);
                return true;
                
            // Commerce Events
            case "purchase":
                purchase(args, callbackContext);
                return true;
            case "search":
                search(args, callbackContext);
                return true;
            case "viewProduct":
                viewProduct(args, callbackContext);
                return true;
            case "viewCategory":
                viewCategory(args, callbackContext);
                return true;
            case "addToCart":
                addToCart(args, callbackContext);
                return true;
            case "removeFromCart":
                removeFromCart(args, callbackContext);
                return true;
            case "clearCart":
                clearCart(args, callbackContext);
                return true;
            case "startCheckout":
                startCheckout(args, callbackContext);
                return true;
            case "addToWishList":
                addToWishList(args, callbackContext);
                return true;
            case "removeFromWishList":
                removeFromWishList(args, callbackContext);
                return true;
                
            // Settings & Configuration
            case "setDebugEnabled":
                setDebugEnabled(args, callbackContext);
                return true;
            case "enableEventCollecting":
                enableEventCollecting(callbackContext);
                return true;
            case "disableEventCollecting":
                disableEventCollecting(callbackContext);
                return true;
            case "enableInAppMessaging":
                enableInAppMessaging(callbackContext);
                return true;
            case "disableInAppMessaging":
                disableInAppMessaging(callbackContext);
                return true;
            case "setSessionDropDuration":
                setSessionDropDuration(args, callbackContext);
                return true;
            case "enableAPMEvents":
                enableAPMEvents(callbackContext);
                return true;
            case "disableAPMEvents":
                disableAPMEvents(callbackContext);
                return true;
            case "updateLanguage":
                updateLanguage(args, callbackContext);
                return true;
                
            // APM
            case "collectNetworkError":
                collectNetworkError(args, callbackContext);
                return true;
            case "collectHttpCall":
                collectHttpCall(args, callbackContext);
                return true;
                
            // Deeplinks
            case "handleDeeplink":
                handleDeeplink(callbackContext);
                return true;
            case "deeplinkLaunched":
                deeplinkLaunched(args, callbackContext);
                return true;
                
            // Geolocation
            case "setCountry":
                setCountry(args, callbackContext);
                return true;
            case "clearCountry":
                clearCountry(callbackContext);
                return true;
            case "setCity":
                setCity(args, callbackContext);
                return true;
            case "clearCity":
                clearCity(callbackContext);
                return true;
            case "setRegion":
                setRegion(args, callbackContext);
                return true;
            case "clearRegion":
                clearRegion(callbackContext);
                return true;
            case "setContinent":
                setContinent(args, callbackContext);
                return true;
            case "clearContinent":
                clearContinent(callbackContext);
                return true;
            case "setCoordinates":
                setCoordinates(args, callbackContext);
                return true;
            case "clearCoordinates":
                clearCoordinates(callbackContext);
                return true;
                
            // Geofencing
            case "enableGeofence":
                enableGeofence(callbackContext);
                return true;
            case "disableGeofence":
                disableGeofence(callbackContext);
                return true;
                
            // Component Interaction Tracking
            case "collectButtonClickEvent":
                collectButtonClickEvent(args, callbackContext);
                return true;
            case "collectTextChangeEvent":
                collectTextChangeEvent(args, callbackContext);
                return true;
            case "collectRadioButtonSelectedEvent":
                collectAutoCapturedRadioButtonSelectedEvent(args, callbackContext);
                return true;
            case "collectToggleChangeEvent":
                collectToggleChangeEvent(args, callbackContext);
                return true;
            case "collectTouchEvent":
                collectTouchEvent(args, callbackContext);
                return true;
            case "collectSwipeEvent":
                collectSwipeEvent(args, callbackContext);
                return true;
            case "collectDoubleTapEvent":
                collectDoubleTapEvent(args, callbackContext);
                return true;
            case "collectLongPressEvent":
                collectLongPressEvent(args, callbackContext);
                return true;
                
            // Super Attributes
            case "getAllSuperAttributes":
                getAllSuperAttributes(callbackContext);
                return true;
            case "setSuperAttribute":
                setSuperAttribute(args, callbackContext);
                return true;
            case "clearSuperAttribute":
                clearSuperAttribute(args, callbackContext);
                return true;
            case "clearAllSuperAttributes":
                clearAllSuperAttributes(callbackContext);
                return true;
                
            // App Inbox
            case "getAppInboxMessages":
                getAppInboxMessages(args, callbackContext);
                return true;
            case "deleteAppInboxMessage":
                deleteAppInboxMessage(args, callbackContext);
                return true;
            case "readAppInboxMessage":
                readAppInboxMessage(args, callbackContext);
                return true;
            case "subscribeToCreateMessages":
                subscribeToCreateMessages(callbackContext);
                return true;
            case "subscribeToDeleteMessages":
                subscribeToDeleteMessages(callbackContext);
                return true;
            case "subscribeToUpdateMessages":
                subscribeToUpdateMessages(callbackContext);
                return true;
            case "enableAppInbox":
                enableAppInbox(callbackContext);
                return true;
            case "disableAppInbox":
                disableAppInbox(callbackContext);
                return true;
                
            // Context Triggers
            case "subscribeToContextTriggerResults":
                subscribeToContextTriggerResults(callbackContext);
                return true;
            case "unsubscribeFromContextTriggerResults":
                unsubscribeFromContextTriggerResults(callbackContext);
                return true;

            // Engagement display callbacks
            case "subscribeToInAppMessageDisplayedResults":
                subscribeToInAppMessageDisplayedResults(callbackContext);
                return true;
            case "unsubscribeFromInAppMessageDisplayedResults":
                unsubscribeFromInAppMessageDisplayedResults(callbackContext);
                return true;
            case "subscribeToSurveyDisplayedResults":
                subscribeToSurveyDisplayedResults(callbackContext);
                return true;
            case "unsubscribeFromSurveyDisplayedResults":
                unsubscribeFromSurveyDisplayedResults(callbackContext);
                return true;
                
            // Crash Reporting
            case "collectCrash":
                collectCrash(args, callbackContext);
                return true;
            case "collectError":
                collectError(args, callbackContext);
                return true;

            // SDK Status
            case "requestNotificationPermission":
                requestNotificationPermission(callbackContext);
                return true;
            case "getSdkStatus":
                getSdkStatus(callbackContext);
                return true;

            // Database Encryption
            case "setDatabaseEncryption":
                setDatabaseEncryption(args, callbackContext);
                return true;

            // SSL Pinning
            case "setSSLPinning":
                setSSLPinning(args, callbackContext);
                return true;

            default:
                return false;
        }
    }
    
    // ============================================
    // HELPER METHODS
    // ============================================
    
    private void handleSuccess(CallbackContext callbackContext) {
        try {
            JSONObject result = new JSONObject();
            result.put("success", true);
            callbackContext.success(result);
        } catch (JSONException e) {
            callbackContext.success();
        }
    }
    
    private void handleSuccess(CallbackContext callbackContext, JSONObject extraData) {
        try {
            extraData.put("success", true);
            callbackContext.success(extraData);
        } catch (JSONException e) {
            callbackContext.success(extraData);
        }
    }
    
    private void handleException(Exception e, CallbackContext callbackContext) {
        try {
            JSONObject errorObject = new JSONObject();
            errorObject.put("success", false);
            errorObject.put("name", e.getClass().getSimpleName());
            errorObject.put("message", e.getMessage());
            callbackContext.error(errorObject);
        } catch (JSONException jsonException) {
            callbackContext.error(e.getMessage());
        }
    }
    
    private void handleIntent(Intent intent) {
        if (intent == null || deeplinkHost == null || deeplinkScheme == null) {
            return;
        }
        
        String action = intent.getAction();
        Uri launchUri = intent.getData();
        
        if (!Intent.ACTION_VIEW.equals(action) || launchUri == null) {
            return;
        }
        
        String scheme = launchUri.getScheme();
        String host = launchUri.getHost();
        
        if (scheme == null || host == null) {
            return;
        }
        
        if (!scheme.equals(deeplinkScheme) || !host.contains(deeplinkHost)) {
            return;
        }
        
        storedDeeplink = launchUri.toString();
        callJSDeeplinkHandlerCallback();
    }
    
    private void callJSDeeplinkHandlerCallback() {
        if (deeplinkHandlerCallbackContext != null && storedDeeplink != null) {
            PluginResult result = new PluginResult(PluginResult.Status.OK, storedDeeplink);
            result.setKeepCallback(true);
            storedDeeplink = null;
            deeplinkHandlerCallbackContext.sendPluginResult(result);
        }
    }
    
    private Product buildProduct(JSONObject productObject) throws JSONException {
        Product.Builder productBuilder = Product.Builder.newInstance(
                productObject.getString("id"),
                productObject.getString("name"),
                productObject.getInt("quantity"),
                new BigDecimal(productObject.getDouble("price")),
                productObject.getString("currency")
        );
        
        if (productObject.has("description") && !productObject.isNull("description")) {
            productBuilder.setProductDescription(productObject.getString("description"));
        }
        
        if (productObject.has("brand") && !productObject.isNull("brand")) {
            productBuilder.setBrand(productObject.getString("brand"));
        }
        
        if (productObject.has("variant") && !productObject.isNull("variant")) {
            productBuilder.setVariant(productObject.getString("variant"));
        }
        
        if (productObject.has("category") && !productObject.isNull("category")) {
            productBuilder.setCategory(productObject.getString("category"));
        }
        
        return productBuilder.build();
    }
    
    private void addCustomAttributesToEvent(AttributeBuilder attributeBuilder, JSONObject customAttributes)
            throws JSONException, ParseException {
        if (customAttributes == null) {
            return;
        }
        
        Iterator<String> keys = customAttributes.keys();
        while (keys.hasNext()) {
            String attributeKey = keys.next();
            JSONObject attributeData = customAttributes.getJSONObject(attributeKey);
            String attributeDataType = attributeData.getString("type");
            
            switch (attributeDataType) {
                case "string":
                    attributeBuilder.put(attributeKey, attributeData.getString("value"));
                    break;
                case "number":
                    attributeBuilder.put(attributeKey, attributeData.getInt("value"));
                    break;
                case "amount":
                    attributeBuilder.put(attributeKey, new BigDecimal(attributeData.getDouble("value")));
                    if (attributeData.has("currency")) {
                        attributeBuilder.put("currency", attributeData.getString("currency"));
                    }
                    break;
                case "date":
                    SimpleDateFormat dateFormatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US);
                    attributeBuilder.put(attributeKey, dateFormatter.parse(attributeData.getString("value")));
                    break;
                case "boolean":
                    attributeBuilder.put(attributeKey, attributeData.getBoolean("value"));
                    break;
                case "float":
                    attributeBuilder.put(attributeKey, attributeData.getDouble("value"));
                    break;
                case "number-array":
                    JSONArray numberArray = attributeData.getJSONArray("value");
                    int[] intValues = new int[numberArray.length()];
                    for (int i = 0; i < numberArray.length(); i++) {
                        intValues[i] = numberArray.getInt(i);
                    }
                    attributeBuilder.put(attributeKey, intValues);
                    break;
                case "string-array":
                    JSONArray stringArray = attributeData.getJSONArray("value");
                    String[] stringValues = new String[stringArray.length()];
                    for (int i = 0; i < stringArray.length(); i++) {
                        stringValues[i] = stringArray.getString(i);
                    }
                    attributeBuilder.put(attributeKey, stringValues);
                    break;
            }
        }
    }
    
    private Coordinates getCoordinatesFromJson(JSONObject coordinates) throws JSONException {
        return new Coordinates(
                coordinates.getInt("left"),
                coordinates.getInt("top"),
                coordinates.getInt("right"),
                coordinates.getInt("bottom")
        );
    }
    
    private TouchPoint getTouchPointFromJson(JSONObject touchPoint) throws JSONException {
        return new TouchPoint(touchPoint.getInt("x"), touchPoint.getInt("y"));
    }
    
    private ScreenTrackingAttributes getScreenTrackingAttributesFromJson(JSONObject screenAttrs) {
        if (screenAttrs == null) {
            return null;
        }
        try {
            String viewClass = screenAttrs.optString("viewClass", "");
            String viewLabel = screenAttrs.optString("viewLabel", "");
            return new ScreenTrackingAttributes(viewClass, viewLabel);
        } catch (Exception e) {
            Log.e(TAG, "Error parsing screen tracking attributes", e);
            return null;
        }
    }
    
    private JSONObject mapInboxMessageToJson(InboxMessage message) throws JSONException {
        JSONObject messageJson = new JSONObject();
        SimpleDateFormat dateFormatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US);
        dateFormatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        
        String type = null;
        switch (message.getType()) {
            case InboxMessageType.PUSH_MESSAGE:
                type = "PUSH_MESSAGE";
                break;
            case InboxMessageType.INAPP_MESSAGE:
                type = "INAPP_MESSAGE";
                break;
            case InboxMessageType.GEOFENCE_MESSAGE:
                type = "GEOFENCE_MESSAGE";
                break;
            case InboxMessageType.ACTION_BASED_MESSAGE:
                type = "ACTION_BASED_MESSAGE";
                break;
        }
        
        messageJson.put("type", type);
        messageJson.put("receivedDate", dateFormatter.format(message.getReceivedDate()));
        messageJson.put("expirationDate", message.getExpirationDate() != null
                ? dateFormatter.format(message.getExpirationDate())
                : JSONObject.NULL);
        messageJson.put("customerId", message.getCustomerId());
        messageJson.put("status", message.getStatus());
        messageJson.put("id", String.valueOf(message.getId()));
        
        // Extract message details based on type
        extractMessageDetails(message, messageJson);
        
        return messageJson;
    }
    
    private void extractMessageDetails(InboxMessage message, JSONObject messageJson) throws JSONException {
        switch (message.getType()) {
            case InboxMessageType.PUSH_MESSAGE:
            case InboxMessageType.GEOFENCE_MESSAGE:
                extractPushEventDetails(message, messageJson);
                break;
            case InboxMessageType.INAPP_MESSAGE:
                extractInAppMessageDetails(message, messageJson);
                break;
            case InboxMessageType.ACTION_BASED_MESSAGE:
                extractActionBasedMessageDetails(message, messageJson);
                break;
        }
    }
    
    private void extractPushEventDetails(InboxMessage message, JSONObject messageJson) throws JSONException {
        if (message.getPayload() == null || message.getPayload().getPushNotification() == null) return;
        PushNotification pn = message.getPayload().getPushNotification();
        JSONObject pushEvent = new JSONObject();

        JSONObject alert = buildAlertJson(pn);
        if (alert.length() > 0) pushEvent.put("alert", alert);

        putIfNotNull(pushEvent, "soundName", pn.getSound());
        putIfNotNull(pushEvent, "pushId", pn.getNotificationId());
        putIfNotNull(pushEvent, "scheduleId", pn.getScheduleId());
        putIfNotNull(pushEvent, "mediaURL", pn.getNotificationImageUrl());
        putIfNotNull(pushEvent, "targetURL", pn.getActionUrl());
        putIfNotNull(pushEvent, "actionType", pn.getActionType());

        // Like the React Native SDK, Android reports geofence messages under pushEvent too.
        messageJson.put("pushEvent", pushEvent);
    }

    private void extractInAppMessageDetails(InboxMessage message, JSONObject messageJson) throws JSONException {
        if (message.getPayload() == null || message.getPayload().getInAppMessage() == null) return;
        InAppInboxModel inAppMessage = message.getPayload().getInAppMessage();
        JSONObject inAppJson = new JSONObject();

        putIfNotNull(inAppJson, "messageId", inAppMessage.getInAppMessageId());

        messageJson.put("inAppMessage", inAppJson);
    }

    private void extractActionBasedMessageDetails(InboxMessage message, JSONObject messageJson) throws JSONException {
        JSONObject abm = new JSONObject();

        if (message.getPayload() != null && message.getPayload().getPushNotification() != null) {
            PushNotification pn = message.getPayload().getPushNotification();

            putIfNotNull(abm, "title", pn.getContentTitle());
            putIfNotNull(abm, "text", pn.getContentBody());
            putIfNotNull(abm, "sound", pn.getSound());
            putIfNotNull(abm, "pushId", pn.getNotificationId());
            putIfNotNull(abm, "scheduleId", pn.getScheduleId());
            putIfNotNull(abm, "imageUrl", pn.getNotificationImageUrl());
            putIfNotNull(abm, "actionTargetUrl", pn.getActionUrl());

            if (pn.getActionType() != null) {
                abm.put("actionType", pn.getActionType());
                int actionTypeIndex = 0;
                switch (pn.getActionType()) {
                    case "NOTHING": actionTypeIndex = 0; break;
                    case "OPEN_APP": actionTypeIndex = 1; break;
                    case "GO_TO_URL": actionTypeIndex = 2; break;
                    case "GO_TO_DEEPLINK": actionTypeIndex = 3; break;
                }
                abm.put("actionTypeIndex", actionTypeIndex);
            }

            if (pn.getCustomActionParameters() != null) {
                abm.put("parameters", new JSONObject(pn.getCustomActionParameters()));
            }

            JSONObject alert = buildAlertJson(pn);
            if (alert.length() > 0) abm.put("alert", alert);
        }

        messageJson.put("actionBasedMessage", abm);
    }

    private JSONObject buildAlertJson(PushNotification pn) throws JSONException {
        JSONObject alert = new JSONObject();
        putIfNotNull(alert, "title", pn.getContentTitle());
        putIfNotNull(alert, "body", pn.getContentBody());
        return alert;
    }

    private static void putIfNotNull(JSONObject obj, String key, Object value) throws JSONException {
        if (value != null) obj.put(key, value);
    }
    
    private JSONArray mapInboxMessagesToJsonArray(List<InboxMessage> messages) {
        JSONArray jsonArray = new JSONArray();
        if (messages != null) {
            for (InboxMessage message : messages) {
                try {
                    jsonArray.put(mapInboxMessageToJson(message));
                } catch (Exception e) {
                    // Skip a message that cannot be mapped, as the React Native SDK does.
                    Log.w(TAG, "Failed to map inbox message", e);
                }
            }
        }
        return jsonArray;
    }
    
    // ============================================
    // SCREEN TRACKING
    // ============================================
    
    private void viewStarted(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String viewLabel = args.getString(0);
                ScreenTrackingAttributes attrs = new ScreenTrackingAttributes(
                        cordova.getActivity().getClass().getSimpleName(), viewLabel);
                getDataroid().getScreenTracker().viewStart(attrs);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void viewStopped(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String viewLabel = args.getString(0);
                ScreenTrackingAttributes attrs = new ScreenTrackingAttributes(
                        cordova.getActivity().getClass().getSimpleName(), viewLabel);
                getDataroid().getScreenTracker().viewStop(attrs);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void viewStartedWithViewClass(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String viewClass = args.getString(0);
                String viewLabel = args.optString(1, null);
                ScreenTrackingAttributes attributes = new ScreenTrackingAttributes(viewClass, viewLabel);
                getDataroid().getScreenTracker().viewStart(attributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void viewStoppedWithViewClass(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String viewClass = args.getString(0);
                String viewLabel = args.optString(1, null);
                ScreenTrackingAttributes attributes = new ScreenTrackingAttributes(viewClass, viewLabel);
                getDataroid().getScreenTracker().viewStop(attributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }

    private void viewWithViewClassAutoCaptured(
            JSONArray args,
            CallbackContext callbackContext,
            boolean started
    ) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String viewClass = args.getString(0);
                String viewLabel = args.optString(1, null);
                String method = started
                        ? "screenTracker.viewStarted"
                        : "screenTracker.viewStopped";
                if (!DataroidHybridBridge.forwardAutoCapturedScreen(
                        getDataroid(), method, viewClass, viewLabel)) {
                    throw new IllegalStateException("Failed to forward auto-captured screen event");
                }
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void viewStartedWithExtras(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String viewClass = args.getString(0);
                String viewLabel = args.optString(1, null);
                JSONObject customAttributes = args.optJSONObject(2);
                
                ScreenTrackingAttributes attributes = new ScreenTrackingAttributes(viewClass, viewLabel);
                addCustomAttributesToEvent(attributes, customAttributes);
                
                getDataroid().getScreenTracker().viewStart(attributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void viewStoppedWithExtras(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String viewClass = args.getString(0);
                String viewLabel = args.optString(1, null);
                JSONObject customAttributes = args.optJSONObject(2);
                
                ScreenTrackingAttributes attributes = new ScreenTrackingAttributes(viewClass, viewLabel);
                addCustomAttributesToEvent(attributes, customAttributes);
                
                getDataroid().getScreenTracker().viewStop(attributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    // ============================================
    // EVENT COLLECTION
    // ============================================
    
    private void collectEvent(JSONArray args, CallbackContext callbackContext) {
        try {
            String eventName = args.getString(0);
            JSONObject eventAttributes = args.optJSONObject(1);
            
            Attributes attributes = new Attributes();
            
            addCustomAttributesToEvent(attributes, eventAttributes);
            
            getDataroid().collectEvent(eventName, attributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    // ============================================
    // USER MANAGEMENT
    // ============================================
    
    private void setUser(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject userData = args.getJSONObject(0);
            JSONObject extraData = args.optJSONObject(1);
            
            Object customerIdValue = userData.opt("customerId");
            if (!(customerIdValue instanceof String)
                    || ((String) customerIdValue).trim().isEmpty()) {
                throw new IllegalArgumentException("userData.customerId is required");
            }
            String customerId = (String) customerIdValue;
            UserAttributes customerAttributes = new UserAttributes();
            
            if (userData.has("email") && !userData.isNull("email")) {
                customerAttributes.setEmail(userData.getString("email"));
            }
            if (userData.has("phoneNumber") && !userData.isNull("phoneNumber")) {
                customerAttributes.setPhoneNumber(userData.getString("phoneNumber"));
            }
            if (userData.has("nationalId") && !userData.isNull("nationalId")) {
                customerAttributes.setNationalId(userData.getString("nationalId"));
            }
            if (userData.has("firstName") && !userData.isNull("firstName")) {
                customerAttributes.setFirstName(userData.getString("firstName"));
            }
            if (userData.has("lastName") && !userData.isNull("lastName")) {
                customerAttributes.setLastName(userData.getString("lastName"));
            }
            if (userData.has("gender") && !userData.isNull("gender")) {
                customerAttributes.setGender(userData.getString("gender"));
            }
            if (userData.has("dateOfBirth") && !userData.isNull("dateOfBirth")) {
                SimpleDateFormat df = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                customerAttributes.setDateOfBirth(df.parse(userData.getString("dateOfBirth")));
            }
            
            if (extraData != null) {
                addCustomAttributesToEvent(customerAttributes, extraData);
            }
            
            getDataroid().setUser(customerId, customerAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearUser(CallbackContext callbackContext) {
        try {
            getDataroid().clearUser();
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    // ============================================
    // COMMERCE EVENTS
    // ============================================
    
    private void purchase(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONArray products = args.optJSONArray(0);
            JSONObject purchaseData = args.getJSONObject(1);
            JSONObject customAttributes = args.optJSONObject(2);
            
            double value = purchaseData.getDouble("value");
            String currency = purchaseData.getString("currency");
            boolean success = purchaseData.getBoolean("success");
            
            PurchaseAttributes purchaseAttributes = new PurchaseAttributes(
                    currency, new BigDecimal(value), success);
            
            if (products != null) {
                List<Product> productList = new ArrayList<>();
                for (int i = 0; i < products.length(); i++) {
                    productList.add(buildProduct(products.getJSONObject(i)));
                }
                purchaseAttributes.setProductList(productList);
            }
            
            if (purchaseData.has("quantity") && !purchaseData.isNull("quantity")) {
                purchaseAttributes.setQuantity(purchaseData.getInt("quantity"));
            }
            if (purchaseData.has("tax") && !purchaseData.isNull("tax")) {
                purchaseAttributes.setTax(new BigDecimal(purchaseData.getDouble("tax")));
            }
            if (purchaseData.has("ship") && !purchaseData.isNull("ship")) {
                purchaseAttributes.setShip(new BigDecimal(purchaseData.getDouble("ship")));
            }
            if (purchaseData.has("discount") && !purchaseData.isNull("discount")) {
                purchaseAttributes.setDiscount(new BigDecimal(purchaseData.getDouble("discount")));
            }
            if (purchaseData.has("coupon") && !purchaseData.isNull("coupon")) {
                purchaseAttributes.setCoupon(purchaseData.getString("coupon"));
            }
            if (purchaseData.has("trxId") && !purchaseData.isNull("trxId")) {
                purchaseAttributes.setTransactionId(purchaseData.getString("trxId"));
            }
            if (purchaseData.has("paymentMethod") && !purchaseData.isNull("paymentMethod")) {
                purchaseAttributes.setPaymentMethod(purchaseData.getString("paymentMethod"));
            }
            if (purchaseData.has("errorCode") && !purchaseData.isNull("errorCode")) {
                purchaseAttributes.setErrorCode(purchaseData.getString("errorCode"));
            }
            if (purchaseData.has("errorMessage") && !purchaseData.isNull("errorMessage")) {
                purchaseAttributes.setErrorMessage(purchaseData.getString("errorMessage"));
            }
            
            addCustomAttributesToEvent(purchaseAttributes, customAttributes);
            getDataroid().collectPurchase(purchaseAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void search(JSONArray args, CallbackContext callbackContext) {
        try {
            String query = args.getString(0);
            JSONObject customAttributes = args.optJSONObject(1);
            
            SearchAttributes searchAttributes = new SearchAttributes(query);
            addCustomAttributesToEvent(searchAttributes, customAttributes);
            getDataroid().collectSearch(searchAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void viewProduct(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject productData = args.getJSONObject(0);
            JSONObject customAttributes = args.optJSONObject(1);
            
            ViewProductAttributes viewProductAttributes = new ViewProductAttributes(buildProduct(productData));
            addCustomAttributesToEvent(viewProductAttributes, customAttributes);
            getDataroid().collectViewProduct(viewProductAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void viewCategory(JSONArray args, CallbackContext callbackContext) {
        try {
            String category = args.getString(0);
            JSONObject customAttributes = args.optJSONObject(1);
            
            ViewCategoryAttributes viewCategoryAttributes = new ViewCategoryAttributes(category);
            addCustomAttributesToEvent(viewCategoryAttributes, customAttributes);
            getDataroid().collectViewCategory(viewCategoryAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void addToCart(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject productData = args.getJSONObject(0);
            double value = args.optDouble(1, 0);
            double totalCartValue = args.optDouble(2, 0);
            JSONObject customAttributes = args.optJSONObject(3);
            
            CartAttributes cartAttributes = new CartAttributes(buildProduct(productData));
            cartAttributes.setValue(new BigDecimal(value));
            cartAttributes.setTotalCartValue(new BigDecimal(totalCartValue));
            addCustomAttributesToEvent(cartAttributes, customAttributes);
            getDataroid().collectAddToCart(cartAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void removeFromCart(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject productData = args.getJSONObject(0);
            double value = args.optDouble(1, 0);
            double totalCartValue = args.optDouble(2, 0);
            JSONObject customAttributes = args.optJSONObject(3);
            
            CartAttributes cartAttributes = new CartAttributes(buildProduct(productData));
            cartAttributes.setValue(new BigDecimal(value));
            cartAttributes.setTotalCartValue(new BigDecimal(totalCartValue));
            addCustomAttributesToEvent(cartAttributes, customAttributes);
            getDataroid().collectRemoveFromCart(cartAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearCart(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject customAttributes = args.optJSONObject(0);
            
            ClearCartAttributes clearCartAttributes = new ClearCartAttributes();
            addCustomAttributesToEvent(clearCartAttributes, customAttributes);
            getDataroid().collectClearCart(clearCartAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void startCheckout(JSONArray args, CallbackContext callbackContext) {
        try {
            double value = args.getDouble(0);
            String currency = args.getString(1);
            int quantity = args.optInt(2, 0);
            JSONObject customAttributes = args.optJSONObject(3);
            
            StartCheckoutAttributes startCheckoutAttributes = new StartCheckoutAttributes(
                    new BigDecimal(value), currency);
            startCheckoutAttributes.setQuantity(quantity);
            addCustomAttributesToEvent(startCheckoutAttributes, customAttributes);
            getDataroid().collectStartCheckout(startCheckoutAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void addToWishList(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject productData = args.getJSONObject(0);
            JSONObject customAttributes = args.optJSONObject(1);
            
            WishListAttributes wishListAttributes = new WishListAttributes(buildProduct(productData));
            addCustomAttributesToEvent(wishListAttributes, customAttributes);
            getDataroid().collectAddToWishList(wishListAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void removeFromWishList(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject productData = args.getJSONObject(0);
            JSONObject customAttributes = args.optJSONObject(1);
            
            WishListAttributes wishListAttributes = new WishListAttributes(buildProduct(productData));
            addCustomAttributesToEvent(wishListAttributes, customAttributes);
            getDataroid().collectRemoveFromWishList(wishListAttributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    // ============================================
    // SETTINGS & CONFIGURATION
    // ============================================

    private void setDebugEnabled(JSONArray args, CallbackContext callbackContext) {
        try {
            boolean enabled = args.getBoolean(0);
            Dataroid dataroid = getDataroid();
            DataroidLogConfig logConfig = new DataroidLogConfig("CORDOVA_SDK");
            if (enabled) {
                logConfig.withLogLevel(LogLevel.VERBOSE);
                Log.d(TAG, "Debug logging enabled (VERBOSE)");
            } else {
                logConfig.withLogLevel(LogLevel.ERROR);
                Log.d(TAG, "Debug logging disabled (ERROR only)");
            }
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }

    private void enableEventCollecting(CallbackContext callbackContext) {
        try {
            getDataroid().getConfig().setEventCollectingEnabled(true);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void disableEventCollecting(CallbackContext callbackContext) {
        try {
            getDataroid().getConfig().setEventCollectingEnabled(false);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void enableInAppMessaging(CallbackContext callbackContext) {
        try {
            getDataroid().getConfig().getInAppMessagingConfig().setEnabled(true);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void disableInAppMessaging(CallbackContext callbackContext) {
        try {
            getDataroid().getConfig().getInAppMessagingConfig().setEnabled(false);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void setSessionDropDuration(JSONArray args, CallbackContext callbackContext) {
        try {
            int duration = args.getInt(0);
            getDataroid().getConfig().getSessionConfig().setTimeout(duration * 1000);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void enableAPMEvents(CallbackContext callbackContext) {
        try {
            getDataroid().getConfig().getAPMConfig().setEnabled(true);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void disableAPMEvents(CallbackContext callbackContext) {
        try {
            getDataroid().getConfig().getAPMConfig().setEnabled(false);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void updateLanguage(JSONArray args, CallbackContext callbackContext) {
        try {
            String languageCode = args.getString(0);
            getDataroid().updateLanguage(new Locale(languageCode));
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    // ============================================
    // APM
    // ============================================
    
    private void collectNetworkError(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject errorData = args.getJSONObject(0);

            if (DataroidHybridBridge.forwardAutoCaptured(
                    getDataroid(), "collectNetworkError", errorData, null)) {
                handleSuccess(callbackContext);
                return;
            }
            
            String url = errorData.getString("url");
            String method = errorData.getString("method");
            long duration = (long) errorData.getDouble("duration");
            String type = errorData.getString("type");
            String exception = errorData.getString("exception");
            
            NetworkErrorAttributes attributes = new NetworkErrorAttributes(
                    url, method, duration, type, exception);
            
            if (errorData.has("message") && !errorData.isNull("message")) {
                attributes.setMessage(errorData.getString("message"));
            }
            
            getDataroid().getAPMClient().collectNetworkError(attributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void collectHttpCall(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject httpData = args.getJSONObject(0);

            if (DataroidHybridBridge.forwardAutoCaptured(
                    getDataroid(), "collectHttpCall", httpData, null)) {
                handleSuccess(callbackContext);
                return;
            }
            
            String url = httpData.getString("url");
            String method = httpData.getString("method");
            int statusCode = httpData.getInt("statusCode");
            double duration = httpData.getDouble("duration");
            boolean success = httpData.getBoolean("success");
            
            HttpCallAttributes attributes = new HttpCallAttributes(
                    url, method, statusCode, (long) duration, success);
            
            if (httpData.has("errorType") && !httpData.isNull("errorType")) {
                attributes.setErrorType(httpData.getString("errorType"));
            }
            if (httpData.has("errorCode") && !httpData.isNull("errorCode")) {
                attributes.setErrorCode(httpData.getString("errorCode"));
            }
            if (httpData.has("errorMessage") && !httpData.isNull("errorMessage")) {
                attributes.setErrorMessage(httpData.getString("errorMessage"));
            }
            
            getDataroid().getAPMClient().collectHttpCall(attributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    // ============================================
    // DEEPLINKS
    // ============================================
    
    private void handleDeeplink(CallbackContext callbackContext) {
        deeplinkHandlerCallbackContext = callbackContext;
        callJSDeeplinkHandlerCallback();
    }
    
    private void deeplinkLaunched(JSONArray args, CallbackContext callbackContext) {
        try {
            String deeplinkUrl = args.getString(0);
            Uri url = Uri.parse(deeplinkUrl);
            DeeplinkLaunchedAttributes attributes = new DeeplinkLaunchedAttributes(url);
            getDataroid().collectDeeplinkLaunched(attributes);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    // ============================================
    // GEOLOCATION
    // ============================================
    
    private void setCountry(JSONArray args, CallbackContext callbackContext) {
        try {
            String country = args.getString(0);
            getDataroid().setCountry(country);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearCountry(CallbackContext callbackContext) {
        try {
            getDataroid().clearCountry();
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void setCity(JSONArray args, CallbackContext callbackContext) {
        try {
            String city = args.getString(0);
            getDataroid().setCity(city);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearCity(CallbackContext callbackContext) {
        try {
            getDataroid().clearCity();
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void setRegion(JSONArray args, CallbackContext callbackContext) {
        try {
            String region = args.getString(0);
            getDataroid().setRegion(region);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearRegion(CallbackContext callbackContext) {
        try {
            getDataroid().clearRegion();
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void setContinent(JSONArray args, CallbackContext callbackContext) {
        try {
            String continent = args.getString(0);
            getDataroid().setContinent(continent);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearContinent(CallbackContext callbackContext) {
        try {
            getDataroid().clearContinent();
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void setCoordinates(JSONArray args, CallbackContext callbackContext) {
        try {
            double latitude = args.getDouble(0);
            double longitude = args.getDouble(1);
            getDataroid().setCoordinates(latitude, longitude);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearCoordinates(CallbackContext callbackContext) {
        try {
            getDataroid().clearCoordinates();
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    // ============================================
    // GEOFENCING
    // ============================================
    
    private void enableGeofence(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                if (!getDataroid().getGeofenceClient().isEnabled()) {
                    getDataroid().getGeofenceClient().enableGeoFencing();
                }
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void disableGeofence(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                if (getDataroid().getGeofenceClient().isEnabled()) {
                    getDataroid().getGeofenceClient().disableGeoFencing();
                }
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    // ============================================
    // COMPONENT INTERACTION TRACKING
    // ============================================
    
    private void collectButtonClickEvent(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject attributes = args.getJSONObject(0);
                JSONObject screenAttrs = args.optJSONObject(1);

                if (DataroidHybridBridge.forwardAutoCaptured(
                        getDataroid(), "collectButtonClickEvent", attributes, screenAttrs)) {
                    handleSuccess(callbackContext);
                    return;
                }
                
                String className = attributes.getString("className");
                String label = attributes.optString("label", null);
                String accessibilityLabel = attributes.optString("accessibilityLabel", null);
                String componentId = attributes.optString("componentId", null);
                
                ButtonClickAttributes buttonClickAttributes = new ButtonClickAttributes();
                buttonClickAttributes.setClassName(className);
                if (label != null) buttonClickAttributes.setLabel(label);
                if (accessibilityLabel != null) buttonClickAttributes.setAccessibilityLabel(accessibilityLabel);
                if (componentId != null) buttonClickAttributes.setComponentId(componentId);
                
                if (attributes.has("coordinates") && !attributes.isNull("coordinates")) {
                    buttonClickAttributes.setCoordinates(getCoordinatesFromJson(attributes.getJSONObject("coordinates")));
                }
                
                if (screenAttrs != null) {
                    ScreenTrackingAttributes screenTrackingAttributes = getScreenTrackingAttributesFromJson(screenAttrs);
                    if (screenTrackingAttributes != null) {
                        buttonClickAttributes.setScreenTrackingAttributes(screenTrackingAttributes);
                    }
                }
                
                getDataroid().getAutoCaptureClient().collectButtonClick(buttonClickAttributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void collectTextChangeEvent(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject attributes = args.getJSONObject(0);
                JSONObject screenAttrs = args.optJSONObject(1);

                if (DataroidHybridBridge.forwardAutoCaptured(
                        getDataroid(), "collectTextChangeEvent", attributes, screenAttrs)) {
                    handleSuccess(callbackContext);
                    return;
                }
                
                String className = attributes.getString("className");
                String textValue = attributes.optString("textValue", "");
                String placeholder = attributes.optString("placeholder", null);
                String accessibilityLabel = attributes.optString("accessibilityLabel", null);
                String componentId = attributes.optString("componentId", null);
                
                TextChangeAttributes textChangeAttributes = new TextChangeAttributes();
                textChangeAttributes.setClassName(className);
                textChangeAttributes.setTextValue(textValue);
                if (placeholder != null) textChangeAttributes.setPlaceholder(placeholder);
                if (accessibilityLabel != null) textChangeAttributes.setAccessibilityLabel(accessibilityLabel);
                if (componentId != null) textChangeAttributes.setComponentId(componentId);
                
                if (attributes.has("coordinates") && !attributes.isNull("coordinates")) {
                    textChangeAttributes.setCoordinates(getCoordinatesFromJson(attributes.getJSONObject("coordinates")));
                }
                
                if (screenAttrs != null) {
                    ScreenTrackingAttributes screenTrackingAttributes = getScreenTrackingAttributesFromJson(screenAttrs);
                    if (screenTrackingAttributes != null) {
                        textChangeAttributes.setScreenTrackingAttributes(screenTrackingAttributes);
                    }
                }
                
                getDataroid().getAutoCaptureClient().collectTextChange(textChangeAttributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void collectAutoCapturedRadioButtonSelectedEvent(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                if (!DataroidHybridBridge.forwardAutoCaptured(
                        getDataroid(), "collectRadioButtonSelectedEvent", args.getJSONObject(0), args.optJSONObject(1))) {
                    callbackContext.error("Radio auto-capture requires ac:true and an initialized SDK");
                    return;
                }
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }

    private void collectToggleChangeEvent(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject attributes = args.getJSONObject(0);
                JSONObject screenAttrs = args.optJSONObject(1);

                if (DataroidHybridBridge.forwardAutoCaptured(
                        getDataroid(), "collectToggleChangeEvent", attributes, screenAttrs)) {
                    handleSuccess(callbackContext);
                    return;
                }
                
                String className = attributes.getString("className");
                boolean isChecked = attributes.optBoolean("isChecked", false);
                String accessibilityLabel = attributes.optString("accessibilityLabel", null);
                String componentId = attributes.optString("componentId", null);
                
                ToggleChangeAttributes toggleChangeAttributes = new ToggleChangeAttributes();
                toggleChangeAttributes.setClassName(className);
                toggleChangeAttributes.setIsChecked(isChecked);
                if (accessibilityLabel != null) toggleChangeAttributes.setAccessibilityLabel(accessibilityLabel);
                if (componentId != null) toggleChangeAttributes.setComponentId(componentId);
                
                if (attributes.has("coordinates") && !attributes.isNull("coordinates")) {
                    toggleChangeAttributes.setCoordinates(getCoordinatesFromJson(attributes.getJSONObject("coordinates")));
                }
                
                if (screenAttrs != null) {
                    ScreenTrackingAttributes screenTrackingAttributes = getScreenTrackingAttributesFromJson(screenAttrs);
                    if (screenTrackingAttributes != null) {
                        toggleChangeAttributes.setScreenTrackingAttributes(screenTrackingAttributes);
                    }
                }
                
                getDataroid().getAutoCaptureClient().collectToggleChange(toggleChangeAttributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void collectTouchEvent(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject attributes = args.getJSONObject(0);
                JSONObject screenAttrs = args.optJSONObject(1);

                if (DataroidHybridBridge.forwardAutoCaptured(
                        getDataroid(), "collectTouchEvent", attributes, screenAttrs)) {
                    handleSuccess(callbackContext);
                    return;
                }
                
                String className = attributes.getString("className");
                
                TouchAttributes touchAttributes = new TouchAttributes();
                touchAttributes.setClassName(className);
                
                if (attributes.has("touchPoint") && !attributes.isNull("touchPoint")) {
                    touchAttributes.setTouchPoint(getTouchPointFromJson(attributes.getJSONObject("touchPoint")));
                }
                
                if (screenAttrs != null) {
                    ScreenTrackingAttributes screenTrackingAttributes = getScreenTrackingAttributesFromJson(screenAttrs);
                    if (screenTrackingAttributes != null) {
                        touchAttributes.setScreenTrackingAttributes(screenTrackingAttributes);
                    }
                }
                
                getDataroid().getAutoCaptureClient().collectTouch(touchAttributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void collectSwipeEvent(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject attributes = args.getJSONObject(0);
                JSONObject screenAttrs = args.optJSONObject(1);

                if (DataroidHybridBridge.forwardAutoCaptured(
                        getDataroid(), "collectSwipeEvent", attributes, screenAttrs)) {
                    handleSuccess(callbackContext);
                    return;
                }
                
                String className = attributes.getString("className");
                
                SwipeAttributes swipeAttributes = new SwipeAttributes();
                swipeAttributes.setClassName(className);
                
                if (attributes.has("swipePoints") && !attributes.isNull("swipePoints")) {
                    JSONObject swipePoints = attributes.getJSONObject("swipePoints");
                    TouchPoint startPoint = getTouchPointFromJson(swipePoints.getJSONObject("swipeStart"));
                    TouchPoint endPoint = getTouchPointFromJson(swipePoints.getJSONObject("swipeEnd"));
                    swipeAttributes.setSwipePoints(startPoint, endPoint);
                }
                
                if (screenAttrs != null) {
                    ScreenTrackingAttributes screenTrackingAttributes = getScreenTrackingAttributesFromJson(screenAttrs);
                    if (screenTrackingAttributes != null) {
                        swipeAttributes.setScreenTrackingAttributes(screenTrackingAttributes);
                    }
                }
                
                getDataroid().getAutoCaptureClient().collectSwipe(swipeAttributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void collectDoubleTapEvent(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject attributes = args.getJSONObject(0);
                JSONObject screenAttrs = args.optJSONObject(1);

                if (DataroidHybridBridge.forwardAutoCaptured(
                        getDataroid(), "collectDoubleTapEvent", attributes, screenAttrs)) {
                    handleSuccess(callbackContext);
                    return;
                }
                
                String className = attributes.getString("className");
                
                DoubleTapAttributes doubleTapAttributes = new DoubleTapAttributes();
                doubleTapAttributes.setClassName(className);
                
                if (attributes.has("touchPoint") && !attributes.isNull("touchPoint")) {
                    doubleTapAttributes.setTouchPoint(getTouchPointFromJson(attributes.getJSONObject("touchPoint")));
                }
                
                if (screenAttrs != null) {
                    ScreenTrackingAttributes screenTrackingAttributes = getScreenTrackingAttributesFromJson(screenAttrs);
                    if (screenTrackingAttributes != null) {
                        doubleTapAttributes.setScreenTrackingAttributes(screenTrackingAttributes);
                    }
                }
                
                getDataroid().getAutoCaptureClient().collectDoubleTap(doubleTapAttributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void collectLongPressEvent(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject attributes = args.getJSONObject(0);
                JSONObject screenAttrs = args.optJSONObject(1);

                if (DataroidHybridBridge.forwardAutoCaptured(
                        getDataroid(), "collectLongPressEvent", attributes, screenAttrs)) {
                    handleSuccess(callbackContext);
                    return;
                }
                
                String className = attributes.getString("className");
                
                LongPressAttributes longPressAttributes = new LongPressAttributes();
                longPressAttributes.setClassName(className);
                
                if (attributes.has("touchPoint") && !attributes.isNull("touchPoint")) {
                    longPressAttributes.setTouchPoint(getTouchPointFromJson(attributes.getJSONObject("touchPoint")));
                }
                
                if (screenAttrs != null) {
                    ScreenTrackingAttributes screenTrackingAttributes = getScreenTrackingAttributesFromJson(screenAttrs);
                    if (screenTrackingAttributes != null) {
                        longPressAttributes.setScreenTrackingAttributes(screenTrackingAttributes);
                    }
                }
                
                getDataroid().getAutoCaptureClient().collectLongPress(longPressAttributes);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    // ============================================
    // SUPER ATTRIBUTES
    // ============================================
    
    private void getAllSuperAttributes(CallbackContext callbackContext) {
        try {
            Map<String, Object> attrs = getDataroid().getAllSuperAttributes();
            JSONObject attrsJson = new JSONObject();
            if (attrs != null) {
                for (Map.Entry<String, Object> entry : attrs.entrySet()) {
                    attrsJson.put(entry.getKey(), entry.getValue());
                }
            }
            JSONObject response = new JSONObject();
            response.put("attributes", attrsJson);
            handleSuccess(callbackContext, response);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void setSuperAttribute(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject attrData = args.getJSONObject(0);
            String key = attrData.getString("key");
            String type = attrData.getString("type");
            
            switch (type) {
                case "string":
                    getDataroid().setSuperAttribute(key, attrData.getString("value"));
                    break;
                case "number":
                    getDataroid().setSuperAttribute(key, attrData.getInt("value"));
                    break;
                case "float":
                    getDataroid().setSuperAttribute(key, attrData.getDouble("value"));
                    break;
                case "boolean":
                    getDataroid().setSuperAttribute(key, attrData.getBoolean("value"));
                    break;
                case "date":
                    SimpleDateFormat df = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US);
                    getDataroid().setSuperAttribute(key, df.parse(attrData.getString("value")));
                    break;
            }
            
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearSuperAttribute(JSONArray args, CallbackContext callbackContext) {
        try {
            String key = args.getString(0);
            getDataroid().clearSuperAttribute(key);
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    private void clearAllSuperAttributes(CallbackContext callbackContext) {
        try {
            getDataroid().clearAllSuperAttributes();
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
    
    // ============================================
    // APP INBOX
    // ============================================
    
    private void getAppInboxMessages(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                com.dataroid.sdk.util.Callback<List<InboxMessage>> getMessagesCallback = inboxMessages -> {
                    try {
                        JSONObject result = new JSONObject();
                        result.put("messages", mapInboxMessagesToJsonArray(inboxMessages));
                        handleSuccess(callbackContext, result);
                    } catch (JSONException e) {
                        handleException(e, callbackContext);
                    }
                };
                
                JSONObject query = args.optJSONObject(0);
                
                if (query != null && query.length() > 0) {
                    InboxQuery.Builder queryBuilder = new InboxQuery.Builder();
                    SimpleDateFormat df = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US);
                    
                    if (query.has("type") && !query.isNull("type")) {
                        String type = query.getString("type");
                        switch (type) {
                            case "PUSH_MESSAGE":
                                queryBuilder.type(InboxMessageType.PUSH_MESSAGE);
                                break;
                            case "INAPP_MESSAGE":
                                queryBuilder.type(InboxMessageType.INAPP_MESSAGE);
                                break;
                            case "GEOFENCE_MESSAGE":
                                queryBuilder.type(InboxMessageType.GEOFENCE_MESSAGE);
                                break;
                            case "ACTION_BASED_MESSAGE":
                                queryBuilder.type(InboxMessageType.ACTION_BASED_MESSAGE);
                                break;
                        }
                    }
                    
                    if (query.has("status") && !query.isNull("status")) {
                        queryBuilder.status(query.getString("status"));
                    }
                    
                    if (query.has("from") && !query.isNull("from")) {
                        queryBuilder.from(df.parse(query.getString("from")));
                    }
                    
                    if (query.has("to") && !query.isNull("to")) {
                        queryBuilder.to(df.parse(query.getString("to")));
                    }
                    
                    if (query.has("anonymous") && !query.isNull("anonymous")) {
                        queryBuilder.anonymous(query.getBoolean("anonymous"));
                    }
                    
                    getDataroid().getInboxClient().getMessages(queryBuilder.build(), getMessagesCallback);
                } else {
                    getDataroid().getInboxClient().getMessages(getMessagesCallback);
                }
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void deleteAppInboxMessage(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String messageId = args.getString(0);
                getDataroid().getInboxClient().deleteMessage(Long.parseLong(messageId), result -> {
                    handleSuccess(callbackContext);
                });
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void readAppInboxMessage(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                String messageId = args.getString(0);
                getDataroid().getInboxClient().readMessage(Long.parseLong(messageId), message -> {
                    handleSuccess(callbackContext);
                });
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void subscribeToCreateMessages(CallbackContext callbackContext) {
        createMessagesCallbackContext = callbackContext;
        cordova.getActivity().runOnUiThread(() -> {
            try {
                getDataroid().getInboxClient().subscribeToCreateMessages(inboxMessage -> {
                    if (createMessagesCallbackContext != null) {
                        try {
                            PluginResult pluginResult = new PluginResult(PluginResult.Status.OK, mapInboxMessageToJson(inboxMessage));
                            pluginResult.setKeepCallback(true);
                            createMessagesCallbackContext.sendPluginResult(pluginResult);
                        } catch (Exception e) {
                            Log.e(TAG, "Error serializing inbox message", e);
                        }
                    }
                });
                // Keep callback alive
                PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
                result.setKeepCallback(true);
                callbackContext.sendPluginResult(result);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void subscribeToDeleteMessages(CallbackContext callbackContext) {
        deleteMessagesCallbackContext = callbackContext;
        cordova.getActivity().runOnUiThread(() -> {
            try {
                getDataroid().getInboxClient().subscribeToDeleteMessages(messageId -> {
                    if (deleteMessagesCallbackContext != null) {
                        PluginResult pluginResult = new PluginResult(PluginResult.Status.OK, String.valueOf(messageId));
                        pluginResult.setKeepCallback(true);
                        deleteMessagesCallbackContext.sendPluginResult(pluginResult);
                    }
                });
                // Keep callback alive
                PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
                result.setKeepCallback(true);
                callbackContext.sendPluginResult(result);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void subscribeToUpdateMessages(CallbackContext callbackContext) {
        updateMessagesCallbackContext = callbackContext;
        cordova.getActivity().runOnUiThread(() -> {
            try {
                getDataroid().getInboxClient().subscribeToUpdateMessages(inboxMessage -> {
                    if (updateMessagesCallbackContext != null) {
                        try {
                            PluginResult pluginResult = new PluginResult(PluginResult.Status.OK, mapInboxMessageToJson(inboxMessage));
                            pluginResult.setKeepCallback(true);
                            updateMessagesCallbackContext.sendPluginResult(pluginResult);
                        } catch (Exception e) {
                            Log.e(TAG, "Error serializing inbox message", e);
                        }
                    }
                });
                // Keep callback alive
                PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
                result.setKeepCallback(true);
                callbackContext.sendPluginResult(result);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void enableAppInbox(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                getDataroid().getConfig().getDataroidInboxConfig().withEnabled(true);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void disableAppInbox(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                getDataroid().getConfig().getDataroidInboxConfig().withEnabled(false);
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    // ============================================
    // CONTEXT TRIGGERS
    // ============================================
    
    private void subscribeToContextTriggerResults(CallbackContext callbackContext) {
        contextTriggerCallbackContext = callbackContext;
        
        cordova.getActivity().runOnUiThread(() -> {
            try {
                if (contextTriggerSubscriber == null) {
                    contextTriggerSubscriber = new Subscriber<CtxTriggerResult>() {
                        @Override
                        public void onNext(CtxTriggerResult result) {
                            if (contextTriggerCallbackContext != null) {
                                try {
                                    // Convert List<Pair<String, Object>> to Map for JSONObject
                                    Map<String, Object> machineOutput = new HashMap<>();
                                    if (result.getMachineOutput() != null) {
                                        for (Pair<String, Object> pair : result.getMachineOutput()) {
                                            machineOutput.put(pair.first, pair.second);
                                        }
                                    }
                                    
                                    JSONObject json = new JSONObject();
                                    json.put("contextTriggerId", result.getContextTriggerId());
                                    json.put("machineOutput", new JSONObject(machineOutput));
                                    
                                    PluginResult pluginResult = new PluginResult(PluginResult.Status.OK, json.toString());
                                    pluginResult.setKeepCallback(true);
                                    contextTriggerCallbackContext.sendPluginResult(pluginResult);
                                } catch (JSONException e) {
                                    Log.e(TAG, "Error serializing context trigger result", e);
                                }
                            }
                        }
                    };
                    
                    getDataroid().getCtxTriggerClient().subscribeToResults(contextTriggerSubscriber);
                }
                
                // Keep callback alive
                PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
                result.setKeepCallback(true);
                callbackContext.sendPluginResult(result);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    private void unsubscribeFromContextTriggerResults(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                if (contextTriggerSubscriber != null) {
                    getDataroid().getCtxTriggerClient().unsubscribeFromResults(contextTriggerSubscriber);
                    contextTriggerSubscriber = null;
                }
                contextTriggerCallbackContext = null;
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }

    // ============================================
    // ENGAGEMENT DISPLAY CALLBACKS
    // ============================================

    private JSONObject mapInAppMessageDisplayedResult(InAppMessageDisplayedResult result)
            throws JSONException {
        JSONObject json = new JSONObject();
        json.put("inAppMessageId", result.getInAppMessageId());
        json.put("triggerEvent", result.getTriggerEvent());
        if (result.getUi() != null) {
            json.put("location", result.getUi().getLocation());
            if (result.getUi().getHorizontalLocation() != null) {
                json.put("horizontalLocation", result.getUi().getHorizontalLocation());
            }
        }
        if (result.getDynamicAttributes() != null) {
            json.put("dynamicAttributes", new JSONObject(result.getDynamicAttributes()));
        }
        return json;
    }

    private JSONObject mapSurveyDisplayedResult(SurveyDisplayedResult result)
            throws JSONException {
        JSONObject json = new JSONObject();
        json.put("surveyId", result.getSurveyId());
        json.put("triggerEvent", result.getTriggerEvent());
        if (result.getUi() != null) {
            json.put("location", result.getUi().getLocation());
            if (result.getUi().getHorizontalLocation() != null) {
                json.put("horizontalLocation", result.getUi().getHorizontalLocation());
            }
            if (result.getUi().getDisplayDuration() != null) {
                json.put("displayDuration", result.getUi().getDisplayDuration());
            }
        }
        if (result.getDynamicAttributes() != null) {
            json.put("dynamicAttributes", new JSONObject(result.getDynamicAttributes()));
        }
        return json;
    }

    private void subscribeToInAppMessageDisplayedResults(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                inAppMessageDisplayedCallbackContext = callbackContext;
                getDataroid().getInAppMessaging().setOnInAppMessageDisplayedListener(
                        new InAppMessageDisplayedListener() {
                            @Override
                            public void onDisplayed(InAppMessageDisplayedResult result) {
                                CallbackContext activeCallback = inAppMessageDisplayedCallbackContext;
                                if (activeCallback == null) return;
                                try {
                                    PluginResult pluginResult = new PluginResult(
                                            PluginResult.Status.OK,
                                            mapInAppMessageDisplayedResult(result));
                                    pluginResult.setKeepCallback(true);
                                    activeCallback.sendPluginResult(pluginResult);
                                } catch (Exception e) {
                                    Log.e(TAG, "Failed to emit in-app displayed result", e);
                                }
                            }
                        });
                PluginResult pluginResult = new PluginResult(PluginResult.Status.NO_RESULT);
                pluginResult.setKeepCallback(true);
                callbackContext.sendPluginResult(pluginResult);
            } catch (Exception e) {
                inAppMessageDisplayedCallbackContext = null;
                handleException(e, callbackContext);
            }
        });
    }

    private void unsubscribeFromInAppMessageDisplayedResults(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                getDataroid().getInAppMessaging().setOnInAppMessageDisplayedListener(null);
                inAppMessageDisplayedCallbackContext = null;
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }

    private void subscribeToSurveyDisplayedResults(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                surveyDisplayedCallbackContext = callbackContext;
                getDataroid().getSurveyClient().setOnSurveyDisplayedListener(
                        new SurveyDisplayedListener() {
                            @Override
                            public void onDisplayed(SurveyDisplayedResult result) {
                                CallbackContext activeCallback = surveyDisplayedCallbackContext;
                                if (activeCallback == null) return;
                                try {
                                    PluginResult pluginResult = new PluginResult(
                                            PluginResult.Status.OK,
                                            mapSurveyDisplayedResult(result));
                                    pluginResult.setKeepCallback(true);
                                    activeCallback.sendPluginResult(pluginResult);
                                } catch (Exception e) {
                                    Log.e(TAG, "Failed to emit survey displayed result", e);
                                }
                            }
                        });
                PluginResult pluginResult = new PluginResult(PluginResult.Status.NO_RESULT);
                pluginResult.setKeepCallback(true);
                callbackContext.sendPluginResult(pluginResult);
            } catch (Exception e) {
                surveyDisplayedCallbackContext = null;
                handleException(e, callbackContext);
            }
        });
    }

    private void unsubscribeFromSurveyDisplayedResults(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                getDataroid().getSurveyClient().setOnSurveyDisplayedListener(null);
                surveyDisplayedCallbackContext = null;
                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }
    
    // ============================================
    // CRASH REPORTING
    // ============================================

    private void collectError(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject payload = args.getJSONObject(0);
                String exceptionType = payload.optString("exceptionType", "Error");
                String exceptionReason = payload.optString("exceptionReason", "Unknown error");

                getDataroid().getCrashReportingClient().recordExternalException(
                        exceptionType, exceptionReason, "javascript");

                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }

    private void collectCrash(JSONArray args, CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                JSONObject payload = args.getJSONObject(0);
                String uuid = payload.optString("uuid", null);
                String exceptionType = payload.optString("exceptionType", "Error");
                String exceptionReason = payload.optString("exceptionReason", "Unknown error");
                JSONArray framesJson = payload.optJSONArray("frames");

                if (exceptionType == null || exceptionReason == null) {
                    handleException(new IllegalArgumentException(
                            "Missing required crash payload fields: exceptionType, exceptionReason"), callbackContext);
                    return;
                }

                List<ExternalExceptionFrame> frames = new ArrayList<>();
                if (framesJson != null) {
                    for (int i = 0; i < framesJson.length(); i++) {
                        JSONObject frameObj;
                        try {
                            frameObj = framesJson.getJSONObject(i);
                        } catch (JSONException e) {
                            continue;
                        }

                        String file = frameObj.optString("file", null);
                        if (file == null) continue;

                        String methodName = frameObj.optString("methodName", "");
                        int line = frameObj.optInt("line", 0);
                        int column = frameObj.optInt("column", 0);

                        frames.add(new ExternalExceptionFrame(line, file, methodName, column, true));
                    }
                }

                Log.d(TAG, "Collecting Cordova Crash: " + exceptionType + " - " + exceptionReason
                        + " (" + frames.size() + " frames)");

                getDataroid().getCrashReportingClient().recordExternalError(
                        uuid, exceptionType, exceptionReason, frames, "javascript");

                handleSuccess(callbackContext);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }

    // ============================================
    // SDK STATUS
    // ============================================

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }

        if (notificationPermissionRequestedThisSession) {
            return;
        }

        if (PermissionHelper.hasPermission(this, Manifest.permission.POST_NOTIFICATIONS)) {
            Log.d(TAG, "Notification permission already granted");
            return;
        }

        cordova.getActivity().runOnUiThread(() -> {
            notificationPermissionRequestedThisSession = true;

            if (PermissionHelper.hasPermission(this, Manifest.permission.POST_NOTIFICATIONS)) {
                Log.d(TAG, "Notification permission granted before request");
                return;
            }

            Log.d(TAG, "Requesting POST_NOTIFICATIONS permission");
            PermissionHelper.requestPermission(this,
                    REQUEST_CODE_POST_NOTIFICATIONS,
                    Manifest.permission.POST_NOTIFICATIONS);
        });
    }

    private void requestNotificationPermission(CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    sendNotificationPermissionResult(callbackContext, true);
                    return;
                }

                if (PermissionHelper.hasPermission(this, Manifest.permission.POST_NOTIFICATIONS)) {
                    sendNotificationPermissionResult(callbackContext, true);
                    return;
                }

                notificationPermissionCallbackContext = callbackContext;
                PermissionHelper.requestPermission(this,
                        REQUEST_CODE_POST_NOTIFICATIONS,
                        Manifest.permission.POST_NOTIFICATIONS);
            } catch (Exception e) {
                handleException(e, callbackContext);
            }
        });
    }

    private void getSdkStatus(CallbackContext callbackContext) {
        try {
            JSONObject status = new JSONObject();
            status.put("initialized", DataroidInitProvider.isInitialized());

            String sdkVersion = null;
            status.put("sdkVersion", sdkVersion != null ? sdkVersion : JSONObject.NULL);
            status.put("framework", FRAMEWORK);

            JSONArray modulesArray = new JSONArray();
            for (String module : DataroidInitProvider.getEnabledModules()) {
                modulesArray.put(module);
            }
            status.put("enabledModules", modulesArray);

            String errorCode = DataroidInitProvider.getLastErrorCode();
            String errorMessage = DataroidInitProvider.getLastErrorMessage();
            status.put("lastErrorCode", errorCode != null ? errorCode : JSONObject.NULL);
            status.put("lastErrorMessage", errorMessage != null ? errorMessage : JSONObject.NULL);

            long initTimestamp = DataroidInitProvider.getInitTimestamp();
            if (initTimestamp > 0) {
                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
                status.put("lastInitTimestamp", sdf.format(new Date(initTimestamp)));
            } else {
                status.put("lastInitTimestamp", JSONObject.NULL);
            }

            JSONObject response = new JSONObject();
            response.put("success", true);
            response.put("status", status);
            handleSuccess(callbackContext, response);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }

    private void sendNotificationPermissionResult(CallbackContext callbackContext, boolean granted) {
        try {
            JSONObject result = new JSONObject();
            result.put("granted", granted);
            result.put("permission", Manifest.permission.POST_NOTIFICATIONS);
            handleSuccess(callbackContext, result);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }

    @Override
    public void onRequestPermissionResult(int requestCode, String[] permissions, int[] grantResults)
            throws JSONException {
        super.onRequestPermissionResult(requestCode, permissions, grantResults);

        if (requestCode != REQUEST_CODE_POST_NOTIFICATIONS) {
            return;
        }

        if (notificationPermissionCallbackContext == null) {
            return;
        }

        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        sendNotificationPermissionResult(notificationPermissionCallbackContext, granted);
        notificationPermissionCallbackContext = null;
    }

    // ========================================================================
    // Database Encryption
    // ========================================================================

    private void setDatabaseEncryption(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONObject config = args.getJSONObject(0);
            boolean enabled = config.optBoolean("enabled", false);
            String hexKey = config.optString("encryptionKey", "");

            if (enabled && hexKey.length() != 64) {
                handleException(new IllegalArgumentException("encryptionKey must be a 64-character hex string (256-bit AES key)"), callbackContext);
                return;
            }

            Log.w(TAG, "setDatabaseEncryption called at runtime — encryption must be configured " +
                    "before SDK initialization via the DB_ENCRYPTION_KEY plugin variable for it to take effect.");
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }

    // ========================================================================
    // SSL Pinning
    // ========================================================================

    private void setSSLPinning(JSONArray args, CallbackContext callbackContext) {
        try {
            JSONArray policies = args.getJSONArray(0);
            if (policies.length() == 0) {
                handleException(new IllegalArgumentException("trustPolicies must be a non-empty array"), callbackContext);
                return;
            }

            Log.w(TAG, "setSSLPinning called at runtime — SSL pinning must be configured " +
                    "before SDK initialization via the SSL_PINNING_POLICIES plugin variable for it to take effect.");
            handleSuccess(callbackContext);
        } catch (Exception e) {
            handleException(e, callbackContext);
        }
    }
}
