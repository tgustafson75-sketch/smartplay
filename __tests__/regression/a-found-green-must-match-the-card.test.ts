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

import { deriveHoleGeometry } from '../../services/holeGeometryDerivation';

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
});
