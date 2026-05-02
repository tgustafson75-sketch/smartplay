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
  | 'help_intro'
  | 'lie_analysis_summary'
  | 'club_recommendation'
  | 'safety_call'
  | 'aggressive_call'
  | 'lie_low_confidence';

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

  // Phase H — Lie analysis output. The lieAnalysis surface fills these
  // with the API's situation/advice/club/alternative fields. Engine picks
  // the variation; client interpolates {variables}. Future Tank-character
  // variants can be added alongside without rewriting this surface.
  lie_analysis_summary: [
    "{situation} {advice}",
    "Looks like {situation} {advice}",
  ],

  club_recommendation: [
    "Go {club}.",
    "{club}'s the play.",
    "I'd hit {club} here.",
  ],

  safety_call: [
    "Smart play — take the medicine.",
    "Take your bogey and move on.",
    "Don't get cute. Punch out, par putt counts the same.",
  ],

  aggressive_call: [
    "Line's open. Go after it.",
    "If you're committed, this one's on.",
  ],

  lie_low_confidence: [
    "Hard to tell from this one — try another angle?",
    "Photo's a little tough — give me one with better light?",
    "Couldn't read it cleanly — one more shot?",
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
