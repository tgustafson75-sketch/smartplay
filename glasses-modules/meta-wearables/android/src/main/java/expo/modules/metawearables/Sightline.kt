package expo.modules.metawearables

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.meta.wearable.dat.camera.Camera
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.removeCamera
import com.meta.wearable.dat.camera.types.PhotoData
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.voiceinvocations.VoiceInvocationsStream
import com.meta.wearable.dat.core.voiceinvocations.isVoiceInvocationsIntent
import com.meta.wearable.dat.core.voiceinvocations.startVoiceInvocationsStream
import com.meta.wearable.dat.core.voiceinvocations.types.actions.LaunchApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Sightline slice 1 — the process-wide state of the glasses link (one per process, like the SDK itself).
 *
 * Owned here, not by the JS module, because the SDK's entry points are APP-scoped: initialize once per
 * process, handleIntent in onCreate AND onNewIntent, and the voice-invocation stream started early. The
 * Expo module (MetaWearablesModule) attaches to forward events to JS and calls into this object.
 *
 * Every session / voice error is surfaced with its OWN code (the SDK enum name) — never collapsed.
 */
object Sightline {
  private const val TAG = "Sightline"
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

  /** Where events go. Null until the JS module attaches; a LaunchApp before that is held. */
  @Volatile var sink: ((String, Map<String, Any?>) -> Unit)? = null
    set(value) {
      field = value
      if (value != null && pendingLaunch.getAndSet(false)) value("onVoiceInvocation", mapOf("action" to "LaunchApp"))
    }
  private val pendingLaunch = AtomicBoolean(false)

  /** How many LaunchApp invocations were answered (sendSuccess) — the Mock Device Kit test asserts exactly once. */
  internal val answeredInvocations = AtomicInteger(0)

  private val initialized = AtomicBoolean(false)
  private var appContext: Context? = null
  private var session: DeviceSession? = null
  private var camera: Camera? = null
  private val sessionJobs = mutableListOf<Job>()
  private val streamJobs = mutableListOf<Job>()
  private var voiceStream: VoiceInvocationsStream? = null

  private fun emit(name: String, body: Map<String, Any?>) {
    val s = sink
    if (s == null) { Log.d(TAG, "event $name before JS attached: $body"); return }
    try { s(name, body) } catch (e: Throwable) { Log.w(TAG, "event $name failed", e) }
  }

  // ── Process lifecycle ─────────────────────────────────────────────────────────────────────────────

  /** Wearables.initialize once per process, then the app-scoped voice-invocation stream. */
  fun initialize(context: Context) {
    if (!initialized.compareAndSet(false, true)) return
    appContext = context.applicationContext
    Wearables.initialize(context.applicationContext)
      .onFailure { e, _ -> Log.w(TAG, "initialize: ${e.name}") }
    scope.launch { Wearables.registrationState.collect { emit("onRegistrationState", mapOf("state" to it.name)) } }
    scope.launch { Wearables.registrationErrorStream.collect { emit("onRegistrationError", mapOf("code" to it.toString())) } }
    startVoiceInvocations()
  }

  private fun startVoiceInvocations() {
    if (voiceStream != null) return
    val vs = try { Wearables.startVoiceInvocationsStream(AutoDeviceSelector()) } catch (e: Throwable) {
      Log.w(TAG, "voice invocations unavailable", e); return
    }
    voiceStream = vs
    scope.launch {
      vs.invocations.collect { inv ->
        if (inv is LaunchApp) {
          // Answer EXACTLY once per invocation, then hand the launch to JS (Caddie screen + push-to-talk).
          scope.launch { try { inv.responseHandle.sendSuccess(null); answeredInvocations.incrementAndGet() } catch (e: Throwable) { Log.w(TAG, "sendSuccess", e) } }
          if (sink != null) emit("onVoiceInvocation", mapOf("action" to "LaunchApp")) else pendingLaunch.set(true)
        }
      }
    }
    scope.launch { vs.errors.collect { emit("onVoiceInvocationError", mapOf("code" to it.name)) } }
  }

  /** Called from onCreate AND onNewIntent (required on SDK >= 1.0.0). */
  fun handleIntent(activity: Activity, intent: Intent?) {
    if (intent == null || !initialized.get()) return
    Wearables.handleIntent(intent) { request -> request.continueRegistration(activity) }
      .onFailure { e, _ -> Log.w(TAG, "handleIntent: $e") }
    if (isVoiceInvocationsIntent(intent)) {
      // The app was launched / foregrounded by "Hey Meta, start SmartPlay Caddie": the stream delivers the
      // LaunchApp action (answered there); make sure the stream is running.
      startVoiceInvocations()
    }
  }

  // ── Registration ──────────────────────────────────────────────────────────────────────────────────

  fun registrationState(): String = Wearables.registrationState.value.name
  fun register(activity: Activity) = Wearables.startRegistration(activity)

  // ── Session ───────────────────────────────────────────────────────────────────────────────────────

  /** Returns null on success, else the DeviceSessionError code. */
  fun startSession(): String? {
    if (session != null) return null
    val result = Wearables.createSession(AutoDeviceSelector())
    val s = result.getOrNull() ?: return (result.errorOrNull()?.name ?: "UNEXPECTED_ERROR").also {
      emit("onSessionError", mapOf("code" to it))
    }
    session = s
    sessionJobs += scope.launch { s.errors.collect { emit("onSessionError", mapOf("code" to it.name)) } }
    sessionJobs += scope.launch { s.state.collect { emit("onSessionState", mapOf("state" to it.name)) } }
    s.start()
    return null
  }

  fun stopSession() {
    stopStream()
    sessionJobs.forEach { it.cancel() }; sessionJobs.clear()
    try { session?.stop() } catch (e: Throwable) { Log.w(TAG, "stop session", e) }
    session = null
  }

  // ── Stream + photo ────────────────────────────────────────────────────────────────────────────────

  /** quality LOW | MEDIUM, fps 2 | 7. Returns null on success, else an error code. */
  fun startStream(quality: String, fps: Int): String? {
    val s = session ?: return "NO_SESSION"
    if (camera != null) return null
    val defaults = StreamConfiguration()
    val cfg = StreamConfiguration(
      defaults.audioCodec,
      if (quality == "MEDIUM") VideoQuality.MEDIUM else VideoQuality.LOW,
      if (fps >= 7) 7 else 2,
      defaults.compressVideo,
    )
    val result = s.addCamera(cfg)
    val cam = result.getOrNull() ?: return (result.errorOrNull()?.name ?: "UNEXPECTED_ERROR").also {
      emit("onSessionError", mapOf("code" to it))
    }
    camera = cam
    streamJobs += scope.launch { cam.stream.state.collect { emit("onStreamState", mapOf("state" to it.name)) } }
    streamJobs += scope.launch { cam.stream.errorStream.collect { emit("onStreamError", mapOf("code" to it.toString())) } }
    val started = cam.stream.start()
    return if (started.isSuccess) null else (started.errorOrNull()?.toString() ?: "STREAM_START_FAILED")
  }

  fun stopStream() {
    streamJobs.forEach { it.cancel() }; streamJobs.clear()
    val cam = camera ?: return
    camera = null
    try { cam.stream.stop(); cam.close() } catch (e: Throwable) { Log.w(TAG, "stop stream", e) }
    try { session?.removeCamera() } catch (e: Throwable) { Log.w(TAG, "removeCamera", e) }
  }

  /** A still from the live stream, written as a JPEG in the cache dir. Returns the file:// URI. */
  suspend fun capturePhoto(): String {
    val cam = camera ?: throw IllegalStateException("NO_STREAM")
    val result = cam.stream.capturePhoto()
    val data = result.getOrNull() ?: throw IllegalStateException(result.errorOrNull()?.toString() ?: "CAPTURE_FAILED")
    val bitmap: Bitmap = when (data) {
      is PhotoData.Bitmap -> data.bitmap
      is PhotoData.HEIC -> {
        val bb = data.data.duplicate()
        val bytes = ByteArray(bb.remaining()).also { bb.get(it) }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalStateException("HEIC_DECODE_FAILED")
      }
    }
    val dir = File((appContext ?: throw IllegalStateException("NOT_INITIALIZED")).cacheDir, "glasses").apply { mkdirs() }
    val file = File(dir, "glasses-${System.currentTimeMillis()}.jpg")
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
    return "file://${file.absolutePath}"
  }
}
