/**
 * 2026-09-23 (Tim — "SmartVision images correctly every time") — a green that vision FOUND (no
 * surveyed coordinate) is checked against the scorecard from a known tee before it is kept. Before,
 * only a vision-read TEE was checked; a wrong green was cached and framed as this hole for good.
 * Through the real derivation, with the scan service answering "green dead centre".
 */
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/', EncodingType: { Base64: 'base64' },
  downloadAsync: async () => ({ status: 200 }), readAsStringAsync: async () => 'AAAA', deleteAsync: async () => undefined,
}));

import fs from 'fs';
import path from 'path';
import { deriveHoleGeometry, seedIsFor, seedRejectedNearby, _clearSeedRejectionsForTest } from '../../services/holeGeometryDerivation';

const GREEN = { lat: 33.6830, lng: -117.1790 };
// A known tee ~400 yards due south of that green.
const TEE_400 = { lat: GREEN.lat - 400 / 1.09361 / 110540, lng: GREEN.lng };

describe('a green vision found has to agree with the card', () => {
  beforeEach(() => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ found_green: true, green_center: { x: 0.5, y: 0.5 }, green_front: null, green_back: null, tee: null, confidence: 'high', notes: '' }),
    }));
  });

  it('a 400-yard card with the found green 400 yards from the known tee: kept', async () => {
    const g = await deriveHoleGeometry({ seed: GREEN, holeNumber: 5, par: 4, yardage: 400, knownTee: TEE_400 });
    expect(g?.green).toBeTruthy();
  });

  it('a 150-yard card with the found green 400 yards from the known tee: a different green, discarded', async () => {
    const g = await deriveHoleGeometry({ seed: GREEN, holeNumber: 5, par: 3, yardage: 150, knownTee: TEE_400 });
    expect(g).toBeNull();
  });

  it('no known tee or no card length: nothing to check against, so the read stands as before', async () => {
    expect(await deriveHoleGeometry({ seed: GREEN, holeNumber: 5, par: 3, yardage: 150, knownTee: null })).toBeTruthy();
    expect(await deriveHoleGeometry({ seed: GREEN, holeNumber: 5, par: 4, yardage: null, knownTee: TEE_400 })).toBeTruthy();
  });

  it('a SURVEYED green is never second-guessed by the card', async () => {
    const g = await deriveHoleGeometry({ seed: GREEN, holeNumber: 5, par: 3, yardage: 150, knownTee: TEE_400, knownGreen: GREEN });
    expect(g?.green).toEqual(GREEN);
  });

  /**
   * 2026-10-03 — Tim at Hemet: "yardage started wrong on hole one". No green in any source, no tee,
   * so the round start asked vision for the green nearest the PLAYER — at the pro shop, the practice
   * green or 18 — and cached it as hole 1. Before a shot on the hole, the player is at the tee, so
   * the green has to be about a tee shot away.
   */
  it('round start, no tee known: a green right next to the player is not hole 1 (322y card)', async () => {
    const g = await deriveHoleGeometry({ seed: GREEN, holeNumber: 1, par: 4, yardage: 322, knownTee: null, seedIs: 'tee' });
    expect(g).toBeNull();
  });

  it('mid-hole, the green can be close — but never farther than the card', async () => {
    expect(await deriveHoleGeometry({ seed: GREEN, holeNumber: 1, par: 4, yardage: 322, knownTee: null, seedIs: 'on_hole' })).toBeTruthy();
  });
});

/**
 * 2026-10-04 (sweep) — three holes in the 10-03 fix:
 *   1. the SmartVision map's own search never passed `seedIs`, so the check never ran there;
 *   2. a rightly-rejected green burned the hole's only attempt — "wrong green" became "no green";
 *   3. one logged shot (even a mistaken one, or a tee shot logged ON the tee) loosened the check.
 */
const yardsNorth = (p: { lat: number; lng: number }, y: number) => ({ lat: p.lat + y / 1.09361 / 110540, lng: p.lng });

describe('where the player is on the hole', () => {
  const at = { lat: 33.68, lng: -117.18 };
  it('no shots, or a shot logged right where the player stands: still at the tee', () => {
    expect(seedIsFor([], at)).toBe('tee');
    expect(seedIsFor([{ start_location: yardsNorth(at, 5) }], at)).toBe('tee');
    expect(seedIsFor([{ start_location: null, gps_location: null }], at)).toBe('tee');
  });
  it('walked away from a shot logged on this hole: on the hole', () => {
    expect(seedIsFor([{ start_location: yardsNorth(at, -220) }], at)).toBe('on_hole');
    expect(seedIsFor([{ gps_location: yardsNorth(at, -60) }], at)).toBe('on_hole');
  });
});

describe('a green refused from where the player stood is tried again once they move', () => {
  beforeEach(() => {
    _clearSeedRejectionsForTest();
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ found_green: true, green_center: { x: 0.5, y: 0.5 }, green_front: null, green_back: null, tee: null, confidence: 'high', notes: '' }),
    }));
  });
  it('the pro-shop refusal is remembered for that spot only', async () => {
    const g = await deriveHoleGeometry({ seed: GREEN, holeNumber: 1, par: 4, yardage: 322, knownTee: null, seedIs: 'tee', courseId: 'hemet' });
    expect(g).toBeNull();
    expect(seedRejectedNearby('hemet', 1, yardsNorth(GREEN, 10))).toBe(true);    // still standing there
    expect(seedRejectedNearby('hemet', 1, yardsNorth(GREEN, -120))).toBe(false); // walked to the tee
    expect(seedRejectedNearby('hemet', 2, GREEN)).toBe(false);                    // another hole
  });
});

describe('both callers that search for a green run the card check, and free the hole to retry', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  it.each(['services/holeDetection.ts', 'app/smartvision.tsx'])('%s', (f) => {
    const src = read(f);
    expect(src).toMatch(/seedIs: seedIsFor\(/);
    expect(src).toMatch(/seedRejectedNearby\(courseId, (hole|holeIndex), (at|playerPt2)\)\) (greenDeriveAttempts|svDeriveAttempts)\.delete/);
  });
  it('every deriveHoleGeometry call without a surveyed green passes seedIs', () => {
    for (const f of ['services/holeDetection.ts', 'app/smartvision.tsx']) {
      const calls = read(f).split('deriveHoleGeometry({').slice(1).map((t) => t.slice(0, 2500));
      const searching = calls.filter((c) => !/knownGreen:\s*(?!null)/.test(c.split('});')[0]));
      for (const c of searching) expect(c.split('});')[0]).toMatch(/seedIs:/);
    }
  });
});


describe('a score being tapped in survives the app going to the background (sweep 2026-10-04)', () => {
  it('the strip flushes its pending entry on any AppState change away from active', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/CaddieDataStrip.tsx'), 'utf8');
    expect(src).toMatch(/AppState\.addEventListener\('change', \(st\) => \{ if \(st !== 'active'\) commitRef\.current\(\); \}\)/);
    expect(src).toMatch(/return \(\) => \{ sub\.remove\(\); leave\(\); commitRef\.current\(\); \};/);
  });
});
