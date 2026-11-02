#!/usr/bin/env node
/**
 * Builds the Wear OS release bundle, but only when it matches the phone build it ships beside.
 *
 * The Wear app shares applicationId com.smartplaycaddie.app with the phone, so Play treats the two
 * as one listing and needs unique versionCodes across both artifacts. Convention (see the comment in
 * wear-os-app/app/build.gradle): Wear versionCode = 1000 + phone versionCode, and versionName equals
 * the phone's version. This refuses to build when either drifts, so a watch bundle can never be
 * produced for the wrong phone build.
 *
 * Signing: wear-os-app/keystore.properties must point at the EAS-managed keystore, or the Data Layer
 * will not pair with the phone. Without it Gradle falls back to the debug key and the script says so.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wearDir = join(root, 'wear-os-app');

const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const phoneVersion = app.version;
const phoneCode = Number(app.android?.versionCode);

const gradle = readFileSync(join(wearDir, 'app', 'build.gradle'), 'utf8');
const wearCode = Number(gradle.match(/^\s*versionCode\s+(\d+)/m)?.[1]);
const wearName = gradle.match(/^\s*versionName\s+'([^']+)'/m)?.[1];

const problems = [];
if (!Number.isInteger(phoneCode)) problems.push('app.json android.versionCode is not an integer');
if (wearCode !== 1000 + phoneCode) {
  problems.push(`wear versionCode ${wearCode} must be ${1000 + phoneCode} (1000 + phone versionCode ${phoneCode})`);
}
if (wearName !== phoneVersion) {
  problems.push(`wear versionName '${wearName}' must match app.json version '${phoneVersion}'`);
}
if (problems.length) {
  console.error('[wear-build] REFUSED — the watch bundle does not match the phone build:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('  Fix wear-os-app/app/build.gradle (or app.json) so they agree, then rerun.');
  process.exit(1);
}

const signed = existsSync(join(wearDir, 'keystore.properties'));
console.log(`[wear-build] phone ${phoneVersion} (${phoneCode}) ↔ wear ${wearName} (${wearCode}) — OK`);
console.log(`[wear-build] signing: ${signed ? 'EAS keystore (keystore.properties)' : 'DEBUG FALLBACK — will not pair with the phone'}`);

const gradlew = join(wearDir, 'gradlew');
const result = spawnSync(gradlew, [':app:bundleRelease', '--no-daemon'], { cwd: wearDir, stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[wear-build] gradle bundleRelease failed');
  process.exit(result.status ?? 1);
}

const aab = join(wearDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
if (!existsSync(aab)) {
  console.error(`[wear-build] expected ${aab} and it is missing`);
  process.exit(1);
}
console.log(`[wear-build] AAB: ${aab}`);
console.log('[wear-build] upload to the wear:production track (separate from production)');
