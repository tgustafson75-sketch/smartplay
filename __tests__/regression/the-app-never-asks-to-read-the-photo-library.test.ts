/**
 * 2026-09-04 (build 24) — WRITE-ONLY MEANS WRITE-ONLY, AT ALL THREE CALL SITES.
 *
 * The app saves swing videos and caddie portraits to the camera roll. It has never READ the photo
 * library — every expo-media-library call is `saveToLibraryAsync`. But one of the three permission
 * requests, in app/profile/custom-caddie.tsx, called `requestPermissionsAsync()` with no argument,
 * which asks for FULL read+write. The two swinglab call sites already passed `true` (writeOnly).
 *
 * The cost was not a stray prompt. It put READ_MEDIA_IMAGES, READ_MEDIA_VIDEO and
 * READ_MEDIA_VISUAL_USER_SELECTED into the manifest, which made Google Play surface a "Photo and
 * video permissions" declaration in App content — a form asking us to justify access the app does
 * not use, for a build that would then be reviewed against that claim. The right fix was to make
 * the declaration DISAPPEAR, not to answer it.
 *
 * Two things have to hold together or the fix silently undoes itself:
 *   1. Every call site passes writeOnly. One that doesn't re-triggers the runtime prompt.
 *   2. The three permissions stay in android.blockedPermissions. Expo's permission merge is purely
 *      ADDITIVE — deleting them from the permissions array does nothing on its own, because the
 *      expo-media-library config plugin contributes them from its own manifest. This was learned
 *      the hard way on 2026-09-03 with READ_EXTERNAL_STORAGE, where a commit claimed they were
 *      removed and a prebuild proved they were not.
 *
 * Asserted at the source (app.json + the call sites) rather than on the generated manifest, because
 * android/ is gitignored and not present in CI. The manifest itself is checked at prebuild time —
 * see docs/LAUNCH-STATUS.md for why `grep -c READ_MEDIA` returning 4 there is correct.
 * [[no-half-fixes-enforce-every-surface]] [[an-invariant-has-three-homes]]
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const READ_MEDIA = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
];

const CALL_SITES = [
  path.join('app', 'profile', 'custom-caddie.tsx'),
  path.join('app', 'swinglab', 'swing', '[swing_id].tsx'),
];

describe('the app never asks to READ the photo library', () => {
  it('no media-read permission is requested in app.json', () => {
    const requested = (app.expo.android.permissions as string[]).filter(p => READ_MEDIA.includes(p));
    expect(requested).toEqual([]);
  });

  it('all three are blocked — deleting them from the array is NOT enough, the plugin re-adds them', () => {
    const blocked = app.expo.android.blockedPermissions as string[];
    for (const p of READ_MEDIA) expect(blocked).toContain(p);
  });

  it('the media-library plugin declares no granularPermissions', () => {
    const plugin = (app.expo.plugins as unknown[]).find(
      (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-media-library',
    );
    expect(plugin).toBeDefined();
    // photo/video here re-injects exactly the permissions blocked above.
    expect(plugin![1]).not.toHaveProperty('granularPermissions');
  });

  it('every requestPermissionsAsync on the media library passes writeOnly', () => {
    const offenders: string[] = [];
    for (const rel of CALL_SITES) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      // Strip comments first — two of these files DOCUMENT the bare form in a comment explaining
      // why it was wrong, and a naive match would read the prose as the defect.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // Only media-library requests: Audio.requestPermissionsAsync() is a different module.
      for (const m of code.matchAll(/(\w+)\.requestPermissionsAsync\(\s*([^)]*)\)/g)) {
        const [full, receiver, args] = m;
        if (!/^(ML|MediaLibrary)$/.test(receiver)) continue;
        if (args.trim() !== 'true') offenders.push(`${rel}: ${full}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the guard can see the call sites at all — a renamed file must fail loudly, not vacuously pass', () => {
    for (const rel of CALL_SITES) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(src).toMatch(/requestPermissionsAsync/);
    }
  });
});
