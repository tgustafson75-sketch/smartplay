/**
 * 2026-05-24 — Voice trigger orchestrator.
 *
 * Wires two non-mic input sources into the existing voice capture
 * orchestrator (services/listeningSession.ts):
 *
 *   1. Bluetooth headset media-button taps (Bose, AirPods, Pixel Buds,
 *      Galaxy Buds) — via the native BluetoothMediaButton module
 *      emitting "onRemoteControl" with type 'play' | 'pause' |
 *      'playPause'. Maps to notifyEarbudTap() — same path the
 *      on-screen mic uses.
 *
 *   2. Voice-assistant launch (Hey Siri / Hey Google / Meta AI on
 *      glasses) — heuristic: if AppState becomes 'active' within
 *      VOICE_LAUNCH_WINDOW_MS of cold app start, assume the user
 *      voice-launched and auto-trigger after a short delay so the
 *      audio session settles.
 *
 * Architecture:
 *
 *     ┌─────────────────────┐
 *     │ Bose / BT button    │
 *     │  → onRemoteControl  │ (native module)
 *     └──────────┬──────────┘
 *                ▼
 *      notifyEarbudTap()  ─────► listeningSession.toggle()
 *                ▲
 *     ┌──────────┴──────────┐
 *     │ Voice-assistant     │
 *     │ launch heuristic    │ (AppState 'active' < 2s from boot)
 *     └─────────────────────┘
 *
 * Idempotency: initVoiceTriggers() can be called multiple times safely;
 * the first call wires listeners and activates the native session, the
 * rest are no-ops. The activation lifecycle for the native module
 * (activate/deactivate) is also wired here.
 *
 * Cleanup: returns an unsubscribe function. The mount site in
 * app/_layout.tsx calls it on unmount; in practice the layout only
 * unmounts on app teardown, so deactivate is rarely invoked.
 */

import { DeviceEventEmitter, AppState, NativeModules, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { notifyEarbudTap } from './earbudControl';
import { devLog } from './devLog';

const VOICE_LAUNCH_WINDOW_MS = 2_000;
const VOICE_LAUNCH_DELAY_MS = 300;

// Set on first init so we can measure "did the app come active within
// X ms of boot?" — the cold-launch-via-voice heuristic.
let appStartTime: number | null = null;
let inited = false;

type BTModule = {
  activate: () => Promise<{ active: boolean; sessionTag: string }>;
  deactivate: () => Promise<{ active: boolean; sessionTag: string }>;
  getStatus: () => Promise<{ active: boolean; sessionTag: string }>;
};

function getBTModule(): BTModule | null {
  const mod = (NativeModules as { BluetoothMediaButton?: BTModule }).BluetoothMediaButton;
  return mod ?? null;
}

/**
 * Wire BT button + voice-assistant launch detection. Returns an
 * unsubscribe function. Safe to call multiple times — subsequent
 * calls return the existing teardown handle.
 */
let activeTeardown: (() => void) | null = null;
export function initVoiceTriggers(): () => void {
  if (inited && activeTeardown) {
    return activeTeardown;
  }
  inited = true;
  appStartTime = Date.now();

  const subscriptions: Array<{ remove: () => void }> = [];

  // 1. Bluetooth headset media-button tap → notifyEarbudTap.
  //    The native module emits 'onRemoteControl' with { type: 'play' |
  //    'pause' | 'playPause' }. All three resolve to a single "tap"
  //    signal — earbudControl handles pattern classification.
  const btSub = DeviceEventEmitter.addListener('onRemoteControl', (event: { type?: string; at?: number }) => {
    const t = String(event?.type ?? '');
    if (t === 'play' || t === 'pause' || t === 'playPause') {
      devLog(`[voiceTriggers] BT button → ${t}`);
      try { notifyEarbudTap(); } catch (e) { devLog('[voiceTriggers] notify err: ' + String(e)); }
    }
  });
  subscriptions.push(btSub);

  // Activate the native session. Idempotent on the native side, so a
  // race with the JS-side `inited` flag is harmless.
  const bt = getBTModule();
  if (bt) {
    bt.activate()
      .then((s) => devLog(`[voiceTriggers] BT module activated (${s.sessionTag})`))
      .catch((e) => devLog('[voiceTriggers] activate failed: ' + String(e)));
  } else {
    // Expected when running in Expo Go or a build without the native
    // module. On-screen mic button still works; just no BT tap capture.
    devLog('[voiceTriggers] BluetoothMediaButton native module not present — BT tap capture disabled');
  }

  // 2. Voice-assistant launch heuristic.
  //    If AppState becomes 'active' within VOICE_LAUNCH_WINDOW_MS of
  //    the FIRST initVoiceTriggers() call (= app boot), assume the
  //    user launched the app via voice (Siri / Google Assistant / Meta
  //    AI) and auto-trigger listening. False positives: cold launches
  //    in general — which is an acceptable UX for a voice-first app.
  //
  //    Subsequent 'active' transitions (app switch from background)
  //    are gated out by the launchTime < window check.
  let launchTriggered = false;
  const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state !== 'active') return;
    if (launchTriggered) return;
    const elapsed = Date.now() - (appStartTime ?? 0);
    if (elapsed < VOICE_LAUNCH_WINDOW_MS) {
      launchTriggered = true;
      devLog(`[voiceTriggers] voice-launch heuristic fired (elapsed=${elapsed}ms)`);
      setTimeout(() => {
        try { notifyEarbudTap(); } catch (e) { devLog('[voiceTriggers] launch trigger err: ' + String(e)); }
      }, VOICE_LAUNCH_DELAY_MS);
    }
  });
  subscriptions.push(appStateSub);

  devLog(`[voiceTriggers] inited (platform=${Platform.OS})`);

  activeTeardown = () => {
    subscriptions.forEach((s) => { try { s.remove(); } catch { /* ignore */ } });
    const m = getBTModule();
    if (m) {
      m.deactivate().catch(() => { /* ignore */ });
    }
    inited = false;
    activeTeardown = null;
  };
  return activeTeardown;
}

/** Test helper — manual trigger from a debug button, etc. */
export function triggerVoiceCapture(): void {
  try { notifyEarbudTap(); } catch (e) { devLog('[voiceTriggers] manual trigger err: ' + String(e)); }
}
