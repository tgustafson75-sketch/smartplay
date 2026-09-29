/**
 * 2026-09-29 — R8 IS ON FOR ANDROID RELEASE BUILDS, AND ITS KEEP RULES ARE PART OF THE BINARY.
 *
 * Play Console: "Obfuscation (2%) … fix by Feb 2027". R8 was never enabled. It is now, through
 * expo-build-properties in app.json; the local release build (with the Sentry/RevenueCat bumps)
 * measured 89.8% of 29,223 classes renamed in mapping.txt.
 *
 * R8 deletes or renames whatever it cannot see being used. What it cannot see is reflection, JNI,
 * and class names written as STRINGS — in a manifest, in meta-data, in SharedPreferences. A missing
 * keep fails only in a release build, never in dev, and not necessarily on the first screen.
 *
 * The first R8 build proved the point. expo-modules-core names its headless app loader only in
 * manifest meta-data, so R8 deleted expo.modules.adapters.react.apploader.RNHeadlessAppLoader
 * outright (ClassNotFoundException in logcat on every cold start). expo-task-manager's TaskService
 * does `getAppLoader().loadApp(...)` when a background-location event arrives with the app process
 * dead — an NPE, on the round's background GPS path. Nothing upstream keeps it; the rule here does.
 *
 * Each rule below names a thing R8 cannot see. Deleting one is a release-only crash.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
type Plugin = string | [string, Record<string, unknown>];
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as { expo: { plugins: Plugin[] } };
const opts = (name: string) => {
  const p = cfg.expo.plugins.find((x) => Array.isArray(x) && x[0] === name) as [string, Record<string, unknown>] | undefined;
  return p?.[1];
};
const android = (opts('expo-build-properties')?.android ?? {}) as Record<string, unknown>;
const rules = String(android.extraProguardRules ?? '');
/** Rule lines only — the comments in the string describe the rules and must not satisfy the guard. */
const ruleLines = rules.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
const has = (line: string) => ruleLines.some((l) => l.trim() === line);

describe('R8 on Android release builds', () => {
  it('is enabled, with resource shrinking', () => {
    expect(android.enableProguardInReleaseBuilds).toBe(true);
    expect(android.enableShrinkResourcesInReleaseBuilds).toBe(true);
  });

  it.each([
    // reached from manifest meta-data only; stripped in the first R8 build (see header)
    '-keep class expo.modules.adapters.react.apploader.** { *; }',
    // our own modules from android-native/, registered by plugins/with*.js
    '-keep class com.smartplaycaddie.** { *; }',
    // MediaPipe: JNI + protobuf-lite reflection
    '-keep class com.google.mediapipe.** { *; }',
    '-keep class * extends com.google.protobuf.GeneratedMessageLite { *; }',
    // vision-camera ships no consumer rules
    '-keep class com.mrousavy.camera.** { *; }',
    // billing bridge
    '-keep class com.revenuecat.purchases.react.** { *; }',
    '-keep class com.revenuecat.purchases.hybridcommon.** { *; }',
    // crash reporting bridge
    '-keep class io.sentry.react.** { *; }',
  ])('keeps %s', (line) => {
    expect(has(line)).toBe(true);
  });

  it('the android-native packages are all under a kept prefix', () => {
    const dir = path.join(root, 'android-native');
    const pkgs = fs.readdirSync(dir).filter((f) => f.endsWith('.kt'))
      .map((f) => /^package\s+([\w.]+)/m.exec(fs.readFileSync(path.join(dir, f), 'utf8'))?.[1])
      .filter((p): p is string => !!p);
    expect(pkgs.length).toBeGreaterThanOrEqual(5);
    const kept = ruleLines.map((l) => /^-keep class ([\w.]+)\.\*\* \{ \*; \}$/.exec(l.trim())?.[1]).filter(Boolean) as string[];
    const uncovered = pkgs.filter((p) => !kept.some((k) => p === k || p.startsWith(`${k}.`)));
    expect(uncovered).toEqual([]);
  });

  it('uploads the R8 mapping to Sentry, or every native Android crash arrives obfuscated', () => {
    const exp = (opts('@sentry/react-native')?.experimental_android ?? {}) as Record<string, unknown>;
    expect(exp.enableAndroidGradlePlugin).toBe(true);
    expect(exp.includeProguardMapping).toBe(true);
    expect(exp.autoUploadProguardMapping).toBe(true);
  });
});
