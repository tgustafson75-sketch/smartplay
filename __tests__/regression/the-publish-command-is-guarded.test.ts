/**
 * 2026-09-09 (Tim: "dont leave anything open") — THE CI GUARD PROTECTED THE PATH NOBODY USES.
 *
 * `.github/workflows/ota-guard.yml` blocks a native change from reaching an OTA, and it runs on
 * `pull_request` only. OTAs here are published with `npm run ota:production` from a laptop, which
 * never touches CI. The gate was real and unreachable.
 *
 * It matters more here than in most repos: app.json pins `runtimeVersion` to the literal "1.0.0", so
 * Expo delivers an update to EVERY binary sharing it — including the build sitting in the store. JS
 * that expects native code the installed shell lacks crashes on launch, and a launch crash cannot
 * download the update that fixes it.
 *
 * With no release tags and nothing recording which commit produced the installed shell, a git-diff
 * baseline would be a guess. `scripts/ota-preflight.mjs` fingerprints the native surface instead and
 * stores the hash beside the runtimeVersion it belongs to, so the rule needs no history:
 *
 *     native fingerprint changed AND runtimeVersion did not → REFUSE
 *
 * which is exactly Expo's own contract.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const preflight = read('scripts/ota-preflight.mjs');

describe('every publish command runs the preflight', () => {
  const publishScripts = Object.entries(pkg.scripts).filter(([, v]) => /eas update/.test(v));

  it('finds the publish commands at all', () => {
    expect(publishScripts.length).toBeGreaterThanOrEqual(2);
  });

  it.each(publishScripts)('%s is gated', (_name, cmd) => {
    // The check must run BEFORE eas update, and && means a refusal stops the publish.
    expect(cmd).toMatch(/^node scripts\/ota-preflight\.mjs && eas update/);
  });

  it('there is a way to re-record the baseline, and it is not the same command as publishing', () => {
    expect(pkg.scripts['ota:baseline']).toBe('node scripts/ota-preflight.mjs --write');
    expect(pkg.scripts['ota:baseline']).not.toContain('eas update');
  });
});

describe('the preflight watches the whole native surface', () => {
  it('covers the authored native dirs, not just the generated projects', () => {
    for (const d of ['android-native', 'ios-native', 'plugins', 'targets', 'wear-os-app', 'patches', 'ios', 'android']) {
      expect(preflight).toContain(`'${d}'`);
    }
  });

  it('skips build output — a derived directory would make every run differ', () => {
    for (const d of ['build', 'node_modules', 'Pods']) expect(preflight).toContain(`'${d}'`);
  });

  it('treats package.json DEPENDENCIES as native, and its scripts as not', () => {
    /**
     * 2026-09-09 — the first version of this asserted on the script's own PROSE and failed because
     * the sentence wrapped across two comment lines. Fifth time this sprint I have leaned on prose;
     * the answer is not a better regex, it is to assert on what the code DOES. It hashes the
     * dependency maps and nothing else from package.json.
     */
    const code = preflight.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
    expect(code).toContain('pkg.dependencies');
    expect(code).toContain('pkg.devDependencies');
    expect(code).not.toContain('pkg.scripts');
  });

  it('has no override flag — the refusal offers a store build, never a bypass', () => {
    const code = preflight.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
    expect(code).not.toMatch(/--force|SKIP_OTA|ALLOW_NATIVE/);
  });
});

describe('the recorded baseline is real and current', () => {
  const baseline = JSON.parse(read('.ota-native-baseline.json')) as {
    runtimeVersion: string; hash: string; fileCount: number;
  };

  it('exists, or the preflight refuses every publish until someone records one', () => {
    expect(baseline.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(baseline.fileCount).toBeGreaterThan(50);
  });

  it('names the runtimeVersion it belongs to — the comparison is meaningless without it', () => {
    const app = JSON.parse(read('app.json')) as { expo: { runtimeVersion: unknown } };
    expect(baseline.runtimeVersion).toBe(app.expo.runtimeVersion);
  });
});
