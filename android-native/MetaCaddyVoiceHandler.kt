/*
 * MetaCaddyVoiceHandler.kt
 * SmartPlay Caddy — Android Google Assistant + Ray-Ban Meta glasses voice handler
 *
 * 2026-05-22
 *
 * Activity that handles voice-assist routing for hands-free SmartPlay Caddy use
 * with Ray-Ban Meta glasses paired to Android. Flow:
 *
 *   "Hey Google, ask Smart Play Caddy 145 to pin"
 *     -> Google Assistant routes to this activity via App Actions
 *     -> we extract the query + current GPS
 *     -> POST to /api/meta-voice
 *     -> read the `speak` field aloud via TextToSpeech
 *     -> Meta glasses HEAR that audio (BT audio routing handles this for free
 *        once the glasses are paired)
 *     -> we setResult(state) so Assistant can persist continuity
 *
 * HONEST CONSTRAINT (read this before shipping):
 *   The custom action "com.google.android.gms.actions.ASK_SMART_PLAY_CADDY"
 *   isn't a real Google-registered action. For "Hey Google, ask Smart Play
 *   Caddy ..." to actually route the user's query INTO this activity, you
 *   need to register an App Action via Google's App Actions framework:
 *     1. Add res/xml/shortcuts.xml with an <capability> declaring the BII
 *        (Built-In Intent) you want to support, e.g.
 *        actions.intent.GET_THING with a query parameter.
 *     2. Reference shortcuts.xml from <meta-data> in your AndroidManifest
 *        under your launcher activity.
 *     3. Register the app in Google's App Actions console + test via the
 *        Google Assistant developer testing flow.
 *   See README_ANDROID.md (sibling file) for the shortcuts.xml + manifest
 *   snippets. Until App Actions is registered, the trigger phrase falls back
 *   to "Hey Google, open Smart Play Caddy" which launches this activity
 *   WITHOUT a query string — the activity then opens the mic for dictation.
 *
 *   The custom-action intent-filter in the manifest is still useful: it
 *   accepts explicit Intent dispatches (e.g. from a notification action or
 *   a companion-app deep link) and from the Google Assistant SDK once
 *   App Actions wires through to it.
 *
 * TARGET: Android SDK 34. Kotlin only. No Compose. No external HTTP / JSON
 * library — uses HttpURLConnection + org.json. Location uses the platform
 * LocationManager (no google-play-services dep required).
 */

package com.smartplaycaddy.voice

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.core.app.ActivityCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Entry-point activity for hands-free Caddy voice flow.
 *
 * Intents recognized:
 *   - com.google.android.gms.actions.ASK_SMART_PLAY_CADDY (custom)
 *   - android.intent.action.ASSIST
 *   - android.intent.action.VOICE_ASSIST
 *   - android.intent.action.VIEW with smartplay://meta-voice?q=...
 *   - any explicit start with EXTRA_QUERY set
 *
 * Result codes returned to Assistant:
 *   - RESULT_OK   with EXTRA_STATE (string JSON) on success
 *   - RESULT_FIRST_USER + 1 on rate-limited / network failure
 *   - RESULT_CANCELED on user cancel before TTS finishes
 */
class MetaCaddyVoiceHandler : Activity(), TextToSpeech.OnInitListener {

    companion object {
        private const val TAG = "MetaCaddy"
        private const val ENDPOINT = "https://smartplay-beta.vercel.app/api/meta-voice"
        private const val LOCATION_REQUEST_CODE = 4201
        private const val SPEECH_REQUEST_CODE = 4202
        private const val LOCATION_TIMEOUT_MS = 2_500L
        private const val HTTP_TIMEOUT_MS = 1_800
        private const val PREFS_NAME = "MetaCaddyPrefs"
        private const val PREF_STATE = "meta_caddy_state"
        private const val PREF_USER_ID = "meta_caddy_user_id"

        /** Extra key callers can pass to skip dictation and use a pre-filled query. */
        const val EXTRA_QUERY = "com.smartplaycaddy.voice.QUERY"
        /** Extra key on the result Intent — JSON string of the new state blob. */
        const val EXTRA_STATE = "com.smartplaycaddy.voice.STATE"

        /** Custom intent action — referenced from the manifest intent-filter. */
        const val ACTION_ASK_SMART_PLAY_CADDY =
            "com.google.android.gms.actions.ASK_SMART_PLAY_CADDY"
    }

    private lateinit var prefs: SharedPreferences
    private var tts: TextToSpeech? = null
    private val ttsReady = AtomicBoolean(false)
    /** Reply we're waiting to speak as soon as TTS finishes initializing. */
    private var pendingSpeak: String? = null
    /** State JSON we'll set as result + persist to prefs once the flow completes. */
    private var pendingState: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        tts = TextToSpeech(this, this)
        Log.d(TAG, "onCreate action=${intent?.action} extras=${intent?.extras?.keySet()}")
        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.let { handleIncomingIntent(it) }
    }

    // ──────────────────────────────────────────────────────────────────────
    // TTS lifecycle
    // ──────────────────────────────────────────────────────────────────────

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.US
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { runOnUiThread { finishWithResult() } }
                @Deprecated("Deprecated in API 21+")
                override fun onError(utteranceId: String?) { runOnUiThread { finishWithResult() } }
                override fun onError(utteranceId: String?, errorCode: Int) {
                    runOnUiThread { finishWithResult() }
                }
            })
            ttsReady.set(true)
            // If a reply queued up before TTS was ready, fire it now.
            pendingSpeak?.let {
                pendingSpeak = null
                speak(it)
            }
        } else {
            Log.w(TAG, "TTS init failed status=$status")
            finishWithResult()
        }
    }

    private fun speak(text: String) {
        val utteranceId = UUID.randomUUID().toString()
        // STREAM_VOICE_CALL routes through the BT audio channel that Meta
        // glasses use as a Bluetooth headset, so the glasses' speakers
        // play it. STREAM_MUSIC would also work; STREAM_VOICE_CALL is
        // more reliable for HFP/HSP profile glasses.
        val params = Bundle().apply {
            putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
            putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, android.media.AudioManager.STREAM_VOICE_CALL)
        }
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Intent → query extraction
    // ──────────────────────────────────────────────────────────────────────

    private fun handleIncomingIntent(intent: Intent) {
        val query = extractQuery(intent)
        if (query.isNullOrBlank()) {
            // No query in the intent — launch dictation so the user can
            // speak it. This is the fallback for "Hey Google, open Smart
            // Play Caddy" without App Actions deep-routing.
            startDictation()
            return
        }
        // We have a query — proceed straight to GPS + POST.
        startCaddyFlow(query.trim())
    }

    private fun extractQuery(intent: Intent): String? {
        // 1. Explicit extra (caller put it there directly).
        intent.getStringExtra(EXTRA_QUERY)?.takeIf { it.isNotBlank() }?.let { return it }
        // 2. Google Assistant's RecognizerIntent extras (when we get
        //    dispatched with a transcribed query).
        intent.getStringExtra(RecognizerIntent.EXTRA_RESULTS)?.takeIf { it.isNotBlank() }?.let { return it }
        intent.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            ?.takeIf { it.isNotBlank() }?.let { return it }
        // 3. Search-query extra (SearchManager.QUERY).
        intent.getStringExtra(android.app.SearchManager.QUERY)?.takeIf { it.isNotBlank() }
            ?.let { return it }
        // 4. Standard text extra.
        intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }?.let { return it }
        // 5. Deep link — smartplay://meta-voice?q=...
        intent.data?.getQueryParameter("q")?.takeIf { it.isNotBlank() }?.let { return it }
        intent.data?.getQueryParameter("query")?.takeIf { it.isNotBlank() }?.let { return it }
        return null
    }

    private fun startDictation() {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask the caddy")
        }
        try {
            startActivityForResult(i, SPEECH_REQUEST_CODE)
        } catch (e: Exception) {
            Log.w(TAG, "No speech recognition installed: $e")
            pendingSpeak = "Speech recognition isn't available on this device."
            ensureTtsAndSpeak()
        }
    }

    @Deprecated("startActivityForResult deprecated but works on SDK 34; ActivityResultLauncher cleaner if Activity inherits AppCompatActivity")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == SPEECH_REQUEST_CODE) {
            if (resultCode != RESULT_OK || data == null) {
                finishWithResult(canceled = true)
                return
            }
            val results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val query = results?.firstOrNull()?.trim().orEmpty()
            if (query.isBlank()) {
                finishWithResult(canceled = true)
                return
            }
            startCaddyFlow(query)
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Caddy pipeline
    // ──────────────────────────────────────────────────────────────────────

    private fun startCaddyFlow(query: String) {
        Log.d(TAG, "startCaddyFlow query=${query.take(60)}")
        fetchLocation { gps ->
            postToCaddy(query, gps)
        }
    }

    /** Best-effort one-shot location request. Caller gets `null` on permission
     *  denied / no provider / 2.5s timeout. We DON'T block forever — the
     *  caddy endpoint accepts null GPS and degrades gracefully. */
    private fun fetchLocation(onResult: (Location?) -> Unit) {
        val granted =
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED ||
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        if (!granted) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION),
                LOCATION_REQUEST_CODE,
            )
            onResult(null)
            return
        }
        val lm = getSystemService(LOCATION_SERVICE) as LocationManager
        // Try last-known first for snap response.
        val last = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
            .mapNotNull { provider ->
                try {
                    if (lm.isProviderEnabled(provider)) lm.getLastKnownLocation(provider) else null
                } catch (_: SecurityException) { null }
            }
            .filter { System.currentTimeMillis() - it.time < 5 * 60_000L }
            .maxByOrNull { it.time }
        if (last != null) { onResult(last); return }

        // No fresh last-known — request a single update with a hard timeout.
        val delivered = AtomicBoolean(false)
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (delivered.compareAndSet(false, true)) {
                    try { lm.removeUpdates(this) } catch (_: SecurityException) {}
                    onResult(location)
                }
            }
            @Suppress("OVERRIDE_DEPRECATION")
            override fun onProviderEnabled(provider: String) {}
            @Suppress("OVERRIDE_DEPRECATION")
            override fun onProviderDisabled(provider: String) {}
            @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { lm.isProviderEnabled(it) }
        try {
            providers.forEach { lm.requestSingleUpdate(it, listener, Looper.getMainLooper()) }
        } catch (e: SecurityException) {
            onResult(null)
            return
        } catch (e: IllegalArgumentException) {
            onResult(null)
            return
        }
        // Timeout safety net.
        android.os.Handler(Looper.getMainLooper()).postDelayed({
            if (delivered.compareAndSet(false, true)) {
                try { lm.removeUpdates(listener) } catch (_: SecurityException) {}
                onResult(null)
            }
        }, LOCATION_TIMEOUT_MS)
    }

    private fun postToCaddy(query: String, gps: Location?) {
        val priorState = prefs.getString(PREF_STATE, "{}") ?: "{}"
        val userId = ensureUserId()
        thread(name = "MetaCaddyPost") {
            val responseJson = try {
                doPost(query, gps, priorState, userId)
            } catch (e: Exception) {
                Log.w(TAG, "POST failed: $e")
                null
            }
            runOnUiThread { onCaddyResponse(responseJson) }
        }
    }

    private fun doPost(query: String, gps: Location?, priorState: String, userId: String): String? {
        val body = JSONObject().apply {
            put("query", query)
            put("user_id", userId)
            if (gps != null) {
                put("gps", JSONObject().apply {
                    put("lat", gps.latitude)
                    put("lng", gps.longitude)
                })
            } else {
                put("gps", JSONObject.NULL)
            }
            // Pass prior state back as a JSON object (server expects an object).
            val priorObj = try { JSONObject(priorState) } catch (_: Exception) { JSONObject() }
            put("state", priorObj)
            put("spoken_context", "")
        }.toString()

        val url = URL(ENDPOINT)
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = HTTP_TIMEOUT_MS
            conn.readTimeout = HTTP_TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code in 200..299) {
                return conn.inputStream.bufferedReader().use { it.readText() }
            }
            Log.w(TAG, "Non-2xx from caddy: $code")
            return null
        } finally {
            conn.disconnect()
        }
    }

    private fun onCaddyResponse(raw: String?) {
        if (raw.isNullOrBlank()) {
            pendingSpeak = "Couldn't reach the caddy. Try again."
            pendingState = null
            ensureTtsAndSpeak()
            return
        }
        val parsed = try { JSONObject(raw) } catch (e: Exception) {
            Log.w(TAG, "Parse failed: $e")
            null
        }
        if (parsed == null) {
            pendingSpeak = "Couldn't read the caddy's response."
            ensureTtsAndSpeak()
            return
        }
        val speakText = parsed.optString("speak", "").ifBlank { "Standing by." }
        val stateObj = parsed.optJSONObject("state") ?: JSONObject()
        pendingSpeak = speakText
        pendingState = stateObj.toString()
        // Persist state locally so the NEXT invocation has it even if the
        // Assistant doesn't carry it forward (defensive — Assistant State
        // continuity is not 100% reliable across SDK versions).
        prefs.edit().putString(PREF_STATE, pendingState).apply()
        ensureTtsAndSpeak()
    }

    private fun ensureTtsAndSpeak() {
        val text = pendingSpeak ?: return finishWithResult()
        if (!ttsReady.get()) {
            // TTS still initializing — onInit will fire pendingSpeak when ready.
            return
        }
        pendingSpeak = null
        speak(text)
    }

    /** Set the result Intent + tear down. Assistant reads EXTRA_STATE so it
     *  can persist continuity (also: our own SharedPreferences cache survives
     *  across launches as belt + suspenders). */
    private fun finishWithResult(canceled: Boolean = false) {
        if (!isFinishing) {
            val result = Intent().apply {
                pendingState?.let { putExtra(EXTRA_STATE, it) }
            }
            setResult(if (canceled) RESULT_CANCELED else RESULT_OK, result)
            finish()
        }
    }

    override fun onDestroy() {
        try { tts?.stop() } catch (_: Exception) {}
        try { tts?.shutdown() } catch (_: Exception) {}
        super.onDestroy()
    }

    // ──────────────────────────────────────────────────────────────────────
    // User id
    // ──────────────────────────────────────────────────────────────────────

    /** Stable per-install user id. Generated once + persisted to prefs. We
     *  don't use ANDROID_ID (deprecated for cross-app reidentification on
     *  modern Android). The endpoint logs only the first 8 chars anyway. */
    private fun ensureUserId(): String {
        prefs.getString(PREF_USER_ID, null)?.let { return it }
        val deviceHint = (Build.MODEL ?: "android").lowercase().replace("\\s+".toRegex(), "_").take(16)
        val id = "${deviceHint}_${UUID.randomUUID().toString().take(12)}"
        prefs.edit().putString(PREF_USER_ID, id).apply()
        return id
    }

    // ──────────────────────────────────────────────────────────────────────
    // Permission callback
    // ──────────────────────────────────────────────────────────────────────

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == LOCATION_REQUEST_CODE) {
            // User saw the permission dialog. Re-enter the flow with the
            // most-recent intent (handleIncomingIntent picks the query
            // out again and proceeds).
            handleIncomingIntent(intent)
        }
    }
}

// Suppress unused import warning for Uri — used at the deep-link entry point
// in extractQuery() and we want this file to compile clean even if the
// linker tree-shakes that path.
@Suppress("unused")
private val _uriPin: Class<Uri> = Uri::class.java
