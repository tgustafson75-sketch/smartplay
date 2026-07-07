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

import { NativeModules, NativeEventEmitter, Platform, AppState, type AppStateStatus } from 'react-native';
import { submitVisionFrame, type VisionFrame } from './glassesVisionInput';
import { devLog } from './devLog';
import { recordNativeModuleHealth } from './nativeModuleHealth';

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
// 2026-05-23 — Probe + record health for the diagnostic surface.
// Records BEFORE assignment so the probe runs even on the iOS path
// where NativeMod is forced to null.
const _mwHealth = recordNativeModuleHealth('MetaWearablesFrame');
const NativeMod: MetaWearablesFrameNativeModule | null =
  Platform.OS === 'android' && _mwHealth.loaded
    ? ((NativeModules as Record<string, unknown>).MetaWearablesFrame as MetaWearablesFrameNativeModule)
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
      lastFrameAt = Date.now();
      // Mark streaming=true on the FIRST frame after a start. The
      // startMetaWearablesStreaming resolver also sets this, but
      // first-frame is the most honest "we're actually receiving data"
      // signal so we publish from here too — cheap idempotent update.
      if (!currentStatus.streaming) {
        publishStatus({ streaming: true, connected: true });
        // Re-arm staleness watching — the probe may have been cleared by
        // a prior stop/stale-flip (subscribeOnce only runs once, so it
        // can't re-create it).
        ensureStaleProbe();
      }
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
  ensureStaleProbe();
  ensureAppStateListener();
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
  // 2026-05-25 — Hardcoded available=false to match currentStatus until
  // the real DAT SDK is wired. See note above currentStatus init.
  void NativeMod;
  return { available: false, connected: false, streaming: false, device: '' };
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
    // 2026-05-23 — Surface a user-facing toast when the player tries
    // to use glasses but the native bridge isn't available. Lazy
    // import of toastStore so this service doesn't pull a store
    // dependency at module init.
    try {
      const { useToastStore } = await import('../store/toastStore');
      useToastStore.getState().show('Glasses unavailable — using cloud features.');
    } catch { /* non-fatal */ }
    throw new Error('Meta Wearables DAT not available on this platform / build');
  }
  subscribeOnce();
  requestedQuality = quality;
  requestedFps = fps;
  const cfg = effectiveStreamConfig();
  const result = await NativeMod.startStreaming(cfg.quality, cfg.fps);
  publishStatus({
    available: true,
    connected: true,
    streaming: true,
    device: result.device || 'Ray-Ban Meta',
    effectiveFps: cfg.fps,
  });
  lastFrameAt = Date.now();
  // Re-arm the stale probe on every (re)start — subscribeOnce only creates
  // it on the FIRST subscribe, and stopMetaWearablesStreaming clears it.
  ensureStaleProbe();
  devLog(
    `[mwdat-bridge] startStreaming ok device=${result.device} alreadyStreaming=${result.alreadyStreaming} effectiveFps=${cfg.fps}`,
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
  } finally {
    publishStatus({ connected: false, streaming: false, effectiveFps: 0 });
    // 2026-07-04 (elite-clean audit) — stop the 4s staleness interval with
    // the stream; it re-arms on the next start / first frame.
    clearStaleProbe();
  }
}

// TODO (2026-05-23): wire voiceService speaking-start / speaking-end
// events into a pause/resume helper here so the DAT one-session-per-
// device constraint doesn't surface as a runtime error when the
// caddie is mid-utterance. For now the bridge runs hot — the cost of
// the collision is a single rejected DAT call, not a crash.

// ─── Status subscription ────────────────────────────────────────────
//
// Consumers (Settings toggle, SmartMotion / PuttingLab / SmartVision
// status badges) subscribe via onGlassesStatusChange to react when
// the stream connects or disconnects. The status changes whenever:
//   - startMetaWearablesStreaming resolves successfully (→ streaming
//     = true, connected = true)
//   - stopMetaWearablesStreaming resolves (→ both false)
//   - A frame hasn't arrived in STALE_MS (default 12s) AFTER we
//     thought we were streaming. Reports streaming=false in that case
//     so UI badges flip back without the consumer having to poll.
//
// Failure modes that should fire a status change but currently don't
// (TODO follow-up): the OS dropping the Bluetooth connection without
// throwing, the Meta AI app revoking permission mid-stream. Both
// surface as a frame-timeout today; explicit DAT lifecycle hooks
// would tighten that.

type StatusListener = (status: GlassesStatus) => void;
export interface GlassesStatus {
  available: boolean;
  connected: boolean;
  streaming: boolean;
  device: string;
  /** Effective FPS the bridge is currently asking the SDK for. May be
   *  lower than the user-requested FPS if thermal/battery throttle
   *  kicked in. */
  effectiveFps: number;
}

// 2026-05-25 — Beta-blocker fix: Android MetaWearablesFrameModule is
// currently stubbed (NOT_IMPLEMENTED reject on startStreaming) until
// the real DAT SDK symbols are confirmed post-beta. The stub registers
// fine, so `NativeMod !== null` returns true on Android, which lit up
// the "GLASSES OFF / PAIRED" badge in SmartVision / SmartMotion /
// PuttingLab even though every glasses operation would reject. Force
// available=false until real DAT lands; flip back to `NativeMod !==
// null` (or a richer probe) when MetaWearablesFrameModule.kt is
// re-implemented against the real SDK.
let currentStatus: GlassesStatus = {
  available: false,
  connected: false,
  streaming: false,
  device: '',
  effectiveFps: 0,
};
const statusListeners = new Set<StatusListener>();
let lastFrameAt: number = 0;
const STALE_MS = 12_000;
let staleProbe: ReturnType<typeof setInterval> | null = null;

function publishStatus(partial: Partial<GlassesStatus>): void {
  currentStatus = { ...currentStatus, ...partial };
  for (const cb of statusListeners) {
    try { cb(currentStatus); } catch (e) { devLog('[mwdat-bridge] status listener threw: ' + String(e)); }
  }
}

function ensureStaleProbe(): void {
  if (staleProbe || !NativeMod) return;
  staleProbe = setInterval(() => {
    if (!currentStatus.streaming) return;
    const age = Date.now() - lastFrameAt;
    if (age > STALE_MS) {
      devLog(`[mwdat-bridge] stream went stale (${age}ms since last frame) — flipping streaming=false`);
      publishStatus({ streaming: false });
      // 2026-07-04 (elite-clean audit) — nothing left to watch once the
      // stream is flagged stale; stop ticking. The probe re-arms on the
      // next startMetaWearablesStreaming / first-frame publish.
      clearStaleProbe();
    }
  }, 4_000);
}

// 2026-07-04 (elite-clean audit) — the probe used to run forever once
// created (subscribeOnce is one-shot, so it survived every stop/teardown).
// Defensive today (NativeMod is null until real DAT lands) but a real
// 4s-interval leak the moment glasses streaming goes live.
function clearStaleProbe(): void {
  if (!staleProbe) return;
  clearInterval(staleProbe);
  staleProbe = null;
}

export function onGlassesStatusChange(cb: StatusListener): () => void {
  statusListeners.add(cb);
  // Fire once with the current state so subscribers don't have to call
  // getMetaWearablesStatus separately for first render.
  try { cb(currentStatus); } catch { /* swallow */ }
  return () => { statusListeners.delete(cb); };
}

export function getGlassesStatusSync(): GlassesStatus {
  return currentStatus;
}

// ─── Thermal / battery awareness ────────────────────────────────────
//
// Bluetooth Classic camera streaming is non-trivial battery + thermal
// load on the phone (radio + JPEG encode + JS bridge IPC). When the
// device reports a hot thermal state, we downshift FPS in real time
// so we don't push the phone past throttling. RN doesn't ship a
// stable thermal-state API across platforms today; the bridge listens
// for AppState background transitions (cheap, available everywhere)
// and downshifts on backgrounding as a conservative proxy. Explicit
// thermal hooks land later when expo-thermal or a similar module is
// in the dependency tree.

type QualityPreset = 'high' | 'medium' | 'low';
let requestedQuality: QualityPreset = 'medium';
let requestedFps: number = 24;
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

function effectiveStreamConfig(): { quality: QualityPreset; fps: number } {
  // Background → drop to low/7. Active → use user-requested.
  if (AppState.currentState !== 'active') {
    return { quality: 'low', fps: 7 };
  }
  return { quality: requestedQuality, fps: requestedFps };
}

async function applyStreamConfig(): Promise<void> {
  if (!NativeMod || !currentStatus.streaming) return;
  const cfg = effectiveStreamConfig();
  if (cfg.fps === currentStatus.effectiveFps) return;
  devLog(`[mwdat-bridge] reconfiguring stream → quality=${cfg.quality} fps=${cfg.fps}`);
  try {
    // DAT doesn't expose a hot-reconfigure on either platform yet —
    // the cheapest reconfigure is stop+start. We swallow any error so
    // a reconfigure miss doesn't crash an active stream.
    await NativeMod.stopStreaming();
    await NativeMod.startStreaming(cfg.quality, cfg.fps);
    publishStatus({ effectiveFps: cfg.fps });
  } catch (e) {
    devLog('[mwdat-bridge] reconfigure failed (non-fatal): ' + String(e));
  }
}

function ensureAppStateListener(): void {
  if (appStateSub || !NativeMod) return;
  appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    devLog(`[mwdat-bridge] app state → ${next}`);
    if (currentStatus.streaming) void applyStreamConfig();
  });
}
