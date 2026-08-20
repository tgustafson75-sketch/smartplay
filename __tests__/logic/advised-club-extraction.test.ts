/**
 * Reading back the club the caddie actually recommended.
 *
 * 2026-08-20 (QA pass). recommend_club fired ZERO times live. The decisive probe: told explicitly,
 * in the user turn, to call the tool, the brain replied
 *     "I'd go with a smooth 8-iron here.  Now, let me log that for you."   tool_actions: []
 * It ANNOUNCED the call and never made it — the conversational turn runs gpt-4o-mini, which is weak
 * at emitting content AND tool_calls together, and the agentic loop ends on a content-only message.
 * Prompt wording cannot fix that, so the server reads the advice out of what the caddie said.
 *
 * The asymmetry that shapes every case below: a MISS costs one unpaired shot. A FALSE POSITIVE
 * scores adherence against advice that was never given, which poisons the club ladder the caddie
 * recommends FROM. Where they conflict, miss.
 */
import { extractAdvisedClub } from '../../api/_brain';

describe('real answers the live brain actually produced', () => {
  // Captured verbatim from api.smartplaycaddie.com during the QA pass.
  const cases: Array<[string, string]> = [
    ["I'd go with a smooth 8 iron here.", '8 iron'],
    ["I'd go with a smooth 8-iron here. It should get you to the green nicely.", '8 iron'],
    ["I'd go with a smooth 6 iron here. Keep it steady and let the wind help.", '6 iron'],
    ["Sounds like a solid 7 iron. A little extra club should help with the wind.", '7 iron'],
    ["I'd go with a sand wedge here. Aim for the middle of the green and let it release a bit.", 'sand wedge'],
  ];
  it.each(cases)('%s → %s', (text, club) => {
    expect(extractAdvisedClub(text)?.club).toBe(club);
  });
});

describe('shape is carried only when it was actually advised', () => {
  it('picks up a shape named alongside the club', () => {
    expect(extractAdvisedClub("I'd go with a 7 iron, little fade into that pin.")).toEqual({ club: '7 iron', shape: 'fade' });
  });
  it('omits shape when none was given', () => {
    expect(extractAdvisedClub("I'd go with a 7 iron here.")).toEqual({ club: '7 iron' });
  });
});

describe('spoken number-words and wedge shorthands', () => {
  it.each([
    ["Let's go with the nine iron.", '9 iron'],
    ['This is a driver hole.', 'driver'],
    ["I'd hit the three wood off the tee here.", '3 wood'],
    ['Take your pitching wedge and land it short.', 'pitching wedge'],
    ["That's a hybrid all day.", 'hybrid'],
    ["Lay up with a 5 iron.", '5 iron'],
  ])('%s → %s', (text, club) => {
    expect(extractAdvisedClub(text)?.club).toBe(club);
  });
});

describe('the false positives that would poison adherence', () => {
  it.each([
    // General club TALK — a fact about a club, not advice on this shot.
    ['Your 7 iron goes about 165 on average.',                       'stated distance, no advice'],
    ['You have been striking your 8 iron really well lately.',       'praise, no advice'],
    ['Most players carry a sand wedge around 80 yards.',             'general knowledge'],
    // Asking for information rather than advising.
    ["What's the distance to the pin?",                              'question back'],
    ['How far do you normally hit your 7 iron?',                     'question about a club'],
    // Advice cue present but NO club named — nothing to record.
    ["I'd go with the smooth swing here, take something off it.",    'cue, no club'],
    // Empty / noise
    ['', 'empty'],
  ])('does not fire on: %s (%s)', (text) => {
    expect(extractAdvisedClub(text)).toBeNull();
  });

  it('a cue in one sentence cannot vouch for a club in an unrelated one', () => {
    // The cue and the club are in different sentences: the club here is commentary, not the advice.
    expect(extractAdvisedClub("Let's go with something smooth. Your 9 iron has been flying lately.")).toBeNull();
  });
});

describe('found by the live probe, not by any unit test', () => {
  /**
   * `npm run probe-tools` caught this on its FIRST run against kevin, with 1139 unit tests green.
   * It depends on a sentence the MODEL chose to write, which is why no static test could reach it.
   */
  it('does not record advice from a hypothetical asking the player for the number', () => {
    const reply = "I don't have your distances yet. If you tell me how far you hit your 7 iron, I can remember it.";
    expect(extractAdvisedClub(reply)).toBeNull();
  });

  it('does not treat distance talk as a recommendation', () => {
    expect(extractAdvisedClub('How far you hit your 7 iron depends on the wind.')).toBeNull();
  });

  it('but a real conditional recommendation still counts', () => {
    // The narrow exclusion must not swallow advice that happens to start with a condition.
    expect(extractAdvisedClub("If it's into the wind, I'd go with a 6 iron.")?.club).toBe('6 iron');
  });
});
