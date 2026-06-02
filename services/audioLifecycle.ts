/**
 * Pre-beta — audio engine warm/cold lifecycle.
 *
 * Audio session was previously kept warm for the entire app session. This
 * controller transitions it cold after 90s of no audio activity, when the
 * user enters Quiet trust level, or when the app is backgrounded. Cold→warm
 * costs ~200ms which fits inside the existing latency-mask filler envelope.
 *
 * voiceService.ts notifies activity via noteAudioActivity(); the controller
 * teardown calls Audio.setAudioModeAsync({active:false}) — actual init is
 * lazy in voiceService so cold is genuinely no-op for the audio engine.
 */

import { Audio } from 'expo-av';
import { AppState } from 'react-native';
import * as Sentry from '@sentry/react-native';

type AudioState = 'cold' | 'warm';

const IDLE_TEARDOWN_MS = 90_000;

let state: AudioState = 'cold';
let lastActivityAt = 0;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
// Audit 101 / S1 — store the trust-level subscription unsub so teardown
// can clean it up. Prior code wired the subscription but never released
// it; under hot-reload (dev) or redundant init() calls (production
// restart paths) listeners stacked and all fired on every trust change.
let trustUnsub: (() => void) | null = null;

function breadcrumb(message: string, data?: Record<string, unknown>) {
  try {
    Sentry.addBreadcrumb({ category: 'audio_lifecycle', level: 'info', message, data });
  } catch {}
}

// 2026-06-01 — Fix GK: probe voiceService's splash lock without a
// static import (avoids circular dep — voiceService imports
// noteAudioActivity from this module). Returns false on any failure
// so a lookup miss can never permanently block goCold.
function tryRequireSplashLocked(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const voiceMod = require('./voiceService') as typeof import('./voiceService');
    return voiceMod.isSplashLocked();
  } catch {
    return false;
  }
}

async function goCold(reason: string): Promise<void> {
  if (state === 'cold') return;
  // 2026-06-01 — Fix GK: defer goCold when the splash lock is held.
  // goCold mutates the audio session to playsInSilentModeIOS:false /
  // staysActiveInBackground:false, which silences any in-flight
  // playback. During the launch greeting that means the user hears
  // the first 1-2 words and then dead air. Skip the transition while
  // the lock is held; the next legitimate goCold trigger (AppState
  // change after splash, idle 90s, trust→quiet user flip) will
  // re-evaluate and apply.
  if (tryRequireSplashLocked()) {
    console.log('[audio] goCold deferred (' + reason + ') — splash lock held');
    return;
  }
  state = 'cold';
  try {
    // 2026-06-01 — Fix GJ: route through voiceService.setAudioModeSerial
    // so this call serializes with configureAudioForSpeech /
    // configureAudioForRecording instead of racing them at the native
    // audio singleton. Previously, calling Audio.setAudioModeAsync
    // directly here would race any active speech-config call going
    // through the queue. If goCold won mid-playback (app backgrounded,
    // trust→quiet flip), playsInSilentModeIOS dropped to false under a
    // live mp3 → silence mid-utterance.
    //
    // Dynamic require avoids the circular dep: voiceService imports
    // noteAudioActivity from THIS module. Static `import { ... } from
    // './voiceService'` would cycle. Require at call time is safe
    // because by the time goCold ever fires (idle 90s / app
    // background / trust quiet), the JS bundle is fully loaded.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const voiceMod = require('./voiceService') as typeof import('./voiceService');
    await voiceMod.setAudioModeSerial({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
  } catch {}
  breadcrumb('audio_cold', { reason });
  console.log('[audio] → cold (' + reason + ')');
}

function goWarm(reason: string): void {
  if (state === 'warm') return;
  state = 'warm';
  breadcrumb('audio_warm', { reason });
  console.log('[audio] → warm (' + reason + ')');
}

/** Called from voiceService whenever TTS or capture begins. */
export function noteAudioActivity(reason = 'tts_or_capture'): void {
  lastActivityAt = Date.now();
  if (state === 'cold') goWarm(reason);
}

export function getAudioState(): AudioState {
  return state;
}

/** Initialize the lifecycle controller. Idempotent. */
export function initAudioLifecycle(): void {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (state === 'warm' && lastActivityAt > 0 && Date.now() - lastActivityAt > IDLE_TEARDOWN_MS) {
      void goCold('idle_90s');
    }
  }, 15_000);

  appStateSub = AppState.addEventListener('change', (next) => {
    if (next !== 'active') void goCold('app_backgrounded');
  });

  // Trust-level subscription — Quiet forces cold immediately.
  try {
    const trustMod = require('../store/trustLevelStore');
    // Audit 101 / S1 — Zustand `subscribe` returns the unsub fn; store
    // it so teardown can release the listener.
    trustUnsub = trustMod.useTrustLevelStore.subscribe((s: { level: number }) => {
      if (s.level === 1) void goCold('trust_quiet');
    });
  } catch {}
}

export function teardownAudioLifecycle(): void {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  if (trustUnsub) {
    trustUnsub();
    trustUnsub = null;
  }
}
