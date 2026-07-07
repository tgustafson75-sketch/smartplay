/**
 * 2026-07-06 — Watch Caddie Bridge (JS side, Android/Wear OS).
 *
 * The second half of the watch story (the first is watchSwingBridge = swing
 * capture). This wires the SAME native module (NativeModules.WearSwingBridge) for:
 *
 *   PHONE → WATCH (outbound): pushes live pin yardage (front/middle/back to the
 *     green, GPS-live via getGreenYardagesSync) + any notification / spoken-prompt /
 *     round-state the app fires through services/watchBridge. Registered as the
 *     watchBridge sender, so sendNotification/sendLiveScore/sendVoicePrompt/
 *     sendRoundState from anywhere in the app now actually reach the watch.
 *
 *   WATCH → PHONE (inbound): the watch mic ships transcribed text ("how far to the
 *     pin") → onWatchVoice → notifyWatchVoice → handsFreeOrchestrator already routes
 *     it through the full caddie pipeline and speaks the answer. Watch taps →
 *     onWatchTap → notifyWatchTap.
 *
 * Platform: Android only. NativeMod is null on iOS/web or any build without the
 * native module → every function is a graceful no-op (nothing throws).
 *
 * All messages ride one path, "/smartplay/caddie", carrying JSON with a `kind`
 * the watch parses (yardage / notification / voice_prompt / score / state).
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { registerWatchSender, notifyWatchVoice, notifyWatchTap, type OutboundPayload } from './watchBridge';
import { getGreenYardagesSync } from './smartFinderService';
import { useRoundStore } from '../store/roundStore';
import { devLog } from './devLog';

const CADDIE_PATH = '/smartplay/caddie';
// Live-yardage refresh cadence while a round is active. 18s balances "updates as
// you walk" against watch battery; the phone already has the fix, so this is just a
// tiny Data Layer message.
const YARDAGE_TICK_MS = 18_000;

interface WearCaddieNativeModule {
  sendToWatch(path: string, data: string): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const NativeMod: WearCaddieNativeModule | null =
  Platform.OS === 'android'
    ? ((NativeModules as Record<string, unknown>).WearSwingBridge as WearCaddieNativeModule | undefined) ?? null
    : null;

let emitter: NativeEventEmitter | null = null;
let voiceSub: { remove: () => void } | null = null;
let tapSub: { remove: () => void } | null = null;
let unsubRound: (() => void) | null = null;
let yardageTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

export function isWatchCaddieBridgeAvailable(): boolean {
  return NativeMod != null;
}

/** Push the current GPS-live green yardages to the watch. Best-effort; skips when
 *  there's no usable read (no fix / no hole data) so the watch never shows a fake. */
export async function pushYardageToWatch(): Promise<void> {
  if (!NativeMod) return;
  try {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) return;
    const y = getGreenYardagesSync(round.currentHole);
    if (y.middle == null && y.front == null && y.back == null) return; // nothing honest to show
    const payload = {
      kind: 'yardage' as const,
      hole: y.hole_number,
      front: y.front,
      middle: y.middle,
      back: y.back,
    };
    await NativeMod.sendToWatch(CADDIE_PATH, JSON.stringify(payload));
  } catch (e) {
    devLog('[watchCaddieBridge] pushYardage failed: ' + String(e));
  }
}

/**
 * Start the caddie bridge. Idempotent. Registers the outbound sender, subscribes to
 * watch voice/tap, and pushes live yardage on hole change + a slow tick.
 */
export async function initWatchCaddieBridge(): Promise<boolean> {
  if (!NativeMod) return false;
  if (started) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emitter = new NativeEventEmitter(NativeMod as any);

    // Outbound: every watchBridge send now ships to the watch on one path.
    registerWatchSender(async (payload: OutboundPayload) => {
      await NativeMod!.sendToWatch(CADDIE_PATH, JSON.stringify(payload));
    });

    // Inbound: watch mic → the regular caddie pipeline (handsFreeOrchestrator
    // already subscribes to subscribeWatchVoice → handleTranscribedUtterance).
    voiceSub = emitter.addListener('onWatchVoice', (e: { text?: string }) => {
      const text = (e?.text ?? '').trim();
      if (text) notifyWatchVoice(text);
    });
    tapSub = emitter.addListener('onWatchTap', (e: { pattern?: string }) => {
      const p = e?.pattern;
      notifyWatchTap(p === 'double' || p === 'triple' || p === 'long_press' ? p : 'single');
    });

    // Push yardage immediately, on every hole change, and on a slow tick.
    void pushYardageToWatch();
    let lastHole = useRoundStore.getState().currentHole;
    unsubRound = useRoundStore.subscribe((s) => {
      if (s.currentHole !== lastHole) {
        lastHole = s.currentHole;
        void pushYardageToWatch();
      }
    });
    yardageTimer = setInterval(() => { void pushYardageToWatch(); }, YARDAGE_TICK_MS);

    started = true;
    return true;
  } catch (e) {
    devLog('[watchCaddieBridge] init failed: ' + String(e));
    started = false;
    return false;
  }
}

/** Tear down. Idempotent. */
export async function stopWatchCaddieBridge(): Promise<void> {
  try {
    voiceSub?.remove();
    tapSub?.remove();
    unsubRound?.();
    if (yardageTimer) clearInterval(yardageTimer);
  } catch {
    /* no-op */
  } finally {
    voiceSub = null; tapSub = null; unsubRound = null; yardageTimer = null; emitter = null;
    started = false;
  }
}
