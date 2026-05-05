/**
 * Phase 110 — Media capture orchestration.
 *
 * Voice-triggered video capture for on-course shots, full swings, and
 * highlight moments. This module is the orchestration boundary —
 * concrete camera + recording lifecycle is delegated to the existing
 * cage-camera path (CageSessionOverlay knows how to drive expo-camera
 * on Z Fold) and to a future shotCaptureOverlay component for the
 * round-active path.
 *
 * Scope this phase: voice intents resolve through here, this module
 * routes to the right capture path with the right metadata. The
 * underlying camera lifecycle (pre-arm, ring buffer, frame grab) is
 * deferred to a follow-up phase — current behaviour is on-demand spin-up
 * with a brief delay.
 *
 * Captured media is recorded against the active round + hole + persona
 * so it surfaces in the right context for playback (open video / play
 * last). Storage paths reuse the existing cageStorage filesystem layout.
 */

import { useRoundStore } from '../store/roundStore';
import { useCageStore } from '../store/cageStore';
import { useSettingsStore } from '../store/settingsStore';
import { getActiveCaddie } from './caddieResolver';
import { track } from './analytics';

export type CaptureKind = 'shot' | 'swing' | 'highlight';

export interface CaptureRequest {
  kind: CaptureKind;
  /** Human-readable phrase from the voice intent, stored alongside the
   *  capture for context. */
  raw_utterance?: string;
}

export interface CapturedMedia {
  id: string;
  kind: CaptureKind;
  uri: string | null;          // file:// URI or null when not yet implemented
  startedAt: number;
  durationSec: number;
  hole: number | null;
  roundId: string | null;
  persona: string;
  isHighlight: boolean;
  raw_utterance?: string;
}

// Per-kind durations (seconds). Tunable per Phase 110 spec.
const DURATION_BY_KIND: Record<CaptureKind, number> = {
  shot: 5,
  swing: 8,
  highlight: 5,
};

// Subscribers (CaptureRequest listeners) — UI components register so the
// camera surface knows when to spin up. The voice intent handlers fire
// requestCapture(); the surface listening picks it up and drives the
// camera. Decoupled so the orchestration boundary doesn't need a direct
// expo-camera dep.
//
// Phase 110-followup — subscribers declare WHICH kinds they handle so
// isCaptureWired() can answer per-kind honestly. CaptureOverlay at app
// root handles 'shot' + 'highlight' for round-side captures; cage
// session flow continues to handle 'swing' through its own session loop.
type CaptureListener = (req: CaptureRequest) => void;
interface SubscriberRegistration {
  kinds: readonly CaptureKind[];
  cb: CaptureListener;
}
const captureSubscribers = new Set<SubscriberRegistration>();

export function subscribeCapture(kinds: readonly CaptureKind[], cb: CaptureListener): () => void {
  const reg: SubscriberRegistration = { kinds, cb };
  captureSubscribers.add(reg);
  return () => { captureSubscribers.delete(reg); };
}

/**
 * Phase 200 / F3 + Phase 110-followup — honest per-kind pre-flight check.
 * Returns true only when a subscribed surface exists for this kind. Voice
 * handlers gate on this to avoid falsely claiming "Recording" when no
 * surface will pick it up.
 *
 *   'shot' / 'highlight' — wired iff CaptureOverlay (mounted at app root)
 *                          has subscribed (it does so during round-active).
 *   'swing'              — wired by Cage Session flow (session-recording
 *                          captures all swings already; voice command is
 *                          redundant during an active session).
 */
export function isCaptureWired(kind: CaptureKind): boolean {
  for (const reg of captureSubscribers) {
    if (reg.kinds.includes(kind)) return true;
  }
  return false;
}

// Recent captures buffer for playback. Persisted indirectly via the
// round-store shots[] (round captures) and cageStore session library
// (cage captures). The capture entries here are the in-flight queue
// before they're committed to those stores.
let recentCaptures: CapturedMedia[] = [];
const MAX_RECENT = 20;

export function getRecentCaptures(): readonly CapturedMedia[] {
  return recentCaptures;
}

export function getMostRecentCapture(): CapturedMedia | null {
  return recentCaptures.length > 0 ? recentCaptures[recentCaptures.length - 1] : null;
}

/**
 * Voice intent calls this. Returns immediately with the captured-media
 * placeholder; the actual file URI is filled in by the surface that
 * picks up the request via subscribeCapture and drives the camera.
 */
export async function requestCapture(req: CaptureRequest): Promise<CapturedMedia> {
  const round = useRoundStore.getState();
  const persona = getActiveCaddie();
  const startedAt = Date.now();

  const placeholder: CapturedMedia = {
    id: `${startedAt}_${req.kind}`,
    kind: req.kind,
    uri: null,
    startedAt,
    durationSec: DURATION_BY_KIND[req.kind],
    hole: round.isRoundActive ? round.currentHole : null,
    roundId: round.currentRoundId,
    persona,
    isHighlight: req.kind === 'highlight',
    raw_utterance: req.raw_utterance,
  };

  recentCaptures.push(placeholder);
  if (recentCaptures.length > MAX_RECENT) recentCaptures.shift();

  track('media_capture_requested', {
    kind: req.kind,
    has_active_round: round.isRoundActive,
    persona,
    subscriber_count: captureSubscribers.size,
  });

  // Fan out only to subscribers that handle this kind.
  for (const reg of captureSubscribers) {
    if (!reg.kinds.includes(req.kind)) continue;
    try { reg.cb(req); } catch (e) { console.warn('[mediaCapture] subscriber threw:', e); }
  }

  return placeholder;
}

/**
 * Surface (CageSessionOverlay / ShotCaptureOverlay) calls this when the
 * recording finishes to fill in the URI.
 */
export function commitCapture(id: string, uri: string): void {
  const idx = recentCaptures.findIndex((c) => c.id === id);
  if (idx >= 0) {
    recentCaptures[idx] = { ...recentCaptures[idx], uri };
    // For 'swing' captures, write through to cage swing library so
    // existing review / Phase K flows pick them up. cage.ingestUploadedSwing
    // is the canonical entry point for non-live-cage swings.
    const c = recentCaptures[idx];
    if (c.kind === 'swing') {
      try {
        useCageStore.getState().ingestUploadedSwing({
          source: 'uploaded_video',
          clipUri: uri,
          club: 'unknown',
          upload: {
            uploaded_at: c.startedAt,
            taken_at: c.startedAt,
            notes: c.raw_utterance ?? null,
          },
        });
      } catch (e) { console.warn('[mediaCapture] cage ingest failed:', e); }
    }
  }
}

/**
 * Caddie acknowledgment line for the requested capture, in the active
 * caddie's voice. Phase 105 / 106 architecture: the active caddie per
 * pillar handles the response.
 */
export function buildCaddieAck(kind: CaptureKind): string {
  const persona = getActiveCaddie();
  // Per-persona / per-kind canned responses. Short — capture is a beat,
  // not a conversation.
  const lines: Record<string, Record<CaptureKind, string>> = {
    kevin: {
      shot: 'Got it, recording.',
      swing: 'Alright, capturing the swing.',
      highlight: "Watching — let's see it.",
    },
    serena: {
      shot: 'Recording.',
      swing: 'Capturing the swing.',
      highlight: 'Let it happen.',
    },
    harry: {
      shot: 'Recording. Take a breath, hit your shot.',
      swing: "Got the camera. Let's see the swing.",
      highlight: 'Alright. Worth watching.',
    },
    tank: {
      shot: 'Locked in. Send it.',
      swing: 'Camera up. Execute.',
      highlight: "Watching. Let's see it.",
    },
  };
  return lines[persona]?.[kind] ?? 'Recording.';
}

/** Reset (test / round-end). Doesn't clear the listener set — that's
 *  managed by component lifecycles. */
export function clearRecentCaptures(): void {
  recentCaptures = [];
}

/**
 * Read-only check: is media capture currently usable in the user's
 * context? Used by the voice handler to give honest pre-flight feedback
 * (e.g. "I need camera permission", "you're not in a round yet").
 */
export function canCapture(kind: CaptureKind): { ok: boolean; reason?: string } {
  const settings = useSettingsStore.getState();
  if (!settings.voiceEnabled) {
    // Voice is off — capture commands shouldn't fire from voice anyway,
    // but defensive guard.
    return { ok: false, reason: 'Voice is off in Settings.' };
  }
  const round = useRoundStore.getState();
  // 'shot' and 'highlight' presume an active round (course context).
  // 'swing' is fine outside round (cage / drill / range).
  if ((kind === 'shot' || kind === 'highlight') && !round.isRoundActive) {
    return { ok: false, reason: "You're not in a round yet — start one and I'll record shots and highlights." };
  }
  // Camera permission check is delegated to the surface that actually
  // drives the camera (CageSessionOverlay already has permission
  // handling). No camera-permission probe at the orchestration level.
  return { ok: true };
}
