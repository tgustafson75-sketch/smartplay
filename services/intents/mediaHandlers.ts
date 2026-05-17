/**
 * Phase 110 — Voice intent handlers for media capture and playback.
 *
 *   media_capture  → routes to services/mediaCapture.requestCapture
 *   media_playback → routes to /swinglab/library or plays last capture
 *
 * Handlers are gated on context (active round / cage session) and
 * answer honestly when context is missing.
 */

import { router } from 'expo-router';
import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import {
  requestCapture,
  buildCaddieAck,
  canCapture,
  getMostRecentCapture,
  isCaptureWired,
  type CaptureKind,
} from '../mediaCapture';
import { track } from '../analytics';

function normalizeKind(raw: unknown): CaptureKind {
  const v = String(raw ?? '').toLowerCase().trim();
  if (v === 'swing') return 'swing';
  if (v === 'highlight') return 'highlight';
  return 'shot'; // default
}

export const mediaCaptureHandler: IntentHandler = {
  intent_type: 'media_capture',

  parameter_schema: {
    capture_type: '"shot" | "swing" | "highlight"',
    raw_utterance: 'verbatim phrase from the user',
  },

  examples: [
    'record this shot',
    'record my swing',
    'watch this',
    'capture this',
    'check this out',
    'look at this',
  ],

  async execute(intent): Promise<IntentResult> {
    const kind = normalizeKind((intent.parameters as { capture_type?: unknown }).capture_type);
    const pre = canCapture(kind);
    if (!pre.ok) {
      return {
        success: false,
        voice_response: pre.reason ?? "Can't record right now.",
        side_effects: [`media:capture_blocked:${kind}`],
        follow_up_needed: false,
      };
    }

    const rawUtterance = String(
      (intent.parameters as { raw_utterance?: unknown }).raw_utterance ?? intent.raw_text ?? '',
    ).trim() || undefined;

    // Phase 110-followup — surface availability check (per-kind).
    // 'shot' / 'highlight' wired by CaptureOverlay (mounted at app root,
    // active during round-active). 'swing' is owned by the cage session
    // flow — voice during an active cage session is redundant (the
    // session already records every detected swing); voice outside cage
    // gets an honest "open cage mode" reply.
    if (!isCaptureWired(kind)) {
      track('media_capture_handler_no_surface', { kind });
      return {
        success: false,
        voice_response: kind === 'swing'
          ? "Open Cage Mode and I'll capture every swing of your session."
          : "Start a round and I'll record shots and highlights from there.",
        side_effects: [`media:capture_no_surface:${kind}`],
        follow_up_needed: false,
      };
    }

    try {
      await requestCapture({ kind, raw_utterance: rawUtterance });
      track('media_capture_handler_ok', { kind });
      return {
        success: true,
        voice_response: buildCaddieAck(kind),
        side_effects: [`media:capture_started:${kind}`],
        follow_up_needed: false,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      track('media_capture_handler_error', { kind, error: msg });
      return {
        success: false,
        voice_response: "Camera didn't come up — try again in a sec.",
        side_effects: [`media:capture_error:${kind}`],
        follow_up_needed: false,
      };
    }
  },
};

// PuttWatch v1 — voice cue for the spectator-friendly putt/chip recording
// flow. Meta Ray-Ban glasses are the intended capture surface (their
// SDK doesn't let us start their recorder programmatically, so this
// handler just ACKs and reminds the user to fire the "Hey Meta, record
// a video" capture themselves). After the round, the user pulls the
// clip from Meta View into their phone library and uploads it via
// SwingLab → Upload with the 'putt' or 'chip' tag for analysis.
export const puttWatchHandler: IntentHandler = {
  intent_type: 'putt_watch',

  parameter_schema: {
    shot_type: '"putt" | "chip"',
  },

  examples: [
    'watch this putt',
    'PuttWatch',
    'analyze this putt',
    'watch this chip',
    'watch this bunker shot',
  ],

  async execute(intent): Promise<IntentResult> {
    const raw = String((intent.parameters as { shot_type?: unknown }).shot_type ?? '').toLowerCase();
    const isChip = raw === 'chip' || raw === 'bunker';
    track('putt_watch_handler_ack', { shot_type: isChip ? 'chip' : 'putt' });
    return {
      success: true,
      voice_response: isChip
        ? "Eyes on you. Record it on the glasses and I'll break it down after."
        : "Got it — watch you putt. Record it on the glasses and I'll analyze it after.",
      side_effects: [`putt_watch:ack:${isChip ? 'chip' : 'putt'}`],
      follow_up_needed: false,
    };
  },
};

export const mediaPlaybackHandler: IntentHandler = {
  intent_type: 'media_playback',

  parameter_schema: {
    playback_action: '"open" | "last"',
    raw_utterance: 'verbatim phrase from the user',
  },

  examples: [
    'open video',
    'show me video',
    'pull up video',
    'play that back',
    'show me last shot',
    'replay',
  ],

  async execute(intent): Promise<IntentResult> {
    const action = String((intent.parameters as { playback_action?: unknown }).playback_action ?? '').toLowerCase();

    if (action === 'last' || action === 'replay') {
      const last = getMostRecentCapture();
      if (!last || !last.uri) {
        return {
          success: false,
          voice_response: "Nothing to play back yet — record a shot first.",
          side_effects: ['media:playback_no_recent'],
          follow_up_needed: false,
        };
      }
      // Last-capture playback strategy: route to the swing-detail screen
      // for swing captures (it knows how to play clips); for round shots,
      // fall back to the library list (round-shot playback surface is
      // deferred — library is the consistent existing surface).
      try {
        if (last.kind === 'swing') {
          router.push(`/swinglab/swing/${last.id}` as never);
        } else {
          router.push('/swinglab/library' as never);
        }
        track('media_playback_handler_last', { kind: last.kind });
        return {
          success: true,
          voice_response: 'Playing it back.',
          side_effects: [`media:playback_started:last:${last.kind}`],
          follow_up_needed: false,
        };
      } catch {
        return {
          success: false,
          voice_response: "Couldn't open the player.",
          side_effects: ['media:playback_route_error'],
          follow_up_needed: false,
        };
      }
    }

    // 'open' / unspecified → open the library.
    try {
      router.push('/swinglab/library' as never);
      track('media_playback_handler_open');
      return {
        success: true,
        voice_response: 'Pulling up your videos.',
        side_effects: ['media:playback_library_opened'],
        follow_up_needed: false,
      };
    } catch {
      return {
        success: false,
        voice_response: "Couldn't open the library.",
        side_effects: ['media:playback_open_error'],
        follow_up_needed: false,
      };
    }
  },
};
