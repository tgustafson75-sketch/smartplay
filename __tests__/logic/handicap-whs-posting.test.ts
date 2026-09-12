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

  /**
   * 2026-09-11 (Tim, full-app audit) — "if 10-18 don't get scored, or the player stops between 11
   * and 18 and ends and saves the round, we need to calculate that as 9 played and scored."
   *
   * This test used to assert null for ten holes of an eighteen, which encoded the bug: the Rules of
   * Handicapping post a round of 7 to 13 holes as a NINE-hole score. Only the 14-of-18 half was ever
   * implemented, so 10 through 13 holes reached the Index nowhere at all, and exactly 9 slipped
   * through a legacy branch that skipped the net-double-bogey cap entirely.
   */
  it('posts 7 to 13 holes of an eighteen as a NINE-hole score', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 10; h++) scores[h] = 5; // walked in after ten
    const post = computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars: par4x18(), scores });
    expect(post).not.toBeNull();
    expect(post!.postedHoles).toBe(9);
    // The nine it posts is the one the scores are in, capped and net-par filled — not a raw total.
    expect(post!.playedHoles).toBe(9);
  });

  it('posts the BACK nine when that is where he played', () => {
    const scores: Record<number, number> = {};
    for (let h = 10; h <= 18; h++) scores[h] = 5;
    const post = computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars: par4x18(), scores });
    expect(post!.postedHoles).toBe(9);
    expect(post!.playedHoles).toBe(9);
  });

  it('still refuses fewer than seven — that is not a round', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 6; h++) scores[h] = 5;
    expect(computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars: par4x18(), scores })).toBeNull();
  });

  it('a full eighteen still posts as eighteen, not as the better nine', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) scores[h] = 5;
    const post = computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars: par4x18(), scores });
    expect(post!.postedHoles).toBe(18);
    expect(post!.playedHoles).toBe(18);
  });

  it('fourteen of eighteen is an EIGHTEEN, not a nine — the short-round rule stops at thirteen', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 14; h++) scores[h] = 5;
    const post = computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars: par4x18(), scores });
    expect(post!.postedHoles).toBe(18);
    expect(post!.playedHoles).toBe(14);
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
