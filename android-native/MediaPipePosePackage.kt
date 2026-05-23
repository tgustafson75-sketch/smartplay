/**
 * 2026-05-23 — ReactPackage for the MediaPipe pose module. Registered
 * into MainApplication.kt's getPackages() by withMediaPipePose.js at
 * prebuild time.
 */

package com.smartplaycaddie.mediapipe

import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * 2026-05-23 — Defensive ReactPackage. MediaPipe's `tasks-vision`
 * AAR has known static-initializer + native-library-load surfaces
 * that can throw on certain device/arch combinations. Catching here
 * lets MainApplication keep booting even if MediaPipe init fails;
 * JS side (`mediaPipePoseService.ts`) treats the absent bridge as
 * "fall back to cloud" — exactly the seam poseEstimator was built
 * around. Same defensive shape as MetaWearablesPackage.
 */
class MediaPipePosePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return try {
            listOf(MediaPipePoseModule(reactContext))
        } catch (t: Throwable) {
            Log.e("MediaPipePosePackage", "createNativeModules failed — bridge will be null", t)
            emptyList()
        }
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
