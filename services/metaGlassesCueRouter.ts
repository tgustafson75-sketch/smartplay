/**
 * 2026-05-26 — Fix AZ: Meta Glasses verbal-cue auto-routing.
 *
 * Tim: "as I'm doing the Metaglasses video recordings, I am saying
 * Putt Cam or Chip Cam or full swing, and I'm doing that on the hope
 * that once we can process audio... because this review from the
 * Metaglasses is asynchronous, it can process afterwards, pick up
 * that, and get a cue for how it's being analyzed."
 *
 * Whisper already transcribes every clip (swingCommentaryService).
 * This module detects the verbal-cue phrases in that transcript and
 * returns a tag + perspective hint that the cageStore patches onto
 * the session's upload metadata. The analyzer router
 * (services/swingLibrary.getAnalyzerKind) reads those fields and
 * routes the clip to the correct analyzer — putting vs full-swing —
 * even though the user never tapped the upload screen's pickers.
 *
 * Safety: caller must gate on `source_device === 'meta_glasses'`
 * AND on user not having set the fields explicitly. We never override
 * a user-chosen tag/perspective.
 *
 * Phrases matched (conservative — whole-word, common variants):
 *   "putt cam" / "putt camera" / "putting cam" / "putting camera"
 *      → { tag: 'putt', perspective: 'pov_self' }
 *      Reasoning: when wearing glasses looking down at the putter
 *      face, POV self + putt → puttingAnalysisService.
 *
 *   "chip cam" / "chip camera" / "chipping cam" / "chipping camera"
 *      → { tag: 'chip', perspective: 'pov_self' }
 *      Same shape as putt — POV grip-and-impact read.
 *
 *   "full swing" / "full swing cam"
 *      → { tag: null, perspective: 'watching_someone' }
 *      Per Tim: on glasses for a full swing, you're either watching
 *      someone else OR (rarer) wearing glasses on a tripod harness.
 *      Default 'watching_someone' since that's the common case;
 *      Phase K full-body swing analyzer picks it up.
 */

import type { SwingTag } from '../store/cageStore';

export interface CueResult {
  tag: SwingTag | null;
  perspective: 'pov_self' | 'watching_someone';
  /** The exact phrase that matched, for logging + telemetry. */
  matched_phrase: string;
}

const CUE_PATTERNS: { regex: RegExp; result: CueResult }[] = [
  {
    regex: /\b(putt|putting)\s*(cam(?:era)?)\b/i,
    result: { tag: 'putt', perspective: 'pov_self', matched_phrase: 'putt cam' },
  },
  {
    regex: /\b(chip|chipping)\s*(cam(?:era)?)\b/i,
    result: { tag: 'chip', perspective: 'pov_self', matched_phrase: 'chip cam' },
  },
  {
    regex: /\b(full)\s*swing(\s*cam(?:era)?)?\b/i,
    result: { tag: null, perspective: 'watching_someone', matched_phrase: 'full swing' },
  },
];

/**
 * Detect a Meta Glasses cue phrase in a transcript. Returns the first
 * matching cue, or null if no recognized phrase is present.
 *
 * Multi-cue handling: in practice Tim says ONE cue per clip. If
 * multiple match (e.g. "this is a putt cam, full swing follow-up
 * next"), the FIRST pattern in CUE_PATTERNS wins. Order is putt →
 * chip → full-swing, biased toward the most specific intent.
 */
export function detectCue(transcript: string | null | undefined): CueResult | null {
  if (!transcript) return null;
  const clean = transcript.trim();
  if (clean.length === 0) return null;
  for (const { regex, result } of CUE_PATTERNS) {
    if (regex.test(clean)) {
      // Return a fresh copy so callers can mutate without polluting
      // the const map (defensive — none currently do).
      return { ...result };
    }
  }
  return null;
}
