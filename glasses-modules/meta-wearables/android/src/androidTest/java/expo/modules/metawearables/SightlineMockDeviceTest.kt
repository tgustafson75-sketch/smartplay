package expo.modules.metawearables

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.meta.wearable.dat.mockdevice.MockDeviceKit
import com.meta.wearable.dat.mockdevice.api.GlassesModel
import com.meta.wearable.dat.mockdevice.api.MockDeviceKitConfig
import com.meta.wearable.dat.mockdevice.api.MockGlasses
import com.meta.wearable.dat.mockdevice.api.camera.CameraFacing
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.util.Collections

/**
 * Sightline slice 1 against Meta's Mock Device Kit (no glasses, no Meta AI app): the voice invocation is
 * answered exactly once and reaches JS, an incomplete one is an error and is never acted on, and a still
 * from the mock camera comes back as a non-empty JPEG.
 */
@RunWith(AndroidJUnit4::class)
class SightlineMockDeviceTest {
  companion object {
    private val ctx get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val events: MutableList<Pair<String, Map<String, Any?>>> = Collections.synchronizedList(mutableListOf())
    private lateinit var glasses: MockGlasses

    @BeforeClass @JvmStatic fun setUp() {
      InstrumentationRegistry.getInstrumentation().runOnMainSync {
        val kit = MockDeviceKit.getInstance(ctx)
        kit.enable(MockDeviceKitConfig(true, true))   // registered, permissions granted
        glasses = kit.pairGlasses(GlassesModel.RAYBAN_META).getOrNull() ?: error("pairGlasses failed")
        glasses.powerOn(); glasses.unfold(); glasses.don()
        Sightline.initialize(ctx)
        Sightline.sink = { name, body -> events += name to body }
      }
      InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(ctx.packageName, android.Manifest.permission.CAMERA)
      // The voice-invocation stream must be connected to the mock glasses before any simulated action.
      check(waitFor(15_000) { glasses.services.voiceInvocation.hasConnectedApps() }) { "voice invocation stream never connected" }
    }

    private fun waitFor(ms: Long, cond: () -> Boolean): Boolean {
      val until = System.currentTimeMillis() + ms
      while (System.currentTimeMillis() < until) { if (cond()) return true; Thread.sleep(50) }
      return cond()
    }
    private fun count(name: String) = synchronized(events) { events.count { it.first == name } }
  }

  @Test fun launchApp_isAnsweredExactlyOnce_andReachesJs() {
    val before = count("onVoiceInvocation")
    val answeredBefore = Sightline.answeredInvocations.get()
    val requestId = glasses.services.voiceInvocation.simulateLaunchAppAction()
    assertNotNull("simulateLaunchAppAction returned a null request ID", requestId)
    assertTrue("LaunchApp never reached JS", waitFor(10_000) { count("onVoiceInvocation") == before + 1 })
    assertTrue("LaunchApp never answered", waitFor(10_000) { Sightline.answeredInvocations.get() == answeredBefore + 1 })
    Thread.sleep(1_000)   // and not answered twice
    assertEquals(answeredBefore + 1, Sightline.answeredInvocations.get())
    assertEquals(before + 1, count("onVoiceInvocation"))
  }

  @Test fun incompleteAction_isAnErrorAndNotActedOn() {
    val invocations = count("onVoiceInvocation")
    val answered = Sightline.answeredInvocations.get()
    val errors = count("onVoiceInvocationError")
    glasses.services.voiceInvocation.simulateIncompleteAction()
    assertTrue("no onVoiceInvocationError", waitFor(10_000) { count("onVoiceInvocationError") > errors })
    Thread.sleep(500)
    assertEquals("an incomplete invocation was acted on", invocations, count("onVoiceInvocation"))
    assertEquals("an incomplete invocation was answered", answered, Sightline.answeredInvocations.get())
  }

  @Test fun mockCamera_capturePhoto_isANonEmptyJpeg() = runBlocking {
    val still = File(ctx.cacheDir, "mock-still.jpg")
    FileOutputStream(still).use {
      Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }.compress(Bitmap.CompressFormat.JPEG, 90, it)
    }
    InstrumentationRegistry.getInstrumentation().runOnMainSync {
      glasses.services.camera.setCameraFeed(CameraFacing.BACK)
      glasses.services.camera.setCapturedImage(Uri.fromFile(still))
    }
    var err: String? = null
    InstrumentationRegistry.getInstrumentation().runOnMainSync { err = Sightline.startSession() }
    assertNull("startSession: $err", err)
    assertTrue("session never STARTED", waitFor(15_000) { synchronized(events) { events.any { it.first == "onSessionState" && it.second["state"] == "STARTED" } } })
    InstrumentationRegistry.getInstrumentation().runOnMainSync { err = Sightline.startStream("LOW", 2) }
    assertNull("startStream: $err", err)
    assertTrue("stream never STREAMING", waitFor(15_000) { synchronized(events) { events.any { it.first == "onStreamState" && it.second["state"] == "STREAMING" } } })
    try {
      val uri = withTimeout(15_000) { Sightline.capturePhoto() }
      val file = File(Uri.parse(uri).path!!)
      assertTrue("capture file empty", file.length() > 0)
      val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, opts)
      assertEquals("image/jpeg", opts.outMimeType)
    } finally {
      InstrumentationRegistry.getInstrumentation().runOnMainSync { Sightline.stopSession() }
    }
  }
}
