/**
 * 2026-06-04 — Golf Father chapter: alignment-trust failure on fade
 * setups (the optical illusion that pulls right-handed golfers off
 * their intended line when they aim left).
 *
 * Tank should consult this BEFORE diagnosing a swing fault on a fade
 * miss. The diagnostic helper below returns a confidence score for
 * "alignment trust failure vs. swing mechanics" given a set of signals
 * the caller has already collected (player report, start-line data,
 * setup-aim change, etc.).
 *
 * Non-regression: nothing in services/patternEngine.ts is modified.
 * This module ADDS a complementary diagnosis Tank can run first; the
 * existing fade/draw root-cause analysis still runs unchanged when the
 * alignment-trust hypothesis comes back low-confidence.
 */

// ─── Core principle (LLM-prompt-ready text) ────────────────────────

export const FADE_ALIGNMENT_PRINCIPLE = `
Many right-handed golfers experience a visual illusion when aiming left for a
fade. The farther left the intended start line, the less the golfer trusts the
alignment from over the ball. The result is often an unconscious re-aim during
setup — the fade shape itself can be fine, but it's now firing on the wrong
target line. The miss is alignment trust, not swing mechanics.
`.trim();

// ─── Alignment failure sequence ────────────────────────────────────

export const ALIGNMENT_FAILURE_SEQUENCE: readonly string[] = [
  'Golfer correctly picks the start line behind the ball.',
  'Golfer walks into setup.',
  'Line appears too far left from over the ball.',
  'Golfer distrusts the alignment.',
  'Golfer re-aims (usually toward the target, away from the intended start line).',
  'Fade window disappears — the shape is fine but the line is wrong.',
  'Golfer blames the swing.',
] as const;

// ─── Draw vs fade visual asymmetry ─────────────────────────────────

export const DRAW_VS_FADE_INTELLIGENCE = {
  fadeSetupNote:
    'Fade setups create stronger visual distortions because the start line is offset further from the visible target.',
  drawSetupNote:
    'Draw setups appear visually more natural — the start line and target sit on closer apparent angles.',
  implication:
    'Alignment-trust failures are more likely on fade attempts than on draws. When diagnosing a fade miss, evaluate alignment trust BEFORE diagnosing swing mechanics.',
} as const;

// ─── Diagnostic indicators ─────────────────────────────────────────

/** Each signal carries a weight used to compute an alignment-trust
 *  confidence score. Weights sum to ~10 for an unambiguous case. */
export const ALIGNMENT_TRUST_INDICATORS = {
  /** Player verbalized doubt about the line during or after setup. */
  player_reported_doubt: 3,
  /** GPS / aim sensor / camera caught a stance change after the
   *  initial alignment was set. */
  observed_setup_reaim: 3,
  /** Ball started on the target line (or right of it for a fade) when
   *  the intended start line was further left — i.e. classic
   *  "fade window missed" signature. */
  start_line_matches_target_not_intent: 2,
  /** Ball shape is a normal fade — the curvature is correct, only the
   *  line is wrong. */
  shape_was_correct_only_line_off: 2,
  /** Player asked "was I aimed left enough?" or any equivalent. */
  player_self_question_about_aim: 2,
} as const;

export type AlignmentSignalKey = keyof typeof ALIGNMENT_TRUST_INDICATORS;

export interface AlignmentDiagnosisInput {
  signals: AlignmentSignalKey[];
  /** When the miss was an attempted fade, set true. Draw-attempt misses
   *  get a small confidence penalty because the visual illusion is less
   *  strong. Both still evaluate, but draws need stronger signals. */
  intendedShape?: 'fade' | 'draw' | 'straight';
}

export interface AlignmentDiagnosisResult {
  /** 0 (definitely not an alignment problem) to 10 (almost certainly). */
  confidence: number;
  /** When confidence ≥ 5, this is the recommended coaching framing.
   *  Otherwise null — defer to the existing swing-fault diagnosis. */
  coachingResponse: string | null;
  /** Pass-through so the caller can show the user what we matched on. */
  matchedSignals: AlignmentSignalKey[];
}

/** Pure function — no side effects, deterministic given the same input.
 *  Designed so SwingLab / Coach Mode / future avatar can all run the
 *  same diagnosis and get the same answer. */
export function evaluateAlignmentVsSwingFault(
  input: AlignmentDiagnosisInput,
): AlignmentDiagnosisResult {
  const weights = input.signals.reduce(
    (sum, key) => sum + (ALIGNMENT_TRUST_INDICATORS[key] ?? 0),
    0,
  );
  // Draw misses are less likely to be alignment-illusion driven; halve
  // the score so the signals have to be stronger to clear the threshold.
  const adjusted = input.intendedShape === 'fade'
    ? weights
    : input.intendedShape === 'draw'
      ? weights * 0.5
      : weights * 0.75;
  const confidence = Math.min(10, Math.round(adjusted * 10) / 10);
  const coachingResponse = confidence >= 5 ? COACHING_RESPONSE_TEMPLATE : null;
  return {
    confidence,
    coachingResponse,
    matchedSignals: input.signals.slice(),
  };
}

// ─── Coaching response template ────────────────────────────────────

export const COACHING_RESPONSE_TEMPLATE = `
The swing itself appears relatively normal. There is evidence that the intended
fade line may have been altered after address. Many golfers experience a visual
illusion when aiming left for a fade and unknowingly re-aim from over the ball.
The miss may be related more to alignment trust than swing mechanics.
`.trim();

/**
 * Convenience for prompt builders — a single block suitable for direct
 * injection into Tank's system context. Wraps the principle, the
 * sequence, and the diagnostic threshold rule in one paragraph.
 */
export function buildAlignmentPromptBlock(): string {
  return [
    'ALIGNMENT-TRUST DIAGNOSTIC (Golf Father chapter):',
    FADE_ALIGNMENT_PRINCIPLE,
    '',
    'When evaluating a fade miss, check for alignment-trust failure BEFORE recommending swing changes. Look for: post-setup re-aim, start-line matching the target rather than the intended line, the ball flight being a normal fade on the wrong line, or the player verbalizing doubt about their aim. If two or more of these signals are present, lead with the alignment hypothesis. Otherwise, proceed with the standard swing-mechanics diagnosis.',
  ].join('\n');
}
