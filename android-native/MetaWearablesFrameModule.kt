/**
 * 2026-05-23 — Meta Wearables DAT v0.7 — Android native frame module.
 *
 * Bridges the DAT camera stream (Ray-Ban Meta glasses) into React
 * Native via a DeviceEventEmitter event. The JS side
 * (services/glassesVisionInput.ts + services/metaWearablesBridge.ts)
 * pushes received frames into the existing rolling-queue. Once the
 * frames are flowing, the rest of the stack (Kevin multimodal,
 * puttingAnalysisService auto-fold, lie analysis acoustic prior) all
 * light up without further changes.
 *
 * Architecture:
 *   - startStreaming(quality, fps, promise)
 *       Picks the highest-quality device the DAT auto-selector finds,
 *       opens a session, starts a camera stream at the requested
 *       quality/fps, and begins emitting "MetaWearableFrame" events.
 *   - stopStreaming(promise)
 *       Tears down the camera stream + the session. Idempotent.
 *   - getStatus(promise)
 *       Returns { connected, streaming, deviceName }. UI uses this to
 *       show a "Glasses connected" pill in Settings.
 *
 * Event payload: { uri: string, captured_at: number, source: 'glasses' }
 *   - uri is a content:// (or file://) pointer to a JPEG saved to the
 *     app's cache dir. Each frame overwrites the previous one so cache
 *     doesn't grow unbounded; the JS side reads the URI immediately
 *     via getActiveVisionFrameBase64() if it needs base64.
 *
 * Concurrency: DAT enforces "one session per device". This module
 * keeps a single session reference so a duplicate startStreaming() is
 * a no-op (the second call returns the existing session's status).
 *
 * Sequencing with MetaCaddyVoiceHandler:
 *   The voice handler routes TTS over HFP to the glasses speakers.
 *   When TTS is active we DO NOT also stream camera frames (DAT will
 *   refuse the second active resource). The JS bridge gates
 *   startStreaming() on voice idle. State machine lives JS-side in
 *   services/metaWearablesBridge.ts.
 */

package com.smartplaycaddy.wearables

import android.content.Context
import android.graphics.Bitmap
import android.os.Environment
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import java.io.File
import java.io.FileOutputStream

// NOTE: These imports resolve against the DAT artifacts pulled in by
// app/build.gradle (added via withMetaWearablesDAT.js config plugin).
// Until the first EAS build with the plugin enabled runs, your IDE may
// show these as unresolved — that's expected.
import com.meta.wearable.mwdat.Wearables
import com.meta.wearable.mwdat.session.AutoDeviceSelector
import com.meta.wearable.mwdat.session.WearableSession
import com.meta.wearable.mwdat.camera.CameraStream
import com.meta.wearable.mwdat.camera.StreamConfiguration
import com.meta.wearable.mwdat.camera.VideoQuality

class MetaWearablesFrameModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var session: WearableSession? = null
    @Volatile private var stream: CameraStream? = null
    @Volatile private var collectorJob: Job? = null
    @Volatile private var lastDeviceName: String? = null
    @Volatile private var initialized: Boolean = false

    override fun getName(): String = "MetaWearablesFrame"

    private fun ensureInitialized() {
        if (initialized) return
        Wearables.initialize(reactApplicationContext.applicationContext)
        initialized = true
    }

    /** Resolve the requested quality to a DAT enum. Default MEDIUM. */
    private fun resolveQuality(input: String?): VideoQuality = when (input?.lowercase()) {
        "high" -> VideoQuality.HIGH
        "low"  -> VideoQuality.LOW
        else   -> VideoQuality.MEDIUM
    }

    /** Resolve requested FPS to one of DAT's allowed values. */
    private fun resolveFps(input: Int?): Int {
        val candidate = input ?: 24
        val allowed = listOf(2, 7, 15, 24, 30)
        // Pick the closest allowed value rather than rejecting — small
        // mismatches between JS callers and DAT's discrete set are
        // common and not worth surfacing as an error.
        return allowed.minByOrNull { kotlin.math.abs(it - candidate) } ?: 24
    }

    @ReactMethod
    fun startStreaming(quality: String?, fps: Int, promise: Promise) {
        try {
            ensureInitialized()
            if (stream != null) {
                // Idempotent — return current status.
                val map = Arguments.createMap()
                map.putBoolean("alreadyStreaming", true)
                map.putString("device", lastDeviceName ?: "")
                promise.resolve(map)
                return
            }

            scope.launch {
                try {
                    // Auto-select the first paired Ray-Ban Meta device.
                    val sessionResult = Wearables.createSession(AutoDeviceSelector())
                    val newSession = sessionResult.getOrThrow()
                    session = newSession
                    lastDeviceName = newSession.device?.name ?: "Ray-Ban Meta"
                    newSession.start()

                    val config = StreamConfiguration(
                        videoQuality = resolveQuality(quality),
                        frameRate = resolveFps(fps),
                    )
                    val addResult = newSession.addStream(config)
                    addResult.fold(
                        onSuccess = { newStream ->
                            stream = newStream
                            collectorJob = scope.launch {
                                newStream.videoStream.collect { frame ->
                                    handleFrame(frame as Any)
                                }
                            }
                            newStream.start()

                            val map = Arguments.createMap()
                            map.putBoolean("alreadyStreaming", false)
                            map.putString("device", lastDeviceName ?: "")
                            promise.resolve(map)
                        },
                        onFailure = { err, _ ->
                            promise.reject("DAT_ADD_STREAM_FAILED", err.toString())
                            cleanup()
                        },
                    )
                } catch (e: Throwable) {
                    promise.reject("DAT_SESSION_FAILED", e.message ?: e.toString())
                    cleanup()
                }
            }
        } catch (e: Throwable) {
            promise.reject("DAT_INIT_FAILED", e.message ?: e.toString())
        }
    }

    @ReactMethod
    fun stopStreaming(promise: Promise) {
        try {
            cleanup()
            promise.resolve(null)
        } catch (e: Throwable) {
            promise.reject("DAT_STOP_FAILED", e.message ?: e.toString())
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        val map = Arguments.createMap()
        map.putBoolean("connected", session != null)
        map.putBoolean("streaming", stream != null)
        map.putString("device", lastDeviceName ?: "")
        promise.resolve(map)
    }

    /** Write the frame to a single overwritable cache file and emit a
     *  React Native event with the URI. The JS side reads it via
     *  glassesVisionInput.submitVisionFrame which copies into its
     *  rolling queue. Keeping the cache to ONE file prevents unbounded
     *  growth — at 24 FPS we'd otherwise leak hundreds of MB per
     *  minute.
     *
     *  The `frame` parameter is typed Any because DAT's exact Frame
     *  class is `com.meta.wearable.mwdat.camera.VideoFrame` (per docs)
     *  and pulls in a Bitmap via `.bitmap` OR `.makeBitmap()` depending
     *  on the version — we resolve via reflection at runtime to avoid
     *  hard-coding a brittle import that could break on a minor SDK
     *  bump. */
    private fun handleFrame(frame: Any) {
        try {
            val bitmap = resolveBitmap(frame) ?: return
            val file = frameCacheFile()
            FileOutputStream(file).use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 75, out)
            }
            val payload = Arguments.createMap().apply {
                putString("uri", "file://" + file.absolutePath)
                putDouble("captured_at", System.currentTimeMillis().toDouble())
                putString("source", "glasses")
            }
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("MetaWearableFrame", payload)
        } catch (e: Throwable) {
            // Frame drop is non-fatal — we'd rather lose a frame than
            // crash the stream. The JS-side queue tolerates gaps.
            android.util.Log.w("MetaWearablesFrame", "frame handle failed: ${e.message}")
        }
    }

    private fun resolveBitmap(frame: Any): Bitmap? {
        // Try .bitmap property first (kotlin val), then .makeBitmap()
        // method (java accessor). Both shapes have been observed in
        // DAT preview builds; reflection keeps us robust.
        return try {
            val cls = frame.javaClass
            val bitmapField = runCatching { cls.getMethod("getBitmap") }.getOrNull()
            if (bitmapField != null) {
                bitmapField.invoke(frame) as? Bitmap
            } else {
                val mk = runCatching { cls.getMethod("makeBitmap") }.getOrNull()
                mk?.invoke(frame) as? Bitmap
            }
        } catch (_: Throwable) { null }
    }

    private fun frameCacheFile(): File {
        val dir = File(reactApplicationContext.cacheDir, "mwdat_frames")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "latest.jpg")
    }

    private fun cleanup() {
        runCatching { collectorJob?.cancel() }
        runCatching { stream?.stop() }
        runCatching { session?.stop() }
        collectorJob = null
        stream = null
        session = null
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        cleanup()
        scope.cancel()
    }
}
