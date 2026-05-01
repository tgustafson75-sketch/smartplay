/**
 * Phase F — Coach-register dialog templates.
 *
 * Reflective, pattern-based, past-tense informing present. Consumed by
 * services/dialogEngine.ts via `getDialog('coach', situation, context)`.
 *
 * Coach voice diagnoses without lecturing. Specific over generic. Reports a
 * pattern, leaves the next move up to the player. Character-agnostic.
 */

export type CoachSituation =
  | 'recap_intro'
  | 'pattern_callout'
  | 'club_observation'
  | 'no_patterns_yet'
  | 'consistency_note'
  | 'recap_outro';

const TEMPLATES: Record<CoachSituation, string[]> = {
  recap_intro: [
    "Here's what stood out.",
    "What I noticed today.",
    "Quick read on the round.",
  ],

  pattern_callout: [
    "You missed {direction} with {club} {count} times today.",
    "{count} pulls {direction} on {club} — worth a look.",
    "{club} kept leaking {direction} — {count} of them.",
  ],

  club_observation: [
    "{club} carried {distance} on average — {variance}.",
    "Average {club}: {distance}. {variance}.",
  ],

  no_patterns_yet: [
    "Nothing jumping out yet — clean round.",
    "No patterns to flag.",
    "Nothing surprising in the data.",
  ],

  consistency_note: [
    "Most of the round was on plan.",
    "Pretty consistent throughout.",
  ],

  recap_outro: [
    "That's the read.",
    "Take it for what it's worth.",
    "Worth thinking about between rounds.",
  ],
};

export function getCoachTemplate(situation: CoachSituation): string {
  const list = TEMPLATES[situation];
  return list[Math.floor(Math.random() * list.length)];
}

export function _allCoachTemplates(): Record<CoachSituation, string[]> {
  return TEMPLATES;
}
