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

function breadcrumb(message: string, data?: Record<string, unknown>) {
  try {
    Sentry.addBreadcrumb({ category: 'audio_lifecycle', level: 'info', message, data });
  } catch {}
}

async function goCold(reason: string): Promise<void> {
  if (state === 'cold') return;
  state = 'cold';
  try {
    await Audio.setAudioModeAsync({
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
    trustMod.useTrustLevelStore.subscribe((s: { level: number }) => {
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
}
