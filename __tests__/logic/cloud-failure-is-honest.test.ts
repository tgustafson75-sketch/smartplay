/**
 * What the caddie says when it cannot reach the cloud.
 *
 * 2026-08-21. Tim, twice, quoting the app back at me: "Good time to talk about blah blah blah in
 * robot girl voice." That is DEAD_END_PRACTICE — "Good moment to sharpen your tempo or short game"
 * — spoken through device TTS after a failed cloud turn, offered as though it answered the question
 * he actually asked.
 *
 * His fix, and it is the right one: "hide local mode behind a toggle… if it goes weak, it prompts
 * the user… we want to continue to populate the local brain, but not continue to tap into it and
 * break things."
 *
 * The distinction these tests pin: ON A ROUND the local brain has something REAL to say — a measured
 * yardage, a club from the player's own logged bag — and that stays. OFF a round it has nothing, so
 * it invents a topic, and that is what gets replaced with the truth.
 */
import { cloudFailureLine, CLOUD_UNREACHABLE_OFFER, DEAD_END_PRACTICE } from '../../services/localStatusResponder';
import { useRoundStore } from '../../store/roundStore';

describe('off a round, with nothing real to say', () => {
  beforeEach(() => { useRoundStore.setState({ isRoundActive: false }); });

  it('tells the truth and offers the toggle instead of inventing a topic', () => {
    const line = cloudFailureLine('en', false);
    expect(line).toBe(CLOUD_UNREACHABLE_OFFER.en);
    expect(line).toMatch(/couldn't reach my brain/i);
    expect(line).toMatch(/Local Mode/);
    // The line Tim kept hearing must NOT be what a non-opted-in player gets.
    expect(line).not.toBe(DEAD_END_PRACTICE.en);
  });

  it('still offers the practice nudge to someone who CHOSE local mode', () => {
    // They opted into an offline caddie; a practice suggestion is a fair thing for it to say.
    expect(cloudFailureLine('en', true)).toBe(DEAD_END_PRACTICE.en);
  });

  it('is honest in every language, not just English', () => {
    for (const lang of ['en', 'es', 'zh'] as const) {
      expect(cloudFailureLine(lang, false)).toBe(CLOUD_UNREACHABLE_OFFER[lang]);
    }
  });
});

describe('on a round, the local brain has something real — keep it', () => {
  it('answers about the shot rather than announcing a failure', () => {
    // The player is standing over a ball. "I couldn't reach my brain" is useless here; a hole number
    // or a measured read is the caddie helping with what it genuinely knows.
    useRoundStore.setState({ isRoundActive: true, currentHole: 7 });
    const line = cloudFailureLine('en', false);
    expect(line).not.toBe(CLOUD_UNREACHABLE_OFFER.en);
    expect(line.length).toBeGreaterThan(0);
  });
});
