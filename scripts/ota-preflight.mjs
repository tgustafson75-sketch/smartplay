#!/usr/bin/env node
/**
 * scripts/ota-preflight.mjs — REFUSE AN OTA THAT CARRIES A NATIVE CHANGE.
 *
 * 2026-09-09 (72-hour triple-check) — .github/workflows/ota-guard.yml already blocks this, and it
 * runs on `pull_request` only. OTAs here are published with `npm run ota:production` from a laptop,
 * which never touches CI. The guard was protecting the path nobody uses.
 *
 * WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE: app.json pins `runtimeVersion` to the literal string
 * "1.0.0". Expo delivers an update to every binary sharing that runtimeVersion, so an OTA published
 * today goes straight to the build sitting in the store. If the JS in it expects native code that
 * binary does not have, the app crashes on launch — and a launch crash cannot download the update
 * that would fix it. The only recourse is a store release users must be told to install.
 *
 * HOW IT DECIDES. There are no release tags in this repo and nothing records which commit produced
 * the installed shell, so a git-diff baseline would be a guess. Instead it FINGERPRINTS the native
 * surface — every file that can change the binary — and stores that hash next to the runtimeVersion
 * it belongs to. Then the rule is exact and needs no history:
 *
 *     native fingerprint changed  AND  runtimeVersion did not  →  REFUSE
 *
 * That is precisely Expo's own contract. Changing native code is allowed; shipping it to a shell
 * built before it, under the same runtimeVersion, is not.
 *
 * `npm run ota:baseline` re-records the fingerprint. Run it when a STORE BUILD ships, because that
 * is the moment the installed shell catches up with the source.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const BASELINE = join(root, '.ota-native-baseline.json');

/**
 * Everything that can change the native binary. Deliberately wider than the CI guard's original
 * list, which watched only the GENERATED projects and missed every directory the native source is
 * actually authored in.
 */
const NATIVE_DIRS = ['android-native', 'ios-native', 'plugins', 'targets', 'wear-os-app', 'ios', 'android', 'patches'];

/**
 * 2026-09-11 — DIRECTORIES .easignore EXCLUDES CANNOT REACH A BINARY, SO THEY MUST NOT MOVE THE
 * FINGERPRINT.
 *
 * `ios/` and `android/` are prebuild OUTPUT in this CNG project, and `.easignore` lines 35-36 keep
 * them out of the tarball uploaded to EAS — the build server regenerates them from app.json and
 * plugins/. They existed locally only as leftovers from a `expo-updates fingerprint:generate` run.
 *
 * Deleting those leftovers — a pure cleanup that cannot change any artifact — moved this hash and
 * refused a prose-only OTA. That is worse than a false alarm: the only documented ways past it are
 * "ship a store build" or "re-record the baseline", and re-recording for a reason the note does not
 * cover is how a guard quietly becomes a rubber stamp. So the fingerprint now covers exactly what
 * can reach the build: anything .easignore excludes is skipped.
 *
 * Read from .easignore rather than hardcoded, so the two cannot drift.
 */
const easIgnored = (() => {
  try {
    return readFileSync(join(root, '.easignore'), 'utf8')
      .split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/\/$/, ''))
      .filter(Boolean);
  } catch { return []; }
})();
const isExcludedFromBuild = (relPath) =>
  easIgnored.some((pat) => relPath === pat || relPath.startsWith(`${pat}/`));
const NATIVE_FILES = ['app.json', 'app.config.js', 'app.config.ts'];

/**
 * 2026-09-13 — eas.json is hashed with its `EXPO_PUBLIC_*` env values REMOVED, for the same reason
 * package.json contributes its dependencies only (see below): a change that cannot reach the native
 * build must not refuse an OTA, or the check trains you to ignore it.
 *
 * An `EXPO_PUBLIC_*` value is inlined into the JS BUNDLE at export — so it travels WITH the update
 * rather than living in the installed shell. It is definitionally incapable of being the hazard this
 * script exists to catch ("JS expects native code the shell does not have"), because the JS and the
 * value ship together.
 *
 * EVERY OTHER KEY IN eas.json STAYS HASHED, and that is not caution for its own sake — plugins in this
 * repo really do read env at build time. `plugins/withMetaWearablesDAT.js` gates Info.plist entries and
 * Gradle changes on `MWDAT_IOS_ENABLED` / `MWDAT_ANDROID_ENABLED`, so the `glasses` profile's env
 * genuinely changes native output. Excluding env wholesale would have defeated the guard for a live
 * case. Checked rather than assumed: no config plugin reads an `EXPO_PUBLIC_` key — the full set they
 * read is EXPO_GITHUB_TOKEN, GITHUB_TOKEN, META_WEARABLE_APP_ID, META_WEARABLE_CLIENT_TOKEN and the two
 * MWDAT flags — and `__tests__/regression/ota-envelope-is-honest.test.ts` fails if that stops being
 * true, which is what keeps this narrowing safe rather than merely convenient.
 *
 * What prompted it: adding EXPO_PUBLIC_OWNER_EMAIL to the development and preview profiles — so owner
 * mode stops depending on a runtime default that would have made every install an owner — moved the
 * fingerprint and refused an otherwise pure-JS update.
 */
function easJsonNativeSurface() {
  try {
    const raw = readFileSync(join(root, 'eas.json'), 'utf8');
    const parsed = JSON.parse(raw);
    for (const profile of Object.values(parsed.build ?? {})) {
      if (profile && typeof profile === 'object' && profile.env && typeof profile.env === 'object') {
        for (const key of Object.keys(profile.env)) {
          if (key.startsWith('EXPO_PUBLIC_')) delete profile.env[key];
        }
      }
    }
    return JSON.stringify(parsed);
  } catch {
    // Unreadable or unparseable eas.json: hash the bytes so a broken file still moves the fingerprint.
    try { return readFileSync(join(root, 'eas.json'), 'utf8'); } catch { return ''; }
  }
}
/** Build output and caches are derived, not authored — hashing them would make every run differ. */
const SKIP_DIRS = new Set(['build', 'node_modules', '.gradle', 'Pods', 'DerivedData', '.cxx', 'generated']);

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function fingerprint() {
  const files = [];
  for (const d of NATIVE_DIRS) {
    if (isExcludedFromBuild(d)) continue;   // .easignore keeps it out of the build entirely
    const abs = join(root, d);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs, files);
  }
  for (const f of NATIVE_FILES) {
    const abs = join(root, f);
    if (existsSync(abs)) files.push(abs);
  }
  // package.json contributes its DEPENDENCIES only: a script edit or version bump is not a native
  // change, and failing on those trains you to ignore the check — which is how a real one gets through.
  const h = createHash('sha256');
  const listed = [];
  for (const f of files.sort()) {
    const rel = relative(root, f).split(sep).join('/');
    let buf;
    try { buf = readFileSync(f); } catch { continue; }
    h.update(rel); h.update(buf);
    listed.push(rel);
  }
  h.update('eas.json');
  h.update(easJsonNativeSurface());
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    h.update(JSON.stringify(Object.keys(deps).sort().map((k) => `${k}@${deps[k]}`)));
  } catch { /* no package.json is its own problem */ }
  return { hash: h.digest('hex'), fileCount: listed.length };
}

function runtimeVersion() {
  try {
    const a = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo || {};
    return typeof a.runtimeVersion === 'string' ? a.runtimeVersion : JSON.stringify(a.runtimeVersion ?? null);
  } catch { return 'unknown'; }
}

const now = fingerprint();
const rv = runtimeVersion();

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    note: 'Native fingerprint of the shell currently in the stores. Re-record with `npm run ota:baseline` when a STORE BUILD ships.',
    runtimeVersion: rv, hash: now.hash, fileCount: now.fileCount, recordedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(`[ota-preflight] baseline recorded — runtimeVersion ${rv}, ${now.fileCount} native files.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error([
    '',
    '  OTA REFUSED — no native baseline recorded.',
    '',
    '  This check cannot tell whether the JS you are about to publish matches the native shell',
    '  already installed on phones. Publishing blind is the launch-crash case: a crash on launch',
    '  cannot download the update that fixes it.',
    '',
    '  If the current source IS what the store build was made from:',
    '      npm run ota:baseline',
    '',
  ].join('\n'));
  process.exit(1);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));

if (base.hash === now.hash) {
  console.log(`[ota-preflight] native unchanged since the store build (runtimeVersion ${rv}). OK to publish.`);
  process.exit(0);
}

if (base.runtimeVersion !== rv) {
  console.log([
    `[ota-preflight] native CHANGED and runtimeVersion moved ${base.runtimeVersion} → ${rv}.`,
    '[ota-preflight] That is the correct pairing: this update cannot reach the older shell. OK to publish.',
  ].join('\n'));
  process.exit(0);
}

console.error([
  '',
  '  OTA REFUSED — native code changed and runtimeVersion did not.',
  '',
  `  runtimeVersion is still "${rv}", so Expo would deliver this update to the binary already in`,
  '  the store. If that JS expects native code the installed shell does not have, the app crashes',
  '  on launch — and a launch crash cannot download the OTA that would fix it.',
  '',
  '  Two ways forward, and only two:',
  '',
  '    1. Ship a STORE BUILD instead (this is a native change, so it is not an OTA at all):',
  '         npm run android:build:production   /   npm run ios:ship',
  '       Then, once it is live:  npm run ota:baseline',
  '',
  '    2. If the native change is NOT in this update and the baseline is simply stale — you already',
  '       shipped a store build with it — re-record and re-run:',
  '         npm run ota:baseline',
  '',
  '  There is no override flag. A native change is not an OTA that needs care; it is a store build.',
  '',
].join('\n'));
process.exit(1);
