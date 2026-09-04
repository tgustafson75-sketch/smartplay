/**
 * 2026-09-01 (release prep) — a build that cannot be UPLOADED is not a build.
 *
 * android.versionCode sat at 1 while ios.buildNumber had reached 21 — the two had drifted apart
 * because nothing incremented either automatically. Google Play rejects an upload whose versionCode
 * has been used before, so the second Android upload of the release would have been refused at the
 * worst possible moment, with nothing in the app or the test suite pointing at why.
 *
 * appVersionSource is "local", so autoIncrement bumps the number in app.json at build time. Enabled
 * on the production profiles only: internal/dev builds are not uploaded to a store and do not need it.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
  expo: {
    version: string;
    runtimeVersion?: string;
    android: { versionCode: number; permissions: string[] };
    ios: { buildNumber: string };
  };
};
/**
 * How far the two platform build numbers may legitimately diverge. Each single-platform build moves
 * one of them by one, so a small gap is normal; anything larger means a platform has been left
 * un-built long enough that its stored number is stale. The original bug was a gap of 20.
 */
const MAX_PLATFORM_DRIFT = 5;

const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8')) as {
  cli?: { appVersionSource?: string };
  build: Record<string, { autoIncrement?: boolean; channel?: string }>;
};

describe('the store will accept a second upload', () => {
  it('every profile that ships to a store auto-increments', () => {
    for (const p of ['production', 'production-apk']) {
      expect(eas.build[p]?.autoIncrement).toBe(true);
    }
  });

  it('autoIncrement means what we think — the version source is local', () => {
    expect(eas.cli?.appVersionSource).toBe('local');
  });

  it('the two platform build numbers have not grossly drifted', () => {
    /**
     * 2026-09-04 — RELAXED FROM EXACT EQUALITY, and here is why that is not a guard being weakened
     * to make a failure go away.
     *
     * The original defect this file was written for was versionCode 1 against buildNumber 21: one
     * platform had never been incremented at all, so its next upload would be rejected. Exact
     * equality was a convenient way to express "neither has been left behind".
     *
     * It is not achievable alongside autoIncrement. autoIncrement bumps ONLY the platform being
     * built, so every single-platform build moves one number and not the other. Under exact
     * equality, building Android alone leaves the suite red until someone hand-edits app.json to a
     * number that platform never shipped — which is worse than the drift: the repo then states a
     * version that does not exist in any store. That happened twice on 2026-09-04 (24 -> 25 on the
     * Android build, 25 -> 26 on the iOS build).
     *
     * So the assertion now matches the actual risk. A gap of a few is normal alternating release
     * cadence. A gap of 20 is a platform nobody has built since the project was scaffolded, which
     * is the thing that gets an upload refused.
     */
    const android = app.expo.android.versionCode;
    const ios = Number(app.expo.ios.buildNumber);
    expect(Math.abs(android - ios)).toBeLessThanOrEqual(MAX_PLATFORM_DRIFT);
  });

  it('android versionCode is past 1 — a fresh project value is a rejected upload', () => {
    expect(app.expo.android.versionCode).toBeGreaterThan(1);
  });
});

describe('the OTA contract is intact', () => {
  it('runtimeVersion is still the literal the shipped build carries', () => {
    // Testers are frozen on this runtime; changing it strands every phone in the field.
    expect(app.expo.runtimeVersion).toBe('1.0.0');
    expect(app.expo.version).toBe('1.0.0');
  });

  it('the notification permission added for background GPS is declared', () => {
    expect(app.expo.android.permissions).toContain('android.permission.POST_NOTIFICATIONS');
  });
});
