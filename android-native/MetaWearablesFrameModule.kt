/**
 * 2026-07-11 — Meta Wearables DAT v0.8 — REAL Android frame module.
 *
 * Replaces the 2026-05-25 stub. The stub existed because an earlier attempt
 * guessed class names that didn't resolve against mwdat 0.7.0. This version is
 * written against the CONFIRMED v0.8 API, taken verbatim from the official
 * sample (facebook/meta-wearables-dat-android → samples/CameraAccess):
 *
 *   val selector = AutoDeviceSelector()                       // first paired wearable
 *   Wearables.createSession(selector)                         // Result<DeviceSession>
 *       .onSuccess { session = it }.onFailure { e, _ -> … }
 *   session.start()
 *   session.addStream(StreamConfiguration(videoQuality, frameRate))  // Result<Stream>
 *       .onSuccess { stream = it }
 *   stream.start()
 *   stream.videoStream.collect { frame ->                     // Flow<VideoFrame>
 *       // frame.buffer (I420 ByteBuffer), frame.width, frame.height
 *   }
 *
 * Public surface matches the iOS module + services/metaWearablesBridge.ts:
 *   startStreaming(quality, fps) -> { alreadyStreaming, device }
 *   stopStreaming()              -> null (idempotent)
 *   getStatus()                  -> { connected, streaming, device }
 *   event "MetaWearableFrame"    -> { uri, captured_at, source: "glasses" }
 *
 * Each frame is converted I420 -> ARGB (YuvToBitmapConverter, adapted from the
 * sample, below) -> JPEG written to a single overwritable cache file; the RN
 * event carries the file:// uri, same shape glassesVisionInput already ingests.
 */

package com.smartplaycaddie.wearables

import android.graphics.Bitmap
import android.net.Uri
import androidx.core.graphics.createBitmap
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.meta.wearable.dat.camera.Stream
import com.meta.wearable.dat.camera.addStream
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.VideoFrame
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class MetaWearablesFrameModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "MetaWearablesFrame"

  private var session: DeviceSession? = null
  private var stream: Stream? = null
  private var scope: CoroutineScope? = null
  private var collectJob: Job? = null
  @Volatile private var streaming: Boolean = false
  private val deviceName: String = "Ray-Ban Meta"

  // NativeEventEmitter on the JS side calls these; provide no-op impls so RN
  // doesn't warn. Frame fan-out uses RCTDeviceEventEmitter directly below.
  @ReactMethod fun addListener(eventName: String?) {}

  @ReactMethod fun removeListeners(count: Int) {}

  private fun qualityOf(raw: String?): VideoQuality =
      when (raw?.lowercase()) {
        "high" -> VideoQuality.HIGH
        "low" -> VideoQuality.LOW
        else -> VideoQuality.MEDIUM
      }

  /** Closest allowed DAT frame rate (2/7/15/24/30) to what the caller asked for. */
  private fun fpsOf(raw: Int): Int {
    val allowed = intArrayOf(2, 7, 15, 24, 30)
    return allowed.minByOrNull { kotlin.math.abs(it - raw) } ?: 24
  }

  @ReactMethod
  fun startStreaming(quality: String?, fps: Int, promise: Promise) {
    try {
      if (stream != null) {
        val map = Arguments.createMap()
        map.putBoolean("alreadyStreaming", true)
        map.putString("device", deviceName)
        promise.resolve(map)
        return
      }

      // 1) Session against the first available paired wearable.
      var created: DeviceSession? = null
      var failed = false
      Wearables.createSession(AutoDeviceSelector())
          .onSuccess { created = it }
          .onFailure { error, _ ->
            failed = true
            promise.reject("DAT_SESSION_FAILED", "createSession failed: $error")
          }
      if (failed) return
      val activeSession = created ?: run {
        promise.reject("DAT_SESSION_FAILED", "createSession returned no session")
        return
      }
      session = activeSession
      activeSession.start()

      // 2) Camera stream at the requested quality/fps.
      val config = StreamConfiguration(videoQuality = qualityOf(quality), frameRate = fpsOf(fps))
      var createdStream: Stream? = null
      var streamFailed = false
      activeSession.addStream(config)
          .onSuccess { createdStream = it }
          .onFailure { error, _ ->
            streamFailed = true
            cleanup()
            promise.reject("DAT_STREAM_FAILED", "addStream failed: $error")
          }
      if (streamFailed) return
      val activeStream = createdStream ?: run {
        cleanup()
        promise.reject("DAT_STREAM_FAILED", "addStream returned no stream")
        return
      }
      stream = activeStream

      // 3) Collect frames on a background scope; convert + emit each one.
      val newScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
      scope = newScope
      collectJob =
          newScope.launch {
            try {
              activeStream.videoStream.collect { frame -> handleFrame(frame) }
            } catch (t: Throwable) {
              // Collection ending / cancellation is expected on stop; log only.
              android.util.Log.d("MetaWearablesFrame", "videoStream collect ended: ${t.message}")
            }
          }
      activeStream.start()
      streaming = true

      val map = Arguments.createMap()
      map.putBoolean("alreadyStreaming", false)
      map.putString("device", deviceName)
      promise.resolve(map)
    } catch (t: Throwable) {
      cleanup()
      promise.reject("DAT_START_FAILED", t.message ?: "unknown DAT error", t)
    }
  }

  @ReactMethod
  fun stopStreaming(promise: Promise) {
    cleanup()
    promise.resolve(null)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val map = Arguments.createMap()
    map.putBoolean("connected", session != null)
    map.putBoolean("streaming", streaming)
    map.putString("device", if (session != null) deviceName else "")
    promise.resolve(map)
  }

  // ─── Frame handling ────────────────────────────────────────────────
  private fun handleFrame(frame: VideoFrame) {
    try {
      val bitmap = YuvToBitmapConverter.convert(frame.buffer, frame.width, frame.height) ?: return
      val file = frameCacheFile()
      FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.JPEG, 75, out) }
      val payload: WritableMap = Arguments.createMap()
      payload.putString("uri", Uri.fromFile(file).toString())
      payload.putDouble("captured_at", System.currentTimeMillis().toDouble())
      payload.putString("source", "glasses")
      reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("MetaWearableFrame", payload)
    } catch (t: Throwable) {
      // A single dropped frame is non-fatal — the rolling queue tolerates gaps.
      android.util.Log.d("MetaWearablesFrame", "frame handle failed: ${t.message}")
    }
  }

  private fun frameCacheFile(): File {
    val dir = File(reactContext.cacheDir, "mwdat_frames")
    if (!dir.exists()) dir.mkdirs()
    return File(dir, "latest.jpg")
  }

  // ─── Cleanup ───────────────────────────────────────────────────────
  private fun cleanup() {
    streaming = false
    try {
      collectJob?.cancel()
    } catch (_: Throwable) {}
    collectJob = null
    try {
      scope?.cancel()
    } catch (_: Throwable) {}
    scope = null
    try {
      stream?.stop()
    } catch (t: Throwable) {
      android.util.Log.d("MetaWearablesFrame", "stream.stop threw: ${t.message}")
    }
    stream = null
    try {
      session?.stop()
    } catch (t: Throwable) {
      android.util.Log.d("MetaWearablesFrame", "session.stop threw: ${t.message}")
    }
    session = null
  }

  override fun onCatalystInstanceDestroy() {
    cleanup()
  }
}

/**
 * I420 → ARGB converter, adapted verbatim from the official DAT sample
 * (samples/CameraAccess/.../YuvToBitmapConverter.kt, Meta Platforms, Apache-2.0).
 * VideoFrame.buffer carries raw I420; this yields an ARGB Bitmap we JPEG-encode.
 */
internal object YuvToBitmapConverter {
  private val lock = Any()
  private var pixels: IntArray = IntArray(0)
  private var yuvBytes: ByteArray = ByteArray(0)
  private var cachedBitmap: Bitmap? = null
  private var lastWidth: Int = 0
  private var lastHeight: Int = 0

  fun convert(yuvData: ByteBuffer, width: Int, height: Int): Bitmap? {
    if (width <= 0 || height <= 0) return null
    if (width % 2 == 1 || height % 2 == 1) return null

    val frameSize = width * height
    val expectedSize = frameSize + (frameSize shr 1)
    if (yuvData.remaining() < expectedSize) return null

    synchronized(lock) {
      if (pixels.size < frameSize) pixels = IntArray(frameSize)
      if (yuvBytes.size < expectedSize) yuvBytes = ByteArray(expectedSize)

      val currentBitmap = cachedBitmap
      val bitmap =
          if (currentBitmap != null &&
              lastWidth == width &&
              lastHeight == height &&
              !currentBitmap.isRecycled) {
            currentBitmap
          } else {
            currentBitmap?.recycle()
            try {
              val newBitmap = createBitmap(width, height)
              cachedBitmap = newBitmap
              lastWidth = width
              lastHeight = height
              newBitmap
            } catch (_: OutOfMemoryError) {
              return null
            }
          }

      val originalPosition = yuvData.position()
      yuvData.get(yuvBytes, 0, expectedSize)
      yuvData.position(originalPosition)

      convertI420ToArgb(yuvBytes, pixels, width, height)
      bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
      return bitmap
    }
  }

  private fun convertI420ToArgb(yuvBytes: ByteArray, argbOut: IntArray, width: Int, height: Int) {
    val frameSize = width * height
    val uvPlaneSize = frameSize shr 2
    val uOffset = frameSize
    val vOffset = uOffset + uvPlaneSize

    val coeffVr = 1836
    val coeffUg = 218
    val coeffVg = 546
    val coeffUb = 2163

    val halfWidth = width shr 1
    var pixelIndex = 0

    for (row in 0 until height) {
      val uvRowOffset = (row shr 1) * halfWidth
      for (col in 0 until width) {
        val uvIndex = uvRowOffset + (col shr 1)
        val y = (yuvBytes[pixelIndex].toInt() and 0xFF) - 16
        val u = (yuvBytes[uOffset + uvIndex].toInt() and 0xFF) - 128
        val v = (yuvBytes[vOffset + uvIndex].toInt() and 0xFF) - 128

        val yScaled = (y * 1192) shr 10
        val r = yScaled + ((coeffVr * v) shr 10)
        val g = yScaled - ((coeffUg * u + coeffVg * v) shr 10)
        val b = yScaled + ((coeffUb * u) shr 10)

        val rClamped = (r and (r shr 31).inv()) or ((255 - r) shr 31 and 255) and 255
        val gClamped = (g and (g shr 31).inv()) or ((255 - g) shr 31 and 255) and 255
        val bClamped = (b and (b shr 31).inv()) or ((255 - b) shr 31 and 255) and 255

        argbOut[pixelIndex] = 0xFF000000.toInt() or (rClamped shl 16) or (gClamped shl 8) or bClamped
        pixelIndex++
      }
    }
  }
}
