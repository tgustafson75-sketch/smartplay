/**
 * 2026-10-16 (re-review of S1e) — two ways the height read still went wrong on real wrists.
 *
 * 1. ONE jittery raised-hands sample hijacked the anchors whenever it fell back within 700ms: "fastest
 *    descent wins" favours a one-gap drop. 3870 (strike heard 7.00s): a stray at 5.43s → impact 5.53s; at
 *    5.83s → 6.03s. Lily with one jitter frame during address: 47 of 54 positions hijacked. The locate's
 *    swingTimeSec becomes the 'strike' label and clubPathWindow anchors the ARC on address.
 * 2. It rejected REAL swings the old read placed within 18ms: (A) the downswing fell in an unsampled gap,
 *    so top→impact OBSERVED was 709ms (the on-device locate's own samples on Lily, below); (B) the window
 *    ended soon after impact, so no follow-through could be seen.
 */
import tim from '../fixtures/locate-3870-wrists.json';
import lily from '../fixtures/lily-4075-wrists.json';
import { deriveSwingAnchors, type MotionSample } from '../../services/swing/poseMotion';

const T: MotionSample[] = (tim.samples as number[][]).map(([tMs, x, y]) => ({ tMs, x, y })).sort((a, b) => a.tMs - b.tMs);
const L: MotionSample[] = (lily.samples as number[][]).map(([tMs, x, y]) => ({ tMs, x, y })).sort((a, b) => a.tMs - b.tMs);
const near = (a: ReturnType<typeof deriveSwingAnchors>, gt: number, tol: number) => !!a && Math.abs(a.impactMs - gt) <= tol;

describe('one jittery raised-hands sample is not the swing', () => {
  for (const t of [5429, 5829, 6029]) for (const dy of [0.07, 0.09]) {
    it(`3870, stray at ${t}ms (+${dy})`, () => {
      expect(near(deriveSwingAnchors(T.map((p) => (p.tMs === t ? { ...p, y: 0.6123 - dy } : p))), 7000, 120)).toBe(true);
    });
  }
  for (const stride of [1, 3, 5]) {
    it(`Lily, one jitter frame anywhere in address, every ${stride} frame(s)`, () => {
      const w = L.filter((p) => p.tMs >= 4300 && p.tMs <= 7600).filter((_, i) => i % stride === 0);
      const base = Math.max(...w.slice(0, 3).map((p) => p.y));
      const amp = Math.max(...w.map((p) => base - p.y));
      const missed: string[] = [];
      for (let k = 3; k < w.length && w[k].tMs < 5300; k++) for (const f of [0.65, 0.8]) {
        const a = deriveSwingAnchors(w.map((p, i) => (i === k ? { ...p, y: base - f * amp } : p)));
        if (!near(a, 6040, 150)) missed.push(`${w[k].tMs}/${f}->${a?.impactMs}`);
      }
      expect(missed).toEqual([]);
    });
  }
});

describe('a real swing is not rejected for what the samples could not show', () => {
  it('(A) the downswing fell in an unsampled gap — the on-device locate\'s own samples (Lily, clip offset 700ms)', () => {
    const got = [[265, 0.479], [820, 0.485], [1375, 0.496], [1930, 0.501], [2484, 0.504], [3039, 0.506], [3594, 0.502], [4149, 0.495], [4249, 0.496], [4349, 0.493], [4449, 0.459], [4549, 0.389], [4649, 0.349], [4703, 0.362], [5258, 0.404], [5358, 0.46], [5458, 0.373], [5558, 0.331], [5658, 0.366], [5758, 0.296], [5813, 0.3], [6368, 0.368]];
    const a = deriveSwingAnchors(got.map(([tMs, y]) => ({ tMs, x: 0.5, y })));
    expect(near(a, 5340, 60)).toBe(true);
  });
  it('(A) and at clip offset 400ms', () => {
    const got = [[277, 0.476], [857, 0.481], [1437, 0.486], [2017, 0.509], [2597, 0.502], [3177, 0.505], [3756, 0.501], [4336, 0.495], [4436, 0.495], [4536, 0.496], [4636, 0.493], [4736, 0.459], [4836, 0.389], [4916, 0.365], [5496, 0.379], [5696, 0.446], [5896, 0.35], [6076, 0.296], [6656, 0.368]];
    const a = deriveSwingAnchors(got.map(([tMs, y]) => ({ tMs, x: 0.5, y })));
    expect(near(a, 5640, 80)).toBe(true);
  });
  for (const [stride, ph] of [[5, 4], [6, 2]]) {
    it(`(B) the window ends soon after impact — [4800, 6400] every ${stride}th frame, phase ${ph}`, () => {
      const w = L.filter((p) => p.tMs >= 4800 && p.tMs <= 6400).filter((_, i) => i % stride === ph);
      expect(near(deriveSwingAnchors(w), 6040, 70)).toBe(true);
    });
  }
});
