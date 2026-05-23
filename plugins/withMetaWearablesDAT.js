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
  AndroidConfig,
} = require('@expo/config-plugins');

// ─── Credentials (literal — overridable via EAS env if you ever
//     decide to migrate to env-driven later) ───────────────────────
const HARDCODED_APP_ID = '2111052109463421';
const HARDCODED_CLIENT_TOKEN = 'AR|2111052109463421|7f68907105fa276594f961b611ca42ac';

const ENV_FALLBACK = {
  appId: process.env.META_WEARABLE_APP_ID || HARDCODED_APP_ID,
  clientToken: process.env.META_WEARABLE_CLIENT_TOKEN || HARDCODED_CLIENT_TOKEN,
};

// ─── 1. Maven repo (project-level build.gradle) ─────────────────────
function withMavenRepo(config) {
  return withProjectBuildGradle(config, (gradleConfig) => {
    const marker = 'maven.pkg.github.com/facebook/meta-wearables-dat-android';
    if (gradleConfig.modResults.contents.includes(marker)) {
      return gradleConfig;
    }
    // Inject the Maven block inside the existing `allprojects { repositories { ... } }` block.
    // The default Expo template uses Groovy build.gradle (not .kts) at the
    // project root. We match it permissively.
    const repoBlock = `
        maven {
            url "https://maven.pkg.github.com/facebook/meta-wearables-dat-android"
            credentials {
                username = ""
                password = System.getenv("GITHUB_TOKEN") ?: ""
            }
        }`;
    if (/allprojects\s*\{\s*repositories\s*\{/.test(gradleConfig.modResults.contents)) {
      gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
        /allprojects\s*\{\s*repositories\s*\{/,
        (match) => match + repoBlock,
      );
    } else {
      // Fallback — append a fresh allprojects block (rare on Expo SDK 54+
      // since the template ships one, but defensive).
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

// ─── Plugin entry point ─────────────────────────────────────────────
function withMetaWearablesDAT(config) {
  let next = config;
  next = withMavenRepo(next);
  next = withAppGradle(next, ENV_FALLBACK);
  next = withManifest(next);
  return next;
}

module.exports = withMetaWearablesDAT;
