/**
 * 2026-05-23 — Meta Wearables DAT → glassesVisionInput JS bridge.
 *
 * The native module (android-native/MetaWearablesFrameModule.kt)
 * emits "MetaWearableFrame" events when frames arrive from Ray-Ban
 * Meta glasses. This module:
 *   1. Subscribes to those events at boot.
 *   2. Pushes each frame into the existing glassesVisionInput rolling
 *      queue — same path the rest of the app already consumes
 *      (Kevin multimodal, puttingAnalysisService auto-fold, lie
 *      analysis acoustic prior, smartAnalysisEngine routing).
 *   3. Exposes start/stop helpers so a Settings screen can toggle
 *      streaming without the user needing to know about DAT internals.
 *
 * Sequencing with TTS (DAT one-session-per-device constraint):
 *   When voiceService is actively speaking through HFP → glasses
 *   speakers, DAT will refuse to start a camera stream. The bridge
 *   listens for voice "speaking start" / "speaking end" events and
 *   pauses/resumes the camera stream accordingly. Until those events
 *   are wired (small voiceService hook — see TODO comment), the
 *   bridge is conservative: it does NOT auto-pause; the user is
 *   expected to stop streaming if they hit the conflict. The cost of
 *   the conflict is a clean DAT error toast, not a crash.
 *
 * Platform: Android only for now. iOS implementation lands once we
 * have an Apple Developer Program enrollment + the Swift equivalent
 * of MetaWearablesFrameModule.kt. The native-module-absent path
 * collapses to no-op without throwing.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { submitVisionFrame, type VisionFrame } from './glassesVisionInput';
import { devLog } from './devLog';

// ─── Native module shape (TS-side declaration) ──────────────────────

interface MetaWearablesFrameNativeModule {
  startStreaming(quality: 'high' | 'medium' | 'low', fps: number): Promise<{
    alreadyStreaming: boolean;
    device: string;
  }>;
  stopStreaming(): Promise<void>;
  getStatus(): Promise<{
    connected: boolean;
    streaming: boolean;
    device: string;
  }>;
}

// Resolve safely — on iOS / web / older builds without the module,
// every helper below collapses to a no-op rather than throwing.
const NativeMod: MetaWearablesFrameNativeModule | null =
  Platform.OS === 'android'
    ? ((NativeModules as Record<string, unknown>).MetaWearablesFrame as MetaWearablesFrameNativeModule | undefined) ?? null
    : null;

let emitter: NativeEventEmitter | null = null;
let subscribed = false;

interface FramePayload {
  uri: string;
  captured_at: number;
  source: 'glasses';
}

function subscribeOnce(): void {
  if (subscribed || !NativeMod) return;
  // Cast is safe — NativeModules.MetaWearablesFrame implements the
  // EventEmitterRequired contract from the native module spec above.
  // NativeEventEmitter's first-arg type isn't publicly exported in
  // older RN typings; cast to `any` here to avoid plumbing the
  // private NativeModule interface from react-native internals.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitter = new NativeEventEmitter(NativeMod as any);
  emitter.addListener('MetaWearableFrame', (payload: FramePayload) => {
    try {
      if (!payload?.uri) return;
      const frame: VisionFrame = {
        uri: payload.uri,
        captured_at: payload.captured_at ?? Date.now(),
        source: 'glasses',
      };
      // submitVisionFrame is async; we don't await — the rolling
      // queue handles backpressure via its own LRU. Errors here are
      // non-fatal (single dropped frame).
      void submitVisionFrame(frame).catch((e) => {
        devLog('[mwdat-bridge] submitVisionFrame failed: ' + String(e));
      });
    } catch (e) {
      devLog('[mwdat-bridge] frame handler threw: ' + String(e));
    }
  });
  subscribed = true;
  devLog('[mwdat-bridge] subscribed to MetaWearableFrame events');
}

// ─── Public API ─────────────────────────────────────────────────────

export function isMetaWearablesAvailable(): boolean {
  return NativeMod !== null;
}

export async function getMetaWearablesStatus(): Promise<{
  available: boolean;
  connected: boolean;
  streaming: boolean;
  device: string;
}> {
  if (!NativeMod) {
    return { available: false, connected: false, streaming: false, device: '' };
  }
  try {
    const status = await NativeMod.getStatus();
    return { available: true, ...status };
  } catch (e) {
    devLog('[mwdat-bridge] getStatus failed: ' + String(e));
    return { available: true, connected: false, streaming: false, device: '' };
  }
}

/**
 * Start the camera frame stream from Ray-Ban Meta glasses. Default
 * quality is medium (504×896) and 24 FPS — balances bandwidth on
 * Bluetooth Classic against frame freshness. Resolves to the device
 * name on success, or rejects with a DAT_* error code on failure
 * (most common: BLUETOOTH_NOT_PAIRED, NO_GLASSES_DETECTED).
 */
export async function startMetaWearablesStreaming(
  quality: 'high' | 'medium' | 'low' = 'medium',
  fps: number = 24,
): Promise<string> {
  if (!NativeMod) {
    throw new Error('Meta Wearables DAT not available on this platform / build');
  }
  subscribeOnce();
  const result = await NativeMod.startStreaming(quality, fps);
  devLog(
    `[mwdat-bridge] startStreaming ok device=${result.device} alreadyStreaming=${result.alreadyStreaming}`,
  );
  return result.device || 'Ray-Ban Meta';
}

/** Tear down the stream. Idempotent; safe to call multiple times. */
export async function stopMetaWearablesStreaming(): Promise<void> {
  if (!NativeMod) return;
  try {
    await NativeMod.stopStreaming();
    devLog('[mwdat-bridge] streaming stopped');
  } catch (e) {
    devLog('[mwdat-bridge] stopStreaming threw (non-fatal): ' + String(e));
  }
}

// TODO (2026-05-23): wire voiceService speaking-start / speaking-end
// events into a pause/resume helper here so the DAT one-session-per-
// device constraint doesn't surface as a runtime error when the
// caddie is mid-utterance. For now the bridge runs hot — the cost of
// the collision is a single rejected DAT call, not a crash.
