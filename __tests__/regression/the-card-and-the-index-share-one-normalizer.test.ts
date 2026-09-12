/**
 * 2026-09-11 (full-app audit) — A SECOND COPY, UNDER A COMMENT SAYING IT WAS NOT.
 *
 * services/handicapCalculator's own header says postingInputsFor was extracted so the recap card
 * and rebuildDifferentialsFromHistory "call the same two functions, so they agree by construction
 * rather than by comment", and spells out the cost of them disagreeing: "the player read a worse
 * number than the one that actually moved their Index".
 *
 * postingInputsFor had exactly ONE consumer — components/recap/HandicapImpactCard. The rebuild
 * re-implemented it inline, character for character: same `posted` expression, same `score`
 * fallback, same baseline derivation. They agreed only because the two copies still happened to
 * match, which is precisely the state the comment claims was fixed.
 *
 * It would have bitten on the next change to the posting rule — including the short-round rule
 * added the same day — because nothing anywhere said the edit had to be made twice.
 */
import {
  rebuildDifferentialsFromHistory, postingInputsFor, postedDifferentialFor,
} from '../../services/handicapCalculator';

const par4x18 = () => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4]));
const scores = (n: number, v: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, v]));

const round = {
  startedAt: 1_700_000_000_000,
  totalScore: 90,
  holesPlayed: 18,
  handicapAgs: 88,
  handicapHoles: 18 as const,
  holePars: par4x18(),
  scores: scores(18, 5),
  courseId: null,
  rating: 71.2,
  slope: 125,
};

describe('one normalizer, two readers', () => {
  it('the rebuild produces the differential the card would show for the same round', () => {
    // The whole point: these two numbers are what the player compares. If they can differ, the
    // recap says one thing and the Index moves by another.
    const idx = 14;
    const viaCard = Math.round(postedDifferentialFor(postingInputsFor(round)!, idx) * 10) / 10;
    const viaRebuild = rebuildDifferentialsFromHistory([round])[0];
    expect(viaRebuild).toBeCloseTo(viaCard, 1);
  });

  it('agrees on a NINE-hole round too, where the expected-second-nine term applies', () => {
    const nine = {
      ...round, holesPlayed: 9, handicapHoles: 9 as const, totalScore: 45, handicapAgs: 44,
      scores: scores(9, 5), rating: 35.6, slope: 122,
    };
    const idx = 14;
    const viaCard = Math.round(postedDifferentialFor(postingInputsFor(nine)!, idx) * 10) / 10;
    const viaRebuild = rebuildDifferentialsFromHistory([nine])[0];
    expect(viaRebuild).toBeCloseTo(viaCard, 1);
  });

  it('and on a round with no posting basis, both decline it', () => {
    const unpostable = { ...round, holesPlayed: 4, handicapHoles: undefined, handicapAgs: undefined, totalScore: 20, scores: scores(4, 5) };
    expect(postingInputsFor(unpostable)).toBeNull();
    expect(rebuildDifferentialsFromHistory([unpostable])).toHaveLength(0);
  });
});

describe('the duplicate cannot come back', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/handicapCalculator.ts'), 'utf8',
  ) as string;

  /** The rebuild function's body, cut at the next top-level export. */
  const rebuildBody = (() => {
    const at = src.indexOf('export function rebuildDifferentialsFromHistory');
    const rest = src.slice(at);
    const next = rest.slice(50).search(/\nexport (?:function|const|type|interface)/);
    return next > 0 ? rest.slice(0, next + 50) : rest;
  })();

  it('the window actually captured the rebuild', () => {
    expect(rebuildBody.length).toBeGreaterThan(400);
    expect(rebuildBody).toMatch(/const eligible = normalized/);
  });

  it('the rebuild calls the shared normalizer', () => {
    expect(rebuildBody).toMatch(/postingInputsFor\(r\)/);
  });

  it('and does NOT re-derive `posted` or the baseline itself', () => {
    // These are the exact expressions the inline copy used. Either coming back means two owners.
    expect(rebuildBody).not.toMatch(/r\.handicapHoles \?\? \(r\.holesPlayed === 9/);
    expect(rebuildBody).not.toMatch(/const score = r\.handicapAgs \?\? r\.totalScore/);
    expect(rebuildBody).not.toMatch(/postingBaseline\(r\)/);
  });

  it('postingInputsFor now has more than one consumer, which was the original claim', () => {
    const card = require('fs').readFileSync(
      require('path').join(__dirname, '../../components/recap/HandicapImpactCard.tsx'), 'utf8',
    ) as string;
    expect(card).toMatch(/postingInputsFor\(\{/);
    expect(src).toMatch(/postingInputsFor\(r\)/);
  });
});
