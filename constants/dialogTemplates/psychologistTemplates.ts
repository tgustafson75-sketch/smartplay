/**
 * Phase F — Psychologist-register dialog templates.
 *
 * Observational, regulating, between-shots. The walking conversation register.
 * Consumed by services/dialogEngine.ts via
 * `getDialog('psychologist', situation, context)`.
 *
 * CRITICAL Mike-test guardrails — the line between "buddy who notices" and
 * "sports psychologist using therapy framing" is the edge Phase F must hold:
 *   - NEVER use "let's process", "how does that make you feel",
 *     "I notice you're showing signs of...", "your nervous system",
 *     "regulate", "process this emotion", or any clinical framing.
 *   - Stay on the buddy side. Casual. Brief. Off-topic when warranted.
 *   - Buddy talks the way a friend in the cart talks — small comments,
 *     low pressure, sometimes a joke, sometimes silence.
 *
 * Character-agnostic — Kevin reads these today, Tank's gravelly older-mentor
 * variants will be added as alternative phrasings in Phase H without changing
 * this schema.
 */

export type PsychologistSituation =
  | 'pre_shot_calm'
  | 'post_bad_shot_reset'
  | 'pace_check'
  | 'momentum_lift'
  | 'tilt_break'
  | 'idle_walk_filler'
  // Phase R — earbud opener for between-shot conversation surfaces (Arena landing, etc.)
  | 'earbud_open';

const TEMPLATES: Record<PsychologistSituation, string[]> = {
  pre_shot_calm: [
    "Take a breath.",
    "One swing.",
    "Smooth tempo, that's all.",
    "Nothing fancy here.",
  ],

  post_bad_shot_reset: [
    "Let it go. Next one.",
    "Done. Move on.",
    "Shake it off.",
    "Already in the past.",
  ],

  pace_check: [
    "We're moving fine.",
    "No rush.",
    "Take your time.",
  ],

  momentum_lift: [
    "You're playing well.",
    "Stay in this rhythm.",
    "Whatever you're doing, keep doing it.",
  ],

  tilt_break: [
    "Take a sec. We've got time.",
    "Breathe. Reset.",
    "This hole forgives more than you think.",
  ],

  idle_walk_filler: [
    "Nice afternoon for it.",
    "Course is in good shape.",
    "Long walk between these tees.",
    "",  // empty — sometimes the best psychologist response is silence
  ],

  earbud_open: [
    "What's up?",
    "How you doing?",
    "Talk to me.",
    "Yeah?",
    "What are you tackling?",
  ],
};

export function getPsychologistTemplate(situation: PsychologistSituation): string {
  const list = TEMPLATES[situation];
  return list[Math.floor(Math.random() * list.length)];
}

export function _allPsychologistTemplates(): Record<PsychologistSituation, string[]> {
  return TEMPLATES;
}
