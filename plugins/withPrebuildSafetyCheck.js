/**
 * 2026-05-23 — Prebuild safety check.
 *
 * Runs at the end of prebuild AFTER all other plugins have mutated
 * the AndroidManifest. Reads the merged manifest text and warns
 * LOUDLY in the build log if any known crash-suspect class still
 * appears as an active provider or initializer. The log line shows
 * up clearly in EAS Build output — if a future EAS build crashes,
 * a quick scroll of the prebuild log reveals which classes survived
 * our defensive strips.
 *
 * This is informational only — it never fails the build. The user's
 * choice is: ignore the warning (build proceeds) or update the
 * removal list in the relevant plugin.
 *
 * Known crash-suspect classes (compiled from public Android crash
 * reports + community bug threads, 2024-2026):
 *   - androidx.startup.InitializationProvider — sourcing init for
 *     many libs; failures here predate Application.onCreate
 *   - androidx.profileinstaller.ProfileInstallerInitializer — PGO
 *     profile install bug on specific OEM kernels
 *   - com.google.firebase.provider.FirebaseInitProvider — Firebase
 *   - com.google.firebase.crashlytics.ndk.CrashlyticsNdkInitProvider
 *   - com.facebook.appevents.AppEventsLoggerInitProvider — Meta
 *     analytics auto-init
 *   - androidx.work.impl.WorkManagerInitializer — WorkManager 2.6+
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const KNOWN_RISKY_CLASSES = [
  'androidx.startup.InitializationProvider',
  'androidx.profileinstaller.ProfileInstallerInitializer',
  'com.google.firebase.provider.FirebaseInitProvider',
  'com.google.firebase.crashlytics.ndk.CrashlyticsNdkInitProvider',
  'com.facebook.appevents.AppEventsLoggerInitProvider',
  'androidx.work.impl.WorkManagerInitializer',
];

function withPrebuildSafetyCheck(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      try {
        const manifestPath = path.join(
          modConfig.modRequest.platformProjectRoot,
          'app', 'src', 'main', 'AndroidManifest.xml',
        );
        if (!fs.existsSync(manifestPath)) {
          console.log('[withPrebuildSafetyCheck] AndroidManifest.xml not present yet — skipping scan.');
          return modConfig;
        }
        const contents = fs.readFileSync(manifestPath, 'utf-8');
        const stillActive = [];
        for (const cls of KNOWN_RISKY_CLASSES) {
          // Look for the class name with NO tools:node="remove" on
          // the same provider/initializer entry. The regex is loose
          // — false positives are OK because this is informational.
          const idx = contents.indexOf(cls);
          if (idx < 0) continue;
          // Slice ±400 chars around the match to inspect for the
          // tools:node="remove" attribute. If absent, this class is
          // still active in the merged manifest.
          const window = contents.slice(Math.max(0, idx - 200), Math.min(contents.length, idx + 200));
          if (!window.includes('tools:node="remove"')) {
            stillActive.push(cls);
          }
        }
        if (stillActive.length === 0) {
          console.log('[withPrebuildSafetyCheck] ✓ all known-risky auto-init providers are stripped or absent.');
        } else {
          console.warn(
            '\n[withPrebuildSafetyCheck] ⚠ The following known-risky auto-init classes are still active in the merged manifest:\n' +
            stillActive.map((c) => '  - ' + c).join('\n') +
            '\n  If the next build crashes at launch, these are the prime suspects. Add a' +
            ' tools:node="remove" provider entry in the relevant config plugin to strip them.\n',
          );
        }
      } catch (e) {
        console.warn('[withPrebuildSafetyCheck] scan failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);
}

module.exports = withPrebuildSafetyCheck;
