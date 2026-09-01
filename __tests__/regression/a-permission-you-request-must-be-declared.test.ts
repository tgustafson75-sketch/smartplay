/**
 * 2026-09-01 (Tim's Android issue log, twice in one round:
 * `bgLocation.skip_foreground_service — POST_NOTIFICATIONS not granted — BG GPS pocket-tracking disabled`).
 *
 * backgroundLocationTask asks for POST_NOTIFICATIONS at runtime, correctly and defensively. It could
 * never be granted: the permission was NOT declared in app.json, and on Android 13+ the system will
 * not even show the dialog for a permission absent from the merged manifest — the request returns
 * denied immediately, every time, for every player on every round.
 *
 * So the round quietly lost phone-in-pocket tracking and the code faithfully logged a reason that
 * looked like a user choice ("not granted") when the user was never asked. The same missing
 * permission is named in this file's own header as the root cause of the Z Fold "app closes on Start
 * Round" crash — which is the device Tim reported from.
 *
 * A runtime request for an undeclared permission is a request that cannot succeed. Guard the SHAPE.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
  expo: { android: { permissions: string[] } };
};
const declared = new Set(appJson.expo.android.permissions);

describe('every Android permission the code requests is declared in the manifest', () => {
  it('POST_NOTIFICATIONS is declared — the one that was missing', () => {
    expect(declared.has('android.permission.POST_NOTIFICATIONS')).toBe(true);
  });

  it('the foreground-service permissions it rides with are still declared', () => {
    for (const p of [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    ]) expect(declared.has(p)).toBe(true);
  });

  it('THE CLASS: no source file requests an android.permission.* that app.json does not declare', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.tsx?$/.test(e.name)) files.push(f);
      }
    };
    for (const d of ['services', 'app', 'components', 'store', 'hooks', 'utils']) {
      const p = path.join(root, d);
      if (fs.existsSync(p)) walk(p);
    }
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/['"`](android\.permission\.[A-Z_]+)['"`]/g)) {
        if (!declared.has(m[1]) && !missing.includes(`${path.relative(root, f)} -> ${m[1]}`)) {
          missing.push(`${path.relative(root, f)} -> ${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
