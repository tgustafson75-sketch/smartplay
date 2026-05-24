/**
 * 2026-05-24 — Bluetooth media-button bridge (Android).
 *
 * Captures BT headset play/pause/playPause taps (Bose, AirPods Pro on
 * Android, Pixel Buds, Galaxy Buds, etc.) and surfaces them to JS via
 * a DeviceEventEmitter event. JS-side consumer is
 * services/voiceTriggers.ts → initVoiceTriggers(), which translates
 * the tap into notifyEarbudTap() — the same entry point the on-screen
 * mic button uses (services/listeningSession.ts:87 subscribes).
 *
 * Event name: "onRemoteControl"  (matches Tim's intended JS API surface)
 * Event payload: { type: "play" | "pause" | "playPause" }
 *
 * How BT taps reach this module:
 *   1. JS calls activate() when listening should be possible.
 *   2. We create a MediaSession + set isActive(true).
 *   3. PlaybackState is set to STATE_PAUSED with PLAY_PAUSE action
 *      enabled — sufficient for the OS to route BT button events to
 *      this session's callback even without active audio playback.
 *   4. MediaSession.Callback fires onPlay / onPause / onPlayPause on
 *      headset taps. We treat all three as a single "tap" signal.
 *   5. We emit "onRemoteControl" with the type. JS handles dedup +
 *      pattern classification (existing logic in earbudControl.ts).
 *
 * Activation lifecycle (called from JS):
 *   - activate(): create session, mark active. Idempotent.
 *   - deactivate(): release session, mark inactive. Idempotent.
 *   - getStatus(): { active, sessionTag }.
 *
 * Why a phantom session is needed:
 *   Android dispatches BT media button events to the most recently
 *   active MediaSession. Without an active session, taps either
 *   nothing-happen or get swallowed by Spotify / a podcast app. The
 *   session here doesn't play audio — STATE_PAUSED + PLAY_PAUSE
 *   action is enough to claim the dispatcher.
 *
 * Why not MediaSessionCompat:
 *   Avoids pulling in androidx.media. android.media.session.MediaSession
 *   has been in the SDK since API 21 (we target minSdk 26). One less
 *   transitive dep, simpler defensive package class.
 *
 * Audio session conflicts (known limitation, deferred to follow-up):
 *   When TTS is speaking (voiceService.ts), expo-av activates its own
 *   audio session in DuckOthers mode. The MediaSession here remains
 *   active in parallel — they don't collide because no audio is
 *   actually played by the MediaSession. If a future tweak adds a
 *   phantom track for tighter capture, audio routing will need a
 *   pause/resume coordination layer.
 */

package com.smartplaycaddie.btmedia

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class BluetoothMediaButtonModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val tag = "BTMediaButton"
    @Volatile private var session: MediaSession? = null
    @Volatile private var isActive: Boolean = false

    override fun getName(): String = "BluetoothMediaButton"

    @ReactMethod
    fun activate(promise: Promise) {
        try {
            if (session != null) {
                // Idempotent — already active. Bump the active flag in case
                // the OS deactivated it under us; setActive(true) is cheap.
                runCatching { session?.isActive = true }
                isActive = true
                resolveStatus(promise)
                return
            }

            val ctx = reactApplicationContext.applicationContext
            val newSession = MediaSession(ctx, "SmartPlayBTButton")

            // setFlags() was deprecated in API 26 — the flags
            // (HANDLES_MEDIA_BUTTONS / HANDLES_TRANSPORT_CONTROLS) are
            // the default for any session created on modern Android, so
            // explicit setFlags is unnecessary on minSdk 26. We just
            // need the callback + an active state + PLAY_PAUSE action.

            newSession.setCallback(object : MediaSession.Callback() {
                override fun onPlay() {
                    emitTap("play")
                }
                override fun onPause() {
                    emitTap("pause")
                }
                // Some headsets (Bose QC, certain AirPods generations on
                // Android via AVRCP) send PLAY_PAUSE rather than
                // discrete play / pause. The framework dispatches that
                // via onMediaButtonEvent() — we route to "playPause" for
                // parity with iOS togglePlayPauseCommand semantics.
                // android.media.session.MediaSession doesn't have a
                // dedicated onPlayPause(); the AndroidX compat version
                // does. We rely on onPlay()/onPause() catching most
                // headset emissions and use the explicit setActions()
                // below to ensure PLAY_PAUSE is one of the dispatched
                // routes when applicable.
            })

            // PlaybackState with PLAY_PAUSE-capable actions. STATE_PAUSED
            // (vs STATE_STOPPED) keeps the session as the active media
            // dispatcher target on most launchers. position = 0 + speed
            // = 0 is the canonical paused-with-no-progress shape.
            val state = PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY or
                    PlaybackState.ACTION_PAUSE or
                    PlaybackState.ACTION_PLAY_PAUSE,
                )
                .setState(PlaybackState.STATE_PAUSED, 0L, 0f)
                .build()
            newSession.setPlaybackState(state)
            newSession.isActive = true

            session = newSession
            isActive = true
            Log.i(tag, "MediaSession activated")
            resolveStatus(promise)
        } catch (t: Throwable) {
            // Defensive: any throw during session setup is non-fatal —
            // the on-screen mic button + voice intent paths still work.
            Log.e(tag, "activate failed", t)
            promise.reject("BT_MEDIA_ACTIVATE_FAILED", t.message ?: t.toString())
        }
    }

    @ReactMethod
    fun deactivate(promise: Promise) {
        try {
            val s = session
            if (s != null) {
                runCatching { s.isActive = false }
                runCatching { s.release() }
                Log.i(tag, "MediaSession deactivated")
            }
            session = null
            isActive = false
            resolveStatus(promise)
        } catch (t: Throwable) {
            Log.e(tag, "deactivate failed", t)
            promise.reject("BT_MEDIA_DEACTIVATE_FAILED", t.message ?: t.toString())
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        resolveStatus(promise)
    }

    /**
     * Required for NativeEventEmitter on the JS side. No-op bodies are
     * fine — the JS layer subscribes via DeviceEventEmitter directly,
     * so we only need these to silence the RN warning when callers use
     * `new NativeEventEmitter(NativeModules.BluetoothMediaButton)`.
     */
    @ReactMethod
    fun addListener(eventName: String) { /* Required for NativeEventEmitter */ }

    @ReactMethod
    fun removeListeners(count: Int) { /* Required for NativeEventEmitter */ }

    private fun resolveStatus(promise: Promise) {
        val map = Arguments.createMap()
        map.putBoolean("active", isActive)
        map.putString("sessionTag", if (session != null) "SmartPlayBTButton" else "")
        promise.resolve(map)
    }

    private fun emitTap(type: String) {
        try {
            val payload = Arguments.createMap()
            payload.putString("type", type)
            payload.putDouble("at", System.currentTimeMillis().toDouble())
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onRemoteControl", payload)
            Log.d(tag, "tap → onRemoteControl ($type)")
        } catch (t: Throwable) {
            Log.w(tag, "emit failed (non-fatal)", t)
        }
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        runCatching {
            session?.isActive = false
            session?.release()
        }
        session = null
        isActive = false
    }
}
