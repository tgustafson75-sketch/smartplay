/**
 * 2026-09-13 (triple-check of the day's work) — A MISSING DIALOG TEMPLATE WOULD HAVE THROWN.
 *
 * The three template getters read `const list = TEMPLATES[situation]; return list[...]`, which throws
 * "Cannot read properties of undefined" for any situation the map does not hold. `getDialog` is typed
 * `situation: string` and CASTS it — `situation as CaddieSituation` — so TypeScript guards the literal
 * call sites and not the dynamic ones. app/lie-analysis already builds its key from the trust level, and
 * every future computed key has the same shape.
 *
 * Earlier today I deleted nine caddie situations because a live owner already said them. That was right,
 * and it widened exactly this hole: nine names that used to resolve now would not. Found by asking what
 * happens to a caller that passes one of them — which is the question the deletions should have prompted
 * at the time.
 *
 * A missing template means the caddie SAYS NOTHING. Every caller concatenates the result, so an empty
 * string is safe, and a throw on the TTS path is field-fatal — the class this repo calls a render crash.
 */
import { getDialog, listSituations } from '../../services/dialogEngine';

describe('an unknown situation is silence, not an exception', () => {
  const GONE = [
    'shot_logged_ack', 'distance_to_pin', 'distance_to_front', 'distance_to_back',
    'wind_callout', 'plays_like', 'no_data_apology', 'help_intro', 'lie_analysis_summary_engaged',
  ];

  it.each(GONE)('a situation removed today ("%s") returns empty rather than throwing', (situation) => {
    expect(() => getDialog('caddie', situation)).not.toThrow();
    expect(getDialog('caddie', situation)).toBe('');
  });

  it.each(['caddie', 'coach', 'psychologist'] as const)('%s handles a never-existing situation', (role) => {
    expect(() => getDialog(role, 'totally_made_up_situation')).not.toThrow();
    expect(getDialog(role, 'totally_made_up_situation')).toBe('');
  });

  it('an empty string is safe for the callers that concatenate', () => {
    // app/lie-analysis builds `summary + clubLine + closer + goalLine` and trims.
    const assembled = `${getDialog('caddie', 'nope')} ${getDialog('caddie', 'also_nope')}`.trim();
    expect(assembled).toBe('');
  });
});

describe('the real situations still speak', () => {
  it.each(['caddie', 'coach', 'psychologist'] as const)('every %s situation returns a non-empty line', (role) => {
    const situations = listSituations(role);
    expect(situations.length).toBeGreaterThan(0);
    for (const s of situations) {
      const line = getDialog(role, s, {
        club: '7 iron', yards: 150, note: 'n', situation: 's', advice: 'a', speed: '10', direction: 'left',
        actual: 150, plays_like: 155,
      });
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('the aggressive call wired today actually produces a line', () => {
    expect(getDialog('caddie', 'aggressive_call').length).toBeGreaterThan(0);
    expect(getDialog('caddie', 'safety_call').length).toBeGreaterThan(0);
  });

  it('interpolation still fills a variable', () => {
    expect(getDialog('caddie', 'club_recommendation', { club: '7 iron' })).toMatch(/7 iron/);
  });
});
