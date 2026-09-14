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
 *
 * ─── 2026-09-13 (Tim: "the rest is likely not additive and/or noise") ───────────────────────────
 *
 * NINE SITUATIONS WERE REMOVED, and every one of them had a LIVE owner that already said the thing,
 * usually better. The audit that found them first read them as unwired halves; they are not — they
 * are a second, dormant authoring of shipping copy, which is the defect this codebase names most
 * often. Wiring them would have created the two-owners split, not closed one.
 *
 *   distance_to_pin / _front / _back  services/intents/queryStatusHandler answers green_front /
 *                                     green_back / green_middle with the RESOLVED yardage
 *                                     (`${value} to the ${which}.`) — the same sentence, with a real
 *                                     number behind it instead of a caller-supplied one.
 *   wind_callout                      the same handler says "12 miles per hour out of the southwest"
 *                                     AND has a calm-case line. "{speed} {direction}" is thinner.
 *   plays_like                        the handler factors weather in; the template restated the shape
 *                                     without the computation.
 *   no_data_apology                   THE IMPORTANT ONE. The handler's refusals are SPECIFIC — "I
 *                                     don't have green coordinates for the front of this hole", "I
 *                                     can't read the wind right now". A generic "I don't have that
 *                                     yet." is a REGRESSION in honesty: an honesty gate has to say
 *                                     what it still needs. [[silence-is-not-an-answer]]
 *   shot_logged_ack                   services/caddieAckLines is the documented single owner of "Got
 *                                     it." — and offlineVoiceCache pre-renders those lines in the
 *                                     persona's REAL voice, so speaking a template copy instead would
 *                                     regress the happy path to robotic device TTS.
 *   help_intro                        "Here's what you can say." was the pre-brain answer. The
 *                                     "how do I …?" path now reaches services/knowledgeBase/howTo
 *                                     through the brain and gives the actual steps.
 *   lie_analysis_summary_engaged      a leftover of the L4 trust level, collapsed 2026-06-04. L3
 *                                     inherits the engaged tone via responseMode; nothing can select
 *                                     this key any more.
 *
 * `aggressive_call` was the ONLY one of the twelve that was a genuine missing wire, and it is now
 * called: app/lie-analysis paired it with `safety_call` and passed only the conservative branch, so
 * the caddie said nothing at all when the aggressive line was on.
 */

export type CaddieSituation =
  | 'shot_prompt'
  | 'lie_analysis_summary'
  | 'lie_analysis_summary_terse'
  | 'club_recommendation'
  | 'safety_call'
  | 'aggressive_call'
  | 'lie_low_confidence'
  | 'goal_aware_addendum'
  | 'earbud_open';

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

  // Phase H — Lie analysis output. The lieAnalysis surface fills these
  // with the API's situation/advice/club/alternative fields. Engine picks
  // the variation; client interpolates {variables}. Future Tank-character
  // variants can be added alongside without rewriting this surface.
  // Three verbosity variants per Trust Spectrum level — the screen picks
  // which key to call based on getTrustLevel(): L1 (Quiet/Cockpit) → terse,
  // L2 (Companion) → standard, L3 (Active) → engaged.
  lie_analysis_summary: [
    "{situation} {advice}",
    "Looks like {situation} {advice}",
  ],
  lie_analysis_summary_terse: [
    "{advice}",
    "Here's the play: {advice}",
  ],

  // Phase O — earbud tap-to-talk opener (Caddie register, in-round).
  // Real-caddie phrasing — not "How can I help you?" or "Listening…".
  earbud_open: [
    "What are you seeing?",
    "What are you thinking?",
    "What's the play?",
    "Talk to me.",
    "What's on your mind?",
  ],

  // Goal-aware addendum — only spoken when the API returns a goal_aware_note
  // (i.e., the score state actually shifted the recommendation). Templates
  // wrap the API's note text without restating it verbatim.
  goal_aware_addendum: [
    "{note}",
    "And — {note}",
    "Worth noting: {note}",
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

  /**
   * 2026-09-13 (triple-check) — DEGRADES, NEVER THROWS.
   *
   * This was `const list = TEMPLATES[situation]; return list[...]`, which throws
   * "Cannot read properties of undefined" on any situation the map does not hold. `getDialog` takes
   * `situation: string` and CASTS it (`situation as CaddieSituation`), so TypeScript protects the typed
   * call sites and not the dynamic ones — app/lie-analysis builds its key from the trust level, and any
   * future computed key has the same shape.
   *
   * Nine situations were removed from the caddie map earlier today because a live owner already said
   * them, which widened exactly this hole: nine names that used to resolve now would not. A missing
   * template should mean the caddie SAYS NOTHING, not that a voice turn dies — every caller
   * concatenates the result, so an empty string is safe and a throw is field-fatal on the TTS path.
   */
export function getCaddieTemplate(situation: CaddieSituation): string {
  const list = TEMPLATES[situation];
  if (!Array.isArray(list) || list.length === 0) {
    // `typeof` guarded: these template modules are dependency-free by design and are imported by pure
    // tests and by scripts where the React Native `__DEV__` global does not exist. A bare `__DEV__`
    // reference here threw ReferenceError — a fix for "never throw" that introduced a throw, caught by
    // the guard for it within a minute of being written.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[dialogTemplates] no template for situation:', situation);
    }
    return '';
  }
  return list[Math.floor(Math.random() * list.length)];
}

/** For tests / introspection. */
export function _allCaddieTemplates(): Record<CaddieSituation, string[]> {
  return TEMPLATES;
}
