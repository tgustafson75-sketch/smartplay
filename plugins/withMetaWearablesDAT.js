/**
 * 2026-05-23 — Expo config plugin: Meta Wearables DAT v0.7 wiring.
 *
 * What this plugin does at prebuild time:
 *   1. Adds the GitHub Packages Maven repository for the mwdat artifacts
 *      to the Android settings.gradle (and falls back to project-level
 *      build.gradle's allprojects block on older RN templates). The repo
 *      requires a GitHub Personal Access Token with `read:packages` —
 *      sourced from GITHUB_TOKEN env at build time.
 *   2. Injects the manifestPlaceholders Tim's DAT app needs:
 *        MWDAT_APP_ID
 *        MWDAT_CLIENT_TOKEN
 *      Both are baked here as the literal Wearables Developer Center
 *      credentials so EAS Build doesn't need any env-var setup. If you
 *      ever rotate the Client Token, change it here and re-build.
 *   3. Adds the Bluetooth permissions DAT requires (CONNECT + SCAN +
 *      classic BLUETOOTH).
 *   4. Adds the two <meta-data> attestation entries to the manifest's
 *      <application> block.
 *
 * Why a config plugin instead of editing files in the bare android/
 * tree: SmartPlay is on the Expo managed workflow (per app.json). Bare
 * tree edits get wiped on every `expo prebuild`. The plugin runs IN the
 * prebuild and produces the same on-disk result every build.
 *
 * Security note (Tim's call to hard-code per 2026-05-23):
 *   The CLIENT_TOKEN below is sensitive. It rides into the APK at build
 *   time via manifestPlaceholders — same threat surface as any other
 *   embedded API key in a mobile app. If this repo is public on
 *   GitHub, rotate the token via the Wearables Developer Center
 *   periodically OR move the values back to EAS env vars (see the
 *   ENV_FALLBACK constant below — set process.env.META_WEARABLE_APP_ID
 *   / META_WEARABLE_CLIENT_TOKEN in EAS env and the plugin prefers
 *   them over the hard-coded values).
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

// ─── Credentials (literal — overridable via EAS env if you ever
//     decide to migrate to env-driven later) ───────────────────────
const HARDCODED_APP_ID = '2111052109463421';
const HARDCODED_CLIENT_TOKEN = 'AR|2111052109463421|7f68907105fa276594f961b611ca42ac';

const ENV_FALLBACK = {
  appId: process.env.META_WEARABLE_APP_ID || HARDCODED_APP_ID,
  clientToken: process.env.META_WEARABLE_CLIENT_TOKEN || HARDCODED_CLIENT_TOKEN,
};

// ─── 1. Maven repo (project-level build.gradle) ─────────────────────
//
// Resolve the GitHub Personal Access Token at PREBUILD time so the
// gradle native build doesn't depend on env-var inheritance from the
// EAS Build container (which is inconsistent across worker images).
// Read precedence:
//   1. process.env.GITHUB_TOKEN          ← EAS Build env (EAS dashboard)
//   2. process.env.EXPO_GITHUB_TOKEN     ← alt name in case the env is namespaced
//   3. extra.githubToken in app.json     ← committable fallback if Tim ever
//                                          wants to bake it into config
// If none resolve, we still inject the Maven block — but with a clear
// "[missing GITHUB_TOKEN]" sentinel string in the credentials. Gradle
// then 401s during dependency resolution with a self-explanatory
// error in the EAS Build log, instead of silently producing an APK
// missing the DAT artifacts.
function resolveGitHubToken(config) {
  const fromEnv =
    process.env.GITHUB_TOKEN ||
    process.env.EXPO_GITHUB_TOKEN;
  if (fromEnv) return { token: fromEnv, source: 'env' };
  const fromExtra =
    config && config.extra && typeof config.extra.githubToken === 'string'
      ? config.extra.githubToken
      : null;
  if (fromExtra) return { token: fromExtra, source: 'extra' };
  return { token: null, source: 'missing' };
}

function withMavenRepo(config) {
  const { token, source } = resolveGitHubToken(config);
  if (source === 'missing') {
    // Print at prebuild time so the warning lands in EAS Build logs
    // BEFORE gradle ever runs — easier to triage than a 401 buried in
    // dependency-resolution output.
    console.warn(
      '\n[withMetaWearablesDAT] WARNING: GITHUB_TOKEN is not set.\n' +
      '  Set it as an EAS secret (EAS dashboard → Project → Environment\n' +
      '  variables → add GITHUB_TOKEN with a GitHub PAT that has read:packages\n' +
      '  scope) before running `eas build`. The next gradle step will fail\n' +
      '  with a 401 against maven.pkg.github.com/facebook/meta-wearables-dat-android\n' +
      '  until this is resolved. See docs/README_EAS_BUILD.md for details.\n',
    );
  } else {
    console.log(`[withMetaWearablesDAT] resolved GITHUB_TOKEN from ${source}`);
  }
  const renderedPassword = token ? token : '[missing GITHUB_TOKEN — see EAS env or app.json extra.githubToken]';

  return withProjectBuildGradle(config, (gradleConfig) => {
    const marker = 'maven.pkg.github.com/facebook/meta-wearables-dat-android';
    if (gradleConfig.modResults.contents.includes(marker)) {
      // Already injected on a previous prebuild — regenerate the
      // password line in case the token rotated.
      gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
        /password\s*=\s*"[^"]*"\s*\/\/\s*mwdat-pat/,
        `password = "${renderedPassword}" // mwdat-pat`,
      );
      return gradleConfig;
    }
    // Comment marker on the password line lets a future prebuild
    // rotate the value without re-injecting the whole block.
    const repoBlock = `
        maven {
            url "https://maven.pkg.github.com/facebook/meta-wearables-dat-android"
            credentials {
                username = "mwdat"
                password = "${renderedPassword}" // mwdat-pat
            }
        }`;
    if (/allprojects\s*\{\s*repositories\s*\{/.test(gradleConfig.modResults.contents)) {
      gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
        /allprojects\s*\{\s*repositories\s*\{/,
        (match) => match + repoBlock,
      );
    } else {
      gradleConfig.modResults.contents += `
allprojects {
    repositories {
${repoBlock}
    }
}
`;
    }
    return gradleConfig;
  });
}

// ─── 2. App-level build.gradle: dependencies + manifestPlaceholders ─
function withAppGradle(config, { appId, clientToken }) {
  return withAppBuildGradle(config, (gradleConfig) => {
    let contents = gradleConfig.modResults.contents;

    // 2a. manifestPlaceholders — inject inside android.defaultConfig.
    const placeholders = `
        manifestPlaceholders = [
            MWDAT_APP_ID: "${appId}",
            MWDAT_CLIENT_TOKEN: "${clientToken}"
        ]`;
    if (!contents.includes('MWDAT_APP_ID:')) {
      contents = contents.replace(
        /(defaultConfig\s*\{)/,
        `$1${placeholders}`,
      );
    }

    // 2b. mwdat dependencies — inject inside the dependencies { } block.
    const deps = `
    implementation "com.meta.wearable:mwdat-core:0.7.0"
    implementation "com.meta.wearable:mwdat-camera:0.7.0"`;
    if (!contents.includes('com.meta.wearable:mwdat-core')) {
      contents = contents.replace(
        /(dependencies\s*\{)/,
        `$1${deps}`,
      );
    }

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
}

// ─── 3. AndroidManifest: permissions + meta-data ────────────────────
function withManifest(config) {
  return withAndroidManifest(config, async (manifestConfig) => {
    const manifest = manifestConfig.modResults;

    // 3a. Top-level Bluetooth permissions.
    AndroidConfig.Permissions.addPermissionsToManifest(
      [
        'android.permission.BLUETOOTH',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.BLUETOOTH_SCAN',
      ],
      manifest,
    );

    // 3b. <meta-data> inside <application>. The literal credential
    //     values are pulled from manifestPlaceholders at build time via
    //     the gradle injection above, so the manifest entries reference
    //     `${MWDAT_APP_ID}` / `${MWDAT_CLIENT_TOKEN}` rather than the
    //     raw values — keeps the manifest readable + lets EAS env vars
    //     override if you ever migrate off the hard-coded path.
    const application = manifest.manifest.application?.[0];
    if (!application) return manifestConfig;
    application['meta-data'] = application['meta-data'] || [];

    // 2026-05-23 — Defensive: ensure tools namespace declared so we
    // can use tools:node="remove" on any auto-injected Wearables-AAR
    // startup initializer that might crash at boot. Meta SDKs
    // sometimes inject Facebook Analytics auto-providers; this
    // namespace lets the manifest merger honour our removal blocks
    // when needed. Per-provider removal entries are added by the
    // MediaPipe plugin (the more aggressive auto-init source); DAT
    // doesn't currently need a specific removal but the namespace
    // declaration here is forward-defensive.
    manifest.manifest.$ = manifest.manifest.$ || {};
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const ensureMeta = (name, value) => {
      const existing = application['meta-data'].find(
        (m) => m.$ && m.$['android:name'] === name,
      );
      if (existing) {
        existing.$['android:value'] = value;
      } else {
        application['meta-data'].push({
          $: { 'android:name': name, 'android:value': value },
        });
      }
    };

    ensureMeta('com.meta.wearable.mwdat.APPLICATION_ID', '${MWDAT_APP_ID}');
    ensureMeta('com.meta.wearable.mwdat.CLIENT_TOKEN', '${MWDAT_CLIENT_TOKEN}');

    return manifestConfig;
  });
}

// ─── 3.5. MainApplication.kt — inject MetaWearablesPackage() ───────
//
// 2026-05-23 CRITICAL FIX: the previous regex `val\s+packages\s*=\s*PackageList\(this\).packages`
// did NOT match the current Expo SDK 54 MainApplication template, which
// uses an inline `.apply { ... }` block:
//     PackageList(this).packages.apply {
//       // Packages that cannot be autolinked yet can be added manually here, for example:
//       // add(MyReactNativePackage())
//     }
// Result: injection silently failed → native module never registered →
// NativeModules.MetaWearablesFrame === undefined. With the previous APK
// build we ALSO had the package path wrong (com.smartplaycaddy.* —
// missing the 'ie'), so even if injection had matched the regex, the
// referenced class wouldn't have resolved. Both issues fixed now.
//
// New regex matches BOTH templates (legacy `val packages` and modern
// `.apply { ... }`), injecting inside the apply block via the canonical
// `add(...)` call (not `packages.add(...)` which only works in the val
// template).
function withMainApplicationInjection(config) {
  // Step 1: copy the Kotlin sources into the prebuilt tree at the
  // CORRECTED package path (com.smartplaycaddie.wearables — matches
  // the app's `com.smartplaycaddie.app` namespace).
  const next = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const pkgPath = path.join(
        platformRoot,
        'app', 'src', 'main', 'java', 'com', 'smartplaycaddie', 'wearables',
      );
      const sourceDir = path.join(projectRoot, 'android-native');
      const files = ['MetaWearablesFrameModule.kt', 'MetaWearablesPackage.kt'];
      try {
        if (!fs.existsSync(pkgPath)) fs.mkdirSync(pkgPath, { recursive: true });
        for (const f of files) {
          const src = path.join(sourceDir, f);
          const dst = path.join(pkgPath, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        }
      } catch (e) {
        console.warn('[withMetaWearablesDAT] Android source copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);

  // Step 2: inject the package registration. Supports two Expo
  // MainApplication template variants. CORRECTED package path.
  return withMainApplication(next, (mainAppConfig) => {
    let contents = mainAppConfig.modResults.contents;
    const marker = 'MetaWearablesPackage()';
    if (contents.includes(marker)) return mainAppConfig;

    // Modern Expo template (SDK 54+):
    //   PackageList(this).packages.apply { ... }
    const applyRegex = /(PackageList\(this\)\.packages\.apply\s*\{)/;
    // Legacy template:
    //   val packages = PackageList(this).packages
    const valLineRegex = /(val\s+packages\s*=\s*PackageList\(this\)\.packages)/;

    if (applyRegex.test(contents)) {
      contents = contents.replace(
        applyRegex,
        (match) =>
          `${match}\n              // Auto-injected by withMetaWearablesDAT.js — Meta Wearables DAT native module.\n              add(com.smartplaycaddie.wearables.MetaWearablesPackage())`,
      );
      mainAppConfig.modResults.contents = contents;
      console.log('[withMetaWearablesDAT] injected MetaWearablesPackage into MainApplication.kt (apply-block template)');
    } else if (valLineRegex.test(contents)) {
      contents = contents.replace(
        valLineRegex,
        (match) =>
          `${match}\n            // Auto-injected by withMetaWearablesDAT.js — Meta Wearables DAT native module.\n            packages.add(com.smartplaycaddie.wearables.MetaWearablesPackage())`,
      );
      mainAppConfig.modResults.contents = contents;
      console.log('[withMetaWearablesDAT] injected MetaWearablesPackage into MainApplication.kt (val template)');
    } else {
      console.warn(
        '[withMetaWearablesDAT] WARNING: MainApplication.kt template did not match either known shape. ' +
        'NativeModules.MetaWearablesFrame will be null at runtime. Update plugins/withMetaWearablesDAT.js.',
      );
    }
    return mainAppConfig;
  });
}

// ─── 4. iOS Info.plist — Bluetooth + camera + DAT attestation ──────
function withIOSInfoPlist(config, { appId, clientToken }) {
  return withInfoPlist(config, (infoConfig) => {
    const plist = infoConfig.modResults;

    // Bluetooth usage description — required for any app that talks to
    // a Bluetooth peripheral on iOS. Same string set the existing
    // expo-location plugin uses for transparency tone.
    if (!plist.NSBluetoothAlwaysUsageDescription) {
      plist.NSBluetoothAlwaysUsageDescription =
        'Smart Play Caddie connects to your Ray-Ban Meta glasses to receive camera frames + route caddie voice to the glasses speakers.';
    }
    if (!plist.NSBluetoothPeripheralUsageDescription) {
      plist.NSBluetoothPeripheralUsageDescription = plist.NSBluetoothAlwaysUsageDescription;
    }
    // Camera usage — DAT uses the glasses camera, not the phone camera,
    // but iOS still surfaces the prompt for clarity.
    if (!plist.NSCameraUsageDescription) {
      plist.NSCameraUsageDescription =
        'Smart Play Caddie reads frames from your Ray-Ban Meta glasses to coach your swing and read greens.';
    }

    // DAT attestation. These keys are read by the iOS SDK at session
    // init time — same role as the AndroidManifest meta-data entries.
    plist['MetaWearablesAppId'] = appId;
    plist['MetaWearablesClientToken'] = clientToken;

    return infoConfig;
  });
}

// ─── 5. iOS Podfile — add the Wearables pod via withDangerousMod ──
// @expo/config-plugins does not expose a typed `withPodfile`; the
// canonical pattern is a dangerous-mod that edits the Podfile text in
// place. This is exactly how expo-build-properties' iOS branch
// touches the Podfile when its `extraPods` option is in play.
function withIOSPodfile(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) return modConfig;
      let contents = fs.readFileSync(podfilePath, 'utf-8');
      const marker = "pod 'Wearables'";
      if (contents.includes(marker)) return modConfig;
      const insertion = `
  # Meta Wearables DAT v0.7 — Ray-Ban Meta glasses live frames + audio.
  pod 'Wearables', :git => 'https://github.com/facebook/meta-wearables-dat-ios.git', :tag => '0.7.0'
  pod 'WearablesCamera', :git => 'https://github.com/facebook/meta-wearables-dat-ios.git', :tag => '0.7.0'
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

// ─── 6. Drop Swift + Obj-C source files into the iOS project ───────
//
// Expo prebuild regenerates the bare ios/ tree on every run. We use a
// "dangerous mod" to copy the Swift + Obj-C module files from
// ios-native/ into ios/SmartPlayCaddie/ at prebuild time. This is the
// least-invasive seam — the canonical Swift sources live in
// ios-native/ (version-tracked + reviewable) and the prebuild copies
// them into place. After this lands, Xcode automatically picks up the
// files via the "auto-add new files" project setting Expo configures.
function withSwiftSourceCopy(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const sourceDir = path.join(projectRoot, 'ios-native');
      const targetDir = path.join(platformRoot, 'SmartPlayCaddie', 'Wearables');
      const files = ['MetaWearablesFrameModule.swift', 'MetaWearablesFrame.m'];
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
      } catch (e) {
        console.warn('[withMetaWearablesDAT] iOS source copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);
}

// ─── Plugin entry point ─────────────────────────────────────────────
function withMetaWearablesDAT(config) {
  let next = config;
  // Android
  next = withMavenRepo(next);
  next = withAppGradle(next, ENV_FALLBACK);
  next = withManifest(next);
  next = withMainApplicationInjection(next);
  // iOS
  next = withIOSInfoPlist(next, ENV_FALLBACK);
  next = withIOSPodfile(next);
  next = withSwiftSourceCopy(next);
  return next;
}

module.exports = withMetaWearablesDAT;
