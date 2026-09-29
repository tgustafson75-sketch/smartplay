/**
 * 2026-09-29 (Tim, Hemet: "STATIC a few times when I should not have", "yardage on the rest screen was
 * not updating", and 3745.jpg — the round bar STATIC while the map said LIVE 446y at the same instant).
 *
 * THREE causes, one symptom:
 *  1. After 90s without 5m of motion gpsManager drops to 'stationary', which polled at Accuracy.Low —
 *     a low-power NETWORK fix on Android (15–90m, sometimes far worse). The accuracy fell into the weak
 *     band, the resolver dropped to the scorecard number and said STATIC. Standing on a tee is exactly
 *     that state, and it is also when the rest screen is up — so the rest screen repeated a number
 *     that never moved.
 *  2. The rest screen hides a number older than 45s, and the Caddie tab published only when the value
 *     CHANGED — a still player's number went stale and vanished.
 *  3. The map preview decided LIVE/STATIC and the yardage for itself, from the raw fix with none of
 *     the resolver's gates. Two owners of one fact.
 */
jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}));

import fs from 'fs';
import path from 'path';
import { pollConfigFor } from '../../services/gpsManager';

const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('a player standing still keeps a GPS-grade fix', () => {
  it('THE BUG: stationary polls at High accuracy, never a low-power network fix', () => {
    expect(pollConfigFor('stationary').accuracy).toBe(4);
  });
  it('the saving is the cadence, not the reading', () => {
    expect(pollConfigFor('stationary').intervalMs).toBeGreaterThanOrEqual(pollConfigFor('walking').intervalMs);
    expect(pollConfigFor('walking').accuracy).toBe(4);
  });
});

describe('the rest screen is fed on every recompute, not only when the number moves', () => {
  it('the publish effect depends on markTick', () => {
    const src = code('app/(tabs)/caddie.tsx');
    expect(src).toMatch(/useRestReadoutStore\.getState\(\)\.publish\(\{[\s\S]{0,200}?\}\);\s*\}, \[isRoundActive, displayYardage, playsLikeYardage, currentHole, markTick, geometryCompletions\]\);/);
  });
});

describe('one readout: the map preview never judges the yardage for itself', () => {
  const l1 = code('components/caddie/L1HolePreview.tsx');
  const caddie = code('app/(tabs)/caddie.tsx');

  it('THE BUG: the preview no longer computes its own LIVE/STATIC call', () => {
    expect(l1).not.toMatch(/resolveYardageSource\(/);
    expect(l1).toMatch(/const src = readout\?\.source \?\? null;/);
  });

  it('the number it prints is the readout it was given — its own haversine only places the marker', () => {
    expect(l1).toMatch(/fmtCompact\(readout\.yardage\)/);
    expect(l1).not.toMatch(/fmtCompact\(yardsToGreen\)/);
  });

  it('every render on the Caddie tab is handed the same readout the data strip shows', () => {
    const renders = caddie.match(/<L1HolePreview[\s\S]*?\/>/g) ?? [];
    expect(renders.length).toBe(4);
    for (const r of renders) expect(r).toMatch(/readout=\{yardageReadout\}/);
    expect(caddie).toMatch(/yardageSource=\{yardageReadout\.source\}/);
  });

  it('the full-size map sits in the band nothing covers, with the yardage beside the marker', () => {
    expect(caddie).toMatch(/top: L1_MAP_TOP_CLEAR, bottom: bottomClear/);
    expect(caddie).toMatch(/const bottomClear = budget\.bubbleClearance \+ \(isRoundActive \? planCardHeight : 0\) \+ 6;/);
    expect(caddie).toMatch(/labelFollowsMarker/);
  });
});
