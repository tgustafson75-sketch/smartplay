/**
 * 2026-06-29 — Wear OS swing bridge (phone side, Android).
 *
 * Receives per-swing IMU summaries from the SmartPlay Watch app over the
 * Wearable Data Layer and surfaces them to JS via DeviceEventEmitter.
 * JS consumer is services/watchSwingBridge.ts, which maps the payload to
 * store/watchStore.ts → recordSwing().
 *
 * Mirrors the defensive structure of BluetoothMediaButtonModule:
 *   - all methods take a Promise and never throw across the bridge
 *   - the ReactPackage wraps construction in try/catch, so a missing
 *     play-services-wearable class leaves NativeModules.WearSwingBridge
 *     null and the JS layer no-ops (no crash, phone APK unaffected).
 *
 * Events emitted to JS:
 *   "onWatchSwing"      — { backswingMs, downswingMs, tempoRatio,
 *                           peakWristSpeed, wristAcceleration,
 *                           impactAcceleration, transitionDetected,
 *                           earlyTransition, tempoGood, clubHeadSpeedEst,
 *                           capturedAtMs }
 *   "onWatchConnection" — { connected: Boolean, node: String }
 */

package com.smartplaycaddie.wearbridge

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

class WearSwingBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), MessageClient.OnMessageReceivedListener {

    private val tag = "WearSwingBridge"
    private val swingPath = "/smartplay/swing"
    private val helloPath = "/smartplay/hello"
    @Volatile private var listening = false

    override fun getName(): String = "WearSwingBridge"

    /** Register the Data Layer listener. Idempotent. */
    @ReactMethod
    fun start(promise: Promise) {
        try {
            if (!listening) {
                Wearable.getMessageClient(reactApplicationContext.applicationContext)
                    .addListener(this)
                listening = true
                Log.i(tag, "Data Layer listener registered")
            }
            resolveStatus(promise)
        } catch (t: Throwable) {
            Log.e(tag, "start failed", t)
            promise.reject("WEAR_START_FAILED", t.message ?: t.toString())
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            if (listening) {
                Wearable.getMessageClient(reactApplicationContext.applicationContext)
                    .removeListener(this)
                listening = false
                Log.i(tag, "Data Layer listener removed")
            }
            resolveStatus(promise)
        } catch (t: Throwable) {
            Log.e(tag, "stop failed", t)
            promise.reject("WEAR_STOP_FAILED", t.message ?: t.toString())
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        resolveStatus(promise)
    }

    @ReactMethod
    fun addListener(eventName: String) { /* Required for NativeEventEmitter */ }

    @ReactMethod
    fun removeListeners(count: Int) { /* Required for NativeEventEmitter */ }

    override fun onMessageReceived(event: MessageEvent) {
        try {
            when (event.path) {
                swingPath -> emitSwing(event)
                helloPath -> emitConnection(true, event.sourceNodeId)
            }
        } catch (t: Throwable) {
            Log.w(tag, "onMessageReceived parse failed (non-fatal)", t)
        }
    }

    private fun emitSwing(event: MessageEvent) {
        val json = JSONObject(String(event.data, Charsets.UTF_8))
        val payload = Arguments.createMap().apply {
            putInt("backswingMs", json.optInt("backswingMs"))
            putInt("downswingMs", json.optInt("downswingMs"))
            putDouble("tempoRatio", json.optDouble("tempoRatio"))
            putDouble("peakWristSpeed", json.optDouble("peakWristSpeed"))
            putDouble("wristAcceleration", json.optDouble("wristAcceleration"))
            putDouble("impactAcceleration", json.optDouble("impactAcceleration"))
            putBoolean("transitionDetected", json.optBoolean("transitionDetected"))
            putBoolean("earlyTransition", json.optBoolean("earlyTransition"))
            putBoolean("tempoGood", json.optBoolean("tempoGood"))
            putDouble("clubHeadSpeedEst", json.optDouble("clubHeadSpeedEst"))
            putDouble("capturedAtMs", json.optDouble("capturedAtMs"))
        }
        emit("onWatchSwing", payload)
        // A swing implies a live connection — surface that too.
        emitConnection(true, event.sourceNodeId)
    }

    private fun emitConnection(connected: Boolean, node: String) {
        val payload = Arguments.createMap().apply {
            putBoolean("connected", connected)
            putString("node", node)
        }
        emit("onWatchConnection", payload)
    }

    private fun emit(eventName: String, payload: com.facebook.react.bridge.WritableMap) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, payload)
        } catch (t: Throwable) {
            Log.w(tag, "emit($eventName) failed (non-fatal)", t)
        }
    }

    private fun resolveStatus(promise: Promise) {
        val map = Arguments.createMap()
        map.putBoolean("listening", listening)
        promise.resolve(map)
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        runCatching {
            if (listening) {
                Wearable.getMessageClient(reactApplicationContext.applicationContext)
                    .removeListener(this)
            }
        }
        listening = false
    }
}
