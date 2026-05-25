/**
 * 2026-05-25 — STUB. Compiles against zero DAT SDK symbols so the APK
 * ships for beta. The earlier implementation guessed at
 * com.meta.wearable.mwdat.* class names (Wearables, WearableSession,
 * CameraStream, StreamConfiguration, VideoQuality, AutoDeviceSelector)
 * — none of those resolved against the actual mwdat-core:0.7.0 +
 * mwdat-camera:0.7.0 artifacts, blocking every recent Kotlin compile.
 *
 * Beta scope: no internal tester has Ray-Ban Meta glasses paired, so
 * MetaWearableFrame events were never going to fire anyway. Post-beta
 * we'll re-implement against the real SDK once the Wearables Developer
 * Center docs unblock (or via runtime reflection if the package stays
 * pre-release). All JS callers in
 * services/glassesVisionInput.ts + services/metaWearablesBridge.ts
 * already tolerate NativeModules.MetaWearablesFrame === null AND
 * promise.reject responses, so this stub is harmless at runtime.
 *
 * Methods return:
 *   startStreaming → reject NOT_IMPLEMENTED
 *   stopStreaming  → resolve null (idempotent no-op)
 *   getStatus      → resolve { connected: false, streaming: false }
 */

package com.smartplaycaddie.wearables

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MetaWearablesFrameModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "MetaWearablesFrame"

    @ReactMethod
    fun startStreaming(quality: String?, fps: Int, promise: Promise) {
        promise.reject(
            "DAT_NOT_IMPLEMENTED",
            "Meta Wearables DAT module is stubbed in this build. Glasses streaming returns post-beta once mwdat SDK symbols are confirmed.",
        )
    }

    @ReactMethod
    fun stopStreaming(promise: Promise) {
        promise.resolve(null)
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        val map = Arguments.createMap()
        map.putBoolean("connected", false)
        map.putBoolean("streaming", false)
        map.putString("device", "")
        promise.resolve(map)
    }
}
