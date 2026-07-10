/**
 * 2026-06-29 / extended 2026-07-06 / polished 2026-07-08 — Watch UI (Wear OS).
 * Programmatic (no Compose/XML) to keep the watch APK tiny.
 *
 * One glanceable screen, readable at arm's length:
 *   ┌────────────────────┐
 *   │      SmartPlay     │   (brand, tiny green)
 *   │       HOLE 7       │   (hole label, dim)
 *   │        147         │   (BIG middle-of-green yardage — the hero number)
 *   │    F 132   B 158   │   (front / back to the green, flanking)
 *   │   [  Ask caddie ]  │   (prominent green mic button)
 *   │  status / feedback │
 *   │   · Record swings ·│   (secondary swing-capture toggle)
 *   └────────────────────┘
 *
 * LIVE PIN YARDAGE is pushed from the phone (front/middle/back to the green,
 * GPS-live). "Ask caddie" taps → the watch speech recognizer → the transcript is
 * shipped to the phone, which routes it through the full caddie pipeline and speaks
 * the answer (and can push a spoken prompt / notification back here for the watch TTS).
 *
 * Screen stays awake (FLAG_KEEP_SCREEN_ON) while the app is foreground so the number
 * is glanceable mid-hole instead of dimming to a blank ambient face.
 *
 * On launch the watch sends a "/smartplay/hello" presence ping so the phone marks the
 * watch connected immediately — not only when swing capture starts.
 *
 * Data Layer paths:
 *   phone → watch: "/smartplay/caddie"  (JSON {kind: yardage|notification|voice_prompt|score|state})
 *   watch → phone: "/smartplay/voice"   (UTF-8 transcript)  ·  "/smartplay/hello" (presence)
 *                  "/smartplay/swing"   (capture, from SwingSensorService)
 */

package com.smartplaycaddie.wear

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.ActivityCompat
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.Locale

class MainActivity : Activity(), MessageClient.OnMessageReceivedListener {

    companion object {
        private const val TAG = "SmartPlayWear"
        private const val CADDIE_PATH = "/smartplay/caddie"
        private const val VOICE_PATH = "/smartplay/voice"
        private const val HELLO_PATH = "/smartplay/hello"
        private const val REQ_SPEECH = 7001
        private val GREEN = Color.parseColor("#88F700") // canonical SmartPlay neon green
        private val DIM = Color.parseColor("#9AA0A6")
    }

    private var capturing = false
    private var tts: TextToSpeech? = null

    private lateinit var holeLabel: TextView
    private lateinit var yardageBig: TextView
    private lateinit var frontTv: TextView
    private lateinit var backTv: TextView
    private lateinit var status: TextView
    private lateinit var micBtn: Button
    private lateinit var captureBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keep the hero yardage glanceable mid-hole instead of dropping to a blank
        // ambient face the moment the wrist stops moving.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        requestNeededPermissions()
        tts = TextToSpeech(this) { /* ready — best-effort */ }

        setContentView(buildUi())
    }

    /** Build the one-screen UI programmatically. */
    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            // Generous side padding so nothing clips on round watch faces.
            setPadding(dp(16), dp(6), dp(16), dp(6))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }

        val title = TextView(this).apply {
            text = "SmartPlay"
            setTextColor(GREEN)
            letterSpacing = 0.12f
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            gravity = Gravity.CENTER
        }

        holeLabel = TextView(this).apply {
            text = "—"
            setTextColor(DIM)
            letterSpacing = 0.15f
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            gravity = Gravity.CENTER
        }

        // The hero number — middle-of-green yardage. Huge and centered.
        yardageBig = TextView(this).apply {
            text = "—"
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 58f)
            includeFontPadding = false
            gravity = Gravity.CENTER
        }

        // Front / back flanking the hero number, classic rangefinder layout.
        val fbRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(2), 0, dp(8))
        }
        frontTv = TextView(this).apply {
            text = ""
            setTextColor(DIM)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            setPadding(dp(6), 0, dp(6), 0)
        }
        backTv = TextView(this).apply {
            text = ""
            setTextColor(DIM)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            setPadding(dp(6), 0, dp(6), 0)
        }
        fbRow.addView(frontTv)
        fbRow.addView(backTv)

        // Prominent mic button — the primary action.
        micBtn = Button(this).apply {
            text = "Ask caddie"
            setTextColor(Color.BLACK)
            setBackgroundColor(GREEN)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setOnClickListener { startSpeech() }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
        }

        status = TextView(this).apply {
            text = "start a round on the phone"
            setTextColor(DIM)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, 0)
        }

        // Secondary: swing capture toggle, dim so it doesn't compete with the number.
        captureBtn = Button(this).apply {
            text = "Record swings"
            setTextColor(DIM)
            setBackgroundColor(Color.parseColor("#1A1A1A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setOnClickListener { onToggleCapture() }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(6) }
        }

        root.addView(title)
        root.addView(holeLabel)
        root.addView(yardageBig)
        root.addView(fbRow)
        root.addView(micBtn)
        root.addView(status)
        root.addView(captureBtn)
        return root
    }

    override fun onResume() {
        super.onResume()
        runCatching { Wearable.getMessageClient(this).addListener(this) }
        // Presence ping so the phone marks the watch connected on open.
        announcePresence()
    }

    override fun onPause() {
        super.onPause()
        runCatching { Wearable.getMessageClient(this).removeListener(this) }
    }

    // ── Phone → watch ────────────────────────────────────────────────────────
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != CADDIE_PATH) return
        try {
            val json = JSONObject(String(event.data, Charsets.UTF_8))
            runOnUiThread { handleCaddie(json) }
        } catch (t: Throwable) {
            Log.w(TAG, "caddie message parse failed (non-fatal)", t)
        }
    }

    private fun handleCaddie(json: JSONObject) {
        when (json.optString("kind")) {
            "yardage" -> {
                val mid = if (json.isNull("middle")) null else json.optInt("middle")
                val front = if (json.isNull("front")) null else json.optInt("front")
                val back = if (json.isNull("back")) null else json.optInt("back")
                val hole = if (json.isNull("hole")) null else json.optInt("hole")
                yardageBig.text = mid?.toString() ?: "—"
                holeLabel.text = if (hole != null) "HOLE $hole" else "TO THE GREEN"
                frontTv.text = if (front != null) "F $front" else ""
                backTv.text = if (back != null) "B $back" else ""
                // Only clear the "start a round" hint once we have a real read.
                if (mid != null || front != null || back != null) {
                    if (status.text == "start a round on the phone") status.text = ""
                }
            }
            "notification" -> {
                status.text = json.optString("text")
            }
            "voice_prompt" -> {
                val text = json.optString("text")
                if (text.isNotEmpty()) {
                    status.text = text
                    tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sp")
                }
            }
            "score" -> {
                val vs = json.optInt("vsPar")
                status.text = "Score ${if (vs >= 0) "+$vs" else "$vs"}"
            }
            "state" -> {
                if (!json.optBoolean("round_active")) {
                    yardageBig.text = "—"
                    holeLabel.text = "—"
                    frontTv.text = ""
                    backTv.text = ""
                    status.text = "start a round on the phone"
                }
            }
        }
    }

    // ── Watch mic → phone ────────────────────────────────────────────────────
    private fun startSpeech() {
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask your caddie")
            }
            startActivityForResult(intent, REQ_SPEECH)
        } catch (t: Throwable) {
            Log.w(TAG, "speech intent failed", t)
            status.text = "Speech not available"
        }
    }

    @Deprecated("startActivityForResult result path — fine for this single call")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_SPEECH && resultCode == RESULT_OK) {
            val text = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
            if (!text.isNullOrEmpty()) {
                status.text = "“$text”" // “…”
                sendToPhone(VOICE_PATH, text.toByteArray(Charsets.UTF_8))
            }
        }
    }

    // ── Swing capture (unchanged behavior) ───────────────────────────────────
    private fun onToggleCapture() {
        capturing = !capturing
        val svc = Intent(this, SwingSensorService::class.java)
        if (capturing) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc)
            else startService(svc)
            captureBtn.text = "Stop swings"
        } else {
            stopService(svc)
            captureBtn.text = "Record swings"
        }
    }

    /** Presence ping — phone marks the watch connected. Best-effort. */
    private fun announcePresence() {
        sendToPhone(HELLO_PATH, "wear".toByteArray(Charsets.UTF_8))
    }

    /** Send to every connected node (the phone). Best-effort. */
    private fun sendToPhone(path: String, data: ByteArray) {
        val ctx = applicationContext
        Wearable.getNodeClient(ctx).connectedNodes
            .addOnSuccessListener { nodes ->
                val client = Wearable.getMessageClient(ctx)
                for (node in nodes) {
                    client.sendMessage(node.id, path, data)
                        .addOnFailureListener { e -> Log.w(TAG, "send $path failed: ${e.message}") }
                }
            }
            .addOnFailureListener { e -> Log.w(TAG, "connectedNodes failed: ${e.message}") }
    }

    private fun requestNeededPermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(Manifest.permission.HIGH_SAMPLING_RATE_SENSORS) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.HIGH_SAMPLING_RATE_SENSORS)
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            needed.add(Manifest.permission.RECORD_AUDIO)
        if (needed.isNotEmpty()) ActivityCompat.requestPermissions(this, needed.toTypedArray(), 1)
    }

    /** dp → px for programmatic layout. */
    private fun dp(v: Int): Int =
        (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        super.onDestroy()
        runCatching { tts?.shutdown() }
    }
}
