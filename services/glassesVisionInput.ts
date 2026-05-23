/**
 * Glasses Vision Input — real-time frame queue + auto-mode detection.
 *
 * Architecture: Meta Ray-Ban glasses (and phone camera) push frames into
 * this module. The module:
 *   1. Buffers the last N frames in a rolling queue (newest at the end).
 *   2. Auto-detects whether the captured stream looks like SWING or
 *      PUTTING input from frame metadata + heading variance + source
 *      hints. Detection result feeds smartAnalysisEngine routing.
 *   3. Fans out to subscribers (smartAnalysisEngine, the active screen,
 *      brain.ts) so they react to new frames without polling.
 *   4. Preserves the original "lastFrame TTL" surface for back-compat
 *      with the prior stub-era callers (getActiveVisionContext).
 *
 * Wire reality check (unchanged): Meta currently does NOT expose live
 * frames to third-party apps. PuttWatch + SmartMotion ship on a "user
 * records, uploads later" model. The transport adapter
 * (registerGlassesTransport) is the seam — when Meta opens an API, only
 * the transport file changes; everything here stays put.
 *
 * 2026-05-22 update: enhanced from the prior 30-second single-slot stub
 * to a rolling queue + subscriber fanout + auto-mode-detection. Older
 * callers keep working — getActiveVisionContext() still returns the
 * newest in-window frame, and submitVisionFrame() is unchanged signature.
 */

import { useRoundStore } from '../store/roundStore';
import { getCurrentLocation } from './shotLocationService';
import { devLog } from './devLog';

// ─── Types ───────────────────────────────────────────────────────────────

export type VisionSource = 'phone_camera' | 'glasses' | 'tightlie' | 'smartmotion';
export type VisionMode = 'swing' | 'putting' | 'lie' | 'green_read' | 'unknown';

export interface VisionFrame {
  /** Local URI to a JPEG/PNG frame. file:// or content:// — fetchable. */
  uri: string;
  /** Capture timestamp (ms epoch). */
  captured_at: number;
  /** Optional heading degrees (phone compass / glasses IMU). */
  heading_deg?: number | null;
  /** Optional pitch degrees (downward POV is strongly negative; useful
   *  signal for putting-mode auto-detection). */
  pitch_deg?: number | null;
  source: VisionSource;
}

export interface VisionContext {
  frame: VisionFrame;
  hole_number: number | null;
  course_id: string | null;
  player_location: { lat: number; lng: number } | null;
  voice_utterance: string | null;
  /** 2026-05-22 — Auto-detected input mode. Drives smartAnalysisEngine
   *  routing so a glasses POV stream classifies as 'putting' without
   *  the caller having to tag it. */
  detected_mode: VisionMode;
  /** 0..100 confidence in detected_mode. */
  mode_confidence: number;
}

interface QueuedFrame {
  frame: VisionFrame;
  context_promise: Promise<VisionContext>;
}

// ─── Configuration ───────────────────────────────────────────────────────

/** Frames live this long in the queue. ~30s covers a typical glance-and-
 *  ask voice flow. Longer would let stale frames bleed into the wrong
 *  shot's context. */
const FRAME_TTL_MS = 30_000;

/** Rolling queue cap. Six matches the puttingAnalysis MAX_FRAMES (setup,
 *  address, top, impact, follow-through, roll) AND leaves room for a
 *  swing burst of three or four frames without ejecting all putting
 *  frames in mixed-mode capture. */
const QUEUE_MAX = 12;

/** Pitch threshold (degrees) below which we suspect a downward POV
 *  consistent with putting. Phone-held selfie-stick or glasses looking
 *  down at the ball sits in this range. */
const PUTTING_PITCH_THRESHOLD_DEG = -25;

// ─── State ───────────────────────────────────────────────────────────────

const queue: QueuedFrame[] = [];
type Listener = (ctx: VisionContext) => void;
const listeners = new Set<Listener>();

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Push a frame into the rolling queue. Each frame's VisionContext is
 * computed lazily once and cached — subscribers see the SAME context
 * the next async consumer sees.
 *
 * Resolves to the assembled VisionContext so single-shot callers that
 * want to await the result (existing pattern) still work.
 */
export async function submitVisionFrame(frame: VisionFrame): Promise<VisionContext> {
  const round = useRoundStore.getState();
  const location = await getCurrentLocation().catch(() => null);
  const detected = detectMode(frame);
  const context: VisionContext = {
    frame,
    hole_number: round.isRoundActive ? round.currentHole : null,
    course_id: round.activeCourseId,
    player_location: location,
    voice_utterance: null,
    detected_mode: detected.mode,
    mode_confidence: detected.confidence,
  };

  queue.push({ frame, context_promise: Promise.resolve(context) });
  pruneQueue();
  devLog(
    `[vision] frame queued source=${frame.source} hole=${context.hole_number} ` +
    `mode=${detected.mode} (${detected.confidence}%) queue_size=${queue.length}`,
  );

  // Fan out to subscribers — fire-and-forget so a slow listener can't
  // block the next frame.
  for (const cb of listeners) {
    try { cb(context); } catch (e) { devLog('[vision] listener threw: ' + String(e)); }
  }

  // Per-frame TTL eviction. The pruner above also runs on each submit,
  // but a long lull between submits leaves stale frames; setTimeout
  // closes that gap.
  setTimeout(pruneQueue, FRAME_TTL_MS + 500);

  return context;
}

/**
 * Newest in-window frame (back-compat with the prior single-slot API).
 * Returns null when the queue is empty / all frames aged out.
 */
export async function getActiveVisionContext(): Promise<VisionContext | null> {
  pruneQueue();
  const newest = queue[queue.length - 1];
  if (!newest) return null;
  return newest.context_promise;
}

/**
 * 2026-05-22 — Full queue snapshot, newest LAST. Useful for the
 * puttingAnalysisService (which wants 4-6 frames per analysis) and
 * the smartAnalysisEngine (which can pre-emptively attach the full
 * roll to a multimodal call).
 */
export async function getRecentVisionFrames(limit = QUEUE_MAX): Promise<VisionContext[]> {
  pruneQueue();
  const slice = queue.slice(-limit);
  return Promise.all(slice.map(q => q.context_promise));
}

/**
 * 2026-05-22 — Read the auto-detected aggregate mode for the current
 * queue. Useful for analyzer routing without having to inspect each
 * frame ("the player is in putting mode right now"). Returns the most
 * common mode across the last N frames with a blended confidence.
 *
 * Falls back to single-frame detection when only one frame is queued,
 * and to 'unknown' / 0 when the queue is empty.
 */
export async function getAggregateMode(): Promise<{ mode: VisionMode; confidence: number }> {
  const frames = await getRecentVisionFrames(QUEUE_MAX);
  if (frames.length === 0) return { mode: 'unknown', confidence: 0 };
  if (frames.length === 1) {
    return { mode: frames[0].detected_mode, confidence: frames[0].mode_confidence };
  }
  // Vote by mode, weighted by per-frame confidence.
  const tally: Record<VisionMode, number> = {
    swing: 0, putting: 0, lie: 0, green_read: 0, unknown: 0,
  };
  let totalConfidence = 0;
  for (const f of frames) {
    tally[f.detected_mode] += Math.max(1, f.mode_confidence);
    totalConfidence += f.mode_confidence;
  }
  let bestMode: VisionMode = 'unknown';
  let bestScore = 0;
  for (const [mode, score] of Object.entries(tally) as [VisionMode, number][]) {
    if (score > bestScore) { bestMode = mode; bestScore = score; }
  }
  const confidence = Math.round(totalConfidence / frames.length);
  return { mode: bestMode, confidence };
}

/**
 * Attach a voice utterance to every frame in the queue (the player
 * spoke; map the utterance to recent visual context). Idempotent on
 * re-submission — last utterance wins.
 */
export function attachUtteranceToFrame(utterance: string): void {
  pruneQueue();
  for (const q of queue) {
    q.context_promise = q.context_promise.then(ctx => ({ ...ctx, voice_utterance: utterance }));
  }
  devLog(`[vision] utterance attached to ${queue.length} frame(s): "${utterance.slice(0, 60)}"`);
}

/** Hard reset — call on persona switch, round end, or screen close. */
export function clearVisionContext(): void {
  if (queue.length > 0) devLog(`[vision] cleared ${queue.length} frame(s) manually`);
  queue.length = 0;
}

/**
 * Subscribe to new vision frames. Returned cleanup unsubscribes. Useful
 * for smartAnalysisEngine to react to glasses pushes in real time (when
 * transport eventually lands) and for the active screen to refresh
 * overlays on each new frame.
 */
export function subscribeVisionFrames(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// ─── Auto-mode detection ─────────────────────────────────────────────────

/**
 * Classify what KIND of input a frame appears to be from metadata. No
 * pixel inspection — RN can't do that without a native module — so we
 * lean on:
 *   - Source hint (smartmotion → swing; tightlie → lie; glasses → POV)
 *   - Pitch angle (strong downward = putting POV)
 *   - Active app context (player on a green / in cage)
 *
 * Returns the mode + a 0..100 confidence. Conservative — when in doubt
 * we return 'unknown' and let the caller decide.
 */
function detectMode(frame: VisionFrame): { mode: VisionMode; confidence: number } {
  // Strong source hints first.
  switch (frame.source) {
    case 'smartmotion': return { mode: 'swing', confidence: 95 };
    case 'tightlie':    return { mode: 'lie', confidence: 95 };
    case 'phone_camera':
    case 'glasses': {
      // Pitch is the dominant putting signal — glasses pointed down at
      // the ball is unambiguous.
      if (typeof frame.pitch_deg === 'number' && frame.pitch_deg <= PUTTING_PITCH_THRESHOLD_DEG) {
        return { mode: 'putting', confidence: 80 };
      }
      // Round context: if the player is near the green, lean putting.
      try {
        const round = useRoundStore.getState();
        if (round.isRoundActive && round.shots.length > 0) {
          // Last shot's end_location near green-known → likely putting.
          const last = round.shots[round.shots.length - 1];
          if (last.end_location) {
            // Cheap proximity heuristic: any end_location with a logged
            // putt-feel value within this hole suggests putting mode.
            const sameHolePutts = round.shots.filter(s =>
              s.hole === last.hole && (s.club === 'Putter' || s.feel === 'pure'),
            ).length;
            if (sameHolePutts >= 1) return { mode: 'putting', confidence: 55 };
          }
        }
      } catch { /* non-fatal */ }
      return { mode: 'unknown', confidence: 30 };
    }
    default:
      return { mode: 'unknown', confidence: 0 };
  }
}

// ─── Queue maintenance ───────────────────────────────────────────────────

function pruneQueue(): void {
  const cutoff = Date.now() - FRAME_TTL_MS;
  let dropped = 0;
  while (queue.length > 0 && queue[0].frame.captured_at < cutoff) {
    queue.shift();
    dropped++;
  }
  while (queue.length > QUEUE_MAX) {
    queue.shift();
    dropped++;
  }
  if (dropped > 0) devLog(`[vision] queue pruned ${dropped} frame(s), now ${queue.length}`);
}

// ─── Transport adapter (unchanged) ───────────────────────────────────────

export interface GlassesVisionTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
}

let activeTransport: GlassesVisionTransport | null = null;

export function registerGlassesTransport(t: GlassesVisionTransport): void {
  activeTransport = t;
  devLog('[vision] glasses transport registered');
}

export function getGlassesTransport(): GlassesVisionTransport | null {
  return activeTransport;
}
