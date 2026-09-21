/**
 * 2026-09-21 (Tim: "Now you fucking tell me we have not build the fucking watch app??????")
 *
 * He was right to be angry, and the guard that should have stopped it was already green.
 *
 * WHAT HAPPENED. `wear-os-app/` is a standalone Gradle project. No config plugin references it, no
 * eas.json profile builds it, and `npm run android:build:production` does not touch it. So its
 * source changed on 2026-09-09 and again on 2026-09-21 while the APK on disk was dated **July 29**,
 * and `versionCode` had never moved off 1. The phone half of the watch command path shipped in a
 * store build to a watch binary that predated both ends of it.
 *
 * WHY THE EXISTING GUARD MISSED IT. `the-watch-command-path-exists-on-both-ends.test.ts` greps two
 * `.kt` files for matching path constants. That proves the SOURCE agrees with itself, which was
 * never the question — an artifact six weeks older than the source passes it every time. A guard
 * that cannot see the thing that reaches the user certifies the draft.
 * [[a-guard-that-cannot-reach-the-artifact-certifies-the-draft]]
 *
 * WHAT THIS ASSERTS INSTEAD: the built artifact is not older than the source it claims to carry.
 * It is the one question the source-text guard structurally cannot ask.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const WEAR_SRC = path.join(ROOT, 'wear-os-app/app/src');
/**
 * 2026-09-21, second pass — WATCH THE ARTIFACT PLAY ACTUALLY TAKES.
 *
 * This watched only the APK, because that is what was on disk. Play's Wear OS upload slot requires
 * an **AAB** — Cowork hit that on the first attempt and discarded the draft release. So the thing
 * that reaches a wrist is the bundle, and a guard pointed at the APK would sit green while the
 * .aab went stale: the same defect one artifact along, which is how the original was missed.
 */
const ARTIFACTS = [
  'wear-os-app/app/build/outputs/bundle/release/app-release.aab',
  'wear-os-app/app/build/outputs/apk/release/app-release.apk',
].map(r => path.join(ROOT, r));

function newestMtime(dir: string): { file: string; mtime: number } {
  let newest = { file: '', mtime: 0 };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const hit = e.isDirectory() ? newestMtime(p) : { file: p, mtime: fs.statSync(p).mtimeMs };
    if (hit.mtime > newest.mtime) newest = hit;
  }
  return newest;
}

describe('the wear APK is not older than the source it claims to carry', () => {
  /**
   * Skipped rather than failed when no APK exists: a fresh clone or a CI box has never built it,
   * and failing there would train everyone to ignore this. The case that matters is a STALE
   * artifact sitting next to newer source, which is what actually happened.
   */
  const present = ARTIFACTS.filter(a => fs.existsSync(a));

  /**
   * RAW TIMESTAMPS, NOT DAYS. The first version of this rounded the gap to whole days, so it went
   * green on a source file edited minutes after the build — and its own break-test passed, which
   * is how the rounding got caught. The real case was six weeks and would have been caught either
   * way; the point is that a guard whose resolution is coarser than the thing it measures has a
   * blind spot exactly where "I just changed that" lives. [[break-test-every-gate]]
   */
  (present.length ? it : it.skip)('every built wear artifact is newer than the wear source', () => {
    const src = newestMtime(WEAR_SRC);
    const stale = present
      .filter(a => src.mtime > fs.statSync(a).mtimeMs)
      .map(a => path.relative(ROOT, a));
    expect({ newestSource: path.relative(ROOT, src.file), staleArtifacts: stale })
      .toEqual({ newestSource: path.relative(ROOT, src.file), staleArtifacts: [] });
  });

  /** Play's Wear slot takes a bundle. An APK alone means nothing is uploadable. */
  it('a Wear AAB exists — the APK alone cannot be uploaded to Play', () => {
    expect(fs.existsSync(ARTIFACTS[0])).toBe(true);
  });

  /**
   * applicationId MUST match the phone app or the Data Layer will not pair — and because it
   * matches, Play requires the versionCode to be unique across the listing. `1` collides with
   * every phone build.
   */
  it('carries a versionCode that cannot collide with a phone build', () => {
    const gradle = fs.readFileSync(path.join(ROOT, 'wear-os-app/app/build.gradle'), 'utf8');
    const appId = /applicationId\s+'([^']+)'/.exec(gradle)?.[1];
    const code = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
    const phone = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
      .expo.android.versionCode as number;

    expect(appId).toBe('com.smartplaycaddie.app');   // the pairing requirement
    expect(code).toBeGreaterThan(1000);              // the 1000-offset scheme
    expect(code).not.toBe(phone);                    // the Play requirement
  });
});
