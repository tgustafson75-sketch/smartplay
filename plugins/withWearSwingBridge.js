/**
 * 2026-06-29 — Expo config plugin: Wear OS swing-bridge native module (phone side).
 *
 * What this plugin does at prebuild time:
 *   1. Copies WearSwingBridge{Module,Package}.kt from android-native/ into
 *      the prebuilt tree at com.smartplaycaddie.wearbridge.
 *   2. Adds the play-services-wearable dependency to app/build.gradle
 *      (Google Maven — no GitHub token / private repo).
 *   3. Injects `add(WearSwingBridgePackage())` into the
 *      PackageList(this).packages.apply { ... } block in MainApplication.kt,
 *      wrapped in try/catch so a class-load failure can't crash boot.
 *
 * No new manifest permissions: the Wearable Data Layer (MessageClient) on
 * the PHONE side requires none. (The watch app declares its own sensor +
 * foreground-service permissions in wear-os-app/.)
 *
 * Mirrors withBluetoothMediaButton.js — the canonical native-module
 * pattern in this repo. Every step is wrapped so any failure is non-fatal:
 * the module is simply absent at runtime and services/watchSwingBridge.ts
 * gracefully no-ops, leaving the phone APK build + boot unaffected.
 */

const {
  withMainApplication,
  withAppBuildGradle,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const WEARABLE_DEP = 'com.google.android.gms:play-services-wearable';
const WEARABLE_VERSION = '18.2.0';

// ─── Step 1: copy Kotlin sources ────────────────────────────────────
function withSourceCopy(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const pkgPath = path.join(
        platformRoot,
        'app', 'src', 'main', 'java', 'com', 'smartplaycaddie', 'wearbridge',
      );
      const sourceDir = path.join(projectRoot, 'android-native');
      const files = ['WearSwingBridgeModule.kt', 'WearSwingBridgePackage.kt'];
      try {
        if (!fs.existsSync(pkgPath)) fs.mkdirSync(pkgPath, { recursive: true });
        for (const f of files) {
          const src = path.join(sourceDir, f);
          const dst = path.join(pkgPath, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        }
        console.log('[withWearSwingBridge] Android sources copied');
      } catch (e) {
        console.warn('[withWearSwingBridge] Android source copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);
}

// ─── Step 2: add the Wearable Data Layer gradle dependency ──────────
function withWearableGradleDep(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    try {
      const contents = gradleConfig.modResults.contents;
      if (typeof contents !== 'string' || contents.includes(WEARABLE_DEP)) {
        return gradleConfig;
      }
      const dep = `\n    implementation("${WEARABLE_DEP}:${WEARABLE_VERSION}")`;
      gradleConfig.modResults.contents = contents.replace(
        /(dependencies\s*\{)/,
        `$1${dep}`,
      );
      console.log('[withWearSwingBridge] play-services-wearable dep added');
    } catch (e) {
      console.warn('[withWearSwingBridge] gradle dep add failed (non-fatal):', e.message);
    }
    return gradleConfig;
  });
}

// ─── Step 3: inject package into MainApplication.kt ─────────────────
function withPackageInjection(config) {
  return withMainApplication(config, (mainAppConfig) => {
    try {
      const contents = mainAppConfig?.modResults?.contents;
      if (typeof contents !== 'string' || contents.length === 0) {
        console.warn(
          '[withWearSwingBridge] WARNING: MainApplication contents not a string (got ' +
          typeof contents + ') — skipping injection. Module will be null at runtime.',
        );
        return mainAppConfig;
      }
      const marker = 'WearSwingBridgePackage()';
      if (contents.includes(marker)) return mainAppConfig;

      const applyRegex = /(PackageList\(this\)\.packages\.apply\s*\{)/;
      const valLineRegex = /(val\s+packages\s*=\s*PackageList\(this\)\.packages)/;

      let updated = null;
      if (applyRegex.test(contents)) {
        updated = contents.replace(
          applyRegex,
          (match) =>
            `${match}
              // Auto-injected by withWearSwingBridge.js — try/catch so a
              // class-load failure never crashes MainApplication.
              try {
                add(com.smartplaycaddie.wearbridge.WearSwingBridgePackage())
              } catch (t: Throwable) {
                android.util.Log.e("MainApplication", "WearSwingBridgePackage failed to load — continuing without it", t)
              }`,
        );
        console.log('[withWearSwingBridge] injected package into MainApplication.kt (apply-block)');
      } else if (valLineRegex.test(contents)) {
        updated = contents.replace(
          valLineRegex,
          (match) =>
            `${match}
            // Auto-injected by withWearSwingBridge.js — try/catch
            try {
              packages.add(com.smartplaycaddie.wearbridge.WearSwingBridgePackage())
            } catch (t: Throwable) {
              android.util.Log.e("MainApplication", "WearSwingBridgePackage failed to load — continuing without it", t)
            }`,
        );
        console.log('[withWearSwingBridge] injected package into MainApplication.kt (val template)');
      } else {
        console.warn(
          '[withWearSwingBridge] WARNING: MainApplication.kt template did not match either known shape. ' +
          'NativeModules.WearSwingBridge will be null at runtime.',
        );
      }
      if (updated != null) {
        mainAppConfig.modResults.contents = updated;
      }
      return mainAppConfig;
    } catch (e) {
      console.warn(
        '[withWearSwingBridge] ERROR during MainApplication injection: ' +
        (e && e.message ? e.message : String(e)) +
        ' — skipping. Module will be null at runtime, APK build continues.',
      );
      return mainAppConfig;
    }
  });
}

function withWearSwingBridge(config) {
  let next = config;
  next = withSourceCopy(next);
  next = withWearableGradleDep(next);
  next = withPackageInjection(next);
  return next;
}

module.exports = withWearSwingBridge;
