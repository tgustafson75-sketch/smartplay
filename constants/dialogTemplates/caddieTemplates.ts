/**
 * Phase F — Caddie-register dialog templates.
 *
 * Tactical, present-tense, decisive. Consumed by services/dialogEngine.ts via
 * `getDialog('caddie', situation, context)`. Templates are character-AGNOSTIC
 * — Kevin reads them today; Tank (Phase H) will read the same templates
 * through his own voice config without rewriting the strings.
 *
 * Variation strategy: each situation has multiple variations. The engine
 * picks one at random per call to avoid robotic repetition.
 *
 * Variables in templates use `{name}` syntax — interpolated by dialogEngine
 * from the context object.
 */

export type CaddieSituation =
  | 'shot_prompt'
  | 'shot_logged_ack'
  | 'distance_to_pin'
  | 'distance_to_front'
  | 'distance_to_back'
  | 'wind_callout'
  | 'plays_like'
  | 'no_data_apology'
  | 'help_intro';

const TEMPLATES: Record<CaddieSituation, string[]> = {
  shot_prompt: [
    "What'd you hit?",
    "How was that one?",
    "What club?",
    "Talk to me about that shot.",
    "Reload?",
    "What was that?",
    "How'd it feel?",
  ],

  shot_logged_ack: [
    "Got it.",
    "Logged.",
    "Down for the count.",
    "Noted.",
  ],

  distance_to_pin: [
    "{yards} to the pin.",
    "{yards} yards in.",
    "{yards} to the middle.",
  ],

  distance_to_front: [
    "{yards} to the front.",
    "Front edge {yards}.",
  ],

  distance_to_back: [
    "{yards} to the back.",
    "Back edge {yards}.",
  ],

  wind_callout: [
    "{speed} {direction}.",
    "Wind's {direction} at {speed}.",
  ],

  plays_like: [
    "{actual} actual, plays like {plays_like}.",
    "{actual} on the card — plays {plays_like}.",
  ],

  no_data_apology: [
    "I don't have that yet.",
    "Can't pull that one right now.",
    "No data on that one — yet.",
  ],

  help_intro: [
    "Here's what you can say.",
    "Try one of these.",
  ],
};

export function getCaddieTemplate(situation: CaddieSituation): string {
  const list = TEMPLATES[situation];
  return list[Math.floor(Math.random() * list.length)];
}

/** For tests / introspection. */
export function _allCaddieTemplates(): Record<CaddieSituation, string[]> {
  return TEMPLATES;
}
