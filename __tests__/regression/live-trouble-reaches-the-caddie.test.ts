import { computeHazardIntelligence } from '../../services/hazardIntelligence';
import type { HoleGeometry } from '../../services/courseGeometryService';

/**
 * 2026-08-22 (Tim, after a round at Greenhill) — "generic advice because we're also not reading and
 * using the vision to see what the hole is. It says 'watch out for hazards', not WHERE the hazards
 * are, which is what we spent all last night building."
 *
 * computeHazardIntelligence was extracted from the SmartFinder screen so anything could use it, and
 * then only SmartFinder called it. Playing a round with SmartFinder closed, the caddie had no idea a
 * bunker sat right at 205 — so it said "hit it straight" on a dogleg.
 */
describe('the caddie knows WHERE the trouble is', () => {
  // A bunker ~200y out and clearly RIGHT of the player→green line.
  const player = { lat: 42.3600, lng: -71.7000 };
  const green = { lat: 42.3618, lng: -71.7000 };   // due north
  const bunkerRight = { lat: 42.3616, lng: -71.6994 };

  const geometry = {
    hole: 5,
    tee: player,
    green,
    hazards: [{ label: 'Bunker', location: bunkerRight }],
  } as unknown as HoleGeometry;

  it('a shot playing DUE NORTH still gets a side (bearing 0 is a heading, not a missing value)', () => {
    // `!shotBearingDeg` was a falsy check on a number: bearing 0 collapsed every hazard to 'center',
    // so the caddie could not say "bunker right" on any hole that plays due north.
    const intel = computeHazardIntelligence(player, geometry, null, 0);
    expect(intel!.side).toBe('right');
  });

  it('names a side and a distance rather than "watch out for hazards"', () => {
    const intel = computeHazardIntelligence(player, geometry, null, 0 /* bearing due north */);
    expect(intel).not.toBeNull();
    expect(intel!.side).toBe('right');
    expect(intel!.front).toBeGreaterThan(50);
    expect(Number.isFinite(intel!.front)).toBe(true);
  });

  it('separates REACHING the trouble from CARRYING it — different clubs', () => {
    const intel = computeHazardIntelligence(player, geometry, null, 0);
    expect(intel!.carryToClear).toBeGreaterThanOrEqual(intel!.front);
  });

  it('returns null rather than guessing when there is no geometry or no fix', () => {
    expect(computeHazardIntelligence(null, geometry, null, 0)).toBeNull();
    expect(computeHazardIntelligence(player, null, null, 0)).toBeNull();
  });
});

describe('it reaches the brain through the ONE shared block', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');
  const retrieval = read('services/caddieMemoryRetrieval.ts');

  it('getCaddieContext computes live trouble', () => {
    expect(retrieval).toMatch(/function liveTroubleLine/);
    expect(retrieval).toMatch(/computeHazardIntelligence/);
    expect(retrieval).toMatch(/const trouble = liveTroubleLine\(input\.courseId, input\.hole\)/);
  });

  it('puts the measured fact FIRST, ahead of the learned priors', () => {
    // Everything else in the block is a prior; this is the shot the player is standing over.
    expect(retrieval).toMatch(/lines\.unshift\(trouble\)/);
  });

  it('does not depend on SmartFinder being open — it reads GPS and geometry directly', () => {
    expect(retrieval).toMatch(/gpsManager/);
    expect(retrieval).toMatch(/getHoleGeometry/);
    expect(retrieval).not.toMatch(/smartFinderStore/);
  });

  it('every brain path already reads this block, so no route needs plumbing again', () => {
    for (const f of [
      'hooks/useVoiceCaddie.ts',
      'hooks/useKevin.ts',
      'services/pipecatContext.ts',
      'services/conversationalBrain.ts',
      'services/intents/inRoundDiagnosticHandler.ts',
    ]) {
      expect(read(f)).toMatch(/getCaddieContext\(/);
    }
  });
});
