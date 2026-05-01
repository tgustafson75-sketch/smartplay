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

function interpolate(template: string, context: DialogContext): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = context[key];
    return v == null ? `{${key}}` : String(v);
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
