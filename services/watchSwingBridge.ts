/**
 * 2026-06-29 — Wear OS swing bridge (JS side).
 *
 * Subscribes to the phone-side native module (NativeModules.WearSwingBridge,
 * Android only) and maps each per-swing IMU summary into the existing
 * store/watchStore.ts → recordSwing(). From there swingMetricsService.ts
 * already promotes club speed / tempo / smash to the truth-grade 'watch'
 * source tier — no further wiring needed in the analysis layer.
 *
 * Platform: Android only. On iOS / web (and on any Android build where the
 * native module didn't load), NativeMod is null and every function is a
 * graceful no-op — nothing throws, the app is unaffected.
 *
 * Lifecycle: call initWatchSwingBridge() once (e.g. from the watch/health
 * settings screen or app bootstrap) to start listening; stopWatchSwingBridge()
 * to tear down. Both are idempotent.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { useWatchStore } from '../store/watchStore';

interface WearSwingNativeModule {
  start(): Promise<{ listening: boolean }>;
  stop(): Promise<{ listening: boolean }>;
  getStatus(): Promise<{ listening: boolean }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/** Raw event payload from WearSwingBridgeModule.kt (path "/smartplay/swing"). */
interface WatchSwingEvent {
  backswingMs: number;
  downswingMs: number;
  tempoRatio: number;
  peakWristSpeed: number;
  wristAcceleration: number;
  impactAcceleration: number;
  transitionDetected: boolean;
  earlyTransition: boolean;
  tempoGood: boolean;
  clubHeadSpeedEst: number;
  capturedAtMs: number;
}

interface WatchConnectionEvent {
  connected: boolean;
  node: string;
}

const NativeMod: WearSwingNativeModule | null =
  Platform.OS === 'android'
    ? ((NativeModules as Record<string, unknown>).WearSwingBridge as WearSwingNativeModule | undefined) ?? null
    : null;

let emitter: NativeEventEmitter | null = null;
let swingSub: { remove: () => void } | null = null;
let connSub: { remove: () => void } | null = null;
let started = false;

/** True when the native bridge is present on this build/platform. */
export function isWatchSwingBridgeAvailable(): boolean {
  return NativeMod != null;
}

/**
 * Start listening for watch swings. Idempotent. Safe to call anywhere —
 * resolves to false (no-op) when the native module is absent.
 */
export async function initWatchSwingBridge(): Promise<boolean> {
  if (!NativeMod) return false;
  if (started) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emitter = new NativeEventEmitter(NativeMod as any);

    swingSub = emitter.addListener('onWatchSwing', (e: WatchSwingEvent) => {
      // Map 1:1 into the existing store. club is unknown from the wrist —
      // the analysis hookup supplies the selected club when it lands; until
      // then 'unknown' is honest (no fabricated club label).
      useWatchStore.getState().recordSwing({
        backswingMs: Math.round(e.backswingMs ?? 0),
        downswingMs: Math.round(e.downswingMs ?? 0),
        tempoRatio: e.tempoRatio ?? 0,
        peakWristSpeed: e.peakWristSpeed ?? 0,
        wristAcceleration: e.wristAcceleration ?? 0,
        impactAcceleration: e.impactAcceleration ?? 0,
        transitionDetected: !!e.transitionDetected,
        earlyTransition: !!e.earlyTransition,
        tempoGood: !!e.tempoGood,
        clubHeadSpeedEst: e.clubHeadSpeedEst ?? 0,
        club: 'unknown',
      });
    });

    connSub = emitter.addListener('onWatchConnection', (e: WatchConnectionEvent) => {
      useWatchStore.getState().setConnected(!!e.connected, 'Galaxy Watch');
    });

    await NativeMod.start();
    started = true;
    return true;
  } catch {
    // Defensive — never throw across the bridge init.
    started = false;
    return false;
  }
}

/** Stop listening + tear down subscriptions. Idempotent. */
export async function stopWatchSwingBridge(): Promise<void> {
  try {
    swingSub?.remove();
    connSub?.remove();
    swingSub = null;
    connSub = null;
    emitter = null;
    if (NativeMod && started) await NativeMod.stop();
  } catch {
    /* no-op */
  } finally {
    started = false;
    useWatchStore.getState().setConnected(false);
  }
}
