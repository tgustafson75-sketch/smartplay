package expo.modules.mlkitpose

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.pose.Pose
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.PoseDetector
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * On-device pose detection backed by Google ML Kit (BlazePose, 33 landmarks).
 *
 * Exposes a single async function `detectPoseAsync(uri)`:
 *   - input : a LOCAL file/content uri for an extracted swing keyframe
 *   - output: { width, height, landmarks: [{ type, x, y, likelihood }] }
 *             or null when no person is detected.
 *
 * `type` is the ML Kit PoseLandmark.Type ordinal (NOSE=0 … RIGHT_FOOT_INDEX=32);
 * x/y are SOURCE-IMAGE PIXELS; likelihood is 0..1. The JS side
 * (services/pose/onDevicePose.ts) maps the ordinal → COCO-17 names and passes
 * pixels + width/height straight through to the PoseFrame, which is exactly
 * what SwingBodyOverlay's viewBox expects.
 */
class MlkitPoseModule : Module() {
  // SINGLE_IMAGE_MODE: we run on still keyframes, not a live stream.
  private val detector: PoseDetector by lazy {
    val options = PoseDetectorOptions.Builder()
      .setDetectorMode(PoseDetectorOptions.SINGLE_IMAGE_MODE)
      .build()
    PoseDetection.getClient(options)
  }

  override fun definition() = ModuleDefinition {
    Name("MlkitPose")

    AsyncFunction("detectPoseAsync") Coroutine { uri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      // InputImage.fromFilePath accepts a file:// or content:// Uri and handles
      // EXIF rotation, so width/height come back already upright.
      val image = InputImage.fromFilePath(context, Uri.parse(uri))
      val pose = processPose(image)
      val landmarks = pose.allPoseLandmarks
      if (landmarks.isEmpty()) {
        null
      } else {
        mapOf(
          "width" to image.width,
          "height" to image.height,
          "landmarks" to landmarks.map { lm ->
            mapOf(
              "type" to lm.landmarkType,
              "x" to lm.position.x,
              "y" to lm.position.y,
              "likelihood" to lm.inFrameLikelihood
            )
          }
        )
      }
    }
  }

  private suspend fun processPose(image: InputImage): Pose =
    suspendCancellableCoroutine { cont ->
      detector.process(image)
        .addOnSuccessListener { pose -> cont.resume(pose) }
        .addOnFailureListener { e -> cont.resumeWithException(e) }
    }
}
