/**
 * 2026-09-10 — three GPS gates that could not do their job at the cadence the app actually runs at.
 *
 * 1. THE JUMP-OUTLIER GATE COULD NOT RUN DURING A ROUND. It required
 *    `(raw.timestamp - lastFix.timestamp) < 5_000`, and POLL_CONFIG delivers walking fixes 10s
 *    apart and stationary fixes 20s apart — so outside `active` mode the condition was false on
 *    every tick and the only surviving position filter was the 300m absolute gate. A 60-290m
 *    cell-tower handoff landed straight in lastFix and every yardage derived from it.
 *
 *    Widening the window would be wrong: 50m over 10s is a cart moving normally. The rule's real
 *    content is a SPEED — 50m in 5s is 10 m/s — and stated that way it holds at any cadence.
 *
 * 2. bumpToActive WIPED THE SMOOTHING BUFFER, and smartFinderService.peekFix calls it every 3-4s
 *    from three surfaces. The 5-sample smoother never filled, so the yardage jittered on raw GPS
 *    precisely while the player was reading it.
 *
 * 3. coordGuard REJECTED A ~111m BAND around the prime meridian and the equator — an `||`, so a
 *    longitude near Greenwich disqualified a coordinate however valid its latitude. That band runs
 *    through eastern England, France, Spain and Ghana, and production is live in 176 countries.
 */
import fs from 'fs';
import path from 'path';
import { isValidGolfCoord } from '../../utils/coordGuard';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const gps = read('services/gpsManager.ts');
const sf = read('services/smartFinderService.ts');

describe('the jump gate is a speed rule, not a 5-second window', () => {
  it('no longer gates on a fixed window it cannot satisfy', () => {
    // The comment explaining the fix quotes the old expression on purpose, so assert there is no
    // live CODE line using it — the same trap as asserting a tombstone's absence.
    const live = gps.split('\n').filter(l => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*')) return false;
      return /\(raw\.timestamp - lastFix\.timestamp\) < OUTLIER_JUMP_WINDOW_MS/.test(l);
    });
    expect(live).toEqual([]);
  });

  it('rejects on implied speed instead', () => {
    expect(gps).toMatch(/const impliedMps = jump \/ \(dtMs \/ 1000\)/);
    expect(gps).toMatch(/impliedMps > OUTLIER_MAX_IMPLIED_MPS/);
  });

  it('the threshold is DERIVED from the original rule, not a new guess', () => {
    expect(gps).toMatch(/OUTLIER_MAX_IMPLIED_MPS = OUTLIER_JUMP_M \/ \(OUTLIER_JUMP_WINDOW_MS \/ 1000\)/);
  });

  it('guards a non-positive time gap rather than dividing by it', () => {
    expect(gps).toMatch(/if \(dtMs > 0\) \{/);
  });

  it('the 300m absolute backstop is untouched', () => {
    expect(gps).toMatch(/OUTLIER_ABSOLUTE_JUMP_M = 300/);
  });
});

describe('the polled peek does not discard the smoothing history', () => {
  it('peekFix opts out of the reset', () => {
    expect(sf).toMatch(/bumpToActive\('smartfinder_peek', \{ resetSmoothing: false \}\)/);
  });

  it('every other caller keeps the old behaviour by default', () => {
    // The option defaults to resetting, so a mark or an explicit refresh is unchanged.
    expect(gps).toMatch(/if \(opts\?\.resetSmoothing !== false\) smoothingBuffer = \[\];/);
  });

  it('an explicit refresh still resets — that one genuinely wants the raw position', () => {
    expect(sf).toMatch(/bumpToActive\('smartfinder_refresh'\)/);
  });
});

describe('a course on the prime meridian is a real course', () => {
  it('accepts a coordinate just east of Greenwich', () => {
    expect(isValidGolfCoord(51.4769, 0.0004)).toBe(true);
    expect(isValidGolfCoord(51.4769, -0.0004)).toBe(true);
  });

  it('accepts a coordinate just north of the equator', () => {
    expect(isValidGolfCoord(0.0004, 36.8219)).toBe(true);
  });

  it('still rejects the {0,0} placeholder', () => {
    expect(isValidGolfCoord(0, 0)).toBe(false);
  });

  it('still rejects the half-null placeholder golfcourseapi produces', () => {
    // {37.4, 0} — a malformed record, which is what the band was really defending against.
    expect(isValidGolfCoord(37.4, 0)).toBe(false);
    expect(isValidGolfCoord(0, -116.9)).toBe(false);
  });

  it('still rejects the null-island NEIGHBOURHOOD — both axes near zero', () => {
    // My first cut dropped this band entirely and two existing guards caught it. A near-zero PAIR
    // is a placeholder; only the axis-by-axis form was wrong.
    expect(isValidGolfCoord(0.0001, 0.0001)).toBe(false);
    expect(isValidGolfCoord(-0.0005, 0.0005)).toBe(false);
  });

  it('the band is an AND, not an OR', () => {
    const src = read('utils/coordGuard.ts');
    expect(src).toMatch(/Math\.abs\(lat\) < 0\.001 && Math\.abs\(lng\) < 0\.001/);
  });

  it('still rejects out-of-range and non-finite values', () => {
    expect(isValidGolfCoord(91, 10)).toBe(false);
    expect(isValidGolfCoord(10, 181)).toBe(false);
    expect(isValidGolfCoord(NaN, 10)).toBe(false);
    expect(isValidGolfCoord(null, null)).toBe(false);
  });

  it('smartFinderService no longer keeps a hand-copied duplicate of the rule', () => {
    expect(sf).toMatch(/function safeLoc[\s\S]{0,300}isValidGolfCoord\(lat, lng\)/);
    expect(sf).not.toMatch(/Math\.abs\(lat\) < 0\.001 \|\| Math\.abs\(lng\) < 0\.001/);
  });
});
