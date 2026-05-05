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
