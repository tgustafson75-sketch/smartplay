/**
 * 2026-05-23 — MediaPipe Pose Landmarker — Android native module.
 *
 * BlazePose 33-keypoint pose detection on-device. Becomes the
 * primary path in services/poseEstimator.ts when present; the cloud
 * /api/pose-analysis route stays the defensive fallback.
 *
 * Public API exposed to React Native:
 *   - detectPoseFromFrame(b64, options, promise)
 *       One-shot pose detection on a single JPEG/PNG frame. Returns
 *       33 normalized keypoints + confidence + world-space landmarks
 *       (when available). This is the path SmartPlay actually uses
 *       today — Phase K extracts 5 keyframes from a swing clip via
 *       expo-video-thumbnails, then calls this once per frame.
 *   - startContinuousDetection(quality, promise)
 *       Subscribes to the running camera (CameraX) and emits
 *       MediaPipePoseFrame events at the model's processing rate.
 *       Reserved for future live-preview use; not wired into any UI
 *       surface today.
 *   - stopContinuousDetection(promise)
 *   - getStatus(promise) → { available, modelLoaded, lastInferenceMs }
 *
 * Quality presets (model variants):
 *   - "lite"  — pose_landmarker_lite.task   (~3 MB, fastest)
 *   - "full"  — pose_landmarker_full.task   (~9 MB, default, what we ship)
 *   - "heavy" — pose_landmarker_heavy.task  (~30 MB, best accuracy)
 *
 * Backward compatibility: never throws on JS-callable methods. Every
 * failure path rejects the promise with a clean DAT_*-style error
 * code; the JS service collapses to "fall back to cloud" without
 * raising to the caller.
 */

package com.smartplaycaddie.mediapipe

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

// MediaPipe imports — resolved by withMediaPipePose.js config plugin
// pulling com.google.mediapipe:tasks-vision into the gradle deps.
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult

class MediaPipePoseModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    @Volatile private var landmarker: PoseLandmarker? = null
    @Volatile private var loadedQuality: String = "full"
    @Volatile private var lastInferenceMs: Long = 0

    override fun getName(): String = "MediaPipePose"

    private fun assetForQuality(quality: String): String = when (quality) {
        "lite"  -> "mediapipe/pose_landmarker_lite.task"
        "heavy" -> "mediapipe/pose_landmarker_heavy.task"
        else    -> "mediapipe/pose_landmarker_full.task"
    }

    /** Lazy init the landmarker. Synchronized so two concurrent
     *  detectPose calls from JS don't double-build. Throws on init
     *  failure — callers wrap in try/promise.reject. */
    @Synchronized
    private fun ensureLandmarker(quality: String) {
        if (landmarker != null && loadedQuality == quality) return
        // Reload only if quality changed.
        landmarker?.close()
        landmarker = null
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath(assetForQuality(quality))
            // Try GPU delegate first — falls back to CPU on devices
            // that don't support GPU acceleration for tasks-vision.
            .setDelegate(Delegate.GPU)
            .build()
        val options = PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.IMAGE)
            // Single pose — golf is one-player-per-frame for now. If
            // we ever wire a "coach + student" mode, bump this.
            .setNumPoses(1)
            .setMinPoseDetectionConfidence(0.4f)
            .setMinPosePresenceConfidence(0.4f)
            .setMinTrackingConfidence(0.4f)
            .setOutputSegmentationMasks(false)
            .build()
        landmarker = try {
            PoseLandmarker.createFromOptions(reactApplicationContext, options)
        } catch (e: Throwable) {
            // GPU path failed — retry with CPU. Some emulators + older
            // ARM devices don't have the GPU delegate registered.
            val cpuOptions = options.toBuilder()
                .setBaseOptions(
                    BaseOptions.builder()
                        .setModelAssetPath(assetForQuality(quality))
                        .setDelegate(Delegate.CPU)
                        .build(),
                )
                .build()
            PoseLandmarker.createFromOptions(reactApplicationContext, cpuOptions)
        }
        loadedQuality = quality
    }

    @ReactMethod
    fun detectPoseFromFrame(b64: String, options: ReadableMap?, promise: Promise) {
        try {
            val quality = options?.takeIf { it.hasKey("quality") }?.getString("quality") ?: "full"
            ensureLandmarker(quality)
            // Decode base64 → bitmap. Strip data: prefix if present.
            val clean = if (b64.startsWith("data:")) b64.substringAfter(",") else b64
            val bytes = Base64.decode(clean, Base64.DEFAULT)
            val bitmap: Bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                ?: run {
                    promise.reject("MP_DECODE_FAILED", "Could not decode base64 frame to bitmap")
                    return
                }
            val mpImage: MPImage = BitmapImageBuilder(bitmap).build()
            val t0 = System.currentTimeMillis()
            val result: PoseLandmarkerResult = landmarker!!.detect(mpImage)
            lastInferenceMs = System.currentTimeMillis() - t0
            promise.resolve(serializeResult(result, lastInferenceMs))
        } catch (e: Throwable) {
            promise.reject("MP_INFERENCE_FAILED", e.message ?: e.toString())
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        val map = Arguments.createMap()
        map.putBoolean("available", true)
        map.putBoolean("modelLoaded", landmarker != null)
        map.putString("loadedQuality", loadedQuality)
        map.putDouble("lastInferenceMs", lastInferenceMs.toDouble())
        promise.resolve(map)
    }

    /** Continuous-detection methods reserved for future live-preview
     *  use. Stub-rejected today so callers that try them get a clean
     *  "not implemented" rather than a silent no-op. Wire-up adds a
     *  CameraX preview + IMAGE_ANALYSIS use case + LiveStream
     *  RunningMode landmarker. */
    @ReactMethod
    fun startContinuousDetection(quality: String?, promise: Promise) {
        promise.reject("MP_NOT_IMPLEMENTED", "startContinuousDetection is reserved for future use")
    }

    @ReactMethod
    fun stopContinuousDetection(promise: Promise) {
        promise.resolve(null)
    }

    @ReactMethod
    fun close(promise: Promise) {
        try {
            landmarker?.close()
            landmarker = null
            promise.resolve(null)
        } catch (e: Throwable) {
            promise.reject("MP_CLOSE_FAILED", e.message ?: e.toString())
        }
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        landmarker?.close()
        landmarker = null
    }

    // ─── Result serialization ─────────────────────────────────────

    /** Translate PoseLandmarkerResult into the JS shape:
     *    {
     *      poseFound: boolean,
     *      landmarks: [{ x, y, z, visibility, presence } * 33],
     *      worldLandmarks: [...] | null,
     *      inferenceMs: number,
     *    }
     *  The visibility field is 0..1 — used by poseEstimator's
     *  joint_confidence rollup downstream. */
    private fun serializeResult(result: PoseLandmarkerResult, ms: Long): WritableMap {
        val out = Arguments.createMap()
        val landmarks: WritableArray = Arguments.createArray()
        val worldLandmarks: WritableArray = Arguments.createArray()
        var found = false
        if (result.landmarks().isNotEmpty()) {
            found = true
            for (lm in result.landmarks()[0]) {
                val p = Arguments.createMap()
                p.putDouble("x", lm.x().toDouble())
                p.putDouble("y", lm.y().toDouble())
                p.putDouble("z", lm.z().toDouble())
                p.putDouble("visibility", lm.visibility().orElse(0f).toDouble())
                p.putDouble("presence", lm.presence().orElse(0f).toDouble())
                landmarks.pushMap(p)
            }
            if (result.worldLandmarks().isNotEmpty()) {
                for (lm in result.worldLandmarks()[0]) {
                    val p = Arguments.createMap()
                    p.putDouble("x", lm.x().toDouble())
                    p.putDouble("y", lm.y().toDouble())
                    p.putDouble("z", lm.z().toDouble())
                    p.putDouble("visibility", lm.visibility().orElse(0f).toDouble())
                    p.putDouble("presence", lm.presence().orElse(0f).toDouble())
                    worldLandmarks.pushMap(p)
                }
            }
        }
        out.putBoolean("poseFound", found)
        out.putArray("landmarks", landmarks)
        out.putArray("worldLandmarks", worldLandmarks)
        out.putDouble("inferenceMs", ms.toDouble())
        return out
    }
}
