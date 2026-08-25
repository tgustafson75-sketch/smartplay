import {
  getCaddieTemplate,
  type CaddieSituation,
  _allCaddieTemplates,
} from '../constants/dialogTemplates/caddieTemplates';
import {
  getCoachTemplate,
  type CoachSituation,
  _allCoachTemplates,
} from '../constants/dialogTemplates/coachTemplates';
import {
  getPsychologistTemplate,
  type PsychologistSituation,
  _allPsychologistTemplates,
} from '../constants/dialogTemplates/psychologistTemplates';

/**
 * Phase F — Character-agnostic dialog engine.
 *
 * Returns a single string for a given role + situation, with `{var}` placeholders
 * interpolated from the context object. The engine picks among templated
 * variations to avoid robotic repetition.
 *
 * Today the only character is Kevin, so the engine returns the bare template.
 * Phase H adds Tank as an alternate character; the API extends with a
 * `character` parameter and Tank-specific phrasings layer on top of the same
 * generic templates without rewriting any consumer.
 *
 * Architectural seam: this is the single point where character-specific voice
 * gets composed. Future Tank phasing happens here, not in 50 inline-prompt
 * sites scattered across the app.
 */

export type DialogRole = 'caddie' | 'coach' | 'psychologist';

export type DialogSituation = CaddieSituation | CoachSituation | PsychologistSituation;

export type DialogContext = Record<string, string | number | null | undefined>;

/**
 * 2026-08-24 (Tim's on-course screenshot) — DON'T GLUE A LEAD-IN ONTO A CAPITALISED SENTENCE.
 *
 * The caddie said: "Looks like Ball is on a patchy lie with some sticks and debris…"
 *
 * The template is "Looks like {situation} {advice}", and `situation` arrived as a complete sentence
 * beginning with a capital. Interpolating it verbatim produced a capital mid-sentence and a missing
 * article — small, and exactly the kind of seam that stops the caddie sounding like a person, which
 * is the north star ([[feels-like-a-real-caddie]]).
 *
 * So a slot that lands mid-sentence gets its first letter lowered. Deliberately conservative: an
 * ALL-CAPS token (a club like "PW", an acronym) and anything already lowercase are left alone, and
 * a slot at the very START of the template is untouched because there it IS the sentence opener.
 */
function interpolate(template: string, context: DialogContext): string {
  return template.replace(/\{(\w+)\}/g, (match, key, offset: number) => {
    const v = context[key];
    if (v == null) return `{${key}}`;
    const text = String(v);
    if (offset === 0 || !text) return text;
    // Only when this slot genuinely continues a sentence — i.e. the preceding text does not end a
    // sentence with . ! ? or : — does a leading capital read as a mistake.
    const before = template.slice(0, offset).trimEnd();
    if (before === '' || /[.!?:]$/.test(before)) return text;
    const first = text.split(/\s/)[0];
    if (first === first.toUpperCase() && first.length <= 4) return text;   // PW, GW, 3W, an acronym
    return text.charAt(0).toLowerCase() + text.slice(1);
  });
}

/**
 * Returns a string of dialog for the given role/situation, with context vars
 * interpolated. Picks a random variation each call.
 *
 * Examples:
 *   getDialog('caddie', 'shot_prompt', {})
 *     → "What'd you hit?" (one of seven variations)
 *   getDialog('caddie', 'distance_to_pin', { yards: 152 })
 *     → "152 to the pin."
 *   getDialog('psychologist', 'post_bad_shot_reset', {})
 *     → "Let it go. Next one."
 */
export function getDialog(role: DialogRole, situation: string, context: DialogContext = {}): string {
  let raw: string;
  if (role === 'caddie') {
    raw = getCaddieTemplate(situation as CaddieSituation);
  } else if (role === 'coach') {
    raw = getCoachTemplate(situation as CoachSituation);
  } else {
    raw = getPsychologistTemplate(situation as PsychologistSituation);
  }
  return interpolate(raw, context);
}

/**
 * Introspection helper — returns all templates for a role. Used by tests
 * and the help-discovery surface.
 */
export function listSituations(role: DialogRole): string[] {
  if (role === 'caddie') return Object.keys(_allCaddieTemplates());
  if (role === 'coach') return Object.keys(_allCoachTemplates());
  return Object.keys(_allPsychologistTemplates());
}
