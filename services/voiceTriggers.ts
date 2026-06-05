/**
 * 2026-05-24 — Voice trigger orchestrator.
 *
 * Wires Bluetooth headset media-button taps (Bose, AirPods, Pixel Buds,
 * Galaxy Buds) into the existing voice capture orchestrator
 * (services/listeningSession.ts). The native BluetoothMediaButton
 * module emits "onRemoteControl" with type 'play' | 'pause' |
 * 'playPause'. All three map to notifyEarbudTap() — same path the
 * on-screen mic uses.
 *
 * Architecture:
 *
 *     ┌─────────────────────┐
 *     │ Bose / BT button    │
 *     │  → onRemoteControl  │ (native module)
 *     └──────────┬──────────┘
 *                ▼
 *      notifyEarbudTap()  ─────► listeningSession.toggle()
 *
 * 2026-06-03 — REMOVED: voice-assistant launch heuristic that
 * auto-fired notifyEarbudTap() ~300ms after the first AppState
 * 'active' transition on cold launch. The heuristic had no real
 * signal — it was a pure timing guess that fired on EVERY cold
 * launch (false-positive by design). When Stage 3 removed the
 * splash-lock that had been masking it, it landed mid-greeting and
 * killed the splash mp3 via listeningSession.toggle() →
 * stopSpeaking/speak chain. Confirmed root cause of "splash plays
 * 2 words then silence" via 3-audit convergence (2026-06-03).
 * Real earbud taps still flow through onRemoteControl above. Do
 * NOT re-add a timing-based launch heuristic — if voice-assistant
 * launch detection is needed, gate it on a real platform signal
 * (Siri intent payload, Google Assistant launch extra), not on
 * AppState timing.
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

import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { notifyEarbudTap } from './earbudControl';
import { devLog } from './devLog';

let inited = false;
let btEnabled = false;

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
 * Wire BT button. Returns an unsubscribe function. Safe to call
 * multiple times — subsequent calls return the existing teardown
 * handle.
 */
let activeTeardown: (() => void) | null = null;
export function initVoiceTriggers(): () => void {
  if (inited && activeTeardown) {
    return activeTeardown;
  }
  inited = true;

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

  // Activation is opt-in and driven by Settings → Earbud / BT remote tap.
  // This avoids claiming the media session on boot when the user has the
  // feature turned off.
  void syncBluetoothMediaButtonState(btEnabled);

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

/** Keep the native bridge in sync with the Settings toggle. */
export async function syncBluetoothMediaButtonState(enabled: boolean): Promise<void> {
  btEnabled = enabled;
  const bt = getBTModule();
  if (!bt) {
    devLog('[voiceTriggers] BluetoothMediaButton native module not present — BT tap capture disabled');
    return;
  }
  try {
    if (enabled) {
      const s = await bt.activate();
      devLog(`[voiceTriggers] BT module activated (${s.sessionTag})`);
    } else {
      const s = await bt.deactivate();
      devLog(`[voiceTriggers] BT module deactivated (${s.sessionTag})`);
    }
  } catch (e) {
    devLog('[voiceTriggers] BT module sync failed: ' + String(e));
  }
}

/** Test helper — manual trigger from a debug button, etc. */
export function triggerVoiceCapture(): void {
  try { notifyEarbudTap(); } catch (e) { devLog('[voiceTriggers] manual trigger err: ' + String(e)); }
}
