/**
 * 2026-11-01 — JS bridge for MicCaptureService. See that file for why the service exists and when
 * it may start. Both methods resolve (never reject) so a refused start is just `false`, and the
 * JS caller in services/micCaptureService.ts treats false as "no lock-screen capture", not an error.
 */

package com.smartplaycaddie.micfg

import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MicCaptureModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val tag = "MicCapture"

    override fun getName(): String = "MicCapture"

    @ReactMethod
    fun startMicForeground(promise: Promise) {
        try {
            reactContext.startForegroundService(Intent(reactContext, MicCaptureService::class.java))
            promise.resolve(true)
        } catch (t: Throwable) {
            // SecurityException here means the start came from the background, or RECORD_AUDIO is
            // not granted yet. Both are answers, not crashes.
            Log.w(tag, "startMicForeground refused: ${t.message}")
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun stopMicForeground(promise: Promise) {
        try {
            reactContext.stopService(Intent(reactContext, MicCaptureService::class.java))
            promise.resolve(true)
        } catch (t: Throwable) {
            Log.w(tag, "stopMicForeground failed: ${t.message}")
            promise.resolve(false)
        }
    }
}
