/**
 * 2026-05-23 — React Native package registration for the Meta
 * Wearables frame module. Register this in MainApplication.kt's
 * getPackages() list so the JS side can see the
 * NativeModules.MetaWearablesFrame native module.
 *
 * After prebuild, MainApplication.kt should add:
 *   override fun getPackages(): List<ReactPackage> {
 *     val packages = PackageList(this).packages
 *     packages.add(com.smartplaycaddy.wearables.MetaWearablesPackage())
 *     return packages
 *   }
 *
 * The withMetaWearablesDAT config plugin does NOT yet auto-edit
 * MainApplication.kt (Expo prebuild owns that file's regen). For the
 * FIRST EAS Build that includes DAT, the recommended path is:
 *   1. Run `eas build --platform android --profile preview`.
 *   2. If MainApplication.kt isn't picking up MetaWearablesPackage
 *      automatically, eject to bare workflow OR add a small inline
 *      plugin step (TODO Tim — next iteration) that injects the
 *      packages.add(...) line at prebuild.
 *
 * Until then this package class compiles and the module functions,
 * but the JS bridge `NativeModules.MetaWearablesFrame` will be null
 * because MainApplication never registers it. We'll close that gap
 * in the next iteration once Tim greenlights the first EAS Build.
 */

package com.smartplaycaddie.wearables

import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * 2026-05-23 — Defensive ReactPackage. If MetaWearablesFrameModule's
 * constructor throws (e.g. Wearables SDK class-load failure due to a
 * missing transitive dep, or a static initializer NPE), this catches
 * the throw + returns an empty module list. MainApplication.onCreate
 * keeps running, the rest of React Native boots cleanly, and only the
 * MetaWearablesFrame bridge is silently absent — JS side already
 * collapses to no-op when NativeModules.MetaWearablesFrame is null.
 *
 * Crash hypothesis (sprint log 2026-05-23): previous APK build's app
 * launch failed because of either the MainApplication regex mismatch
 * (no inject) OR a Wearables SDK init throw during package
 * instantiation. The new MainApplication regex is fixed; this catch
 * is belt-and-suspenders for the second hypothesis.
 */
class MetaWearablesPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return try {
            listOf(MetaWearablesFrameModule(reactContext))
        } catch (t: Throwable) {
            Log.e("MetaWearablesPackage", "createNativeModules failed — bridge will be null", t)
            emptyList()
        }
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
