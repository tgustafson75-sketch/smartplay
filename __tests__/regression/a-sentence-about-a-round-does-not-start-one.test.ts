/**
 * 2026-10-28 (Brain review r5) — THE TAB MIC'S PRE-ROUND SHORTCUT ACTS ONLY ON AN ORDER.
 *
 * It runs on every Caddie-tab turn before the router and the brain, matched a substring, and its only
 * guard (isNotACommand) misses a plain statement. Pre-fix, off-round:
 *
 *   "That was a quick round today"                       → a round started at the home course
 *   "Tomorrow I want to start a round at Hemet with my dad" → a round at Hemet with a guest "dad"
 *   "I did cage mode for an hour this morning…"           → Cage Mode opened, the camera recording
 *   "My wife wants me to try coach mode with our daughter" → Coach Mode opened
 *   "I want to record my swing down the line tomorrow"    → SmartMotion opened, auto-recording
 *
 * none of them confirmed, and the caddie never heard the sentence.
 *
 * BEHAVIOURAL: the real tabPreRoundShortcut (the hook dispatches on its result) with the real lists.
 */
import { tabPreRoundShortcut } from '../../services/tabPreRoundShortcut';

const HOME = 'Echo Hills';

describe('a sentence that mentions a round or a camera mode reaches the caddie', () => {
  it.each([
    'That was a quick round today',
    'Tomorrow I want to start a round at Hemet with my dad',
    'I did cage mode for an hour this morning and my back is sore',
    'I did cage mode this morning',
    'My wife wants me to try coach mode with our daughter',
    'I want to start a round at Hemet',
    'So that was a quick round',
    // SmartMotion with an angle starts recording on arrival, and "record" passes the handler's verb gate.
    'I want to record my swing down the line tomorrow',
  ])('"%s" → no shortcut', (t) => {
    expect(tabPreRoundShortcut(t, HOME)).toBeNull();
  });
});

describe('an order still takes the shortcut', () => {
  it.each([
    ['Start a round at Hemet with Mike', 'quick_round'],
    ["Let's play a round", 'quick_round'],
    ['Let’s play a quick round', 'quick_round'],
    ['Quick round at Hemet', 'quick_round'],
    ['Okay, start a quick round', 'quick_round'],
    ['Can you start a round at Hemet', 'quick_round'],
    ['Cage mode', 'open_tool'],
    ['Start cage mode', 'open_tool'],
    ['Open cage mode', 'open_tool'],
    ['Hey Kevin, start cage mode', 'open_tool'],
    ['Coach mode for Lily', 'open_tool'],
    ['Watch my student', 'open_tool'],
    ['Record me down the line', 'open_tool'],
    ['Down the line', 'open_tool'],
  ])('"%s" → %s', (t, kind) => {
    expect(tabPreRoundShortcut(t, HOME)?.intent_type).toBe(kind);
  });

  it('keeps the course, the guests and the player it heard', () => {
    expect(tabPreRoundShortcut('Start a round at Hemet with Mike', HOME)?.parameters)
      .toEqual({ hole_count: 18, course_hint: 'Hemet', guest_names: ['Mike'] });
    expect(tabPreRoundShortcut("Let's play a quick round", HOME)?.parameters.course_hint).toBe(HOME);
    expect(tabPreRoundShortcut('Coach mode for Lily', HOME)?.parameters).toEqual({ tool_name: 'coach_mode', player_name: 'Lily' });
    expect(tabPreRoundShortcut('Record me down the line', HOME)?.parameters)
      .toEqual({ tool_name: 'smartmotion', auto_start: true, angle: 'down_the_line' });
  });
});
