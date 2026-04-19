/**
 * voiceTimingController — Controls WHEN the caddie speaks.
 *
 * Enforces a 10-second minimum cooldown between all auto-triggered speech.
 * Manual "Ask Caddie" taps always bypass the cooldown.
 *
 * Triggers:
 *   1. holeStart(message)     — full message, always speaks (resets cooldown)
 *   2. afterShot(pattern)     — speaks only if pattern confidence is strong
 *   3. patternChange(insight) — short insight, subject to cooldown
 *   4. askCaddie(message)     — always speaks, bypasses cooldown
 *
 * Usage:
 *   import { VoiceTimingController } from '../services/voiceTimingController';
 *
 *   VoiceTimingController.holeStart('Play center. Stay smooth.', speakFn);
 *   VoiceTimingController.afterShot(pattern, confidence, insight, speakFn);
 *   VoiceTimingController.patternChange(insight, speakFn);
 *   VoiceTimingController.askCaddie(message, speakFn);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Any async function that accepts a string and speaks it. */
export type SpeakFn = (message: string) => Promise<void> | void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_COOLDOWN_MS = 10_000; // 10 seconds between auto-triggered speech

// Minimum pattern confidence to trigger afterShot speech (0–1)
const SHOT_PATTERN_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _lastSpokenAt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canAutoSpeak(): boolean {
  return Date.now() - _lastSpokenAt > AUTO_COOLDOWN_MS;
}

function recordSpoken(): void {
  _lastSpokenAt = Date.now();
}

async function doSpeak(message: string, speakFn: SpeakFn): Promise<void> {
  if (!message?.trim()) return;
  recordSpoken();
  await speakFn(message);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const VoiceTimingController = {

  /**
   * holeStart — speaks the full caddie message at the start of a hole.
   * Always fires (bypasses cooldown — hole transitions are high-value moments).
   */
  async holeStart(message: string, speakFn: SpeakFn): Promise<void> {
    await doSpeak(message, speakFn);
  },

  /**
   * afterShot — speaks post-shot insight only when a strong pattern exists.
   * Subject to cooldown.
   *
   * @param pattern     Current pattern key ('miss_right' | 'miss_left' | 'neutral')
   * @param confidence  Pattern confidence 0–1 (from analyzeShots)
   * @param insight     Insight string from patternInsight
   * @param speakFn     The speak function to call
   */
  async afterShot(
    pattern:    string | null,
    confidence: number,
    insight:    string,
    speakFn:    SpeakFn,
  ): Promise<void> {
    if (!pattern || pattern === 'neutral') return;
    if (confidence < SHOT_PATTERN_THRESHOLD) return;
    if (!canAutoSpeak()) return;
    await doSpeak(insight, speakFn);
  },

  /**
   * patternChange — speaks when the detected miss pattern flips.
   * Subject to cooldown.
   *
   * @param insight  Insight string for the new pattern
   * @param speakFn  The speak function to call
   */
  async patternChange(insight: string, speakFn: SpeakFn): Promise<void> {
    if (!insight?.trim()) return;
    if (!canAutoSpeak()) return;
    await doSpeak(insight, speakFn);
  },

  /**
   * askCaddie — user-initiated. Always speaks, no cooldown check.
   * Still records lastSpokenAt so subsequent auto triggers respect the gap.
   */
  async askCaddie(message: string, speakFn: SpeakFn): Promise<void> {
    await doSpeak(message, speakFn);
  },

  /** Read the timestamp of the last spoken call (ms since epoch). */
  getLastSpokenAt(): number {
    return _lastSpokenAt;
  },

  /** Manually reset — e.g. when a new round starts. */
  reset(): void {
    _lastSpokenAt = 0;
  },
};
