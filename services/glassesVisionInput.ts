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
  /** 2026-05-22 — Family Coaching tagging. When a parent records a
   *  kid's swing via voice ("record Emma's swing"), the recording
   *  flow stamps the family-member id onto every frame so the
   *  juniorSwingAnalyzer + library know which roster member the
   *  capture belongs to. null = account holder's own swing (default). */
  golfer_id?: string | null;
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
  /** 2026-05-22 — Family Coaching: which roster member this frame
   *  belongs to. Mirrors frame.golfer_id so consumers don't have to
   *  reach back into the frame. */
  golfer_id: string | null;
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
  // Auto-stamp the active family member when the caller didn't pass one.
  // The "record Emma's swing" voice intent sets the active member on
  // useFamilyStore before triggering capture; submitVisionFrame reads it
  // so callers don't have to plumb the id through every layer.
  let golferId: string | null = frame.golfer_id ?? null;
  if (!golferId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fam = require('../store/familyStore') as typeof import('../store/familyStore');
      golferId = fam.useFamilyStore.getState().active_member_id;
    } catch { /* non-fatal */ }
  }
  const context: VisionContext = {
    frame: { ...frame, golfer_id: golferId },
    hole_number: round.isRoundActive ? round.currentHole : null,
    course_id: round.activeCourseId,
    player_location: location,
    voice_utterance: null,
    detected_mode: detected.mode,
    mode_confidence: detected.confidence,
    golfer_id: golferId,
  };

  queue.push({ frame, context_promise: Promise.resolve(context) });
  pruneQueue();
  devLog(
    `[vision] frame queued source=${frame.source} hole=${context.hole_number} ` +
    `mode=${detected.mode} (${detected.confidence}%) golfer=${golferId ?? 'self'} ` +
    `queue_size=${queue.length}`,
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

// ─── Transport adapter (Pass 2: stronger contract) ──────────────────────
//
// The transport is the seam between SmartPlay and whatever glasses
// hardware actually streams frames. Today no transport implementation
// exists (Meta hasn't opened the camera API to third parties); this
// contract is what we'll plug into when they do, or what an experimental
// USB / WebRTC bridge would implement.
//
// Wire protocol contract:
//   - The transport delivers JPEG/PNG frames via submitVisionFrame()
//     (above), tagged with source: 'glasses'.
//   - Optional pitch_deg / heading_deg come from the glasses IMU when
//     available — used by detectMode() to auto-classify swing/putting.
//   - Connection lifecycle is start() / stop(); isConnected() is the
//     instantaneous truth. onStatusChange() lets the AR overlay
//     surface a "glasses connected" indicator.
//   - Capability advertise: prefersFrameRate() lets a transport tell
//     consumers what cadence it can sustain (e.g. BT-LE ~5 fps,
//     Wi-Fi-direct ~30 fps) so submitVisionFrame can pace appropriately.

export type GlassesTransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface GlassesVisionTransport {
  /** Start the connection. Resolves once the transport is ready to push
   *  frames OR rejects with a reason consumers can surface ("Bluetooth
   *  off", "no paired device"). */
  start(): Promise<void>;
  /** Stop and release resources. Idempotent. */
  stop(): Promise<void>;
  /** Current instantaneous connection state. Cheaper than awaiting
   *  start() to know if the transport is up. */
  isConnected(): boolean;
  /** Sustained frames-per-second the transport can deliver. Used by
   *  the consumer to decide whether to render live-AR (~15 fps min)
   *  or burst-capture-only (<5 fps). */
  prefersFrameRate(): number;
  /** Subscribe to connection-status changes. Returned cleanup
   *  unsubscribes. */
  onStatusChange(cb: (status: GlassesTransportStatus) => void): () => void;
  /** Friendly transport identifier shown in Settings → Glasses (e.g.
   *  "Meta Ray-Ban (Aviator)", "Test rig over WebRTC"). */
  label: string;
}

/**
 * 2026-05-22 — Stub BluetoothGlassesTransport.
 *
 * Documents the contract a real implementation would fulfill against a
 * paired Meta Ray-Ban (or experimental bridge) using BLE GATT for
 * control + L2CAP for frame bytes. Today this stub:
 *   - Reports disconnected always
 *   - Returns 0 fps capability
 *   - start() rejects with a "not yet implemented" message that
 *     surfaces honestly in Settings if the user attempts to enable it
 *
 * When Meta opens the API (or a custom hardware partner ships one),
 * the only thing that has to change is the body of this class plus
 * registering it via registerGlassesTransport() at app start.
 */
export class BluetoothGlassesTransport implements GlassesVisionTransport {
  readonly label = 'Meta Ray-Ban (Bluetooth)';
  private status: GlassesTransportStatus = 'disconnected';
  private listeners = new Set<(s: GlassesTransportStatus) => void>();

  async start(): Promise<void> {
    devLog('[vision] BluetoothGlassesTransport.start() — not yet implemented');
    this.setStatus('error');
    throw new Error(
      'Glasses transport not yet implemented. Meta has not opened the ' +
      'camera frames API to third-party apps. PuttWatch + manual upload ' +
      'remain the supported capture paths.',
    );
  }

  async stop(): Promise<void> {
    this.setStatus('disconnected');
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  prefersFrameRate(): number {
    return 0; // stub — real BT-LE bridge would advertise 5-10 fps
  }

  onStatusChange(cb: (s: GlassesTransportStatus) => void): () => void {
    this.listeners.add(cb);
    // Fire immediately with current status.
    try { cb(this.status); } catch { /* non-fatal */ }
    return () => { this.listeners.delete(cb); };
  }

  private setStatus(next: GlassesTransportStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const cb of this.listeners) {
      try { cb(next); } catch { /* non-fatal */ }
    }
  }
}

let activeTransport: GlassesVisionTransport | null = null;

export function registerGlassesTransport(t: GlassesVisionTransport): void {
  activeTransport = t;
  devLog(`[vision] glasses transport registered: ${t.label} (target fps=${t.prefersFrameRate()})`);
}

export function getGlassesTransport(): GlassesVisionTransport | null {
  return activeTransport;
}

// ─── Family-recording session helper (Pass 4) ─────────────────────────────
//
// Voice intent "record Emma's swing" calls beginFamilyRecording(memberId)
// to start a capture session tagged for that roster member. Any
// subsequent submitVisionFrame inside the session window auto-stamps
// golfer_id. The session ends on endFamilyRecording() or after
// FAMILY_SESSION_TIMEOUT_MS of inactivity. Self-recordings (account
// holder) skip this entirely — submitVisionFrame leaves golfer_id null
// when no session is active.

const FAMILY_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let activeRecordingMemberId: string | null = null;
let recordingExpiresAt = 0;

/**
 * Begin tagging incoming frames with the given family-member id. Also
 * sets useFamilyStore.active_member_id so other surfaces (junior
 * analyzer, library) see the same active golfer.
 */
export function beginFamilyRecording(memberId: string | null): void {
  activeRecordingMemberId = memberId;
  recordingExpiresAt = Date.now() + FAMILY_SESSION_TIMEOUT_MS;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fam = require('../store/familyStore') as typeof import('../store/familyStore');
    fam.useFamilyStore.getState().setActiveMember(memberId);
  } catch { /* non-fatal */ }
  devLog(`[vision] family recording session started for member=${memberId ?? 'self'}`);
}

export function endFamilyRecording(): void {
  if (activeRecordingMemberId) devLog(`[vision] family recording session ended (was ${activeRecordingMemberId})`);
  activeRecordingMemberId = null;
  recordingExpiresAt = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fam = require('../store/familyStore') as typeof import('../store/familyStore');
    fam.useFamilyStore.getState().setActiveMember(null);
  } catch { /* non-fatal */ }
}

/** Returns the active family-recording member id, or null when no
 *  session is running / session has timed out. */
export function getActiveFamilyRecordingMember(): string | null {
  if (!activeRecordingMemberId) return null;
  if (Date.now() > recordingExpiresAt) {
    endFamilyRecording();
    return null;
  }
  return activeRecordingMemberId;
}
