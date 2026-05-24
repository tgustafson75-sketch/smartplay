/**
 * 2026-05-24 — ReactPackage registration for the BT media-button bridge.
 *
 * Auto-injected into MainApplication.kt by plugins/withBluetoothMediaButton.js
 * inside the PackageList(this).packages.apply { ... } block (Expo SDK 54+
 * template). The plugin wraps the add() in try/catch so a class-load
 * failure can't crash app boot — pattern mirrored from MetaWearablesPackage.
 */

package com.smartplaycaddie.btmedia

import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class BluetoothMediaButtonPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return try {
            listOf(BluetoothMediaButtonModule(reactContext))
        } catch (t: Throwable) {
            Log.e("BTMediaButtonPackage", "createNativeModules failed — bridge will be null", t)
            emptyList()
        }
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
