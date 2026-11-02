/**
 * 2026-11-01 — Microphone foreground service (Android).
 *
 * Why it exists: on Android a background app's microphone can be cut off or read as silence once
 * the screen locks. A foreground service of type `microphone` keeps the capture legal and visible
 * (the persistent notification below is the price). An earbud tap with the phone locked mid-round
 * is the case this exists for.
 *
 * Android 14+ refuses to START a microphone foreground service from the background in most cases.
 * So the JS caller starts it at round start, while the app is on screen, and it stays up until the
 * round ends. A start refused for that reason returns false from MicCaptureModule and the app keeps
 * working as before, without the lock-screen guarantee.
 *
 * Declared in the manifest by plugins/withMicCaptureService.js with
 * android:foregroundServiceType="microphone"; the matching FOREGROUND_SERVICE_MICROPHONE permission
 * is also declared there. Play requires a foreground-service declaration for this type.
 */

package com.smartplaycaddie.micfg

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder

class MicCaptureService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Caddie listening", NotificationManager.IMPORTANCE_LOW),
        )
        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("SmartPlay Caddie is listening")
            .setContentText("Your caddie can hear earbud taps during the round")
            .setOngoing(true)
            .build()
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        return START_NOT_STICKY
    }

    companion object {
        const val CHANNEL_ID = "caddie_listening"
        const val NOTIFICATION_ID = 4107
    }
}
