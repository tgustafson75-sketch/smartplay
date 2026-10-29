/**
 * 2026-10-28 (Brain review r9) — A PLAN OR A CONDITIONAL IS NOT AN ORDER.
 *
 * The shared story frame knew negations, the past, habits and reported speech, but not "if" or the
 * future: "If I go for it and miss I'm dead" and "Let me know when I should go for it" set risk mode
 * to aggressive for the round, "If I play it safe I make bogey anyway" set safe, "I need to go home
 * after this hole" router.replace'd him off the round screen mid-hole, and "I want to scan my scorecard
 * after the round" / "I want to add a new course to my list later" opened the importer and add-course
 * screens — each at confidence 'high', before the caddie heard it.
 *
 * BEHAVIOURAL: the real precheck, which runs before /api/kevin on every voice and typed route.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { isNotACommand } from '../../services/utteranceIsCommand';

const kind = (u: string) => precheckLocalIntent(u)?.intent_type ?? null;

describe('a conditional, a plan or a want goes to the caddie', () => {
  it.each([
    "If I go for it and miss I'm dead",
    'Let me know when I should go for it',
    'If I play it safe I make bogey anyway',
    'I need to go home after this hole',
    'I want to scan my scorecard after the round',
    'I want to add a new course to my list later',
    'I need to go home',
    'Tomorrow switch to dark mode',
  ])('"%s"', (u) => {
    expect(kind(u)).toBe('conversational');
  });

  it('the tab-mic bypasses share the frame', () => {
    expect(isNotACommand('If I take a penalty here I am done')).toBe(true);
  });
});

describe('orders, including polite ones, still act', () => {
  it.each([
    ['can you take me home', 'navigate'],
    ['take me home', 'navigate'],
    ['go for it', 'change_setting'],
    ['next hole', 'navigate'],
    ['switch to dark mode', 'change_setting'],
    ['show me my round from yesterday', 'find_my_data'],
  ])('"%s" → %s', (u, want) => {
    expect(kind(u)).toBe(want);
  });
});
