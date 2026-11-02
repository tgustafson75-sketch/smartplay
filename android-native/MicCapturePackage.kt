/**
 * 2026-11-01 — ReactPackage for MicCaptureModule. Registered into MainApplication.kt by
 * plugins/withMicCaptureService.js, wrapped in try/catch like the Bluetooth package.
 */

package com.smartplaycaddie.micfg

import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MicCapturePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return try {
            listOf(MicCaptureModule(reactContext))
        } catch (t: Throwable) {
            Log.e("MicCapturePackage", "createNativeModules failed — bridge will be null", t)
            emptyList()
        }
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
