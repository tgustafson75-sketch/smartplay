/**
 * 2026-06-29 — ReactPackage registration for the Wear OS swing bridge.
 *
 * Auto-injected into MainApplication.kt by plugins/withWearSwingBridge.js
 * inside the PackageList(this).packages.apply { ... } block. The add() is
 * wrapped in try/catch by the plugin, AND construction is wrapped here, so
 * a missing play-services-wearable class can never crash app boot —
 * NativeModules.WearSwingBridge simply stays null and the JS layer no-ops.
 * Pattern mirrored from BluetoothMediaButtonPackage.
 */

package com.smartplaycaddie.wearbridge

import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class WearSwingBridgePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return try {
            listOf(WearSwingBridgeModule(reactContext))
        } catch (t: Throwable) {
            Log.e("WearSwingBridgePackage", "createNativeModules failed — bridge will be null", t)
            emptyList()
        }
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
