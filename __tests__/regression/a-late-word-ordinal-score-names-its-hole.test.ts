/**
 * 2026-10-31 (Brain recheck r25, BRAIN-R25-1) — A SCORE ON A WORD-ORDINAL HOLE OF TENTH OR HIGHER NAMES THAT HOLE.
 *
 * The r24 fix (BRAIN-R24-1) removed every bare word ordinal from the score readers, so "I got a 5 on the twelfth"
 * named no hole. The score then fell to voiceScoreHole (the lowest unscored hole behind him) online, and the
 * offline writer logged it to the hole he stands on, overwriting a real score. A word ordinal after "on"/"at"
 * from tenth up cannot be a count in a score ("on the second shot" still is), so it names the hole again.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { namedSpokenHole, parseSpokenHole } from '../../services/spokenHole';

describe('a score on a word-ordinal hole of tenth or higher names that hole (r25)', () => {
  it.each([
    ['I got a 5 on the twelfth', 12],
    ['I made a 4 at the thirteenth', 13],
    ['I got a 6 on the eleventh', 11],
    ['I shot a 5 on the eighteenth', 18],
    ['I made a 3 on the tenth', 10],
  ])('"%s" names hole %i for a score', (utterance, hole) => {
    expect(parseSpokenHole(utterance, true)).toBe(hole);
    expect(namedSpokenHole(utterance, true)).toBe(hole);
  });

  it.each([
    ['I got a 5 on the twelfth', 12],
    ['I made a 4 at the thirteenth', 13],
  ])('"%s" carries hole %i into log_score from the precheck', (utterance, hole) => {
    const i = precheckLocalIntent(utterance);
    expect(i?.intent_type).toBe('log_score');
    expect(i?.parameters?.hole_number).toBe(hole);
  });

  it.each([
    'I got a 4 on the second shot',
    'I got a 6 on the first try',
    'I made a bogey, the first bogey of the day',
  ])('"%s" still names no hole for a score (a count, not a hole)', (utterance) => {
    expect(parseSpokenHole(utterance, true)).toBeNull();
    expect(namedSpokenHole(utterance, true)).toBeNull();
  });
});
