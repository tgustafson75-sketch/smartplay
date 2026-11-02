/**
 * 2026-11-01 — Expo config plugin: microphone foreground service (Android).
 *
 * Mirrors plugins/withBluetoothMediaButton.js, plus the manifest edits a foreground service needs:
 *   1. Copies MicCaptureService / MicCaptureModule / MicCapturePackage from android-native/ into the
 *      prebuilt tree under com/smartplaycaddie/micfg.
 *   2. Injects the package into MainApplication.kt, try/catch-wrapped so a class-load failure cannot
 *      stop the app booting (the JS caller then sees the module as absent and does nothing).
 *   3. Declares the service with android:foregroundServiceType="microphone" and the
 *      FOREGROUND_SERVICE / FOREGROUND_SERVICE_MICROPHONE permissions.
 *
 * Android only. iOS has no equivalent and needs none (its audio session is kept by the iOS plugin).
 */

const { withMainApplication, withDangerousMod, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SERVICE_CLASS = 'com.smartplaycaddie.micfg.MicCaptureService';
const PACKAGE_LINE = 'MicCapturePackage()';
const MICROPHONE_PERMISSION = 'android.permission.FOREGROUND_SERVICE_MICROPHONE';

function withSourceCopy(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const pkgPath = path.join(platformRoot, 'app', 'src', 'main', 'java', 'com', 'smartplaycaddie', 'micfg');
      const sourceDir = path.join(projectRoot, 'android-native');
      try {
        fs.mkdirSync(pkgPath, { recursive: true });
        for (const f of ['MicCaptureService.kt', 'MicCaptureModule.kt', 'MicCapturePackage.kt']) {
          fs.copyFileSync(path.join(sourceDir, f), path.join(pkgPath, f));
        }
        console.log('[withMicCaptureService] Android sources copied');
      } catch (e) {
        console.warn('[withMicCaptureService] source copy failed — the mic service will be absent:', e.message);
      }
      return modConfig;
    },
  ]);
}

function withPackageInjection(config) {
  return withMainApplication(config, (cfg) => {
    try {
      const contents = cfg?.modResults?.contents;
      if (typeof contents !== 'string' || contents.length === 0) {
        console.warn('[withMicCaptureService] MainApplication contents not a string — skipping injection.');
        return cfg;
      }
      if (contents.includes(PACKAGE_LINE)) return cfg;
      const applyRegex = /(PackageList\(this\)\.packages\.apply\s*\{)/;
      if (!applyRegex.test(contents)) {
        console.warn('[withMicCaptureService] MainApplication template not recognised — MicCapture will be null at runtime.');
        return cfg;
      }
      cfg.modResults.contents = contents.replace(
        applyRegex,
        (match) => `${match}
              // Auto-injected by withMicCaptureService.js — try/catch so a class-load failure never crashes MainApplication.
              try {
                add(com.smartplaycaddie.micfg.MicCapturePackage())
              } catch (t: Throwable) {
                android.util.Log.e("MainApplication", "MicCapturePackage failed to load — continuing without it", t)
              }`,
      );
      return cfg;
    } catch (e) {
      console.warn('[withMicCaptureService] injection error — skipping:', e && e.message ? e.message : String(e));
      return cfg;
    }
  });
}

function withManifestService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const perms = (manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || []);
    const hasPerm = (name) => perms.some((p) => p.$?.['android:name'] === name);
    if (!hasPerm(MICROPHONE_PERMISSION)) {
      perms.push({ $: { 'android:name': MICROPHONE_PERMISSION } });
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.service = app.service || [];
    if (!app.service.some((s) => s.$?.['android:name'] === SERVICE_CLASS)) {
      app.service.push({
        $: {
          'android:name': SERVICE_CLASS,
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone',
        },
      });
    }
    return cfg;
  });
}

function withMicCaptureService(config) {
  return withManifestService(withPackageInjection(withSourceCopy(config)));
}

module.exports = withMicCaptureService;
