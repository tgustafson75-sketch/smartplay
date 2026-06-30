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
import { isSmartMotionActive, emitSmartMotionCommand } from '../smartMotionRecordBus';
import { getActiveSurface } from '../activeSurfaceRegistry';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speak } from '../voiceService';
import { usePracticeStore } from '../../store/practiceStore';
import { getApiBaseUrl } from '../apiBase';

const ANALYSIS_WATCHDOG_MS = 20_000;

// 2026-05-24 — Background watcher: subscribes to cageStore for the
// active session's shots; when the latest shot's perShotAnalysis goes
// from null → populated, speaks the observation field via the existing
// speak() API and tears down. Watchdog at ANALYSIS_WATCHDOG_MS keeps a
// stuck pipeline from leaving a dangling subscriber. No-op when there's
// no active cage session at subscription time.
function watchAndSpeakNextSwingAnalysis(): void {
  const snapshotShotsCount = useCageStore.getState().activeSession?.shots.length ?? -1;
  if (snapshotShotsCount < 0) {
    // No active cage session — auto-speak path doesn't apply here.
    return;
  }

  let spoke = false;

  const unsub = useCageStore.subscribe((s) => {
    if (spoke) return;
    const shots = s.activeSession?.shots ?? [];
    // Trigger on either a new shot landing OR the latest shot getting
    // its analysis populated. Both forms are tolerated because the
    // capture-then-analyze ordering varies by detection mode (manual
    // vs audio-transient).
    const latest = shots[shots.length - 1];
    if (!latest || !latest.perShotAnalysis) return;
    const obs = latest.perShotAnalysis.observation;
    if (!obs || obs.trim().length === 0) return;
    spoke = true;
    clearTimeout(watchdog);
    unsub();
    // 2026-05-24 — Pipe analyzed swing into practiceStore so Tank rules
    // (askGolfFatherHandler.ts) can branch on tendencies like
    // overTheTopCount / typicalMiss. Wrap because store writes shouldn't
    // ever block the speak path.
    try {
      usePracticeStore.getState().updateFromSwing({
        ...latest.perShotAnalysis,
        club: latest.club,
      });
    } catch (e) {
      console.log('[mediaCapture] practiceStore update failed (non-fatal):', e);
    }
    const settings = useSettingsStore.getState();
    const apiUrl = getApiBaseUrl();
    // userInitiated: true because this is a direct consequence of a
    // user voice command ("watch my swing") — preserves L1-Quiet behavior
    // per the voiceUserInitiated rule in memory.
    void speak(obs, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
      .catch((e) => console.log('[mediaCapture] speak observation failed:', e));
  });

  const watchdog = setTimeout(() => {
    if (spoke) return;
    spoke = true;
    unsub();
    const settings = useSettingsStore.getState();
    const apiUrl = getApiBaseUrl();
    void speak(
      'Analysis is taking longer than usual. Check the app for results.',
      settings.voiceGender, settings.language, apiUrl, { userInitiated: true },
    ).catch(() => { /* ignore */ });
  }, ANALYSIS_WATCHDOG_MS);
}

function normalizeKind(raw: unknown): CaptureKind {
  // 2026-05-21 — Fix G: screen-aware default. When the user is on a
  // drill_session surface (Cage Mode), the kind is unambiguously 'swing'
  // regardless of what the voice-intent classifier emitted for
  // capture_type. Without this, a bare "record" on Cage Mode falls
  // through to 'shot' (the default below) which then fails canCapture
  // with "you're not in a round yet" — the manual-mic record path is
  // dead. setActiveSurface('drill_session') is set on Cage Mode mount,
  // so this check is reliable while the user is on that screen.
  if (getActiveSurface() === 'drill_session') return 'swing';
  const v = String(raw ?? '').toLowerCase().trim();
  if (v === 'swing') return 'swing';
  // 2026-05-17 — legacy 'highlight' (hero shot) collapses to 'shot'.
  // Removes the auto-open replay/share pane; clip still lands on the
  // shot's clip_uri for later review.
  return 'shot';
}

export const mediaCaptureHandler: IntentHandler = {
  intent_type: 'media_capture',

  parameter_schema: {
    capture_type: '"shot" | "swing"',
    raw_utterance: 'verbatim phrase from the user',
  },

  examples: [
    'record this shot',
    'record my swing',
    'capture this',
  ],

  async execute(intent): Promise<IntentResult> {
    const kind = normalizeKind((intent.parameters as { capture_type?: unknown }).capture_type);

    const rawUtterance = String(
      (intent.parameters as { raw_utterance?: unknown }).raw_utterance ?? intent.raw_text ?? '',
    ).trim() || undefined;

    // 2026-06-09 — Hands-free Smart Motion control. When the Smart Motion
    // screen is open, a capture phrase drives its OPEN recording window instead
    // of opening a new surface: "start/record/go" → start, "stop/done/finish"
    // → stop. The screen toggles by its current phase, so this is robust to
    // start/stop mis-classification; the 60s window also auto-wraps each minute.
    if (isSmartMotionActive()) {
      const u = (rawUtterance ?? '').toLowerCase();
      const cmd: 'start' | 'stop' | 'toggle' =
        /\b(stop|done|finish|wrap|enough|that'?s it)\b/.test(u) ? 'stop'
        : /\b(start|record|go|begin|rolling|capture|watch|hit)\b/.test(u) ? 'start'
        : 'toggle';
      emitSmartMotionCommand(cmd);
      track('media_capture_smartmotion_voice');
      return {
        success: true,
        voice_response: cmd === 'stop'
          ? 'Wrapping it up — give me a second to read those.'
          // 2026-06-16 — the camera takes ~a second to roll after this plays; "swing
          // when you're set" (not "swing away") stops the user swinging into a
          // not-yet-recording window + missing the first strike. The open window
          // captures the swing whenever it comes.
          : "Recording — swing when you're set. Say stop when you're done, or I'll wrap at a minute.",
        side_effects: ['media:smartmotion_' + cmd],
        follow_up_needed: false,
      };
    }

    // 2026-06-07 — Hands-free swing fallback. When no live capture
    // surface is wired, route to Smart Motion (rebuild: it captures in
    // place, opening straight to the camera). Keeps "record my swing" /
    // "watch my swing" as a one-shot voice action from any screen —
    // voice opens the camera, no navigation into a separate mode first.
    if (kind === 'swing' && !isCaptureWired('swing')) {
      try {
        // 2026-06-30 (Tim) — autoRecord arms the camera so "watch/record my swing" opens
        // STRAIGHT into recording (not the setup screen); course mode is auto-forced there
        // during a round. Matches this handler's own intent ("voice opens the camera").
        router.push('/swinglab/smartmotion?autoRecord=1' as never);
        track('media_capture_handler_quick_record_route');
        return {
          success: true,
          voice_response: 'Opening camera. Get ready.',
          side_effects: ['media:capture_quick_record_opened'],
          follow_up_needed: false,
        };
      } catch {
        return {
          success: false,
          voice_response: "Couldn't open the camera.",
          side_effects: ['media:capture_quick_record_route_error'],
          follow_up_needed: false,
        };
      }
    }

    const pre = canCapture(kind);
    if (!pre.ok) {
      return {
        success: false,
        voice_response: pre.reason ?? "Can't record right now.",
        side_effects: [`media:capture_blocked:${kind}`],
        follow_up_needed: false,
      };
    }

    // Phase 110-followup — surface availability check (per-kind).
    // 'shot' wired by CaptureOverlay (mounted at app root, active during
    // round-active). 'swing' is short-circuited above to Quick Record
    // when not in Cage Mode, so this gate only applies to 'shot'.
    if (!isCaptureWired(kind)) {
      track('media_capture_handler_no_surface', { kind });
      return {
        success: false,
        voice_response: "Start a round and I'll record shots and highlights from there.",
        side_effects: [`media:capture_no_surface:${kind}`],
        follow_up_needed: false,
      };
    }

    try {
      await requestCapture({ kind, raw_utterance: rawUtterance });
      track('media_capture_handler_ok', { kind });

      // 2026-05-24 — Voice-triggered swing → auto-speak the analysis
      // observation when it lands. Background-only: subscribe to
      // cageStore for the next shot whose perShotAnalysis populates,
      // speak its `observation` field via the existing speak() API,
      // then unsubscribe. Bounded by a 20s watchdog so a stuck
      // analysis pipeline never leaves a dangling subscriber.
      //
      // Coverage notes:
      //   - In Cage Mode: cageStore session captures the shot, analysis
      //     populates perShotAnalysis async, we catch and speak.
      //   - NOT in Cage Mode: the earlier branch short-circuits to
      //     Quick Record (router.push) — this auto-speak doesn't fire
      //     because no cage shot is written. Quick Record auto-analysis
      //     coverage is a follow-up that needs the same listener wired
      //     against whatever store/event Quick Record uses.
      //   - settingsStore exposes voiceGender / language (NOT gender /
      //     apiUrl); apiUrl is sourced from EXPO_PUBLIC_API_URL env, the
      //     same pattern voiceCommandParser uses.
      if (kind === 'swing') {
        try {
          watchAndSpeakNextSwingAnalysis();
          return {
            success: true,
            voice_response: 'Swing captured. Analyzing...',
            side_effects: ['swing_captured', 'analysis_started'],
            follow_up_needed: false,
          };
        } catch (e) {
          // Listener arming failure shouldn't break the success path —
          // capture itself succeeded.
          console.log('[mediaCapture] analysis listener arm failed (non-fatal):', e);
        }
      }
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
