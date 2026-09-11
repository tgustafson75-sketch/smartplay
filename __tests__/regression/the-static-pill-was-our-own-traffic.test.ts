/**
 * 2026-09-10 (Tim, mid-round: "Static pill coming on and off ... mostly happens when courses like
 * today and Lakes last week are wrong") — THE FLICKER WAS OUR OWN 4-SECOND TICK.
 *
 * The data-strip pill reads:
 *     liveYardage != null ? 'LIVE' : geometryBuilding[courseId] ? 'MAPPING…' : 'STATIC'
 *
 * holeDetection calls fetchCourseGeometry for the active course on EVERY GPS fix (a 4s cadence) as
 * an opportunistic cache warm. On a course whose build produces nothing servable — no greens, which
 * is Hemet and Lakes — `cacheIsServable` is false, so nothing short-circuits and each tick after the
 * previous build finishes starts ANOTHER full build. markBuilding on the way in, markDone on the way
 * out: MAPPING…/STATIC for the whole round, and continuous Overpass traffic behind it.
 *
 * It only showed on "wrong" courses because a course with greens resolves a live yardage and never
 * reaches that branch — which is exactly the pattern Tim reported.
 *
 * scheduleGeometryRecheck already capped ITS path at two attempts, with a comment naming the same
 * badge-relighting complaint from Berlin. The opportunistic caller bypassed it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const geo = read('services/courseGeometryService.ts');

describe('the static pill was our own traffic', () => {
  it('the opportunistic caller is still the 4s tick — this is the thing being bounded', () => {
    // If this ever stops being true the cooldown below is solving a problem that moved.
    const hd = read('services/holeDetection.ts');
    expect(hd).toMatch(/void fetchCourseGeometry\(round\.activeCourseId\)/);
  });

  it('a build that produced nothing servable arms a cooldown', () => {
    expect(geo).toMatch(/const EMPTY_BUILD_COOLDOWN_MS = 90_000/);
    expect(geo).toMatch(/lastUnservableBuildAt\.set\(courseId, Date\.now\(\)\)/);
  });

  it('a build that DID produce greens clears it, so a working course is never held back', () => {
    expect(geo).toMatch(/mappedHoleCount\(result\) > 0\) lastUnservableBuildAt\.delete\(courseId\)/);
  });

  it('the cooldown is checked BEFORE markBuilding, or the badge still relights', () => {
    // The whole symptom is markBuilding being called; a cooldown that runs after it fixes nothing.
    const cooldownAt = geo.indexOf('lastUnservableBuildAt.get(courseId)');
    const markAt = geo.indexOf('geometryStatus().markBuilding(courseId)');
    expect(cooldownAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(-1);
    expect(cooldownAt).toBeLessThan(markAt);
  });

  it('a SERVABLE cache is never held back by the cooldown', () => {
    // Only an unservable course is throttled — a good one short-circuits inside anyway.
    expect(geo).toMatch(/if \(!\(cachedNow && cacheIsServable\(cachedNow\)\)\) \{/);
  });

  it('it agrees with the scheduled recheck rather than inventing a second number', () => {
    // Two paths pushing a course that cannot answer, at different rates, is how this started.
    expect(geo).toMatch(/RECHECK_DELAYS_MS = \[30_000, 90_000\]/);
    expect(geo).toMatch(/const EMPTY_BUILD_COOLDOWN_MS = 90_000/);
  });

  it('a purge clears the cooldown — "clear and refresh" has to mean it', () => {
    expect(geo).toMatch(/lastUnservableBuildAt\.delete\(courseId\);/);
    expect(geo).toMatch(/lastUnservableBuildAt\.clear\(\);/);
  });

  it('the test seam clears it too, so a seeded rebuild cannot silently no-op', () => {
    const at = geo.indexOf('export function _clearGeometryCache');
    expect(at).toBeGreaterThan(-1);
    expect(geo.slice(at, at + 400)).toMatch(/lastUnservableBuildAt\.clear\(\)/);
  });
});
