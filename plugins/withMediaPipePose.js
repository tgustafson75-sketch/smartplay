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
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────
/**
 * 2026-09-04 — BUMPED 0.10.14 -> 0.10.29 FOR 16 KB PAGE SIZES.
 *
 * Google Play rejected bundle 25 at the review step: "Your app does not support 16 KB memory page
 * sizes." Apps targeting Android 15+ must ship 64-bit native libraries whose PT_LOAD segments are
 * aligned to 16384 bytes; on a device using 16 KB pages an unaligned library can fail to load.
 *
 * Measured rather than guessed. Every 64-bit .so in bundle 25 was read out of the AAB and its ELF
 * program headers parsed: 56 libraries aligned to 16384, and exactly ONE at 4096 —
 * libmediapipe_tasks_vision_jni.so, from this dependency. Nothing else in the app was at fault.
 *
 * Then the candidate versions were checked the same way, by downloading each AAR and reading the
 * header, instead of trusting a release note:
 *
 *     0.10.14    align 4096   <- what we shipped
 *     0.10.21    align 4096
 *     0.10.26.1  align 16384
 *     0.10.29    align 16384  <- chosen
 *     0.10.35    ships no arm64-v8a library at all — avoided deliberately
 *
 * The APIs this app uses (PoseLandmarker, PoseLandmarkerResult, BaseOptions, Delegate, RunningMode,
 * BitmapImageBuilder, MPImage) are unchanged across the range.
 *
 * ANDROID ONLY in effect. The iOS mod below writes a `pod 'MediaPipeTasksVision'` line, but that pod
 * is not present in the generated Podfile and the iOS pose path was never finished (its sources are
 * not registered with the Xcode target), so no iOS binary is affected by this number.
 */
const MP_VERSION = '0.10.29';
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
    // 2026-05-23 — Exclude androidx.startup transitively. tasks-vision
    // 0.10.x pulls it in for the on-boot init provider that we strip
    // from the manifest above. Removing the gradle dep too closes
    // the loop — even if the manifest strip somehow misses, the
    // startup classes won't be on classpath to instantiate.
    const dep = `
    // MediaPipe Pose Landmarker (BlazePose) — on-device pose detection.
    // 2026-05-23 NUCLEAR-HARDENED: exclude androidx.startup so the
    // tasks-vision AAR's auto-init container can't run at boot.
    // MediaPipe Tasks initializes per-detect() instead.
    implementation("com.google.mediapipe:tasks-vision:${MP_VERSION}") {
        exclude group: 'androidx.startup'
        exclude group: 'androidx.profileinstaller'
    }`;
    gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
      /(dependencies\s*\{)/,
      `$1${dep}`,
    );
    return gradleConfig;
  });
}

function withAndroidCameraPermission(config) {
  return withAndroidManifest(config, async (manifestConfig) => {
    // 2026-05-25 — SDK 54 removed AndroidConfig.Permissions.
    // addPermissionsToManifest. Manual mutation of the uses-permission
    // array, idempotent (skip names already present).
    {
      const manifest = manifestConfig.modResults;
      const perms = ['android.permission.CAMERA'];
      if (!Array.isArray(manifest.manifest['uses-permission'])) {
        manifest.manifest['uses-permission'] = [];
      }
      const existing = new Set(
        manifest.manifest['uses-permission']
          .map(p => p?.$?.['android:name'])
          .filter(Boolean),
      );
      for (const name of perms) {
        if (!existing.has(name)) {
          manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
        }
      }
    }

    // 2026-05-23 — NUCLEAR manifest hardening.
    //
    // ContentProviders run BEFORE Application.attachBaseContext +
    // onCreate. If an AAR-registered provider throws during its own
    // onCreate, the app crashes BEFORE any of our Kotlin or JS
    // defenses can fire — no try/catch reaches that high in the
    // boot order. The ONLY defense is to strip the provider from
    // the merged manifest with tools:node="remove".
    //
    // We strip `androidx.startup.InitializationProvider` entirely.
    // It's the canonical auto-init container used by MediaPipe
    // Tasks, WorkManager 2.6+, Lifecycle, and Profile-Installer.
    // Trade-off: any library relying on it for boot-time init must
    // initialize lazily instead. For Smart Play Caddie's stack
    // (Expo + RN + Sentry + custom services), nothing depends on
    // startup for correctness — MediaPipe Tasks Vision in
    // particular initializes per-detect() call, not at boot.
    //
    // Also strip the Profile Installer initializer (a known
    // crash-suspect on some devices) and the Crash Reporter
    // provider (in case any AAR brought one in transitively).
    const manifest = manifestConfig.modResults;
    manifest.manifest.$ = manifest.manifest.$ || {};
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const application = manifest.manifest.application?.[0];
    if (!application) return manifestConfig;
    application.provider = application.provider || [];

    // Helper — add a tools:node="remove" entry idempotently.
    const ensureProviderRemoved = (className) => {
      const existing = application.provider.find(
        (p) => p.$ && p.$['android:name'] === className,
      );
      if (existing) {
        // Coerce any existing entry to a removal.
        existing.$['tools:node'] = 'remove';
        return;
      }
      application.provider.push({
        $: {
          'android:name': className,
          'tools:node': 'remove',
        },
      });
    };

    [
      // AndroidX Startup — the modern auto-init container. MediaPipe
      // Tasks Vision and others register Initializers under this
      // provider. Removing the whole provider forces all initializers
      // to be lazy / explicit.
      'androidx.startup.InitializationProvider',
      // Profile Installer — auto-installs PGO profiles at boot.
      // Known crash-prone on some Samsung + Pixel devices on older
      // Android versions.
      'androidx.profileinstaller.ProfileInstallerInitializer',
      // Firebase init provider — defensive in case any transitive
      // dep pulled it in. SmartPlay doesn't use Firebase, so
      // removing is safe.
      'com.google.firebase.provider.FirebaseInitProvider',
      // Crashlytics init provider — same defense.
      'com.google.firebase.crashlytics.ndk.CrashlyticsNdkInitProvider',
    ].forEach(ensureProviderRemoved);

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
          `${match}
              // Auto-injected by withMediaPipePose.js — try/catch wrap
              // so a class-load failure never crashes MainApplication.
              try {
                add(com.smartplaycaddie.mediapipe.MediaPipePosePackage())
              } catch (t: Throwable) {
                android.util.Log.e("MainApplication", "MediaPipePosePackage failed to load — continuing without it", t)
              }`,
      );
      mainAppConfig.modResults.contents = contents;
      console.log('[withMediaPipePose] injected MediaPipePosePackage into MainApplication.kt (apply-block + try/catch)');
    } else if (valLineRegex.test(contents)) {
      contents = contents.replace(
        valLineRegex,
        (match) =>
          `${match}
            // Auto-injected by withMediaPipePose.js — try/catch wrap.
            try {
              packages.add(com.smartplaycaddie.mediapipe.MediaPipePosePackage())
            } catch (t: Throwable) {
              android.util.Log.e("MainApplication", "MediaPipePosePackage failed to load — continuing without it", t)
            }`,
      );
      mainAppConfig.modResults.contents = contents;
      console.log('[withMediaPipePose] injected MediaPipePosePackage into MainApplication.kt (val template + try/catch)');
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
  /**
   * iOS — DEFERRED, and the reason is bigger than the original comment said.
   *
   * 2026-09-03 (Tim, final build) — Tim chose to attempt enabling this. I enabled it, ran a real
   * prebuild, and STOPPED on the evidence, because the framing I gave him was wrong. This is not a
   * working iOS path that was switched off. It is an UNFINISHED one:
   *
   *   • withIOSPodfile adds `pod 'MediaPipeTasksVision', '~> 0.10.14'`      ✓ verified in ios/Podfile
   *   • withIOSSourceCopyAndModel copies the Swift/ObjC and the 9.4 MB
   *     model into ios/SmartPlayCaddie/{MediaPipe,Resources}               ✓ verified on disk
   *   • NOTHING registers those sources in the Xcode Sources build phase.  ✗ 0 references in
   *     project.pbxproj, against 4 for BluetoothMediaButton — this plugin has no
   *     withIOSCompileSources step at all.
   *
   * So uncommenting these three lines adds a CocoaPods dependency and ships a 9.4 MB model that
   * nothing compiles against. NativeModules.MediaPipePose stays null on iOS exactly as before —
   * every iOS swing still goes to the cloud — while the build carries new pod-resolution risk and
   * new binary weight for no behaviour change. All of the risk, none of the benefit.
   *
   * That is the same defect withBluetoothMediaButton documents at :184-201: sources copied into the
   * tree but never added to the target, so "this native module has never been in the binary". It
   * cost build 16. Finishing this properly means writing the registration step AND proving the pod
   * resolves — real native work whose only true verification is a completed EAS build, which is the
   * thing we get one of.
   *
   * TO FINISH IT LATER: copy withIOSCompileSources from withBluetoothMediaButton.js (note the
   * bare-filename requirement — a doubled path is what failed build 16), then re-enable all four.
   */
  // next = withIOSInfoPlist(next);  // camera perm already set by expo-camera
  // next = withIOSPodfile(next);
  // next = withIOSSourceCopyAndModel(next);
  return next;
}

module.exports = withMediaPipePose;
