/**
 * 2026-10-15 (review G3a) — runStartRound (app/(tabs)/caddie.tsx) and the boot guard (app/_layout.tsx).
 *
 * Finding 6. Location denied: roundStore.startRound asks in a fire-and-forget block and discards the
 * round — but runStartRound had already run incrementRounds(), activated a ghost and pushed
 * /round/briefing. A briefing spoken for a discarded round, roundsTogether +1. Location is now
 * answered BEFORE startRound(), and a denial returns without starting.
 *
 * Finding 7. The in-flight lock was released by a 5s setTimeout; the course-card lookup alone can
 * take 12s (golfCourseApi's detail fetch timeout), so a second Start slipped through and replaced the
 * first round — counted twice. The lock is now released by the exits themselves (a finally around
 * startRound), never by a timer.
 *
 * Finding 8. The map-lookup line ("Got the map…" / no-map) answered with no round identity check —
 * it showed after End Round or in the next round.
 *
 * Finding 11. The boot guard treated an empty course name as a phantom and discarded the round even
 * with scores; and runStartRound could start with '' (it overwrote its own 'Unknown Course' fallback).
 *
 * STRUCTURAL: both are component bodies (caddie.tsx ~5,500 lines; _layout.tsx the app root). These
 * pin the ordering and the conditions each bug turned on.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const caddie = read('app/(tabs)/caddie.tsx');
const fnStart = caddie.indexOf('const runStartRound = useCallback(async (');
const fnEnd = caddie.indexOf('runStartRoundRef.current = runStartRound;', fnStart);
const run = caddie.slice(fnStart, fnEnd);

describe('runStartRound', () => {
  it('slices', () => { expect(fnStart).toBeGreaterThan(0); expect(fnEnd).toBeGreaterThan(fnStart); });

  it('asks for location BEFORE the round exists, and a denial starts nothing (finding 6)', () => {
    const askAt = run.indexOf('requestForegroundPermissionsAsync()');
    const startAt = run.indexOf('startRound(courseName, holes, {');
    const countAt = run.indexOf('incrementRounds();');
    const briefingAt = run.indexOf("router.push('/round/briefing'");
    expect(askAt).toBeGreaterThan(0);
    expect(askAt).toBeLessThan(startAt);
    expect(startAt).toBeLessThan(countAt);
    expect(countAt).toBeLessThan(briefingAt);
    const denied = run.slice(run.indexOf('if (!perm.granted) {', askAt), startAt);
    expect(denied).toMatch(/startRoundInFlightRef\.current = false;/);
    expect(denied).toMatch(/return;/);
  });

  it('the in-flight lock is released by its exits, not a timer (finding 7)', () => {
    expect(run).not.toMatch(/setTimeout\(\(\) => \{ startRoundInFlightRef\.current = false; \}/);
    // startRound is wrapped so the lock is released even if it throws
    expect(run).toMatch(/try \{\s*startRound\(courseName, holes, \{[\s\S]*?\}\);\s*\} finally \{[\s\S]*?startRoundInFlightRef\.current = false;\s*\}/);
  });

  it('the map line speaks only into the round that asked for it (finding 8)', () => {
    expect(run).toMatch(/const launchedRoundId = useRoundStore\.getState\(\)\.currentRoundId;/);
    expect(run).toMatch(/st\.isRoundActive && st\.currentRoundId === launchedRoundId/);
    const geo = run.slice(run.indexOf('const geom = await fetchCourseGeometry('), run.indexOf('// 2026-05-21 — Fix N'));
    // every setCaddieResponse in the map block sits behind the identity check
    expect((geo.match(/setCaddieResponse\(/g) ?? []).length).toBe(3);
    expect((geo.match(/if \(isApiCourse && stillThisRound\(\)\) \{/g) ?? []).length).toBe(2);
    expect(geo).not.toMatch(/if \(isApiCourse\) \{/);
  });

  it('never starts a round with an empty course name (finding 11)', () => {
    expect(run).toMatch(/courseName = picked\.name \|\| 'Unknown Course';/);
    expect(run).not.toMatch(/courseName = picked\.name;/);
  });
});

describe('the boot guard never discards a round that has scores (finding 11)', () => {
  const layout = read('app/_layout.tsx');
  const a = layout.indexOf('useEffect(() => whenRoundStoreHydrated(() => {');
  const guard = layout.slice(a, layout.indexOf('}), []);', a));

  it('an empty course name is not a phantom marker when the round has scores', () => {
    expect(guard).toMatch(/const missingMarkers = brokenIdentity \|\| \(!s\.activeCourse && !hasScores\);/);
    expect(guard).not.toMatch(/const missingMarkers = !s\.currentRoundId \|\| !s\.activeCourse \|\| !s\.roundStartTime;/);
  });

  it('any scored round that trips the guard is finalized, only an unscored one discards', () => {
    const finalizeAt = guard.indexOf('if (hasScores) {');
    expect(finalizeAt).toBeGreaterThan(0);
    expect(guard.indexOf('s.endRound()', finalizeAt)).toBeGreaterThan(finalizeAt);
    expect(guard).not.toMatch(/tooOld && !missingMarkers && hasScores/);
  });
});
