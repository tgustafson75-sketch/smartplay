/**
 * 2026-06-29 / extended 2026-07-06 — Watch UI (Wear OS). Programmatic (no
 * Compose/XML) to keep the watch APK tiny.
 *
 * Now shows LIVE PIN YARDAGE pushed from the phone (front/middle/back to the green,
 * GPS-live) and a "Ask caddie" mic button: tap → the watch's speech recognizer →
 * the transcript is shipped to the phone, which routes it through the full caddie
 * pipeline and speaks the answer (and can push a spoken prompt / notification back
 * here). The original swing-capture toggle stays.
 *
 * Data Layer paths:
 *   phone → watch: "/smartplay/caddie"  (JSON {kind: yardage|notification|voice_prompt|score|state})
 *   watch → phone: "/smartplay/voice"   (UTF-8 transcript)  ·  "/smartplay/swing" (capture)
 */

package com.smartplaycaddie.wear

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
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
        private const val REQ_SPEECH = 7001
    }

    private var capturing = false
    private var tts: TextToSpeech? = null

    private lateinit var yardageBig: TextView
    private lateinit var yardageSub: TextView
    private lateinit var status: TextView
    private lateinit var micBtn: Button
    private lateinit var captureBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNeededPermissions()
        tts = TextToSpeech(this) { /* ready — best-effort */ }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            setPadding(20, 12, 20, 12)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }

        val title = TextView(this).apply {
            text = "SmartPlay"
            setTextColor(Color.parseColor("#88F700"))
            textSize = 13f
            gravity = Gravity.CENTER
        }
        // Big middle-of-green yardage.
        yardageBig = TextView(this).apply {
            text = "—"
            setTextColor(Color.WHITE)
            textSize = 40f
            gravity = Gravity.CENTER
        }
        yardageSub = TextView(this).apply {
            text = "start a round on the phone"
            setTextColor(Color.parseColor("#AAAAAA"))
            textSize = 11f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 8)
        }
        micBtn = Button(this).apply {
            text = "Ask caddie"
            setOnClickListener { startSpeech() }
        }
        captureBtn = Button(this).apply {
            text = "Record swings"
            textSize = 11f
            setOnClickListener { onToggleCapture() }
        }
        status = TextView(this).apply {
            text = ""
            setTextColor(Color.parseColor("#88F700"))
            textSize = 10f
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 0)
        }

        root.addView(title)
        root.addView(yardageBig)
        root.addView(yardageSub)
        root.addView(micBtn)
        root.addView(captureBtn)
        root.addView(status)
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        runCatching { Wearable.getMessageClient(this).addListener(this) }
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
                val parts = mutableListOf<String>()
                if (front != null) parts.add("F $front")
                if (back != null) parts.add("B $back")
                if (hole != null) parts.add("Hole $hole")
                yardageSub.text = if (parts.isEmpty()) "to the middle" else parts.joinToString(" · ")
            }
            "notification" -> {
                status.text = json.optString("text")
            }
            "voice_prompt" -> {
                val text = json.optString("text")
                if (text.isNotEmpty()) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sp")
            }
            "score" -> {
                val vs = json.optInt("vsPar")
                status.text = "Score ${if (vs >= 0) "+$vs" else "$vs"}"
            }
            "state" -> {
                if (!json.optBoolean("round_active")) {
                    yardageBig.text = "—"
                    yardageSub.text = "start a round on the phone"
                }
            }
        }
    }

    // ── Watch mic → phone ────────────────────────────────────────────────────
    private fun startSpeech() {
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
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
                status.text = "\"$text\""
                sendToPhone(VOICE_PATH, text.toByteArray(Charsets.UTF_8))
            }
        }
    }

    // ── Swing capture (unchanged) ────────────────────────────────────────────
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

    override fun onDestroy() {
        super.onDestroy()
        runCatching { tts?.shutdown() }
    }
}
