/**
 * 2026-05-22 — Glasses Vision Input (stub).
 *
 * Future architecture: Meta Ray-Ban glasses push periodic camera frames
 * (and short clips on demand) to the phone over Bluetooth. The phone
 * routes them here, where they're paired with the active voice utterance
 * + GPS + active hole, then forwarded to the multimodal model for richer
 * caddie context ("what am I looking at", "is this fairway or rough",
 * "what's that hazard").
 *
 * Today this module is a stub. It establishes the API contract so:
 *   - voice intent handlers can opt into "if a vision frame is fresh,
 *     attach it to the model call" without a refactor later.
 *   - the Cockpit / SmartFinder / TightLie surfaces can attach a
 *     manually-captured photo through the same pipeline (proves the
 *     pipeline before glasses hardware arrives).
 *
 * Wire reality check:
 *   - Meta currently does NOT expose live camera frames to third-party
 *     apps. PuttWatch shipped on a "user records, uploads later" model
 *     for that reason (see voice-intent+api.ts intent #13). When/if
 *     Meta opens a frames API, the only thing that has to change is
 *     glassesVisionTransport.ts (TBD); this module's API stays put.
 */

import { useRoundStore } from '../store/roundStore';
import { getCurrentLocation } from './shotLocationService';

export interface VisionFrame {
  /** Local URI to a JPEG/PNG frame. file:// or content:// — must be readable by fetch. */
  uri: string;
  /** Timestamp the frame was captured (ms epoch). */
  captured_at: number;
  /** Optional heading in degrees when the frame was captured (phone compass / glasses IMU). */
  heading_deg?: number | null;
  /** Source — useful for downstream routing (which model to use, retention). */
  source: 'phone_camera' | 'glasses' | 'tightlie' | 'smartmotion';
}

export interface VisionContext {
  frame: VisionFrame;
  hole_number: number | null;
  course_id: string | null;
  player_location: { lat: number; lng: number } | null;
  voice_utterance: string | null;
}

interface InFlightFrame {
  frame: VisionFrame;
  context_promise: Promise<VisionContext>;
}

const FRAME_TTL_MS = 30_000;
let lastFrame: InFlightFrame | null = null;

/**
 * Submit a vision frame for inclusion in the next caddie response. The frame
 * is held in memory for FRAME_TTL_MS so a follow-up voice utterance ("what am
 * I looking at") can grab the same context without re-snapping.
 *
 * Today this just stores. Tomorrow this should also push the frame to the
 * multimodal model's pre-context cache so the round-trip on the next voice
 * call is faster.
 */
export async function submitVisionFrame(frame: VisionFrame): Promise<VisionContext> {
  const round = useRoundStore.getState();
  const location = await getCurrentLocation().catch(() => null);
  const context: VisionContext = {
    frame,
    hole_number: round.isRoundActive ? round.currentHole : null,
    course_id: round.activeCourseId,
    player_location: location,
    voice_utterance: null,
  };
  lastFrame = { frame, context_promise: Promise.resolve(context) };
  console.log(`[vision] frame submitted source=${frame.source} hole=${context.hole_number} course=${context.course_id}`);
  // 30-second TTL — clear if not consumed.
  setTimeout(() => {
    if (lastFrame?.frame === frame) {
      lastFrame = null;
      console.log('[vision] frame TTL expired');
    }
  }, FRAME_TTL_MS);
  return context;
}

/**
 * Read the freshest vision frame within TTL. Returns null if no frame is
 * available or the frame has aged out. Handlers call this to opt into
 * vision context without forcing it on every intent.
 *
 * @example
 *   const vision = await getActiveVisionContext();
 *   if (vision) {
 *     // pass vision.frame.uri to the multimodal model call
 *   }
 */
export async function getActiveVisionContext(): Promise<VisionContext | null> {
  if (!lastFrame) return null;
  const age = Date.now() - lastFrame.frame.captured_at;
  if (age > FRAME_TTL_MS) {
    lastFrame = null;
    return null;
  }
  return lastFrame.context_promise;
}

/**
 * Attach a voice utterance to the most-recent vision frame. The voice loop
 * calls this so the model gets both modalities together.
 */
export function attachUtteranceToFrame(utterance: string): void {
  if (!lastFrame) return;
  lastFrame.context_promise = lastFrame.context_promise.then(ctx => ({
    ...ctx,
    voice_utterance: utterance,
  }));
}

/**
 * Clear the held frame manually. Useful when the user closes a tool screen
 * or when persona / round state changes invalidate the context.
 */
export function clearVisionContext(): void {
  if (lastFrame) console.log('[vision] frame cleared manually');
  lastFrame = null;
}

/**
 * Future entry point: register a glasses-transport adapter. When Meta
 * opens a frame API, the adapter will push frames here directly via
 * submitVisionFrame. Stub today so the surface exists.
 */
export interface GlassesVisionTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
}

let activeTransport: GlassesVisionTransport | null = null;

export function registerGlassesTransport(t: GlassesVisionTransport): void {
  activeTransport = t;
  console.log('[vision] glasses transport registered');
}

export function getGlassesTransport(): GlassesVisionTransport | null {
  return activeTransport;
}
