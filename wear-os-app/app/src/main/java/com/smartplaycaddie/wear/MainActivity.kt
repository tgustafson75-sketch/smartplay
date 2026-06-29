/**
 * 2026-06-29 — Watch UI (Wear OS). Minimal by design: one button to
 * arm/disarm swing capture + a status line. UI is built programmatically
 * to avoid pulling in Compose-Wear / XML-layout dependencies — keeps the
 * watch APK tiny and the build dependency-light.
 *
 * Capture runs in SwingSensorService (foreground) so it survives the
 * screen turning off between address and impact.
 */

package com.smartplaycaddie.wear

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.ActivityCompat

class MainActivity : Activity() {

    private var capturing = false
    private lateinit var status: TextView
    private lateinit var toggle: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNeededPermissions()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            setPadding(24, 24, 24, 24)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }

        val title = TextView(this).apply {
            text = "SmartPlay"
            setTextColor(Color.parseColor("#88F700"))
            textSize = 18f
            gravity = Gravity.CENTER
        }
        status = TextView(this).apply {
            text = "Tap to capture swings"
            setTextColor(Color.WHITE)
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 16)
        }
        toggle = Button(this).apply {
            text = "Start"
            setOnClickListener { onToggle() }
        }

        root.addView(title)
        root.addView(status)
        root.addView(toggle)
        setContentView(root)
    }

    private fun onToggle() {
        capturing = !capturing
        val svc = Intent(this, SwingSensorService::class.java)
        if (capturing) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc)
            else startService(svc)
            toggle.text = "Stop"
            status.text = "Capturing — swing away"
        } else {
            stopService(svc)
            toggle.text = "Start"
            status.text = "Stopped"
        }
    }

    private fun requestNeededPermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(Manifest.permission.HIGH_SAMPLING_RATE_SENSORS)
                != PackageManager.PERMISSION_GRANTED
            ) needed.add(Manifest.permission.HIGH_SAMPLING_RATE_SENSORS)
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 1)
        }
    }
}
