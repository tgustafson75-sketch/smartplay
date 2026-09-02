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

  it('the two platform build numbers no longer drift', () => {
    expect(app.expo.android.versionCode).toBe(Number(app.expo.ios.buildNumber));
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
