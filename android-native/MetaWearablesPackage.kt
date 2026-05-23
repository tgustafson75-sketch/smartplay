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

package com.smartplaycaddy.wearables

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MetaWearablesPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(MetaWearablesFrameModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
