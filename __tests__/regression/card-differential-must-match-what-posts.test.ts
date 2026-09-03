/**
 * 2026-09-03 — the recap's handicap card showed a differential the round did not post.
 *
 * The card computed its own with a hardcoded NEUTRAL 72/113 while the Index posting path used the
 * round's real rating and slope. Its own comment claimed the two matched "by construction". They
 * did not, and the error only appears on courses that are not exactly neutral — i.e. all of them.
 * The card OVERSTATED the differential on anything harder than slope 113, so the player read a
 * worse number than the one that actually moved their Index.
 *
 * These pin the formula the posting path uses, so the shared helper cannot drift back.
 */
import {
  postingInputsFor,
  postedDifferentialFor,
  computeScoreDifferential,
} from '../../services/handicapCalculator';

describe('postedDifferentialFor', () => {
  it('uses the real slope and rating, not the neutral baseline', () => {
    const inputs = postingInputsFor({
      totalScore: 92, handicapAgs: 92, holesPlayed: 18, rating: 71.4, slope: 131,
    })!;
    expect(inputs.baseSlope).toBe(131);
    expect(inputs.baseRating).toBe(71.4);
    const diff = postedDifferentialFor(inputs, 14);
    // (113/131) x (92 - 71.4) = 17.77 -> 17.8. The old card showed (113/113) x (92-72) = 20.0.
    expect(diff).toBeCloseTo(17.8, 1);
    expect(diff).not.toBeCloseTo(20.0, 1);
  });

  it('a harder course yields a LOWER differential for the same score', () => {
    const easy = postedDifferentialFor(postingInputsFor({ totalScore: 92, handicapAgs: 92, holesPlayed: 18, rating: 71.4, slope: 113 })!, 14);
    const hard = postedDifferentialFor(postingInputsFor({ totalScore: 92, handicapAgs: 92, holesPlayed: 18, rating: 71.4, slope: 140 })!, 14);
    expect(hard).toBeLessThan(easy);
  });

  it('prefers the CAPPED adjusted gross score over the raw total', () => {
    // A blow-up round posts its net-double-bogey-capped AGS, not what the player actually shot.
    const inputs = postingInputsFor({ totalScore: 108, handicapAgs: 96, holesPlayed: 18, rating: 72, slope: 113 })!;
    expect(inputs.score).toBe(96);
  });

  it('falls back to neutral only when the round carries no rating or slope', () => {
    const inputs = postingInputsFor({ totalScore: 90, handicapAgs: 90, holesPlayed: 18, parTotal: 72 })!;
    expect(inputs.baseSlope).toBe(113);
    expect(inputs.baseRating).toBe(72);
    expect(postedDifferentialFor(inputs, 14)).toBeCloseTo(computeScoreDifferential(90, 72, 113), 5);
  });

  it('refuses a round with no postable hole count', () => {
    expect(postingInputsFor({ totalScore: 60, holesPlayed: 12 })).toBeNull();
  });

  it('adds the expected second nine for a 9-hole round rather than doubling it', () => {
    const nine = postingInputsFor({ totalScore: 46, handicapAgs: 46, holesPlayed: 9, rating: 36, slope: 113 })!;
    expect(nine.posted).toBe(9);
    // Doubling a 46 against 72 would give 20.0; the WHS treatment is played-9 + expected-9.
    expect(postedDifferentialFor(nine, 14)).not.toBeCloseTo(20.0, 1);
  });
});
