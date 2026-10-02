/**
 * 2026-10-01 — Tim asked Serena "do I have to have both hands on the putter?" and she answered about
 * leaving the flagstick in.
 *
 * Two faults, one wrong answer:
 *   1. findRelevantRules counted ANY substring hit as a match. "putter" contains "putt", a flagstick
 *      keyword, and "the" is inside "reading the green" / "another player". A score of one stray syllable
 *      was enough to be read aloud as the rule.
 *   2. No rule covered the stroke itself (Rule 10.1), so even honest matching had nothing right to say —
 *      and the handler's only fallback was "let me check on that one", a dead end. A question the bundled
 *      reference does not cover now goes to the caddie brain (route_to_brain), which can answer it.
 *
 * A confidently wrong rule is worse than no rule: the player believes the caddie.
 */
import { findRelevantRules } from '../../data/rulesReference';
import { rulesQueryHandler } from '../../services/intents/rulesQueryHandler';

const top = (q: string) => (findRelevantRules(q, 1) as { rule_id: string }[])[0]?.rule_id ?? null;

describe('a rules answer must be about the question that was asked', () => {
  it("Tim's question gets the stroke rule, not the flagstick", () => {
    for (const q of [
      'do I have to have both hands on the putter',
      'do you have to have both hands on the putter',
      'can I putt one handed',
      'can I anchor my putter',
    ]) {
      expect([q, top(q)]).toEqual([q, 'making_a_stroke']);
    }
  });

  it('a stray syllable or a filler word is not a match', () => {
    // No rule in the reference is about any of these — they must not borrow one.
    for (const q of [
      'what is the best putter',
      'how do I hold the club',
      'is there a dress code',
    ]) {
      expect([q, top(q)]).toEqual([q, null]);
    }
  });

  it('the questions the reference DOES cover still find their rule', () => {
    const cases: [string, string][] = [
      ['can I leave the flagstick in', 'flagstick_in'],
      ['should I take the pin out', 'flagstick_in'],
      ['can I drop free from casual water', 'casual_water'],
      ['is that out of bounds', 'ob_stroke_distance'],
      ['what is the rule on embedded ball', 'embedded_ball'],
      ['can I move my ball from a divot', 'divot_in_fairway'],
      ['what are my options for a lateral hazard', 'red_penalty_area'],
      ['can I use a rangefinder', 'measuring_devices'],
      ['is slope legal', 'measuring_devices'],
      ['gps allowed', 'measuring_devices'],
      ['my ball moved at address', 'ball_moved_address'],
      ['can I hit a provisional', 'provisional_ball'],
      ['I want to declare it unplayable', 'unplayable_lie'],
      ['can I fix spike marks', 'spike_marks'],
      ['my ball is on the cart path', 'cart_path'],
    ];
    for (const [q, id] of cases) {
      expect([q, findRelevantRules(q, 3).map((r) => r.rule_id)]).toEqual([q, expect.arrayContaining([id])]);
    }
  });

  it('a question the reference does not cover goes to the caddie brain, not a dead end', async () => {
    const r = await rulesQueryHandler.execute(
      { intent_type: 'rules_query', parameters: { query_text: 'is there a dress code' } } as never,
      {} as never,
    );
    expect(r.route_to_brain).toBe(true);
    expect(r.voice_response ?? '').not.toMatch(/let me check/i);
  });
});
