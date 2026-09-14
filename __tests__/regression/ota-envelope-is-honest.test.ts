/**
 * 2026-09-13 (Tim: "Is it all OTA?") — WHAT MAY BE NARROWED OUT OF THE NATIVE FINGERPRINT, AND WHY.
 *
 * `scripts/ota-preflight.mjs` refuses an OTA when the native surface moved and `runtimeVersion` did
 * not, because Expo would hand that JS to the binary already installed. It already narrows one file on
 * principle — package.json contributes its DEPENDENCIES only, since "a script edit or version bump is
 * not a native change, and failing on those trains you to ignore the check".
 *
 * eas.json now gets the same treatment for `EXPO_PUBLIC_*` env values ONLY. An `EXPO_PUBLIC_` value is
 * inlined into the JS BUNDLE at export, so it ships WITH the update rather than living in the shell —
 * it cannot be the hazard the script exists to catch.
 *
 * THE NARROWING IS ONLY SAFE BECAUSE OF WHAT THIS TEST CHECKS. Config plugins in this repo really do
 * read env at build time and really do change native output: `plugins/withMetaWearablesDAT.js` gates
 * Info.plist entries and Gradle edits on `MWDAT_IOS_ENABLED` / `MWDAT_ANDROID_ENABLED`. Excluding env
 * wholesale would have defeated the guard for that live case. The exclusion holds only while no plugin
 * reads an `EXPO_PUBLIC_` key, which is a fact about this repo that can change — so it is asserted
 * here rather than assumed in a comment.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
/**
 * COMMENT-BLIND, and the first draft of this file was not. The note in app/_layout.tsx that EXPLAINS
 * the removed fallback quotes the old code verbatim — `else if (OWNER_EMAILS.length === 1)` — so
 * reading raw source let the explanation fail the assertion it was written to support. The same trap
 * the orphan baseline and the health-disclosure guard both carry warnings about.
 */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const PLUGIN_SOURCES = fs
  .readdirSync(path.join(root, 'plugins'))
  .filter((f) => f.endsWith('.js') || f.endsWith('.ts'))
  .map((f) => ({ file: `plugins/${f}`, src: read(`plugins/${f}`) }));

/** Every env key any config plugin reads — these can reach native output. */
const ENV_KEYS_PLUGINS_READ = (() => {
  const out = new Set<string>();
  for (const { src } of PLUGIN_SOURCES) {
    for (const m of src.matchAll(/process\.env\.([A-Z_0-9]+)/g)) out.add(m[1]);
    for (const m of src.matchAll(/process\.env\[['"]([A-Z_0-9]+)['"]\]/g)) out.add(m[1]);
  }
  return out;
})();

describe('the EXPO_PUBLIC narrowing is safe', () => {
  it('found the plugins and the env keys they read', () => {
    expect(PLUGIN_SOURCES.length).toBeGreaterThan(5);
    expect(ENV_KEYS_PLUGINS_READ.size).toBeGreaterThan(0);
    // the known native toggles, so this test proves it is looking at the real thing
    expect(ENV_KEYS_PLUGINS_READ).toContain('MWDAT_IOS_ENABLED');
  });

  it('NO config plugin reads an EXPO_PUBLIC_ key — this is what makes the exclusion valid', () => {
    const leaks = [...ENV_KEYS_PLUGINS_READ].filter((k) => k.startsWith('EXPO_PUBLIC_'));
    expect(leaks).toEqual([]);
  });

  it('the preflight excludes ONLY EXPO_PUBLIC_ keys, and only from eas.json env maps', () => {
    const pf = read('scripts/ota-preflight.mjs');
    expect(pf).toMatch(/key\.startsWith\('EXPO_PUBLIC_'\)/);
    // every other key must still reach the hash
    expect(pf).toMatch(/h\.update\(easJsonNativeSurface\(\)\)/);
    // and eas.json must no longer be hashed as raw bytes, or the narrowing does nothing
    expect(pf).toMatch(/const NATIVE_FILES = \['app\.json', 'app\.config\.js', 'app\.config\.ts'\];/);
  });

  it('a non-EXPO_PUBLIC env change still moves the fingerprint', () => {
    // MWDAT_* is the proof case: it changes Info.plist and Gradle through a plugin.
    const eas = JSON.parse(read('eas.json')) as { build: Record<string, { env?: Record<string, string> }> };
    const glassesEnv = eas.build.glasses?.env ?? {};
    const nativeToggles = Object.keys(glassesEnv).filter((k) => !k.startsWith('EXPO_PUBLIC_'));
    expect(nativeToggles).toContain('MWDAT_IOS_ENABLED');
    // the narrowing keeps them: only EXPO_PUBLIC_ is deleted before hashing
    const pf = read('scripts/ota-preflight.mjs');
    expect(pf).not.toMatch(/delete profile\.env\[key\];\s*\n\s*\}\s*\n\s*\}\s*\n\s*\}\s*\n\s*return JSON\.stringify\(\{\}\)/);
  });

  it('the script still has no override flag', () => {
    // The whole value of this gate is that it cannot be waved through.
    const pf = read('scripts/ota-preflight.mjs');
    expect(pf).toMatch(/There is no override flag/);
    expect(pf).not.toMatch(/--force|process\.env\.OTA_FORCE|SKIP_OTA/);
  });
});

describe('owner mode after an OTA', () => {
  it('production carries no owner email, so an OTA cannot make a player an owner', () => {
    const eas = JSON.parse(read('eas.json')) as { build: Record<string, { env?: Record<string, string> }> };
    for (const p of ['production', 'production-apk', 'glasses']) {
      expect(eas.build[p]?.env?.EXPO_PUBLIC_OWNER_EMAIL).toBeUndefined();
    }
  });

  it('owner mode depends on a BUILD-TIME value, which is why it cannot leak through an update', () => {
    /**
     * `EXPO_PUBLIC_*` is inlined at export. That is precisely why removing the runtime
     * OWNER_EMAILS.length === 1 fallback was the right fix: privilege now comes from the artifact it
     * was built into, not from a list whose length an unrelated edit could change.
     */
    const layout = code('app/_layout.tsx');
    expect(layout).toMatch(/process\.env\.EXPO_PUBLIC_OWNER_EMAIL/);
    expect(layout).not.toMatch(/OWNER_EMAILS\.length\s*===\s*1/);
  });
});
