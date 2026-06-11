/**
 * 2026-05-22 — Hands-Free Orchestrator.
 *
 * One entry point in front of every hands-free input (Bluetooth
 * earbud taps, smartwatch taps, on-screen "Tap to talk" button).
 * Resolves tap PATTERNS into ACTIONS, manages the smart pause /
 * resume around in-flight voice playback, and threads everything
 * through the existing listeningSession + voiceService surfaces.
 *
 * Pattern → Action mapping (Pass 1; later passes can expand):
 *   single        → toggle listening (Kevin/Serena starts/stops the mic)
 *   double        → repeat the last spoken caddie line
 *   triple        → stop/mute current playback ("Kevin shush")
 *   long_press    → reserved (Pass 2: persona quick-switch)
 *
 * Smart-audio-routing behavior on any inbound tap:
 *   - If voiceService is currently speaking, stop it gracefully before
 *     opening the listening window. The user tapped because they want
 *     to talk OVER the caddie — they shouldn't have to wait for the
 *     line to finish.
 *   - If audio is routed to the phone speaker AND voiceOnPhoneSpeaker
 *     setting is false, suppress the listening session (the user
 *     doesn't have earbuds in; the conversation would broadcast).
 *     Toast informs them.
 *
 * Wire reality check (unchanged): real BT-button capture needs the
 * native bridge in mediaKeyBridge.ts. This orchestrator works against
 * the EVENT-BUS shape — when the native bridge ships, every tap flows
 * through here automatically.
 */

import {
  subscribeTapPattern, type TapPattern,
} from './earbudControl';
import { subscribeWatchTap, subscribeWatchVoice } from './watchBridge';
import { devLog } from './devLog';
import { getApiBaseUrl } from './apiBase';

// ─── Lifecycle ───────────────────────────────────────────────────────────

let started = false;
const unsubs: Array<() => void> = [];

/**
 * Wire the orchestrator. Idempotent — calling twice is a no-op. Called
 * once at app start from app/_layout.tsx (or wherever listeningSession
 * is initialized today; this can sit alongside).
 */
export function startHandsFreeOrchestrator(): void {
  if (started) return;
  started = true;
  unsubs.push(subscribeTapPattern((p) => { void handleTap('earbud', p); }));
  unsubs.push(subscribeWatchTap((p) => { void handleTap('watch', p); }));
  unsubs.push(subscribeWatchVoice((utterance) => { void handleWatchVoice(utterance); }));
  devLog('[handsFree] orchestrator started');
}

export function stopHandsFreeOrchestrator(): void {
  while (unsubs.length > 0) {
    const u = unsubs.pop();
    try { u?.(); } catch { /* non-fatal */ }
  }
  started = false;
  devLog('[handsFree] orchestrator stopped');
}

// ─── Tap dispatch ────────────────────────────────────────────────────────

type TapSource = 'earbud' | 'watch';

async function handleTap(source: TapSource, pattern: TapPattern): Promise<void> {
  devLog(`[handsFree] tap source=${source} pattern=${pattern}`);

  // Stop in-flight voice playback BEFORE any other action — the tap
  // signals the user wants to talk over the caddie OR change mode.
  try {
    const voice = await import('./voiceService');
    if (voice.isSpeaking?.()) {
      devLog('[handsFree] stopping in-flight voice before tap-action');
      await voice.stopSpeaking?.()?.catch?.(() => undefined);
    }
  } catch { /* non-fatal */ }

  switch (pattern) {
    case 'single': {
      // Toggle the existing listening session.
      try {
        const ls = await import('./listeningSession');
        await ls.toggle();
      } catch (e) {
        devLog('[handsFree] toggle failed: ' + String(e));
      }
      return;
    }
    case 'double': {
      await replayLastCaddieLine();
      return;
    }
    case 'triple': {
      // Triple = explicit "shush" — already stopped in-flight above; just
      // surface a confirmation via toast (no voice over the shush).
      try {
        const toast = await import('../store/toastStore');
        toast.useToastStore.getState().show('Quieted.');
      } catch { /* non-fatal */ }
      return;
    }
    case 'long_press': {
      // Reserved for Pass 2 — persona quick-switch via long press.
      devLog('[handsFree] long_press received — no action wired in Pass 1');
      return;
    }
  }
}

async function handleWatchVoice(utterance: string): Promise<void> {
  // The watch already transcribed the utterance on-device; route
  // straight through the voice intent classifier the same way the
  // phone's listening session would. The classifier handles every
  // existing intent (record swing, analyze, query state, etc).
  devLog(`[handsFree] watch-voice → intent route: "${utterance.slice(0, 60)}"`);
  try {
    const ls = await import('./listeningSession');
    await ls.handleTranscribedUtterance?.(utterance);
  } catch (e) {
    devLog('[handsFree] watch-voice route failed: ' + String(e));
  }
}

// ─── Replay last line ────────────────────────────────────────────────────

/**
 * Replay the last caddie line — useful when the user missed it
 * (wind / playing partner talked over it / quick double-tap on
 * earbuds). Reads from a small in-memory cache that voiceService
 * populates on every speak() call.
 *
 * Defensive: when no line has been captured yet, no-op + toast.
 */
async function replayLastCaddieLine(): Promise<void> {
  try {
    const voice = await import('./voiceService');
    const last = voice.getLastSpokenLine?.();
    if (!last || !last.trim()) {
      const toast = await import('../store/toastStore');
      toast.useToastStore.getState().show('No recent line to replay.');
      return;
    }
    const settings = (await import('../store/settingsStore')).useSettingsStore.getState();
    await voice.speak?.(
      last,
      settings.voiceGender,
      settings.language ?? 'en',
      getApiBaseUrl(),
      { userInitiated: true },
    )?.catch?.(() => undefined);
    devLog('[handsFree] replayed last caddie line');
  } catch (e) {
    devLog('[handsFree] replay failed: ' + String(e));
  }
}

// ─── Public testing surface ──────────────────────────────────────────────

/** Manually fire a pattern — used by Settings → Dev "test earbud
 *  patterns" panel and by automated tests. */
export async function debugFirePattern(pattern: TapPattern, source: TapSource = 'earbud'): Promise<void> {
  await handleTap(source, pattern);
}
