/**
 * 2026-07-24 (M3/M4 — WHS posting honesty for a high-handicap game).
 * M3: blow-up holes are capped at NET DOUBLE BOGEY so they stop inflating the Index.
 * M4: a couple of picked-up holes are filled with NET PAR so the whole round still counts
 *     (instead of being silently dropped by the old `holesPlayed === 9 || 18` gate).
 */
import { computeWhsPostingScore, rebuildDifferentialsFromHistory, netDoubleBogeyCap } from '../../services/handicapCalculator';

const par4x18 = (): Record<number, number> => {
  const p: Record<number, number> = {};
  for (let h = 1; h <= 18; h++) p[h] = 4;
  return p;
};

describe('computeWhsPostingScore — M3 net-double-bogey cap', () => {
  it('caps a blow-up hole at net double bogey (courseHcp 18 → 1 stroke/hole → par4 max = 7)', () => {
    expect(netDoubleBogeyCap(4, 1)).toBe(7);
    // 17 bogeys (5) + one 9 → the 9 caps to 7, not 9.
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) scores[h] = 5;
    scores[7] = 9;
    const post = computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars: par4x18(), scores });
    expect(post).not.toBeNull();
    expect(post!.adjustedGrossScore).toBe(17 * 5 + 7); // 92, NOT 17*5 + 9 = 94
    expect(post!.postedHoles).toBe(18);
    expect(post!.playedHoles).toBe(18);
  });
});

describe('computeWhsPostingScore — M4 pick-up rounds count', () => {
  it('fills a picked-up hole with net par and still posts (holesPlayed 17 of 18)', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) scores[h] = 5;
    delete scores[12]; // picked up on 12 → not scored
    const post = computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars: par4x18(), scores });
    expect(post).not.toBeNull();
    expect(post!.playedHoles).toBe(17);
    expect(post!.postedHoles).toBe(18);
    // 17 played bogeys (5) + hole 12 filled at net par (4 + 1 stroke = 5).
    expect(post!.adjustedGrossScore).toBe(18 * 5);
  });

  it('returns null when too incomplete to post (below WHS minimum of 14 of 18)', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 10; h++) scores[h] = 5; // only 10 holes
    expect(computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars: par4x18(), scores })).toBeNull();
  });

  it('returns null when a hole par is unknown (can not cap honestly)', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) scores[h] = 5;
    const pars = par4x18(); delete pars[5];
    expect(computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars, scores })).toBeNull();
  });

  it('9-hole posting minimum is 7 of 9', () => {
    const pars: Record<number, number> = {}; for (let h = 1; h <= 9; h++) pars[h] = 4;
    const scores: Record<number, number> = {}; for (let h = 1; h <= 7; h++) scores[h] = 5;
    const post = computeWhsPostingScore({ intendedHoles: 9, courseHandicap: 18, pars, scores });
    expect(post?.postedHoles).toBe(9);
    // 6-of-9 is below the minimum.
    const scores6: Record<number, number> = {}; for (let h = 1; h <= 6; h++) scores6[h] = 5;
    expect(computeWhsPostingScore({ intendedHoles: 9, courseHandicap: 18, pars, scores: scores6 })).toBeNull();
  });
});

describe('rebuildDifferentialsFromHistory honors the WHS posting basis', () => {
  it('uses handicapAgs + handicapHoles (capped) over the raw total, and counts a filled pick-up round', () => {
    const base = { startedAt: 1, totalScore: 94, holesPlayed: 17 }; // raw total high, picked up 1 hole
    // Without a posting basis, holesPlayed 17 would be DROPPED entirely (old behavior).
    const withoutBasis = rebuildDifferentialsFromHistory([
      { ...base }, { startedAt: 2, totalScore: 94, holesPlayed: 17 }, { startedAt: 3, totalScore: 94, holesPlayed: 17 },
    ]);
    expect(withoutBasis.length).toBe(0); // 17-hole rounds with no basis are not postable
    // With the posting basis, the same rounds post (18) from the CAPPED ags (92), not the raw 94.
    const withBasis = rebuildDifferentialsFromHistory([
      { ...base, handicapAgs: 92, handicapHoles: 18 },
      { startedAt: 2, totalScore: 94, holesPlayed: 17, handicapAgs: 92, handicapHoles: 18 },
      { startedAt: 3, totalScore: 94, holesPlayed: 17, handicapAgs: 92, handicapHoles: 18 },
    ]);
    expect(withBasis.length).toBe(3);
    // Differential from AGS 92 vs neutral 72/113 = 20.0 (not from the raw 94 = 22.0).
    expect(withBasis[0]).toBeCloseTo(20.0, 1);
  });
});
