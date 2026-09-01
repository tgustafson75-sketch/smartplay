/**
 * 2026-08-31 (final clean pass) — THE INVARIANT THAT MATTERS, not the one a naive fuzz reports.
 *
 * Fuzzing the geo math with NaN produces NaN, and that is correct: these are pure functions and the
 * validation belongs at the boundary, which is where it is — `isValidGolfCoord` is applied at all
 * seven GPS entry points in gpsManager, and JSON cannot even encode NaN, so a server response
 * carries null instead and is rejected by the same guard.
 *
 * So the real invariant is the CONTRACT BETWEEN THEM: anything `isValidGolfCoord` accepts must
 * produce a finite, sane number downstream. A yardage on screen is the single most consequential
 * number this app renders — a wrong one costs a golfer a shot — so it is worth pinning that the
 * guard is actually sufficient rather than merely present.
 */
import { isValidGolfCoord } from '../../utils/coordGuard';
import { isImplausibleYardage } from '../../utils/yardagePlausibility';
import { haversineYards, haversineMeters, bearingDegrees, destinationPoint } from '../../utils/geoDistance';

/** Real golf latitudes/longitudes plus the edges the guard still admits. */
const LATS = [36.5686, 30.1985, 40.0, 51.5, -33.86, 64.1, -0.002, 89.9, -89.9];
const LNGS = [-121.95, -81.3944, -75.0, -0.12, 151.2, -21.9, 0.002, 179.9, -179.9];
const VALID: { lat: number; lng: number }[] = [];
for (const lat of LATS) for (const lng of LNGS) if (isValidGolfCoord(lat, lng)) VALID.push({ lat, lng });

describe('every coordinate the guard accepts yields a usable number', () => {
  it('the guard admits real golf coordinates and rejects the nonsense', () => {
    expect(VALID.length).toBeGreaterThan(50);
    for (const bad of [[NaN, 0], [Infinity, 1], [0, 0], [91, 0], [0, 181], [null, null], [undefined, 2]] as const) {
      expect([bad, isValidGolfCoord(bad[0] as number, bad[1] as number)]).toEqual([bad, false]);
    }
  });

  it('distance and bearing are always finite and in range', () => {
    for (const a of VALID) for (const b of VALID) {
      const yd = haversineYards(a, b), m = haversineMeters(a, b), brg = bearingDegrees(a, b);
      expect(Number.isFinite(yd) && Number.isFinite(m) && Number.isFinite(brg)).toBe(true);
      expect(yd).toBeGreaterThanOrEqual(0);
      expect(brg).toBeGreaterThanOrEqual(0);
      expect(brg).toBeLessThan(360.0000001);
    }
  });

  it('a point projected from a valid coordinate is itself valid', () => {
    for (const p of VALID.slice(0, 30)) for (const d of [0, 1, 50, 200, 400]) for (const brg of [0, 90, 180, 270, 359]) {
      const r = destinationPoint(p, d, brg) as { lat: number; lng: number };
      expect([p, d, brg, Number.isFinite(r.lat) && Number.isFinite(r.lng)]).toEqual([p, d, brg, true]);
    }
  });

  it('a zero-length measurement is zero, not NaN — the same point twice', () => {
    for (const p of VALID.slice(0, 20)) {
      expect(haversineYards(p, p)).toBe(0);
      expect(Number.isFinite(bearingDegrees(p, p))).toBe(true);
    }
  });
});

/**
 * 2026-08-31 — NaN ESCAPES EVERY COMPARISON, which is how a sanity clamp stops being one.
 *
 * The yardage clamps read `(yards.middle ?? 0) > maxYds`. `NaN > maxYds` is FALSE, so a non-finite
 * yardage passed the clamp, returned with `reason: 'ok'`, and yardageResolver accepted it on a
 * `!= null` check — rendering it as `gps_live` at HIGH confidence, the tier that outranks
 * everything else. That is the "reports over 7000 yards for a hole" failure mode wearing a
 * different number.
 *
 * Latent rather than live — isValidGolfCoord rejects non-finite coordinates at all seven GPS entry
 * points and JSON cannot encode NaN — but closed because the cost is one line and a confidently
 * wrong yardage is the most expensive thing this app can say.
 */
describe('a sanity clamp must reject what it cannot compare', () => {
  const maxYds = 500;
  /**
   * 2026-08-31, second pass — THE REAL PREDICATE, not a copy.
   *
   * The first version of this mirrored the maths, because smartFinderService pulls in native
   * modules the logic project cannot load. That test would have passed even if the shipped clamp
   * said something different — proving nothing about the most consequential number this app shows.
   * The predicate now lives in utils/yardagePlausibility; smartFinderService calls it at all three
   * clamps and so does this.
   */
  const implausible = (v: number | null | undefined): boolean => isImplausibleYardage(v, maxYds);

  it('REJECTS non-finite — the case a bare > silently admits', () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      expect([v, implausible(v)]).toEqual([v, true]);
      // ...and this is what the old form did with the same value:
      expect((v ?? 0) > maxYds).toBe(v === Infinity);
    }
  });

  it('REJECTS a negative distance, which no measurement can produce', () => {
    expect(implausible(-1)).toBe(true);
  });

  it('still accepts every real yardage, and still rejects the absurd one', () => {
    for (const v of [0, 1, 137, 150, 499, 500]) expect([v, implausible(v)]).toEqual([v, false]);
    expect(implausible(7000)).toBe(true);
  });

  it('leaves null alone — "no reading" is not an implausible reading', () => {
    expect(implausible(null)).toBe(false);
    expect(implausible(undefined)).toBe(false);
  });

  it('all three shipped clamps call the shared predicate — no local copy survives', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services/smartFinderService.ts'), 'utf8');
    expect((src.match(/isImplausibleYardage\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // The bare comparison that NaN walks through must not come back.
    expect(src).not.toMatch(/\(yards\.middle \?\? 0\) > maxYds/);
  });
});
