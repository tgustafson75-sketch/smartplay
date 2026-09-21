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
 *   │   · Record Swing ·│   (secondary swing-capture toggle)
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
import android.widget.HorizontalScrollView
import android.widget.ScrollView
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
        /**
         * 2026-09-09 — the watch asking the PHONE to do something.
         *
         * The 08-07 feature ("record button on the watch to control SmartMotion record + stop") was
         * wired in the phone's JS and nowhere else: no path on the phone's native module, and no
         * sender here. Only the middle of the feature existed.
         */
        private const val COMMAND_PATH = "/smartplay/command"
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
    // Drill-feedback strip — a horizontally scrollable row of per-swing metric cards (2026-07-29).
    private lateinit var feedbackScroll: HorizontalScrollView
    private lateinit var feedbackRow: LinearLayout
    private lateinit var fbRow: LinearLayout

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
            /**
             * CENTER, not CENTER_HORIZONTAL. With `isFillViewport` the root is stretched to the
             * viewport whenever the content is shorter than it, so vertical centring is what keeps
             * a larger face (Galaxy Watch 4+ is 450x450) looking exactly as it did before the
             * scroll container existed. Measured: with CENTER_HORIZONTAL the stack packed to the
             * top and the capture button landed at y=417..450 — flush with the very bottom of the
             * frame, which on a ROUND face is where the chord narrows to nothing, so it would have
             * been sliced by the mask. Trading one clipped button for another is not a fix.
             */
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            /**
             * 2026-09-21 — THE BOTTOM OF THIS SCREEN DID NOT EXIST ON A SMALL ROUND WATCH.
             *
             * The old comment here said "generous side padding so nothing clips on round watch
             * faces" and handled the HORIZONTAL axis only. Vertically this was a MATCH_PARENT
             * LinearLayout with eight stacked children and no scroll container, so anything past
             * the fold was simply never laid out.
             *
             * Measured on a 384x384 round face (Wear OS 5 emulator, uiautomator dump, not by eye):
             *   ASK CADDIE            [32,263][352,359]
             *   "start a round on…"   [32,359][352,366]   clipped to 7px
             *   Record swings         ABSENT FROM THE HIERARCHY ENTIRELY
             *
             * So the swing-capture toggle could not be tapped, and the long-press that drives
             * SmartMotion on the phone — shipped earlier today — was unreachable on that face. The
             * status line that reports "Phone not reachable" was invisible too, which means the
             * honest-failure fix from this morning could not be seen either. Three things built,
             * correct, and out of reach. This is native: no OTA could have corrected it.
             *
             * Bottom padding is deliberately larger than the top: on a round face the lower chord
             * narrows, so the last child needs room to clear the curve.
             */
            setPadding(dp(16), dp(6), dp(16), dp(20))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
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
        fbRow = LinearLayout(this).apply {
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

        // Drill-feedback strip: swipe side-to-side through per-swing metric cards. Hidden until a
        // swing_feedback message arrives; takes the hero slot (yardage) while a drill is in progress.
        feedbackRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        feedbackScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            visibility = View.GONE
            // Side padding so the first/last card can center on a round face.
            setPadding(dp(24), 0, dp(24), 0)
            clipToPadding = false
            addView(feedbackRow)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
        }

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
            /**
             * 2026-09-21 (Tim: "Or just Record Swing") — two lines became one.
             *
             * It read "Record swings / hold -> SmartMotion", which put a gesture hint on a 1.4-inch
             * control and made the button the noisiest thing on a screen whose hero is a yardage
             * number. Two words now.
             *
             * WHAT THAT COSTS, written down rather than discovered later: the long-press that
             * toggles SmartMotion on the phone is no longer announced anywhere, and the note this
             * label replaced argued that an undiscoverable gesture is the same as no feature. The
             * gesture still works. If it should be findable, the cheap fix is a swing icon beside
             * the word rather than a second line of text.
             */
            text = "Record Swing"
            /**
             * The icon Tim asked for, in place of the second line of text it replaced. Set as a
             * COMPOUND drawable rather than a separate ImageView so the icon and label stay one
             * tap target and one baseline — a second view here would need its own layout params on
             * a face where vertical space is the scarce thing.
             *
             * Tinted to the button's own DIM colour so it reads as secondary next to the green
             * mic, and re-tinted on toggle with the text.
             */
            setCompoundDrawablesRelativeWithIntrinsicBounds(
                androidx.core.content.ContextCompat.getDrawable(context, R.drawable.ic_swing), null, null, null,
            )
            compoundDrawablePadding = dp(8)
            compoundDrawableTintList = android.content.res.ColorStateList.valueOf(DIM)
            setTextColor(DIM)
            setBackgroundColor(Color.parseColor("#1A1A1A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setOnClickListener { onToggleCapture() }
            /**
             * 2026-09-09 — LONG-PRESS drives SmartMotion on the phone.
             *
             * Deliberately a long-press on the button that already means "record", rather than a
             * third button: this watch face is 1.4 inches and already carries a mic, a yardage
             * number, a feedback strip and this toggle. Two different recordings needed separating,
             * not crowding — a tap still starts the WATCH's own swing sensor, a long-press toggles
             * the PHONE's SmartMotion capture.
             *
             * The label says so, because an undiscoverable gesture is the same as no feature. If Tim
             * would rather have a separate button, this is the one line to move.
             */
            setOnLongClickListener {
                /**
                 * 2026-09-21 — say "sending", then say what actually happened.
                 *
                 * This set the success text immediately and unconditionally, so a player whose
                 * phone was in the cart, asleep or swiped away got "SmartMotion -> phone" and
                 * nothing else — they hold again, it says the same thing again. The wrist is the
                 * only feedback surface here, so a confident wrong answer on it is the whole
                 * failure.
                 */
                status.text = "Sending\u2026"
                sendToPhone(COMMAND_PATH, "smartmotion_toggle".toByteArray(Charsets.UTF_8)) { ok ->
                    runOnUiThread {
                        status.text = if (ok) "SmartMotion \u2192 phone" else "Phone not reachable"
                    }
                }
                true
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(6) }
        }

        root.addView(title)
        root.addView(holeLabel)
        root.addView(yardageBig)
        root.addView(fbRow)
        root.addView(feedbackScroll)
        root.addView(micBtn)
        root.addView(status)
        root.addView(captureBtn)

        /**
         * The scroll container is the fix. A watch face is small and this screen is deliberately
         * dense (title, hole, yardage, front/back, drill strip, mic, status, capture) — the answer
         * is to let the player reach the rest, not to delete a feature to make the pixels fit.
         *
         * `isFillViewport` keeps the content vertically centred when it DOES fit, so nothing
         * changes on a larger face (Galaxy Watch 4+ is 450x450) — it only starts scrolling where it
         * previously truncated.
         */
        return ScrollView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            addView(
                root,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
    }

    /** One metric card for the drill strip: icon glyph · big value · dim label. */
    private fun metricCard(icon: String, value: String, label: String, accent: Boolean): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(6), dp(8), dp(6), dp(8))
            setBackgroundColor(Color.parseColor("#141414"))
            layoutParams = LinearLayout.LayoutParams(dp(92), ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { marginEnd = dp(6) }
        }
        card.addView(TextView(this).apply {
            text = icon
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            gravity = Gravity.CENTER
        })
        card.addView(TextView(this).apply {
            text = value
            setTextColor(if (accent) GREEN else Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            includeFontPadding = false
            gravity = Gravity.CENTER
        })
        card.addView(TextView(this).apply {
            text = label
            setTextColor(DIM)
            letterSpacing = 0.08f
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 9f)
            gravity = Gravity.CENTER
        })
        return card
    }

    /** Enter drill-feedback mode: build the metric cards for this swing + show the strip. */
    private fun showSwingFeedback(json: JSONObject) {
        val club = json.optString("club", "—")
        val tempo = json.optDouble("tempoRatio", 0.0)
        val speed = json.optInt("clubSpeed", 0)
        val transition = json.optString("transition", "unknown")
        val back = json.optInt("backswingMs", 0)
        val down = json.optInt("downswingMs", 0)
        val flushed = json.optBoolean("flushed", false)
        val wrist = json.optString("wrist", "lead")
        val faultHint = if (json.isNull("faultHint")) "" else json.optString("faultHint", "")

        feedbackRow.removeAllViews()
        feedbackRow.addView(metricCard("🏌", if (club.isBlank() || club == "unknown") "—" else club, "CLUB", false))
        feedbackRow.addView(metricCard("⏱", if (tempo > 0) String.format(Locale.US, "%.1f:1", tempo) else "—", "TEMPO", flushed))
        feedbackRow.addView(metricCard("⚡", if (speed > 0) "$speed" else "—", "MPH", false))
        val transLabel = when (transition) {
            "smooth" -> "Smooth"; "quick" -> "Quick"; "early" -> "Early"; else -> "—"
        }
        feedbackRow.addView(metricCard("🔄", transLabel, "TRANS", transition == "smooth"))
        feedbackRow.addView(metricCard("⬆", if (back > 0) "$back" else "—", "BACK ms", false))
        feedbackRow.addView(metricCard("⬇", if (down > 0) "$down" else "—", "DOWN ms", false))

        holeLabel.text = "LAST SWING · ${if (wrist == "trail") "TRAIL" else "LEAD"}"
        yardageBig.visibility = View.GONE
        fbRow.visibility = View.GONE
        feedbackScroll.visibility = View.VISIBLE
        feedbackScroll.scrollTo(0, 0)
        // Prefer the hedged lead/trail coaching hint; fall back to a simple flushed/logged line.
        status.text = if (faultHint.isNotEmpty()) faultHint else if (flushed) "Flushed it" else "Logged"
    }

    /** Leave drill-feedback mode → restore the on-course yardage hero. */
    private fun exitFeedbackMode() {
        if (feedbackScroll.visibility == View.VISIBLE) {
            feedbackScroll.visibility = View.GONE
            yardageBig.visibility = View.VISIBLE
            fbRow.visibility = View.VISIBLE
        }
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
            "swing_feedback" -> showSwingFeedback(json)
            "yardage" -> {
                exitFeedbackMode() // a fresh yardage push means we're back on the course
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
                if (json.optBoolean("round_active")) {
                    exitFeedbackMode() // round resumed → yardage view
                } else {
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
            // 2026-09-21 — the 09-09 note here argued for keeping the long-press hint on BOTH
            // states. The hint is gone from the label entirely now (see the button's own comment),
            // so there is nothing left to keep on both — the two states are just Record / Stop.
            captureBtn.text = "Stop Swing"
        } else {
            stopService(svc)
            captureBtn.text = "Record Swing"
        }
    }

    /** Presence ping — phone marks the watch connected. Best-effort. */
    private fun announcePresence() {
        sendToPhone(HELLO_PATH, "wear".toByteArray(Charsets.UTF_8))
    }

    /**
     * Send to every connected node (the phone). Best-effort, but no longer SILENTLY best-effort.
     *
     * 2026-09-21 — `onDelivered` exists because a fire-and-forget send let the UI lie. The
     * long-press handler set "SmartMotion -> phone" on the line after calling this, before any
     * result could exist, and nothing ever cleared it: with no node connected the loop body never
     * ran, with a failed send only Log.w fired, and the watch told the player it had done
     * something either way. On a 1.4-inch screen that message IS the entire feedback.
     *
     * It matters more here than the usual fire-and-forget, because there is no
     * WearableListenerService on the phone: onWatchCommand only arrives while the RN process is
     * alive, so "phone app not running" is a common state, not an edge case, and it produces
     * exactly the silent no-op that the old status text called a success.
     *
     * Callers that do not care pass null and behave as before.
     */
    private fun sendToPhone(path: String, data: ByteArray, onDelivered: ((Boolean) -> Unit)? = null) {
        val ctx = applicationContext
        Wearable.getNodeClient(ctx).connectedNodes
            .addOnSuccessListener { nodes ->
                if (nodes.isEmpty()) {
                    Log.w(TAG, "send $path: no connected node")
                    onDelivered?.invoke(false)
                    return@addOnSuccessListener
                }
                val client = Wearable.getMessageClient(ctx)
                // One success is delivery: the phone is a single node in practice, and reporting
                // failure because a second paired node refused would be its own wrong answer.
                var reported = false
                for (node in nodes) {
                    client.sendMessage(node.id, path, data)
                        .addOnSuccessListener {
                            if (!reported) { reported = true; onDelivered?.invoke(true) }
                        }
                        .addOnFailureListener { e ->
                            Log.w(TAG, "send $path failed: ${e.message}")
                            if (!reported) { reported = true; onDelivered?.invoke(false) }
                        }
                }
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "connectedNodes failed: ${e.message}")
                onDelivered?.invoke(false)
            }
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
