/**
 * 2026-09-03 (pre-release audit) — the SmartVision layup marker was drawn PAST the hazard it named.
 *
 * computeLayupSuggestion chose `Math.max(hazard - 30, totalDist - 110)`. The max picks whichever
 * candidate is farther from the tee, so a 400-yard hole with a reachable hazard at 250 produced a
 * target at 290 — forty yards beyond it — labelled "Lay up short of the {hazard}". It fired whenever
 * totalDist > hazard + 80, i.e. nearly every par 4 and essentially every par 5, so the advice was
 * inverted on most holes it appeared on.
 *
 * The invariant is one sentence, and it is the whole feature: a layup target is short of the hazard.
 */
import { computeLayupSuggestion, computeDangerCarries } from '../../services/smartVisionOverlay';
import type { HoleGeometry } from '../../services/courseGeometryService';

// ~1 yard of latitude ≈ 0.0000082°. Build a due-north hole so distances are easy to reason about.
const YARD_LAT = 1 / 121_000;
const TEE = { lat: 33.0, lng: -117.0 };
const at = (yardsFromTee: number) => ({ lat: TEE.lat + yardsFromTee * YARD_LAT, lng: TEE.lng });

function hole(par: number, lengthYards: number, hazards: { label: string; yards: number }[]): HoleGeometry {
  return {
    hole_number: 7,
    par,
    tee: TEE,
    green: at(lengthYards),
    hazards: hazards.map(h => ({ label: h.label, location: at(h.yards) })),
  } as unknown as HoleGeometry;
}

/** Distance from tee to the suggested point, in yards, along the same axis. */
const yardsOut = (lat: number) => Math.round((lat - TEE.lat) / YARD_LAT);

describe('computeLayupSuggestion', () => {
  it('puts the target SHORT of a reachable hazard, not past it', () => {
    const g = hole(4, 400, [{ label: 'creek', yards: 250 }]);
    const carries = computeDangerCarries(g, 260);
    const layup = computeLayupSuggestion(g, carries);
    expect(layup).not.toBeNull();
    const out = yardsOut(layup!.position.lat);
    // The old Math.max produced 290 here — forty yards INTO the creek it was warning about.
    expect(out).toBeLessThan(250);
    expect(out).toBeCloseTo(220, -1);
    expect(layup!.detail).toContain('creek');
  });

  it('lays up to a comfortable wedge when that is already short of the hazard', () => {
    // Hazard at 350 on a 400y hole: 110-in (290) is safer AND shorter than hazard-30 (320).
    const g = hole(5, 400, [{ label: 'bunker', yards: 350 }]);
    const layup = computeLayupSuggestion(g, computeDangerCarries(g, 360));
    expect(yardsOut(layup!.position.lat)).toBeCloseTo(290, -1);
  });

  it('lays up short of the NEAREST hazard in range, not whichever is listed first', () => {
    // A bunker at 260 listed before a creek at 200. Laying up short of the bunker still finds water.
    const g = hole(4, 420, [{ label: 'bunker', yards: 260 }, { label: 'creek', yards: 200 }]);
    const layup = computeLayupSuggestion(g, computeDangerCarries(g, 270));
    expect(layup!.detail).toContain('creek');
    expect(yardsOut(layup!.position.lat)).toBeLessThan(200);
  });

  it('suggests nothing rather than a marker at or behind the tee', () => {
    // A hazard 20 yards out leaves no layup to make; hazard-30 is negative.
    const g = hole(4, 400, [{ label: 'ditch', yards: 20 }]);
    expect(computeLayupSuggestion(g, computeDangerCarries(g, 250))).toBeNull();
  });

  it('says nothing when no hazard is reachable', () => {
    const g = hole(4, 400, [{ label: 'creek', yards: 300 }]);
    expect(computeLayupSuggestion(g, computeDangerCarries(g, 180))).toBeNull();
  });
});
