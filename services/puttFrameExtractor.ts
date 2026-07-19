/**
 * 2026-05-22 — Putt-phase frame extractor.
 *
 * Putts are NOT full swings — the diagnostic moments are different.
 * The full-swing extractor in poseDetection.ts samples at
 * [0.08, 0.40, 0.60, 0.75, 0.88], biased toward the 60-78% downswing-
 * to-impact window where a full-swing's face/path read lives. That
 * window is wrong for putting: a putt's "transition" is barely
 * present, the "follow-through" is the longest visible phase (the
 * ball rolling away tells you everything about line and speed), and
 * impact happens almost dead-center.
 *
 * This service samples at putt-specific phase fractions and tags each
 * frame with a phase label so the analyst prompt
 * (puttingAnalysisService → /api/putting-analysis) can lead with the
 * right cues per frame instead of treating all 5 as undifferentiated.
 *
 * Phase fractions (validated against ~30 Meta-glasses POV putts in
 * the cage tests, May 2026):
 *   setup           0.05  — player addressing the ball, posture read
 *   address         0.20  — final stillness, alignment + ball position
 *   impact          0.50  — putter contacting ball, face-angle/contact
 *   follow_through  0.70  — putter past impact, head-stays-down read
 *   roll            0.92  — ball rolling, line + speed read vs break
 *
 * Defensive:
 *   - probeDurationMs mirrors poseDetection (Audio.Sound → VT lower-
 *     bound probe). Falls back to PUTT_FALLBACK_DURATION_MS (2.5s —
 *     typical putt clip).
 *   - Returns empty array on any failure; caller treats as "no frames"
 *     and puttingAnalysisService's spoken-read-only path takes over.
 *   - Optional boundaries support so a master clip with multiple putts
 *     can extract a single putt's window (parity with full-swing
 *     extractKeyFrames signature).
 */

import * as VT from '../utils/videoThumbnail'; // serialized wrapper (native retriever crash fix)
import * as ImageManipulator from 'expo-image-manipulator';
import { Audio } from 'expo-av';
import { devLog } from './devLog';

export type PuttPhase = 'setup' | 'address' | 'impact' | 'follow_through' | 'roll';

export interface PuttFrame {
  /** Base64-encoded JPEG, no data: prefix. */
  b64: string;
  media_type: 'image/jpeg';
  /** Wall-clock time within the source clip the frame was sampled at. */
  time_sec: number;
  /** Phase tag the analyst prompt leads with for this frame. */
  phase: PuttPhase;
}

// Phase fractions tuned for putts (see header comment for derivation).
const PUTT_PHASES: { phase: PuttPhase; t: number }[] = [
  { phase: 'setup',          t: 0.05 },
  { phase: 'address',        t: 0.20 },
  { phase: 'impact',         t: 0.50 },
  { phase: 'follow_through', t: 0.70 },
  { phase: 'roll',           t: 0.92 },
];

const PUTT_FALLBACK_DURATION_MS = 2500;

async function probeDurationMs(clipUri: string): Promise<number> {
  // Mirrors poseDetection.probeDurationMs — Audio.Sound first, then
  // VT lower-bound probe. Kept independent so a future putt-specific
  // duration heuristic (e.g. acoustic-impact-anchored windowing) can
  // diverge without disturbing the full-swing extractor.
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri: clipUri }, { shouldPlay: false });
    if (status.isLoaded && status.durationMillis && status.durationMillis > 0) {
      const ms = status.durationMillis;
      await sound.unloadAsync().catch(() => {});
      devLog(`[puttFrames] duration via Audio.Sound = ${ms}ms`);
      return ms;
    }
    await sound.unloadAsync().catch(() => {});
  } catch (e) {
    devLog('[puttFrames] Audio.Sound probe failed (non-fatal): ' + String(e));
  }

  // VT lower-bound probe — shorter steps than the full-swing probe
  // because putt clips are typically 1.5-3s, rarely past 5s.
  for (const ms of [10_000, 5_000, 3_000, 2_000, 1_500]) {
    try {
      await VT.getThumbnailAsync(clipUri, { time: ms, quality: 0.3 });
      devLog(`[puttFrames] duration via VT lower-bound = ≥${ms}ms`);
      return ms;
    } catch {
      // Frame extract at that timestamp failed → video is shorter.
    }
  }
  devLog(`[puttFrames] duration unknown, fallback ${PUTT_FALLBACK_DURATION_MS}ms`);
  return PUTT_FALLBACK_DURATION_MS;
}

/**
 * Extract the 5 putt-phase key frames from a clip. Returns base64
 * JPEGs ready for puttingAnalysisService.analyzePutt(input).
 *
 * Optional boundaries restrict sampling to [startSec, endSec] within
 * a master video — parity with extractKeyFrames in poseDetection.
 */
export async function extractPuttKeyFrames(
  clipUri: string,
  boundaries?: { startSec: number; endSec: number },
): Promise<PuttFrame[]> {
  if (!clipUri) {
    devLog('[puttFrames] empty clipUri — no frames');
    return [];
  }
  try {
    let windowStartMs: number;
    let windowDurationMs: number;
    if (boundaries) {
      windowStartMs = Math.round(boundaries.startSec * 1000);
      windowDurationMs = Math.round((boundaries.endSec - boundaries.startSec) * 1000);
    } else {
      const durationMs = await probeDurationMs(clipUri);
      windowStartMs = 0;
      windowDurationMs = durationMs;
    }

    const frames = await Promise.all(
      PUTT_PHASES.map(async ({ phase, t }) => {
        const timeMs = windowStartMs + Math.round(windowDurationMs * t);
        try {
          const r = await VT.getThumbnailAsync(clipUri, { time: timeMs, quality: 0.8 });
          // Resize-down to 1024 wide + JPEG-compress to keep the
          // payload tractable for the vision endpoint (5 frames × ~80
          // KB stays well under the 25 MB request cap).
          const m = await ImageManipulator.manipulateAsync(
            r.uri,
            [{ resize: { width: 1024 } }],
            { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
          );
          if (!m.base64) return null;
          return {
            b64: m.base64,
            media_type: 'image/jpeg' as const,
            time_sec: timeMs / 1000,
            phase,
          };
        } catch (err) {
          devLog(`[puttFrames] frame ${phase} @ ${timeMs}ms failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }),
    );
    const valid = frames.filter((f): f is PuttFrame => f !== null);
    devLog(`[puttFrames] extracted ${valid.length}/${PUTT_PHASES.length} phase frames`);
    return valid;
  } catch (e) {
    devLog('[puttFrames] extractPuttKeyFrames threw: ' + String(e));
    return [];
  }
}

/**
 * Convenience wrapper that yields just the base64 strings + phase tags
 * in the shape puttingAnalysisService.analyzePutt() consumes today
 * (frames_base64 is string[]). The phase metadata is dropped here —
 * callers wanting per-phase tagging should consume extractPuttKeyFrames
 * directly. Order is preserved: setup → address → impact → follow_through
 * → roll, so the analyst prompt can rely on positional semantics.
 */
export async function extractPuttFramesForAnalysis(
  clipUri: string,
  boundaries?: { startSec: number; endSec: number },
): Promise<string[]> {
  const frames = await extractPuttKeyFrames(clipUri, boundaries);
  return frames.map((f) => f.b64);
}
