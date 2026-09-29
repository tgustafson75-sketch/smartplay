/**
 * 2026-09-29 — WHERE THE SWING-ANALYSIS FRAMES COME FROM, AND HOW BIG THEY ARE.
 *
 * Pure so it can be tested without a device. services/poseDetection.extractKeyFrames does the native
 * decoding; every decision about WHICH moments to decode and HOW LARGE to send them lives here.
 *
 * Why nine, evenly spaced. The fault read used to send three frames at fixed 10/55/85% of the window
 * (quick tier) or five impact-clustered ones (full tier). Across a ~1.5s swing window three frames are
 * ~500ms apart: the top of the backswing and impact — the two moments nearly every fault is judged on
 * — could both fall between frames, and the model was then asked to call over-the-top from an address
 * frame and a finish. Nine evenly spaced frames close the gap to ~190ms, which is the difference
 * between seeing the top and inferring it (the standalone SmartMotion app settled on the same number
 * for the same reason — its src/lib/frames.ts).
 *
 * Why the long edge, not the width. The resize used to be `{ width: N }`, which on a portrait phone
 * clip (1080x1920 — the way most people film a swing) produced frames ~1.8x taller than the "N px"
 * the comment promised. Sizing by the long edge makes the number mean what it says in both
 * orientations and keeps nine frames inside roughly twice the old three-frame upload.
 */

/** Frames sent for one swing's fault read. */
export const SWING_ANALYSIS_FRAME_COUNT = 9;

/**
 * Inset used when the sampled window touches the very start or end of the clip. Frames at exactly 0
 * or at the last millisecond are commonly black, a record-button transient, or undecodable.
 */
const CLIP_EDGE_INSET_FRACTION = 0.06;
/**
 * The inset for a LOCATED window that the locator clamped to a clip edge. 6% of the whole clip is
 * 1.8s on a 30s upload — longer than the swing window itself — so the span collapsed and the read got
 * one frame (or nine bunched past address). A found window only needs to step off the transient.
 */
const LOCATED_EDGE_INSET_FRACTION = 0.05;
const LOCATED_EDGE_INSET_MAX_MS = 150;
/** A window covering at least this much of the clip is the clip, not a found swing. */
const WHOLE_CLIP_WINDOW_FRACTION = 0.9;

export type AnalysisSample = {
  /** Milliseconds into the clip. */
  tMs: number;
  /** Position within the sampled window, 0 = window start, 1 = window end. */
  fraction: number;
};

/**
 * Evenly spaced sample times across [windowStartMs, windowStartMs + windowDurationMs].
 *
 * An end of the window that coincides with an end of the CLIP is pulled in: by
 * CLIP_EDGE_INSET_FRACTION of the clip when the window IS the clip, and by a small capped inset
 * (5% of the window, at most 150ms) when a located swing window was clamped to the clip edge. An end
 * inside the clip is sampled exactly, because that is where address and the finish are.
 */
export function analysisSampleTimes(
  windowStartMs: number,
  windowDurationMs: number,
  clipDurationMs: number | null | undefined,
  count: number = SWING_ANALYSIS_FRAME_COUNT,
): AnalysisSample[] {
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowDurationMs) || windowDurationMs <= 0) return [];
  if (!Number.isInteger(count) || count < 1) return [];
  const winEnd = windowStartMs + windowDurationMs;
  const clip = typeof clipDurationMs === 'number' && Number.isFinite(clipDurationMs) && clipDurationMs > 0
    ? clipDurationMs
    : null;
  const wholeClip = clip != null && windowDurationMs >= clip * WHOLE_CLIP_WINDOW_FRACTION;
  const inset = clip == null
    ? 0
    : wholeClip
      ? clip * CLIP_EDGE_INSET_FRACTION
      : Math.min(clip * CLIP_EDGE_INSET_FRACTION, windowDurationMs * LOCATED_EDGE_INSET_FRACTION, LOCATED_EDGE_INSET_MAX_MS);
  const from = windowStartMs <= 0 ? Math.max(0, Math.min(inset, winEnd)) : windowStartMs;
  const to = clip != null && winEnd >= clip ? Math.max(from, clip - inset) : winEnd;
  const span = to - from;
  if (count === 1 || span <= 0) {
    const t = Math.round(from + Math.max(0, span) / 2);
    return [{ tMs: t, fraction: (t - windowStartMs) / windowDurationMs }];
  }
  return Array.from({ length: count }, (_, i) => {
    const t = Math.round(from + (span * i) / (count - 1));
    return { tMs: t, fraction: (t - windowStartMs) / windowDurationMs };
  });
}

/**
 * The expo-image-manipulator resize action that makes the LONG edge `target` px, never upscaling.
 * Unknown dimensions fall back to the width form — the historical behaviour — rather than guessing an
 * orientation.
 */
export function longEdgeResize(
  width: number | null | undefined,
  height: number | null | undefined,
  target: number,
): { width: number } | { height: number } {
  const w = typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : null;
  const h = typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : null;
  if (w == null || h == null) return { width: target };
  if (h > w) return { height: Math.min(target, Math.round(h)) };
  return { width: Math.min(target, Math.round(w)) };
}

/**
 * Which locate a clip gets before its frames are sampled.
 *
 *   'full'           ≥ 6s:   on-device first, then the network locate (unchanged)
 *   'on_device_only' 2.5-6s: on-device only. These clips used to skip locating entirely and fall
 *                    to "the last five seconds" — for a 5.5s clip, the whole thing, so the swing got
 *                    a fraction of the frames. A dozen on-device pose reads find it offline in a few
 *                    seconds; the network locate stays reserved for the long clips it was built for.
 *   'none'           < 2.5s: the clip IS the swing.
 */
export const ON_DEVICE_LOCATE_MIN_CLIP_MS = 2_500;
export const NETWORK_LOCATE_MIN_CLIP_MS = 6_000;

export function locatePlanFor(durationMs: number): 'full' | 'on_device_only' | 'none' {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'none';
  if (durationMs >= NETWORK_LOCATE_MIN_CLIP_MS) return 'full';
  if (durationMs >= ON_DEVICE_LOCATE_MIN_CLIP_MS) return 'on_device_only';
  return 'none';
}

/**
 * The span the analysis frames actually covered, stamped onto the result so the review can say it.
 * `whole_clip` is true when the frames were spread over (nearly) the whole recording rather than a
 * window found around the swing.
 */
export type SampleCoverage = {
  start_sec: number;
  end_sec: number;
  frames: number;
  whole_clip: boolean;
};


export function sampleCoverage(
  frameTimesSec: number[],
  /** The window the frames were sampled inside, or null when no window was known (unbounded). */
  windowSec: { startSec: number; endSec: number } | null | undefined,
  clipDurationMs: number | null | undefined,
): SampleCoverage | null {
  const ts = frameTimesSec.filter((t) => typeof t === 'number' && Number.isFinite(t));
  if (ts.length === 0) return null;
  const start = Math.min(...ts);
  const end = Math.max(...ts);
  const clipSec = typeof clipDurationMs === 'number' && Number.isFinite(clipDurationMs) && clipDurationMs > 0
    ? clipDurationMs / 1000
    : null;
  const whole = windowSec == null
    || (clipSec != null && (windowSec.endSec - windowSec.startSec) >= clipSec * WHOLE_CLIP_WINDOW_FRACTION);
  return {
    start_sec: Math.round(start * 10) / 10,
    end_sec: Math.round(end * 10) / 10,
    frames: ts.length,
    whole_clip: whole,
  };
}

/**
 * The one short line the review shows about coverage, as an i18n key + params, or null when there
 * is nothing honest to say. Pure so the wording decision is testable apart from the screen.
 *
 *   found window  → "Found your swing at 1.2–2.8 s · 9 frames"
 *   whole clip    → "Clip covers 0.3–5.2 s · 9 frames — the swing wasn't pinned"
 * `missedTopAndImpact` adds the second clause when the model saw neither the top nor impact (the
 * server has already capped that read at low confidence; this says why, in the player's terms).
 */
export type CoverageNote = {
  key: 'frames_found_swing' | 'frames_whole_clip';
  params: { start: string; end: string; frames: number };
  missedTopAndImpact: boolean;
};

export function coverageNote(
  cov: SampleCoverage | null | undefined,
  phases: { top: boolean; impact: boolean } | null | undefined,
): CoverageNote | null {
  if (!cov || !(cov.frames > 0) || !Number.isFinite(cov.start_sec) || !Number.isFinite(cov.end_sec)) return null;
  return {
    key: cov.whole_clip ? 'frames_whole_clip' : 'frames_found_swing',
    params: { start: cov.start_sec.toFixed(1), end: cov.end_sec.toFixed(1), frames: cov.frames },
    missedTopAndImpact: !!phases && !phases.top && !phases.impact,
  };
}

/**
 * 2026-09-29 — WHAT THE READ ON SCREEN WAS BUILT ON, FOR THE CADDIE.
 *
 * The review shows the coverage line and the confidence, and the server records which phases the model
 * saw — but none of it reached the brain, so "did it see my whole swing?" and "why is it low
 * confidence?" were questions the caddie could only guess at. This is the one line it gets, built from
 * the same facts the screen shows. Null when there is nothing measured to say.
 */
export type ReviewedSwingRead = {
  coverage: SampleCoverage | null;
  phases_visible: { address: boolean; top: boolean; impact: boolean; finish: boolean } | null;
  confidence: 'high' | 'medium' | 'low' | null;
};

const PHASES = ['address', 'top', 'impact', 'finish'] as const;

export function swingReadForCaddie(
  read: ReviewedSwingRead | null | undefined,
  capturedFps: number | null | undefined,
): string | null {
  const parts: string[] = [];
  const cov = read?.coverage ?? null;
  if (cov && cov.frames > 0 && Number.isFinite(cov.start_sec) && Number.isFinite(cov.end_sec)) {
    parts.push(cov.whole_clip
      ? `${cov.frames} frames spread across ${cov.start_sec.toFixed(1)}-${cov.end_sec.toFixed(1)} s of the clip — the swing was NOT pinned, so the frames may straddle it`
      : `${cov.frames} frames from ${cov.start_sec.toFixed(1)}-${cov.end_sec.toFixed(1)} s, where the swing was found`);
  }
  const pv = read?.phases_visible ?? null;
  if (pv) {
    const seen = PHASES.filter((p) => pv[p]);
    const missed = PHASES.filter((p) => !pv[p]);
    parts.push(missed.length === 0
      ? 'all four phases seen (address, top, impact, finish)'
      : `phases seen: ${seen.length ? seen.join(', ') : 'none'}; NOT seen: ${missed.join(', ')}`);
  }
  const conf = read?.confidence ?? null;
  if (conf) {
    parts.push(conf === 'low' && pv && !pv.top && !pv.impact
      ? 'confidence LOW because neither the top nor impact was in the frames'
      : `confidence ${conf}`);
  }
  const fps = typeof capturedFps === 'number' && Number.isFinite(capturedFps) && capturedFps > 0 ? Math.round(capturedFps) : null;
  if (parts.length === 0 && fps == null) return null;
  parts.push(fps != null ? `captured at ${fps} fps` : 'capture frame rate unknown');
  return `${parts.join('; ')}.`;
}
