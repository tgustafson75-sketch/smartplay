/**
 * 2026-08-30 — Force MANUAL code signing on the Apple Watch target.
 *
 * THE FAILURE THIS FIXES. iOS build 13 died in "Run fastlane" with:
 *
 *   No profiles for 'com.smartplaycaddie.app.watchkitapp' were found: Xcode couldn't find any iOS
 *   App Development provisioning profiles matching 'com.smartplaycaddie.app.watchkitapp'.
 *   Automatic signing is disabled and unable to generate a profile.
 *
 * Reading the generated project explains it exactly. `CODE_SIGN_STYLE = Automatic` appears twice —
 * the watch target's Debug and Release configurations — and PROVISIONING_PROFILE_SPECIFIER appears
 * nowhere. The main app target carries no CODE_SIGN_STYLE line at all, which is why EAS's manual
 * credential injection lands on it cleanly and not on the watch.
 *
 * So the watch target asks Xcode to mint a profile on the fly, EAS has switched automatic signing
 * off for a store build, and the target is left with neither. It is NOT a missing credential: EAS
 * created and stored an App Store profile for that bundle id during the interactive run on 08-30.
 * The target simply was not configured to use one.
 *
 * WHY apple-targets' OWN MOD HOOK, AND NOT withXcodeProject OR withDangerousMod. I tried both and
 * both ran too early — each warned that no matching build configuration existed, while the finished
 * project on disk plainly had two. @bacons/apple-targets does not use the standard xcodeproj mod:
 * it installs its own base mod (`withXcodeProjectBetaBaseMod`) and writes the watch target in that
 * separate phase, so nothing registered in the normal phases can see its output no matter where it
 * sits in the app.json plugins array. Registering through its exported `withXcodeProjectBeta` puts
 * this edit in the same phase, after theirs.
 *
 * Both failed attempts warned loudly rather than passing quietly. That is the only reason this took
 * two prebuilds instead of two more failed cloud builds twenty minutes apart.
 *
 * The edit is target-scoped: it walks build configurations and only rewrites ones whose
 * PRODUCT_BUNDLE_IDENTIFIER is the watch app. The main target's signing stays entirely EAS's
 * business.
 *
 * ⚠️ SEPARATE, STILL OPEN: targets/watch/expo-target.config.js documents
 * EvanBacon/expo-apple-targets#175 — prebuild can emit a MISSING "Embed Watch Content" phase, so a
 * build can go green and still ship no watch app. This fixes SIGNING only. Verify the .ipa actually
 * contains Watch/*.app before believing the watch shipped.
 */

const { withXcodeProjectBeta } = require('@bacons/apple-targets/build/with-bacons-xcode');

const WATCH_BUNDLE_ID = 'com.smartplaycaddie.app.watchkitapp';

function withWatchTargetSigning(config) {
  return withXcodeProjectBeta(config, (cfg) => {
    const project = cfg.modResults;
    let changed = 0;

    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      // Comment entries (`KEY_comment`) are plain strings, not objects — skip them.
      if (!entry || typeof entry !== 'object' || !entry.buildSettings) continue;

      const settings = entry.buildSettings;
      const bundleId = String(settings.PRODUCT_BUNDLE_IDENTIFIER ?? '').replace(/"/g, '');
      if (bundleId !== WATCH_BUNDLE_ID) continue;
      if (settings.CODE_SIGN_STYLE !== 'Automatic') continue;

      // Manual, so the provisioning profile EAS injects for this bundle id is actually honoured.
      settings.CODE_SIGN_STYLE = 'Manual';
      changed += 1;
    }

    if (changed === 0) {
      // Loud, never silent. A quiet no-op here is a build that fails twenty minutes later with an
      // error message that says nothing about this plugin.
      console.warn(
        `[withWatchTargetSigning] WARNING: no Automatic-signing configuration found for ` +
        `${WATCH_BUNDLE_ID}. Either the watch target was renamed/removed, or apple-targets changed ` +
        'how it emits signing. If the iOS build fails on provisioning, start here.',
      );
    } else {
      console.log(`[withWatchTargetSigning] set CODE_SIGN_STYLE=Manual on ${changed} watch configuration(s)`);
    }

    return cfg;
  });
}

module.exports = withWatchTargetSigning;
