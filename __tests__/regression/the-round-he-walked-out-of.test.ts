/**
 * 2026-09-11 (Tim, full-app audit) — "if 10-18 don't get scored, or the player stops between 11 and
 * 18 and ends and saves the round, we need to calculate that as 9 played and scored."
 *
 * THE ROUNDS THAT NEVER REACHED HIS HANDICAP.
 *
 * The Rules of Handicapping post a round of 7 to 13 holes as a NINE-hole score and 14 or more as an
 * eighteen. computeWhsPostingScore only implemented the second half — `POST_MIN = 14` and nothing
 * below it — so what happened to an unfinished round depended on the number, which is the worst kind
 * of inconsistency:
 *
 *   - exactly 9 scored slipped through a LEGACY branch elsewhere (`holesPlayed === 9`) and posted as
 *     a raw nine, with NO net-double-bogey cap and no net-par fill, so a blow-up hole went to the
 *     Index at full value;
 *   - 10, 11, 12 or 13 scored matched no branch anywhere and never reached the Index at all.
 *
 * A man who walks in after eleven — rain, darkness, a tee time he had to make — had that round
 * silently vanish from his handicap.
 *
 * And the app's own rules reference, which Tim pointed out is built in, had no entry for the posting
 * rule the engine implements. The arithmetic and the rules surface now agree.
 */
import { useRoundStore } from '../../store/roundStore';
import { getRuleById } from '../../data/rulesReference';

const card = (n: number) => Array.from({ length: n }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));

function playAndEnd(holesOnCard: number, scoredThrough: number, opts?: { nineHole?: boolean; startHole?: number }) {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Walk In GC', card(holesOnCard) as never, {
    nineHole: opts?.nineHole ?? false, startHole: opts?.startHole ?? 1,
    isCompetition: false, notes: '', goal: null, courseId: `walkin-${holesOnCard}-${scoredThrough}`,
  } as never);
  const first = opts?.startHole ?? 1;
  for (let h = first; h < first + scoredThrough; h++) useRoundStore.getState().logScore(h, 5);
  useRoundStore.getState().endRound();
  return useRoundStore.getState().roundHistory[0];
}

describe('a round the player walked out of', () => {
  it('eleven holes of an eighteen posts as a NINE — it used to post as nothing', () => {
    const rec = playAndEnd(18, 11);
    expect(rec.handicapHoles).toBe(9);
    expect(rec.handicapAgs).toBeGreaterThan(0);
  });

  it('still records the holes he actually played, which is a different fact from what it posts as', () => {
    const rec = playAndEnd(18, 11);
    expect(rec.holesPlayed).toBe(11);
    expect(rec.totalScore).toBe(55);
    // The posted score is the capped nine, not the raw eleven-hole total.
    expect(rec.handicapAgs).toBeLessThan(rec.totalScore);
  });

  it('nine holes of an eighteen now carries a REAL posting basis, capped', () => {
    // This is the one that used to sneak through the legacy `holesPlayed === 9` branch with no cap.
    const rec = playAndEnd(18, 9);
    expect(rec.handicapHoles).toBe(9);
    expect(rec.handicapAgs).toBeGreaterThan(0);
  });

  it('fewer than seven is still not a round', () => {
    const rec = playAndEnd(18, 6);
    expect(rec.holesPlayed).toBe(6);
    expect(rec.handicapHoles).toBeUndefined();
  });

  it('a completed eighteen is untouched', () => {
    const rec = playAndEnd(18, 18);
    expect(rec.handicapHoles).toBe(18);
    expect(rec.holesPlayed).toBe(18);
  });
});

describe('the app can explain the rule it applies', () => {
  const rule = getRuleById('incomplete_round_posting');

  it('has a reference entry at all', () => {
    expect(rule).not.toBeNull();
  });

  it('states both thresholds, because getting to 7 or to 14 is the decision a player makes', () => {
    expect(rule!.rule_summary).toMatch(/7 to 13/);
    expect(rule!.rule_summary).toMatch(/14 or more/);
  });

  it('cites the Rules of Handicapping, not the Rules of Golf — they are different books', () => {
    expect(rule!.official_reference).toMatch(/Rules of Handicapping/);
  });

  it('is findable by what a player would actually say', () => {
    for (const k of ['walked in', 'quit early', 'incomplete round']) {
      expect(rule!.keywords).toContain(k);
    }
  });
});
