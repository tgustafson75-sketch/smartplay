/**
 * 2026-09-11 — THE APP ASKED FOUR QUESTIONS AFTER EVERY ROUND AND NEVER USED THE ANSWERS.
 *
 * Tim: "Does all post-round data feed correctly? It asks feel, weather, mindset etc but I have a
 * suspicion that does not feed information for future rounds and situations and data."
 *
 * It did not. app/recap/feelings.tsx asks energy, focus, vibe and weather at the end of every round
 * and writes them to the round record. The ONLY reader was services/recapGenerator, which posts them
 * into the recap of THAT SAME ROUND. Nothing ever looked at them again — measured by sweeping all 31
 * round-record fields for anything that reaches a LATER round.
 *
 * That is worse than not asking. Asking implies the answer matters.
 */
import { conditionFindings, describeConditions, findingsForToday } from '../../services/roundConditions';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const r = (scoreVsPar: number, f: Record<string, string>) => ({ scoreVsPar, postRoundFeelings: f });

/** Four rounds locked in and scoring well, four off and scoring badly. */
const LOCKED = [
  r(8, { focus: 'Locked In' }), r(9, { focus: 'Locked In' }),
  r(7, { focus: 'Locked In' }), r(9, { focus: 'Locked In' }),
  r(16, { focus: 'Off' }), r(15, { focus: 'Off' }),
  r(17, { focus: 'Off' }), r(14, { focus: 'Off' }),
];

describe('it finds what the answers were actually worth', () => {
  it('reports the difference in STROKES, the only unit a golfer feels', () => {
    const out = conditionFindings(LOCKED);
    const locked = out.find((f) => f.value === 'Locked In')!;
    expect(locked).toBeTruthy();
    expect(locked.key).toBe('focus');
    expect(locked.deltaStrokes).toBeLessThan(0);      // better
    expect(locked.text).toMatch(/strokes better/);
    expect(locked.n).toBe(4);
    expect(locked.otherN).toBe(4);
  });

  it('phrases it as an association — the ROUND is the subject, never the player', () => {
    /**
     * A golfer who felt locked in was often also the one who slept well and drew an easy course.
     * This cannot separate those, so it must never diagnose.
     */
    const text = describeConditions(conditionFindings(LOCKED))!;
    expect(text).toMatch(/on the rounds where/);
    expect(text).not.toMatch(/because|caused|proves|your focus is/i);
  });

  it('works on weather too — the situation half of the question', () => {
    const windy = [
      r(18, { weather: 'Windy' }), r(19, { weather: 'Windy' }), r(17, { weather: 'Windy' }),
      r(11, { weather: 'Sunny' }), r(10, { weather: 'Sunny' }), r(12, { weather: 'Sunny' }),
    ];
    const f = conditionFindings(windy).find((x) => x.value === 'Windy')!;
    expect(f.deltaStrokes).toBeGreaterThan(0);        // worse
    expect(f.text).toMatch(/it was windy/);
  });
});

describe('and it stays quiet until it actually knows something', () => {
  it('says nothing with too few rounds', () => {
    expect(conditionFindings(LOCKED.slice(0, 3))).toEqual([]);
    expect(describeConditions([])).toBeNull();
  });

  it('says nothing when one side is thin — a one-round "pattern" is noise', () => {
    const lopsided = [
      r(8, { focus: 'Locked In' }), r(9, { focus: 'Locked In' }), r(7, { focus: 'Locked In' }),
      r(8, { focus: 'Locked In' }), r(9, { focus: 'Locked In' }), r(16, { focus: 'Off' }),
    ];
    expect(conditionFindings(lopsided)).toEqual([]);
  });

  it('says nothing when the two buckets score the same', () => {
    const flat = [
      r(12, { vibe: 'Great' }), r(13, { vibe: 'Great' }), r(12, { vibe: 'Great' }),
      r(13, { vibe: 'Rough' }), r(12, { vibe: 'Rough' }), r(13, { vibe: 'Rough' }),
    ];
    expect(conditionFindings(flat)).toEqual([]);
  });

  /**
   * My first version of this test used three answered rounds against three skipped ones — which the
   * "enough on both sides" early exit rejects before the comparison is ever reached. Break-testing
   * showed it passed even with the comparison group swapped to ALL rounds, so it proved nothing.
   *
   * This fixture clears the early exit (six answered) and then adds skipped rounds with wildly
   * different scores, so using them as the comparison group would visibly move the number.
   */
  it('compares against other ANSWERS to the same question, not against skipped rounds', () => {
    const answeredOnly = [
      r(8, { focus: 'Locked In' }), r(9, { focus: 'Locked In' }), r(7, { focus: 'Locked In' }),
      r(14, { focus: 'Off' }), r(15, { focus: 'Off' }), r(13, { focus: 'Off' }),
    ];
    const withSkips = [...answeredOnly, r(40, {}), r(41, {}), r(42, {})];
    const a = conditionFindings(answeredOnly).find((f) => f.value === 'Locked In')!;
    const b = conditionFindings(withSkips).find((f) => f.value === 'Locked In')!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // Skipped rounds must not join the comparison — the delta and the counts are identical.
    expect(b.deltaStrokes).toBe(a.deltaStrokes);
    expect(b.otherN).toBe(3);
  });

  it('ignores rounds with no score to compare', () => {
    const noScores = LOCKED.map((x) => ({ ...x, scoreVsPar: null }));
    expect(conditionFindings(noScores as never)).toEqual([]);
  });

  it('survives nothing at all', () => {
    expect(conditionFindings(null)).toEqual([]);
    expect(conditionFindings([])).toEqual([]);
  });
});

describe('and it speaks to the round being played NOW', () => {
  it('picks out the finding that matches today', () => {
    const windy = [
      r(18, { weather: 'Windy' }), r(19, { weather: 'Windy' }), r(17, { weather: 'Windy' }),
      r(11, { weather: 'Sunny' }), r(10, { weather: 'Sunny' }), r(12, { weather: 'Sunny' }),
    ];
    const all = conditionFindings(windy);
    expect(findingsForToday(all, { weather: 'Windy' }).map((f) => f.value)).toEqual(['Windy']);
    expect(findingsForToday(all, { weather: 'Sunny' }).map((f) => f.value)).toEqual(['Sunny']);
    expect(findingsForToday(all, { weather: null })).toEqual([]);
  });
});

describe('it reaches a future round now, which it never did', () => {
  it('the brain composes it', () => {
    const b = code('services/caddieDecision.ts');
    expect(b).toMatch(/conditionFindings\(/);
    // Composed ONCE per decision — this was three separate safe() calls, each re-walking the round
    // history to fill one property of the same answer.
    expect(b).toMatch(/const conditions = safe\(/);
    expect(b).toMatch(/conditions: conditions\.all/);
    expect(b).toMatch(/todayMatches: conditions\.today/);
  });

  it('today\'s weather is MEASURED, not waited for', () => {
    // The player answers the weather question at the END of a round, which is no use during one.
    const b = code('services/caddieDecision.ts');
    expect(b).toMatch(/getCachedWeatherEvenIfStale/);
    // and mapped onto the SAME words the post-round screen offers, or the buckets can never match
    for (const w of ['Windy', 'Hot', 'Cold']) expect(b).toContain(`'${w}'`);
  });

  it('the payload carries it', () => {
    expect(code('services/caddieRequestBody.ts')).toMatch(/roundConditions: safe\(/);
  });

  it('and the caddie is told to speak it as association, never as a diagnosis', () => {
    const k = code('api/kevin.ts');
    expect(k).toMatch(/WHAT HE HAS TOLD YOU AFTER OTHER ROUNDS/);
    expect(k).toMatch(/association, not cause/);
    expect(k).toMatch(/never diagnose him/);
    expect(k).toMatch(/AND IT APPLIES TODAY/);
  });

  it('the post-round screen still writes what it always wrote', () => {
    // The capture was never the problem. Only the reading was.
    expect(code('app/recap/feelings.tsx')).toMatch(/postRoundFeelings: \{/);
  });
});
