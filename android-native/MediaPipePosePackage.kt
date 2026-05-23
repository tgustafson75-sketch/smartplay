/**
 * 2026-05-23 — ReactPackage for the MediaPipe pose module. Registered
 * into MainApplication.kt's getPackages() by withMediaPipePose.js at
 * prebuild time.
 */

package com.smartplaycaddy.mediapipe

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MediaPipePosePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(MediaPipePoseModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
