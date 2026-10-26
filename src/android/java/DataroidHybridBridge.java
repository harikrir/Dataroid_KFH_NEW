package com.commencis.cordova.plugin.dataroid;

import com.dataroid.sdk.Dataroid;

import org.json.JSONException;
import org.json.JSONObject;

/** Routes Cordova WebView auto-captured events through the native Hybrid Bridge. */
final class DataroidHybridBridge {
    private static final String AUTO_CAPTURE_KEY = "ac";

    private DataroidHybridBridge() {}

    static boolean forwardAutoCaptured(
            Dataroid dataroid,
            String cordovaMethod,
            JSONObject attributes,
            JSONObject screenAttributes
    ) throws JSONException {
        if (!isAutoCaptured(attributes) || dataroid == null) {
            return false;
        }

        String bridgeMethod = bridgeMethod(cordovaMethod);
        if (bridgeMethod == null) {
            return false;
        }

        JSONObject args = buildArgs(bridgeMethod, attributes, screenAttributes);
        post(dataroid, bridgeMethod, args);
        return true;
    }

    static boolean forwardAutoCapturedScreen(
            Dataroid dataroid,
            String bridgeMethod,
            String viewClass,
            String viewLabel
    ) throws JSONException {
        if (dataroid == null) {
            return false;
        }

        JSONObject args = new JSONObject();
        putIfPresent(args, "viewClass", viewClass);
        putIfPresent(args, "viewLabel", viewLabel);
        if (!"screenTracker.viewStopped".equals(bridgeMethod)) {
            args.put(AUTO_CAPTURE_KEY, true);
        }
        post(dataroid, bridgeMethod, args);
        return true;
    }

    private static boolean isAutoCaptured(JSONObject attributes) {
        return attributes != null && attributes.optBoolean(AUTO_CAPTURE_KEY, false);
    }

    private static String bridgeMethod(String method) {
        switch (method) {
            case "collectButtonClickEvent":
            case "collectTextChangeEvent":
            case "collectToggleChangeEvent":
            case "collectRadioButtonSelectedEvent":
            case "collectTouchEvent":
            case "collectSwipeEvent":
            case "collectDoubleTapEvent":
            case "collectLongPressEvent":
                return method;
            case "collectHttpCall":
                return "collectHttpCallEvent";
            case "collectNetworkError":
                return "collectNetworkErrorEvent";
            default:
                return null;
        }
    }

    private static JSONObject buildArgs(
            String method,
            JSONObject attributes,
            JSONObject screenAttributes
    ) throws JSONException {
        JSONObject args = new JSONObject();
        if (screenAttributes != null) {
            copy(args, screenAttributes, "viewLabel", "viewLabel");
            copy(args, screenAttributes, "viewClass", "viewClass");
        }

        switch (method) {
            case "collectButtonClickEvent":
            case "collectRadioButtonSelectedEvent":
                copy(args, attributes, "className", "className");
                copy(args, attributes, "label", "label");
                copy(args, attributes, "accessibilityLabel", "accessibilityLabel");
                copy(args, attributes, "componentId", "componentId");
                copy(args, attributes, "coordinates", "coordinates");
                break;
            case "collectTextChangeEvent":
                copy(args, attributes, "className", "className");
                copy(args, attributes, "textValue", "value");
                copy(args, attributes, "placeholder", "placeholder");
                copy(args, attributes, "accessibilityLabel", "accessibilityLabel");
                copy(args, attributes, "componentId", "componentId");
                copy(args, attributes, "coordinates", "coordinates");
                break;
            case "collectToggleChangeEvent":
                copy(args, attributes, "className", "className");
                copy(args, attributes, "isChecked", "isChecked");
                copy(args, attributes, "accessibilityLabel", "accessibilityLabel");
                copy(args, attributes, "componentId", "componentId");
                copy(args, attributes, "coordinates", "coordinates");
                break;
            case "collectTouchEvent":
            case "collectDoubleTapEvent":
            case "collectLongPressEvent":
                copy(args, attributes, "touchPoint", "touchPoint");
                break;
            case "collectSwipeEvent":
                JSONObject swipePoints = attributes.optJSONObject("swipePoints");
                if (swipePoints != null) {
                    copy(args, swipePoints, "swipeStart", "swipeStartPoint");
                    copy(args, swipePoints, "swipeEnd", "swipeEndPoint");
                }
                break;
            case "collectHttpCallEvent":
                copy(args, attributes, "url", "url");
                copy(args, attributes, "method", "method");
                copy(args, attributes, "statusCode", "statusCode");
                copy(args, attributes, "duration", "duration");
                copy(args, attributes, "success", "success");
                copy(args, attributes, "requestPayloadSize", "requestSize");
                copy(args, attributes, "responsePayloadSize", "responseSize");
                copy(args, attributes, "errorType", "errorType");
                copy(args, attributes, "errorCode", "errorCode");
                copy(args, attributes, "errorMessage", "errorMessage");
                copy(args, attributes, "customAttributes", "extras");
                break;
            case "collectNetworkErrorEvent":
                copy(args, attributes, "url", "url");
                copy(args, attributes, "method", "method");
                copy(args, attributes, "duration", "duration");
                copy(args, attributes, "exception", "exception");
                copy(args, attributes, "message", "errorMessage");
                copy(args, attributes, "type", "errorType");
                copy(args, attributes, "customAttributes", "extras");
                break;
            default:
                break;
        }

        args.put(AUTO_CAPTURE_KEY, true);
        return args;
    }

    private static void copy(JSONObject target, JSONObject source, String key, String outputKey)
            throws JSONException {
        if (source.has(key) && !source.isNull(key)) {
            target.put(outputKey, source.get(key));
        }
    }

    private static void putIfPresent(JSONObject target, String key, String value) throws JSONException {
        if (value != null) {
            target.put(key, value);
        }
    }

    private static void post(Dataroid dataroid, String method, JSONObject args) throws JSONException {
        JSONObject envelope = new JSONObject();
        envelope.put("method", method);
        envelope.put("args", args);
        dataroid.getInternal().postMessage(envelope.toString());
    }
}
