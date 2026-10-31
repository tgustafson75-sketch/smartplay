/**
 * 2026-10-31 (Brain recheck r18, BRAIN-2) — "I ALMOST BIRDIED THAT HOLE" WRITES NOTHING ON THE CARD.
 *
 * The bare score-name rule matched "birdied" with no story frame, and "almost" / "nearly" are not in
 * STORY_FRAME, so logScoreHandler wrote a birdie for a score that was never made. The near-miss guard is
 * on log_score only, so the brain answers the narration and the card is untouched.
 *
 * BEHAVIOURAL: the real precheckLocalIntent. A near miss must never be log_score; a real score still is.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

describe('a near miss is narration, not a score on the card', () => {
  it.each([
    'I almost birdied that hole',
    'I almost parred that one',
    'I nearly bogeyed it',
    'I almost got a 4',
  ])('"%s" → conversational, not log_score', (said) => {
    const r = precheckLocalIntent(said);
    expect(r?.intent_type).toBe('conversational');
  });

  it.each(['I just missed a birdie there', 'I was so close to a birdie on that one'])(
    '"%s" is never log_score',
    (said) => {
      expect(precheckLocalIntent(said)?.intent_type).not.toBe('log_score');
    },
  );
});

describe('a real score still writes to the card', () => {
  it.each(['I made a 5', 'I got a 4 on that hole', 'I birdied it', 'I parred that one'])(
    '"%s" → log_score',
    (said) => {
      expect(precheckLocalIntent(said)?.intent_type).toBe('log_score');
    },
  );
});
