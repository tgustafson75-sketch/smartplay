/**
 * 2026-06-29 — Foreground sensor service (Wear OS, runs ON the watch).
 *
 * Owns the accelerometer + gyroscope listeners, feeds samples into
 * SwingDetector, and ships each completed swing to the paired PHONE via
 * the Wearable Data Layer (MessageClient, path "/smartplay/swing").
 *
 * Foreground service: high-rate sensors must keep running while the
 * watch screen is off mid-shot, so we post an ongoing notification.
 *
 * Data Layer pairing requirement (READ THIS):
 *   The Data Layer only auto-associates the phone app and this watch app
 *   when BOTH share the SAME applicationId (com.smartplaycaddie.app) AND
 *   are signed with the SAME signing key. See wear-os-app/README.md.
 */

package com.smartplaycaddie.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

class SwingSensorService : Service(), SensorEventListener {

    companion object {
        private const val TAG = "SwingSensorService"
        private const val CHANNEL_ID = "smartplay_swing_capture"
        private const val NOTIF_ID = 4201
        const val SWING_PATH = "/smartplay/swing"
        const val HELLO_PATH = "/smartplay/hello"
        // 200 Hz (5000 µs). At/below 200 Hz, HIGH_SAMPLING_RATE_SENSORS is
        // not strictly required, but we declare it for headroom on watches
        // that round up. SENSOR_DELAY_FASTEST is the fallback hint.
        private const val SAMPLING_PERIOD_US = 5000
    }

    private lateinit var sensorManager: SensorManager
    private var accel: Sensor? = null
    private var gyro: Sensor? = null
    private lateinit var detector: SwingDetector

    override fun onCreate() {
        super.onCreate()
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        gyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        detector = SwingDetector(onSwing = ::sendSwing)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())
        registerSensors()
        announcePresence()
        return START_STICKY
    }

    private fun registerSensors() {
        accel?.let { sensorManager.registerListener(this, it, SAMPLING_PERIOD_US) }
        gyro?.let { sensorManager.registerListener(this, it, SAMPLING_PERIOD_US) }
        if (accel == null || gyro == null) {
            Log.w(TAG, "Missing sensor — accel=$accel gyro=$gyro; swing capture degraded")
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        // event.timestamp is nanos since boot; convert to ms for the detector.
        val tMs = event.timestamp / 1_000_000L
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER ->
                detector.onAccel(event.values[0], event.values[1], event.values[2])
            Sensor.TYPE_GYROSCOPE ->
                detector.onGyro(event.values[0], event.values[1], event.values[2], tMs)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { /* no-op */ }

    /** Ship a completed swing to the phone via the Data Layer. */
    private fun sendSwing(swing: Swing) {
        val json = JSONObject().apply {
            put("backswingMs", swing.backswingMs)
            put("downswingMs", swing.downswingMs)
            put("tempoRatio", swing.tempoRatio)
            put("peakWristSpeed", swing.peakWristSpeed)
            put("wristAcceleration", swing.wristAcceleration)
            put("impactAcceleration", swing.impactAcceleration)
            put("transitionDetected", swing.transitionDetected)
            put("earlyTransition", swing.earlyTransition)
            put("tempoGood", swing.tempoGood)
            put("clubHeadSpeedEst", swing.clubHeadSpeedEstMph)
            put("capturedAtMs", System.currentTimeMillis())
        }
        broadcastToNodes(SWING_PATH, json.toString().toByteArray())
        Log.i(TAG, "swing sent → tempo=${swing.tempoRatio} clubMph=${swing.clubHeadSpeedEstMph}")
    }

    private fun announcePresence() {
        broadcastToNodes(HELLO_PATH, "wear".toByteArray())
    }

    /** Send a message to every connected node (the phone). Best-effort. */
    private fun broadcastToNodes(path: String, data: ByteArray) {
        val ctx = applicationContext
        Wearable.getNodeClient(ctx).connectedNodes
            .addOnSuccessListener { nodes ->
                val client = Wearable.getMessageClient(ctx)
                for (node in nodes) {
                    client.sendMessage(node.id, path, data)
                        .addOnFailureListener { e ->
                            Log.w(TAG, "sendMessage to ${node.id} failed (non-fatal): ${e.message}")
                        }
                }
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "connectedNodes failed (non-fatal): ${e.message}")
            }
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(
                CHANNEL_ID, "Swing capture", NotificationManager.IMPORTANCE_LOW,
            )
            nm.createNotificationChannel(ch)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL_ID)
        else
            @Suppress("DEPRECATION") Notification.Builder(this)
        return builder
            .setContentTitle("SmartPlay")
            .setContentText("Capturing swing motion")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        runCatching { sensorManager.unregisterListener(this) }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
