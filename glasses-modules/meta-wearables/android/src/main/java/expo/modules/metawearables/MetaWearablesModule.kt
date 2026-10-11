package expo.modules.metawearables

import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.types.Permission
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Sightline slice 1 — the minimal JS surface over Sightline (process state). Glasses variant only.
 *
 *   register() · getRegistrationState() · requestCameraPermission() · startSession() / stopSession()
 *   startStream({ quality: 'LOW' | 'MEDIUM', fps: 2 | 7 }) · stopStream() · capturePhoto() → file:// JPEG
 *   events: onRegistrationState, onRegistrationError, onSessionState, onSessionError (distinct codes:
 *           INSUFFICIENT_SDK_VERSION, DWA_OUT_OF_STU_RANGE, DAT_APP_ON_THE_GLASSES_UPDATE_REQUIRED,
 *           DWA_UNAVAILABLE, CAPABILITY_DENIED, …), onStreamState, onStreamError, onVoiceInvocation,
 *           onVoiceInvocationError
 */
class MetaWearablesModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

  override fun definition() = ModuleDefinition {
    Name("MetaWearables")

    Events(
      "onRegistrationState", "onRegistrationError", "onSessionState", "onSessionError",
      "onStreamState", "onStreamError", "onVoiceInvocation", "onVoiceInvocationError",
    )

    OnCreate {
      appContext.reactContext?.let { Sightline.initialize(it) }
      Sightline.sink = { name, body -> this@MetaWearablesModule.sendEvent(name, body) }
    }
    OnDestroy { Sightline.sink = null }

    Function("getRegistrationState") { Sightline.registrationState() }

    Function("register") {
      val activity = appContext.currentActivity ?: throw CodedException("NO_ACTIVITY", "No foreground activity", null)
      Sightline.register(activity)
    }

    AsyncFunction("requestCameraPermission") { promise: Promise ->
      val activity = appContext.currentActivity as? ComponentActivity
        ?: return@AsyncFunction promise.reject("NO_ACTIVITY", "No foreground activity", null)
      activity.runOnUiThread {
        var launcher: ActivityResultLauncher<Permission>? = null
        launcher = activity.activityResultRegistry.register(
          "mwdat-camera-permission-${System.nanoTime()}",
          Wearables.RequestPermissionContract(),
        ) { result ->
          launcher?.unregister()
          result.fold(
            { status -> promise.resolve(status.javaClass.simpleName.uppercase()) },   // GRANTED / DENIED
            { error, _ -> promise.reject("PERMISSION_ERROR", error.toString(), null) },
          )
        }
        launcher.launch(Permission.CAMERA)
      }
    }

    AsyncFunction("startSession") { promise: Promise ->
      val err = Sightline.startSession()
      if (err == null) promise.resolve(null) else promise.reject(err, "Session failed: $err", null)
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    Function("stopSession") { Sightline.stopSession() }

    AsyncFunction("startStream") { options: Map<String, Any?>, promise: Promise ->
      val quality = (options["quality"] as? String) ?: "LOW"
      val fps = (options["fps"] as? Number)?.toInt() ?: 2
      val err = Sightline.startStream(quality, fps)
      if (err == null) promise.resolve(null) else promise.reject(err, "Stream failed: $err", null)
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    Function("stopStream") { Sightline.stopStream() }

    AsyncFunction("capturePhoto") { promise: Promise ->
      scope.launch {
        try { promise.resolve(Sightline.capturePhoto()) }
        catch (e: Throwable) { promise.reject("CAPTURE_FAILED", e.message ?: "capture failed", e) }
      }
    }
  }
}
