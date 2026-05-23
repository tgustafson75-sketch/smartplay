/**
 * 2026-05-23 — Expo config plugin: MediaPipe Pose Landmarker (BlazePose).
 *
 * On-device 33-keypoint pose detection. Becomes the PRIMARY path in
 * services/poseEstimator.ts; the cloud /api/pose-analysis route stays
 * the defensive fallback when MediaPipe is unavailable (web / before
 * the EAS build that includes this plugin) OR returns low confidence.
 *
 * What this plugin does at prebuild:
 *   1. Android — adds `com.google.mediapipe:tasks-vision` (~32 MB; the
 *      bulk of MediaPipe weight) to the app's gradle dependencies. The
 *      pose model itself is bundled into assets/ at runtime.
 *   2. Android — copies android-native/MediaPipePoseModule.kt +
 *      android-native/MediaPipePosePackage.kt into the prebuilt
 *      android tree at the correct package path.
 *   3. Android — uses withMainApplication to add
 *      packages.add(MediaPipePosePackage()) to MainApplication.kt's
 *      getPackages() — same pattern as withMetaWearablesDAT.
 *   4. Android — copies the bundled pose model
 *      assets/mediapipe/pose_landmarker_full.task into
 *      android/app/src/main/assets/. The model file is sourced from
 *      Google's model zoo; we keep it under assets/mediapipe/ so the
 *      asset copy is deterministic + reviewable.
 *   5. iOS — adds the MediaPipeTasksVision pod to the Podfile via
 *      withDangerousMod (parallels the DAT plugin's pod injection).
 *   6. iOS — copies the Swift + Obj-C bridge files from ios-native/
 *      into ios/SmartPlayCaddie/MediaPipe/. The pose model is bundled
 *      via the same assets/mediapipe/ path; the iOS native module
 *      loads from the app bundle resources.
 *   7. Adds NSCameraUsageDescription on iOS + CAMERA permission on
 *      Android (defensive — the project already has these via
 *      expo-camera, but we add idempotently so this plugin is
 *      standalone-correct).
 *
 * Idempotency: every mod checks for an existing marker before mutating.
 * Safe to prebuild repeatedly.
 *
 * Battery / thermal: MediaPipe is much cheaper than uploading frames
 * to a server, but BlazePose Full at 30 FPS still consumes ~10-15%
 * battery/hour on a midrange phone. The JS service throttles to 15
 * FPS under AppState=background and exposes a setQuality('lite' |
 * 'full' | 'heavy') hook so consumers can downshift on thermal
 * warnings. 'lite' is the BlazePose Lite variant (~3 MB model, half
 * the keypoint accuracy but 3x faster) — use for live preview
 * scenarios where speed beats precision.
 *
 * Backward compatibility: when this plugin is NOT in app.json plugins,
 * NativeModules.MediaPipePose resolves to null and the JS service
 * collapses to no-op. The existing cloud pose path keeps working.
 */

const {
  withAndroidManifest,
  withProjectBuildGradle,
  withAppBuildGradle,
  withMainApplication,
  withInfoPlist,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────
const MP_VERSION = '0.10.14'; // current stable as of 2026-05
const MP_MODEL_ASSET_RELPATH = 'mediapipe/pose_landmarker_full.task';
// 2026-05-23 — All variants the JS service may load. The plugin
// copies every one that's present in assets/mediapipe/. Missing
// variants are non-fatal (logged) — the JS service's setPreferredQuality
// just won't be able to switch to them at runtime.
const MP_ALL_MODEL_VARIANTS = [
  'pose_landmarker_lite.task',
  'pose_landmarker_full.task',
  'pose_landmarker_heavy.task',
];

// ─── Android ─────────────────────────────────────────────────────────

function withAndroidGradleDeps(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    const marker = 'com.google.mediapipe:tasks-vision';
    if (gradleConfig.modResults.contents.includes(marker)) return gradleConfig;
    const dep = `
    // MediaPipe Pose Landmarker (BlazePose) — on-device pose detection.
    implementation "com.google.mediapipe:tasks-vision:${MP_VERSION}"`;
    gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
      /(dependencies\s*\{)/,
      `$1${dep}`,
    );
    return gradleConfig;
  });
}

function withAndroidCameraPermission(config) {
  return withAndroidManifest(config, async (manifestConfig) => {
    AndroidConfig.Permissions.addPermissionsToManifest(
      ['android.permission.CAMERA'],
      manifestConfig.modResults,
    );
    return manifestConfig;
  });
}

function withAndroidSourceCopyAndPackageReg(config) {
  // (a) copy Kotlin sources into prebuilt tree at the CORRECTED
  // package path (com.smartplaycaddie.mediapipe — matches the app's
  // `com.smartplaycaddie.app` namespace; previous typo was
  // `smartplaycaddy` missing the `ie`).
  const withSourceCopy = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const pkgPath = path.join(
        platformRoot,
        'app', 'src', 'main', 'java', 'com', 'smartplaycaddie', 'mediapipe',
      );
      const sourceDir = path.join(projectRoot, 'android-native');
      const files = ['MediaPipePoseModule.kt', 'MediaPipePosePackage.kt'];
      try {
        if (!fs.existsSync(pkgPath)) fs.mkdirSync(pkgPath, { recursive: true });
        for (const f of files) {
          const src = path.join(sourceDir, f);
          const dst = path.join(pkgPath, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        }
      } catch (e) {
        console.warn('[withMediaPipePose] Android source copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);

  // (b) copy all available bundled model variants into
  //     android/app/src/main/assets/mediapipe/. The 'full' variant is
  //     the only REQUIRED one; missing 'lite' or 'heavy' just means
  //     setPreferredQuality can't switch to them at runtime — service
  //     falls back to whichever quality is loaded.
  const withModelAsset = withDangerousMod(withSourceCopy, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const srcRoot = path.join(projectRoot, 'assets', 'mediapipe');
      const dstAssetDir = path.join(platformRoot, 'app', 'src', 'main', 'assets', 'mediapipe');
      try {
        if (!fs.existsSync(dstAssetDir)) fs.mkdirSync(dstAssetDir, { recursive: true });
        let copied = 0;
        for (const variant of MP_ALL_MODEL_VARIANTS) {
          const src = path.join(srcRoot, variant);
          const dst = path.join(dstAssetDir, variant);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            copied++;
          }
        }
        if (copied === 0) {
          // Required full variant missing.
          console.warn(
            `[withMediaPipePose] missing ${MP_MODEL_ASSET_RELPATH} — ` +
            'add the BlazePose model file before the next build. ' +
            'Download: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
          );
        } else {
          console.log(`[withMediaPipePose] copied ${copied} model variant(s) into Android assets`);
        }
      } catch (e) {
        console.warn('[withMediaPipePose] Android model-asset copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);

  // (c) inject packages.add(MediaPipePosePackage()) into MainApplication.kt
  //
  // 2026-05-23 CRITICAL FIX: same root cause as withMetaWearablesDAT —
  // the old regex matched a `val packages = ...` template that no
  // longer exists in Expo SDK 54+. The current template uses an inline
  // `PackageList(this).packages.apply { ... }` block. New code matches
  // both, with the apply-block taking precedence. Also corrected the
  // package class reference (com.smartplaycaddie.* — was the typo'd
  // `smartplaycaddy.*`).
  return withMainApplication(withModelAsset, (mainAppConfig) => {
    let contents = mainAppConfig.modResults.contents;
    const marker = 'MediaPipePosePackage()';
    if (contents.includes(marker)) return mainAppConfig;

    const applyRegex = /(PackageList\(this\)\.packages\.apply\s*\{)/;
    const valLineRegex = /(val\s+packages\s*=\s*PackageList\(this\)\.packages)/;

    if (applyRegex.test(contents)) {
      contents = contents.replace(
        applyRegex,
        (match) =>
          `${match}\n              // Auto-injected by withMediaPipePose.js — on-device pose detection.\n              add(com.smartplaycaddie.mediapipe.MediaPipePosePackage())`,
      );
      mainAppConfig.modResults.contents = contents;
      console.log('[withMediaPipePose] injected MediaPipePosePackage into MainApplication.kt (apply-block template)');
    } else if (valLineRegex.test(contents)) {
      contents = contents.replace(
        valLineRegex,
        (match) =>
          `${match}\n            // Auto-injected by withMediaPipePose.js — on-device pose detection.\n            packages.add(com.smartplaycaddie.mediapipe.MediaPipePosePackage())`,
      );
      mainAppConfig.modResults.contents = contents;
      console.log('[withMediaPipePose] injected MediaPipePosePackage into MainApplication.kt (val template)');
    } else {
      console.warn(
        '[withMediaPipePose] WARNING: MainApplication.kt template did not match either known shape. ' +
        'NativeModules.MediaPipePose will be null.',
      );
    }
    return mainAppConfig;
  });
}

// ─── iOS ─────────────────────────────────────────────────────────────

function withIOSInfoPlist(config) {
  return withInfoPlist(config, (infoConfig) => {
    const plist = infoConfig.modResults;
    if (!plist.NSCameraUsageDescription) {
      plist.NSCameraUsageDescription =
        'Smart Play Caddie reads frames from your camera so on-device pose detection can analyze your swing.';
    }
    return infoConfig;
  });
}

function withIOSPodfile(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) return modConfig;
      let contents = fs.readFileSync(podfilePath, 'utf-8');
      const marker = "pod 'MediaPipeTasksVision'";
      if (contents.includes(marker)) return modConfig;
      const insertion = `
  # MediaPipe Pose Landmarker (BlazePose) — on-device pose detection.
  pod 'MediaPipeTasksVision', '~> ${MP_VERSION}'
`;
      if (contents.includes('use_react_native!')) {
        contents = contents.replace('use_react_native!', insertion + '  use_react_native!');
      } else {
        contents += '\n' + insertion;
      }
      fs.writeFileSync(podfilePath, contents, 'utf-8');
      return modConfig;
    },
  ]);
}

function withIOSSourceCopyAndModel(config) {
  const withSourceCopy = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const sourceDir = path.join(projectRoot, 'ios-native');
      const targetDir = path.join(platformRoot, 'SmartPlayCaddie', 'MediaPipe');
      const files = ['MediaPipePoseModule.swift', 'MediaPipePose.m'];
      try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        for (const f of files) {
          const src = path.join(sourceDir, f);
          const dst = path.join(targetDir, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        }
      } catch (e) {
        console.warn('[withMediaPipePose] iOS source copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);
  // Copy all available model variants into the iOS bundle resources.
  return withDangerousMod(withSourceCopy, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const srcRoot = path.join(projectRoot, 'assets', 'mediapipe');
      const dstAssetDir = path.join(platformRoot, 'SmartPlayCaddie', 'Resources', 'mediapipe');
      try {
        if (!fs.existsSync(dstAssetDir)) fs.mkdirSync(dstAssetDir, { recursive: true });
        let copied = 0;
        for (const variant of MP_ALL_MODEL_VARIANTS) {
          const src = path.join(srcRoot, variant);
          const dst = path.join(dstAssetDir, variant);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            copied++;
          }
        }
        if (copied > 0) {
          console.log(`[withMediaPipePose] copied ${copied} model variant(s) into iOS bundle resources`);
        }
      } catch (e) {
        console.warn('[withMediaPipePose] iOS model-asset copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);
}

// ─── Plugin entry point ─────────────────────────────────────────────
function withMediaPipePose(config) {
  let next = config;
  // Android
  next = withAndroidGradleDeps(next);
  next = withAndroidCameraPermission(next);
  next = withAndroidSourceCopyAndPackageReg(next);
  // iOS
  next = withIOSInfoPlist(next);
  next = withIOSPodfile(next);
  next = withIOSSourceCopyAndModel(next);
  return next;
}

module.exports = withMediaPipePose;
