/**
 * 2026-09-11 (full-app audit) — THE SCORE YOU COULD NEITHER SEE NOR CORRECT.
 *
 * roundStore.logScore's own header calls itself "the ONE seam every score path funnels through" and
 * names the wrong-hole class as one Tim has fought repeatedly. It validated neither the hole nor the
 * score.
 *
 * Two of the three parsers upstream did bound it: services/intents/logScoreHandler and
 * declareHoleHandler both accept 1..18 only. services/voice/conversationalToolDispatch — the path
 * the BRAIN's own tool arguments travel — checked `a.hole > 0` and nothing else. So a mis-parsed
 * `log_score { hole: 22 }` wrote scores[22].
 *
 * That score is invisible and permanent: the scorecard iterates courseHoles, so nothing renders it
 * and no tap can correct it, while endRound counts it into holesPlayed and totalScore — and
 * holesPlayed is the number that decides whether a round posts to the handicap as a nine or an
 * eighteen. A zero or negative was equally accepted, and would silently overwrite a real score with
 * a value every downstream `score > 0` filter then discards.
 *
 * Fixed at the seam, the way the mental-state derivation was, so a surface added later inherits it.
 */
import { useRoundStore, MAX_ROUND_HOLES } from '../../store/roundStore';

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));

function freshRound() {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Seam GC', card as never, {
    nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'seam',
  } as never);
}

describe('a hole that cannot exist', () => {
  beforeEach(freshRound);

  it('is refused, not stored', () => {
    useRoundStore.getState().logScore(22, 5);
    expect(useRoundStore.getState().scores[22]).toBeUndefined();
  });

  it('is refused rather than CLAMPED — a 22 must not become a real score on 18', () => {
    useRoundStore.getState().logScore(22, 9);
    expect(useRoundStore.getState().scores[18]).toBeUndefined();
    expect(useRoundStore.getState().scores[MAX_ROUND_HOLES]).toBeUndefined();
  });

  it('refuses hole 0 and negatives and fractions', () => {
    for (const h of [0, -3, 1.5]) useRoundStore.getState().logScore(h, 5);
    expect(Object.keys(useRoundStore.getState().scores)).toHaveLength(0);
  });

  it('still accepts every real hole', () => {
    for (let h = 1; h <= 18; h++) useRoundStore.getState().logScore(h, 4);
    expect(Object.keys(useRoundStore.getState().scores)).toHaveLength(18);
  });
});

describe('a number that is not a score', () => {
  beforeEach(freshRound);

  it('refuses zero — nothing in this app uses it as an erase', () => {
    useRoundStore.getState().logScore(3, 0);
    expect(useRoundStore.getState().scores[3]).toBeUndefined();
  });

  it('refuses a negative', () => {
    useRoundStore.getState().logScore(3, -2);
    expect(useRoundStore.getState().scores[3]).toBeUndefined();
  });

  it('does not let a rejected write destroy the score already there', () => {
    useRoundStore.getState().logScore(3, 6);
    useRoundStore.getState().logScore(3, 0);
    expect(useRoundStore.getState().scores[3]).toBe(6);
  });
});

describe('a partly-loaded card is not a small course', () => {
  it('accepts hole 4 on a round that only loaded one hole', () => {
    /**
     * My first version of this guard capped at getCourseHoleCount(activeCourseId,
     * courseHoles.length) and the existing suite caught it at once: courseHoles is whatever was
     * LOADED, not what the course has — caddie.tsx has an acknowledged `startedWithoutHoles` path.
     * A one-hole fixture made the cap 1 and rejected a perfectly good score on hole 4.
     */
    useRoundStore.setState({ roundHistory: [] } as never);
    useRoundStore.getState().startRound('Partial GC', [{ hole: 1, par: 4, distance: 380 }] as never, {
      nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'partial',
    } as never);
    useRoundStore.getState().logScore(4, 5);
    expect(useRoundStore.getState().scores[4]).toBe(5);
  });

  it('and on a round that loaded no holes at all', () => {
    useRoundStore.setState({ roundHistory: [] } as never);
    useRoundStore.getState().startRound('No Card GC', [] as never, {
      nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: null,
    } as never);
    useRoundStore.getState().logScore(12, 6);
    expect(useRoundStore.getState().scores[12]).toBe(6);
  });
});

describe('the brain tool path guards itself as well', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/voice/conversationalToolDispatch.ts'), 'utf8',
  ) as string;

  it('no hole argument in the file is left unbounded', () => {
    // Break-testing the first version of this guard is what found the SECOND one: log_shot carried
    // the identical `a.hole > 0` with no ceiling. Assert the shape is gone everywhere, not just on
    // the path I happened to be looking at. [[no-half-fixes-enforce-every-surface]]
    expect(src).not.toMatch(/a\.hole > 0 \? Math\.round\(a\.hole\)/);
  });

  it('bounds every one of them by the shared constant, not a hand-written 18', () => {
    expect(src).toMatch(/import \{ MAX_ROUND_HOLES as MAX_HOLES \}/);
    expect(src).toMatch(/askedHole > MAX_HOLES\)\) break;/);
    expect(src).toMatch(/askedShotHole <= MAX_HOLES/);
    // and no bare 18 left to drift
    expect(src).not.toMatch(/a\.hole <= 18/);
    expect(src).not.toMatch(/h <= 18\)/);
  });

  it('breaks BEFORE confirming, so the caddie cannot say "got it" over a rejected write', () => {
    const at = src.indexOf('askedHole > MAX_HOLES)) break;');
    const logAt = src.indexOf('round.logScore(targetHole, rounded)');
    expect(at).toBeGreaterThan(-1);
    expect(logAt).toBeGreaterThan(at);
  });

  it('a shot on an impossible hole falls back to the hole he is on, rather than being dropped', () => {
    // A shot always happened somewhere; refusing it would lose real data. A score is different —
    // there is no honest default for which hole a score belongs to.
    expect(src).toMatch(/: round\.currentHole;/);
  });

  it('refuses a score below one on that path too', () => {
    expect(src).toMatch(/if \(rounded < 1\) break;/);
  });
});
