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
} = require('@expo/config-plugins');
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
    let contents = mainAppConfig.modResults.contents;
    const marker = 'BluetoothMediaButtonPackage()';
    if (contents.includes(marker)) return mainAppConfig;

    const applyRegex = /(PackageList\(this\)\.packages\.apply\s*\{)/;
    const valLineRegex = /(val\s+packages\s*=\s*PackageList\(this\)\.packages)/;

    if (applyRegex.test(contents)) {
      contents = contents.replace(
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
      mainAppConfig.modResults.contents = contents;
      console.log('[withBluetoothMediaButton] injected package into MainApplication.kt (apply-block)');
    } else if (valLineRegex.test(contents)) {
      contents = contents.replace(
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
      mainAppConfig.modResults.contents = contents;
      console.log('[withBluetoothMediaButton] injected package into MainApplication.kt (val template)');
    } else {
      console.warn(
        '[withBluetoothMediaButton] WARNING: MainApplication.kt template did not match either known shape. ' +
        'NativeModules.BluetoothMediaButton will be null at runtime.',
      );
    }
    return mainAppConfig;
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

// ─── Plugin entry point ─────────────────────────────────────────────
function withBluetoothMediaButton(config) {
  let next = config;
  next = withAndroidSourceCopyAndInjection(next);
  next = withIOSSourceCopy(next);
  return next;
}

module.exports = withBluetoothMediaButton;
