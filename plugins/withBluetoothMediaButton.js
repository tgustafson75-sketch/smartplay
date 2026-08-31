/**
 * 2026-05-24 — Expo config plugin: Bluetooth media-button native bridge.
 *
 * What this plugin does at prebuild time:
 *   1. Copies the Kotlin sources from android-native/ into the prebuilt
 *      Android tree at the matching package path
 *      (com.smartplaycaddie.btmedia).
 *   2. Injects `add(BluetoothMediaButtonPackage())` into the
 *      PackageList(this).packages.apply { ... } block in
 *      MainApplication.kt, wrapped in try/catch so a class-load
 *      failure can't crash app boot.
 *   3. Copies the Swift + Obj-C sources from ios-native/ into the
 *      prebuilt iOS project at ios/SmartPlayCaddie/BTMedia/. Xcode
 *      picks them up via the "auto-add new files" project setting
 *      Expo configures.
 *
 * No external native deps:
 *   Android: only android.media.session.MediaSession (API 21+, SDK).
 *   iOS:     only MediaPlayer + AVFoundation (system frameworks).
 *   → No Maven repo, no Podfile entries, no manifest permission adds.
 *     (Bluetooth perms already added by withMetaWearablesDAT.js.)
 *
 * Mirrors the structure of withMetaWearablesDAT.js for consistency —
 * Tim's note in that plugin is the canonical pattern for native
 * modules in this repo.
 */

const {
  withMainApplication,
  withDangerousMod,
  withXcodeProject,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── Android: copy Kotlin sources + inject package ─────────────────
function withAndroidSourceCopyAndInjection(config) {
  // Step 1: copy Kotlin sources into the prebuilt tree under the
  // matching package path.
  const next = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const pkgPath = path.join(
        platformRoot,
        'app', 'src', 'main', 'java', 'com', 'smartplaycaddie', 'btmedia',
      );
      const sourceDir = path.join(projectRoot, 'android-native');
      const files = ['BluetoothMediaButtonModule.kt', 'BluetoothMediaButtonPackage.kt'];
      try {
        if (!fs.existsSync(pkgPath)) fs.mkdirSync(pkgPath, { recursive: true });
        for (const f of files) {
          const src = path.join(sourceDir, f);
          const dst = path.join(pkgPath, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        }
        console.log('[withBluetoothMediaButton] Android sources copied');
      } catch (e) {
        console.warn('[withBluetoothMediaButton] Android source copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);

  // Step 2: inject package registration into MainApplication.kt,
  // matching Expo SDK 54+ `.apply { ... }` template. Wrapped in
  // try/catch so a class-load failure logs and continues.
  return withMainApplication(next, (mainAppConfig) => {
    // 2026-05-25 — Hardened against SDK-54 / mod-pipeline surprises.
    // The earlier version called .includes() / .replace() on
    // mainAppConfig.modResults.contents WITHOUT checking the shape —
    // when the mod runner passed a different object or contents was
    // not a string, prebuild threw and killed the entire APK build at
    // the 48-second mark (failure in expo prebuild). Wrap the whole
    // injection body in try/catch so any failure logs + returns the
    // unmodified config. The BT package will simply not be wired up
    // at runtime (NativeModules.BluetoothMediaButton stays null and
    // services/voiceTriggers.ts gracefully no-ops), but the APK
    // builds and ships.
    try {
      const contents = mainAppConfig?.modResults?.contents;
      if (typeof contents !== 'string' || contents.length === 0) {
        console.warn(
          '[withBluetoothMediaButton] WARNING: MainApplication contents not a string (got ' +
          typeof contents + ') — skipping package injection. BT module will be null at runtime.',
        );
        return mainAppConfig;
      }
      const marker = 'BluetoothMediaButtonPackage()';
      if (contents.includes(marker)) return mainAppConfig;

      const applyRegex = /(PackageList\(this\)\.packages\.apply\s*\{)/;
      const valLineRegex = /(val\s+packages\s*=\s*PackageList\(this\)\.packages)/;

      let updated = null;
      if (applyRegex.test(contents)) {
        updated = contents.replace(
          applyRegex,
          (match) =>
            `${match}
              // Auto-injected by withBluetoothMediaButton.js — try/catch
              // so a class-load failure never crashes MainApplication.
              try {
                add(com.smartplaycaddie.btmedia.BluetoothMediaButtonPackage())
              } catch (t: Throwable) {
                android.util.Log.e("MainApplication", "BluetoothMediaButtonPackage failed to load — continuing without it", t)
              }`,
        );
        console.log('[withBluetoothMediaButton] injected package into MainApplication.kt (apply-block)');
      } else if (valLineRegex.test(contents)) {
        updated = contents.replace(
          valLineRegex,
          (match) =>
            `${match}
            // Auto-injected by withBluetoothMediaButton.js — try/catch
            try {
              packages.add(com.smartplaycaddie.btmedia.BluetoothMediaButtonPackage())
            } catch (t: Throwable) {
              android.util.Log.e("MainApplication", "BluetoothMediaButtonPackage failed to load — continuing without it", t)
            }`,
        );
        console.log('[withBluetoothMediaButton] injected package into MainApplication.kt (val template)');
      } else {
        console.warn(
          '[withBluetoothMediaButton] WARNING: MainApplication.kt template did not match either known shape. ' +
          'NativeModules.BluetoothMediaButton will be null at runtime.',
        );
      }
      if (updated != null) {
        mainAppConfig.modResults.contents = updated;
      }
      return mainAppConfig;
    } catch (e) {
      console.warn(
        '[withBluetoothMediaButton] ERROR during MainApplication injection: ' +
        (e && e.message ? e.message : String(e)) +
        ' — skipping. BT module will be null at runtime, APK build continues.',
      );
      return mainAppConfig;
    }
  });
}

// ─── iOS: copy Swift + Obj-C bridge ─────────────────────────────────
function withIOSSourceCopy(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const sourceDir = path.join(projectRoot, 'ios-native');
      const targetDir = path.join(platformRoot, 'SmartPlayCaddie', 'BTMedia');
      const files = ['BluetoothMediaButtonModule.swift', 'BluetoothMediaButton.m'];
      try {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        for (const f of files) {
          const src = path.join(sourceDir, f);
          const dst = path.join(targetDir, f);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
          }
        }
        console.log('[withBluetoothMediaButton] iOS sources copied');
      } catch (e) {
        console.warn('[withBluetoothMediaButton] iOS source copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);
}

// ─── iOS: register those sources with the app target ────────────────
/**
 * 2026-08-30 — COPYING A FILE INTO THE TREE DOES NOT COMPILE IT.
 *
 * withIOSSourceCopy above has been dropping BluetoothMediaButtonModule.swift and
 * BluetoothMediaButton.m into ios/SmartPlayCaddie/BTMedia/ and stopping there. Xcode compiles what
 * is in the target's Sources build phase, not what happens to be on disk, and the app target does
 * not use an Xcode 16 synchronized group — only the watch target does. Read straight out of a real
 * prebuild, the Sources phase contained exactly:
 *
 *     AppDelegate.swift, WearSwingBridgeModule.swift, WearSwingBridge.m
 *
 * So this native module has never been in the binary. NativeModules.BluetoothMediaButton is
 * undefined at runtime, which takes the earbud media-button bridge with it AND the getAudioRoute /
 * startRouteWatch headset detection added on 08-29.
 *
 * plugins/withWatchSwingBridgeIOS.js called this exact shot in its header — "the sibling plugins
 * copy their Swift/Obj-C into the prebuilt tree and stop there ... relies on something else picking
 * the files up ... the difference is a bridge that exists in the repo and does not exist in the
 * binary". It was right, and nobody checked the siblings.
 *
 * Pass the BARE FILENAME to addSourceFile: the path is resolved relative to the group, and this
 * group's path already contains SmartPlayCaddie/BTMedia. Passing the full path doubles it, which is
 * how build 16 failed.
 */
function withIOSCompileSources(config) {
  return withXcodeProject(config, (modConfig) => {
    try {
      const proj = modConfig.modResults;
      const appName = modConfig.modRequest.projectName;
      const GROUP_DIR = 'BTMedia';
      const FILES = ['BluetoothMediaButtonModule.swift', 'BluetoothMediaButton.m'];

      let groupKey = proj.findPBXGroupKey({ name: GROUP_DIR });
      if (!groupKey) {
        groupKey = proj.pbxCreateGroup(GROUP_DIR, `${appName}/${GROUP_DIR}`);
        const mainKey = proj.findPBXGroupKey({ name: appName }) || proj.getFirstProject().firstProject.mainGroup;
        if (mainKey) proj.addToPbxGroup(groupKey, mainKey);
      }

      const targetUuid = proj.getFirstTarget().uuid;
      for (const f of FILES) {
        // addSourceFile throws on a duplicate, and prebuild may run more than once.
        const already = JSON.stringify(proj.hash.project.objects.PBXBuildFile || {}).includes(f);
        if (already) continue;
        proj.addSourceFile(f, { target: targetUuid }, groupKey);
      }
      console.log('[withBluetoothMediaButton] iOS sources registered with the app target');
    } catch (e) {
      // Never fail the build for this — but say so loudly, because the symptom is a native module
      // that is simply undefined at runtime with nothing to explain why.
      console.warn('[withBluetoothMediaButton] WARNING: could not register iOS sources — the native module will NOT exist:', e.message);
    }
    return modConfig;
  });
}

// ─── Plugin entry point ─────────────────────────────────────────────
function withBluetoothMediaButton(config) {
  let next = config;
  next = withAndroidSourceCopyAndInjection(next);
  next = withIOSSourceCopy(next);
  next = withIOSCompileSources(next);
  return next;
}

module.exports = withBluetoothMediaButton;
