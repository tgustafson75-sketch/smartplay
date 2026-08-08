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
import { useClubSelectionStore } from '../store/clubSelectionStore';
import { useCageStore } from '../store/cageStore';
import { normalizeClub } from './clubNormalize';
import { sendSwingFeedback } from './watchBridge';
import { useSettingsStore } from '../store/settingsStore';
import { interpretWristSwing } from './watchWristInterpretation';

/**
 * 2026-07-29 (Tim — "it should all tie to the app so the current selected-club logic is baked in;
 * ties with the Arccos data"). The wrist can't know which club you swung, so a watch swing used to
 * log as 'unknown'. Resolve the app's currently-selected club instead — a live cage session's
 * currentClub wins (you're actively hitting it), else the last club tagged on any capture surface
 * (clubSelectionStore). Normalized to the SAME canonical ClubName the bag + Arccos import key on, so
 * the watch's speed/tempo and Arccos's carry/total distances accumulate on ONE per-club profile.
 */
function resolveSelectedClub(): string {
  try {
    const cageClub = useCageStore.getState().activeSession?.currentClub;
    const raw = cageClub ?? useClubSelectionStore.getState().lastClub ?? null;
    return normalizeClub(raw ? String(raw) : null) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

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
  // Per-axis capture (present only on watch builds ≥ 2026-07-29 + a matching phone native module).
  peakGyro?: { x: number; y: number; z: number };
  impactAccelAxes?: { x: number; y: number; z: number };
  downswingProfile?: Array<{ t: number; x: number; y: number; z: number }>;
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
// 2026-08-07 (Tim — "use the watch to turn on swing detection in a live round"). Debounce so waggles /
// rapid re-swings don't spam the live shot detector with duplicate shots.
let lastLiveShotTriggerAt = 0;
const LIVE_SHOT_TRIGGER_COOLDOWN_MS = 20_000;

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
      // 2026-07-29 — an inbound swing is live proof the watch is connected, even if the launch-time
      // `/smartplay/hello` (the only thing that fires onWatchConnection) was missed. Refresh the flag.
      useWatchStore.getState().setConnected(true, 'Galaxy Watch');
      // Map 1:1 into the existing store, tagged with the app's currently-selected club (cage's live
      // club → last tagged club), normalized to the canonical name so watch speed/tempo lands on the
      // SAME per-club profile the bag + Arccos import build. 'unknown' only when nothing is selected.
      const club = resolveSelectedClub();
      // Which wrist the watch is on (persistent setting, default 'lead', toggled in Settings). Tags the
      // swing so lead/trail data never pools + drives the per-wrist interpretation below.
      const wrist = useSettingsStore.getState().watchWrist ?? 'lead';
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
        club,
        wrist,
        // Attach the raw per-axis capture when the watch + native module provide it (older builds omit
        // it → undefined). Stored in-memory only; feeds the future calibrated casting/face model.
        axisCapture: e.peakGyro && e.impactAccelAxes
          ? { peakGyro: e.peakGyro, impactAccel: e.impactAccelAxes, downswing: e.downswingProfile ?? [] }
          : undefined,
      });

      // 2026-08-07 (Tim — "how can we use the watch to turn on swing detection in a LIVE round?"). A
      // watch-detected swing is a DEFINITIVE "a shot was just hit" signal — more reliable than the phone's
      // GPS-displacement / acoustic inference. Gated on a REAL swing (transition or real impact/speed, not
      // a waggle) + a 20s debounce. NOTE: the watch's own GPS is NOT in this event yet — the origin is the
      // phone's fix. Sending the watch's exact standing position needs a native watch-app change.
      // 2026-08-08 (audit + Tim picker decision — "bypass in cart"). The first wiring went through
      // shotDetectionService.triggerManual → emit → the AUTO handler, which SUPPRESSES in cart mode /
      // >4 m/s — i.e. it recorded nothing from the cart, Tim's exact setup. Now routes through the TRUE
      // manual seam (conversationalLoggingOrchestrator.triggerManual → runFlow directly), which bypasses
      // the auto-path suppression; its {0,0} sentinel start_location resolves to a real fix downstream.
      try {
        const realSwing = !!e.transitionDetected
          || (e.impactAcceleration ?? 0) > 0
          || (e.clubHeadSpeedEst ?? 0) >= 30;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const roundActive = (require('../store/roundStore') as typeof import('../store/roundStore'))
          .useRoundStore.getState().isRoundActive;
        const now = Date.now();
        if (roundActive && realSwing && now - lastLiveShotTriggerAt > LIVE_SHOT_TRIGGER_COOLDOWN_MS) {
          lastLiveShotTriggerAt = now;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          void (require('./conversationalLoggingOrchestrator') as typeof import('./conversationalLoggingOrchestrator'))
            .conversationalLoggingOrchestrator.triggerManual().catch(() => undefined);
          console.log('[watchSwing] live round → manual shot flow triggered, cart-suppression bypassed (club:', club, ')');
        }
      } catch (err) { console.log('[watchSwing] live-round shot trigger failed (non-fatal):', err); }

      // 2026-07-29 (Tim — drill feedback on the wrist: swipeable metric cards). Push the just-captured
      // swing straight back to the watch so it shows a per-swing readout during a drill. Club-tagged +
      // normalized here, so what the wrist shows matches what the phone logs against the bag. The
      // lead/trail INTERPRETATION is computed here (phone-side) and sent as a hedged hint — the watch
      // just displays it (no lead/trail logic on the watch).
      const transition: 'smooth' | 'quick' | 'early' | 'unknown' =
        e.earlyTransition ? 'early' : e.transitionDetected ? (e.tempoGood ? 'smooth' : 'quick') : 'unknown';
      const interp = interpretWristSwing({
        wrist,
        tempoGood: !!e.tempoGood,
        transitionDetected: !!e.transitionDetected,
        earlyTransition: !!e.earlyTransition,
      });
      void sendSwingFeedback({
        club,
        tempoRatio: Math.round((e.tempoRatio ?? 0) * 10) / 10,
        clubSpeed: Math.round(e.clubHeadSpeedEst ?? 0),
        transition,
        backswingMs: Math.round(e.backswingMs ?? 0),
        downswingMs: Math.round(e.downswingMs ?? 0),
        flushed: !!e.tempoGood,
        wrist,
        faultHint: interp.faultHint,
      }).catch(() => { /* best-effort — never affects capture */ });
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
