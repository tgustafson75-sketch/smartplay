/**
 * 2026-09-11 (full-app audit) — THE RIGHT VALUE AT THE WRONG MOMENT.
 *
 * Earlier the same day, SmartFinder's spoken callout was given `calloutElevationFeet` so the plays-
 * like it announces would stop disagreeing with the number on the card — on an elevated green that
 * gap is a full club. The value was passed into playsLikeDistance. The effect was never told to
 * DEPEND on it.
 *
 * useElevationDeltaStatus starts at `{ deltaFeet: 0, hasData: false }` and resolves asynchronously,
 * and the callout speaks exactly once (calloutSpokenRef). So on the common path the effect fired the
 * moment the yardage resolved, read a not-yet-loaded 0, announced the shot as if the green were
 * level, and could never correct itself. Right value, wrong moment — a half-wired fix, and the same
 * shape as the live-practice insight that never fired.
 *
 * Found by react-hooks/exhaustive-deps, not by reading the diff.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../app/smartfinder.tsx'), 'utf8');

describe('the spoken callout waits for the elevation', () => {
  it('depends on the elevation, so it re-evaluates when it lands', () => {
    const at = src.indexOf('calloutSpokenRef.current = true');
    expect(at).toBeGreaterThan(-1);
    const depsAt = src.indexOf('}, [isRoundActive, voiceEnabled, trustLevel', at);
    expect(depsAt).toBeGreaterThan(-1);
    const deps = src.slice(depsAt, depsAt + 320);
    expect(deps).toMatch(/calloutElevationFeet/);
    expect(deps).toMatch(/calloutElevation\.hasData/);
  });

  it('holds back while the elevation is still unresolved', () => {
    expect(src).toMatch(/if \(!calloutElevation\.hasData\) \{/);
    expect(src).toMatch(/calloutEligibleSinceRef\.current < ELEVATION_GRACE_MS\) return;/);
  });

  it('but only for a bounded window — a course with no elevation data must not go silent', () => {
    // hasData is false both while loading AND when the course genuinely has none. Waiting forever
    // would trade a slightly wrong number for no caddie at all, which is the worse failure.
    expect(src).toMatch(/const ELEVATION_GRACE_MS = \d+;/);
    const ms = Number(/const ELEVATION_GRACE_MS = (\d+);/.exec(src)![1]);
    expect(ms).toBeGreaterThan(500);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it('still speaks only once', () => {
    expect(src).toMatch(/if \(calloutSpokenRef\.current\) return;/);
    expect([...src.matchAll(/calloutSpokenRef\.current = true/g)]).toHaveLength(1);
  });

  it('and still passes the elevation into the plays-like maths', () => {
    expect(src).toMatch(/playsLikeDistance\(middle, caddieWeather, shotBearingDeg, calloutElevationFeet\)/);
  });
});
