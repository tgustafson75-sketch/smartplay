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
  | 'recap_outro'
  // Phase I — SwingLab surfaces. Coach voice across the Practice tab.
  | 'swinglab_home_intro'
  | 'swinglab_home_intro_returning'
  | 'drill_suggestion_generic'
  | 'drill_suggestion_with_pattern'
  | 'cage_mode_setup_intro'
  | 'cage_session_review_intro'
  | 'arena_intro'
  | 'arena_challenge_intro'
  | 'drill_detail_intro'
  | 'primary_issue_summary_terse'
  | 'primary_issue_summary_standard'
  | 'primary_issue_summary_engaged'
  | 'earbud_open';

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

  // Phase I — SwingLab Coach surfaces. Variation per call avoids robotic
  // repetition. Variables: {name}, {drill}, {pattern}, {club}, {challenge}.

  swinglab_home_intro: [
    "Welcome to the lab. What are we working on today?",
    "Good place to be — let's pick something to sharpen.",
    "In the lab. Pick a drill, or jump straight into a Cage Session.",
  ],
  swinglab_home_intro_returning: [
    "Welcome back, {name}. Pick up where we left off?",
    "Back in the lab. What's calling you today?",
    "Good to see you. Ready to work?",
  ],

  drill_suggestion_generic: [
    "Try the {drill} if you've got time — it's a strong starting point.",
    "{drill} would be a good place to start today.",
    "If you want one to focus on, the {drill} pays back.",
  ],
  drill_suggestion_with_pattern: [
    "Based on last week, the {drill} would help with {pattern}.",
    "{drill} is the one — last round you were {pattern}, this targets it.",
    "Try the {drill}. It directly addresses {pattern} from your last few rounds.",
  ],

  cage_mode_setup_intro: [
    "{club} — let's see what's working today.",
    "{club} up. Smooth start, then build up.",
    "Starting with the {club} — money club. Show me.",
  ],

  cage_session_review_intro: [
    "Let me take a look at that.",
    "Some things worth talking about.",
    "Alright, let's see what we've got.",
  ],

  arena_intro: [
    "Beat your last score? Let's see.",
    "Pick a challenge. Compete with yourself.",
    "Game on. What feels right today?",
  ],
  arena_challenge_intro: [
    "{challenge}. Show me what you've got.",
    "{challenge} — focus, then commit.",
    "{challenge}. Have fun with it.",
  ],

  // Per-drill detail intros — drill carries its own coach_voice text in the
  // drill data; this template wraps any per-drill intro the consumer site
  // wants to compose around it. Today most consumers read drill.coach_voice
  // directly without going through this template.
  drill_detail_intro: [
    "Here's how I'd think about this one.",
    "Quick walk-through.",
  ],

  // Phase K.5 — verbosity-keyed wrappers for the swing-analysis primary issue
  // observation. The cage summary picks the right key by trust level the same
  // way Phase H picks lie_analysis_summary variants.
  primary_issue_summary_terse: [
    "{name}. {feel}",
    "{name} — {feel}",
  ],
  primary_issue_summary_standard: [
    "{name}. {mechanical} {feel}",
    "Looks like {name}. {mechanical} {feel}",
  ],
  primary_issue_summary_engaged: [
    "Alright, what I'm seeing: {name}. {mechanical} Here's the cue — {feel}",
    "Let me walk you through it. {name}. {mechanical} Try this — {feel}",
  ],

  // Phase O — earbud tap-to-talk opener (Coach register, on Practice surfaces).
  earbud_open: [
    "What are you working on?",
    "What's the focus?",
    "What do you want to dial in?",
  ],
};

export function getCoachTemplate(situation: CoachSituation): string {
  const list = TEMPLATES[situation];
  return list[Math.floor(Math.random() * list.length)];
}

export function _allCoachTemplates(): Record<CoachSituation, string[]> {
  return TEMPLATES;
}
