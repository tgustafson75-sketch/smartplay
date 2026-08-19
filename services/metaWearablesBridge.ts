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

import { NativeModules, NativeEventEmitter, Platform, AppState, Linking, type AppStateStatus } from 'react-native';
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
  /** 2026-08-19 — hands an inbound deep link to the DAT SDK so the consent round trip completes.
   *  iOS only today (Android's SDK finishes authorization in-process); absent on older builds. */
  handleAppLink?(url: string): Promise<{ handled: boolean; reason?: string }>;
}

// Resolve safely — on iOS / web / older builds without the module,
// every helper below collapses to a no-op rather than throwing.
// 2026-05-23 — Probe + record health for the diagnostic surface.
// Records BEFORE assignment so the probe runs even on the iOS path
// where NativeMod is forced to null.
const _mwHealth = recordNativeModuleHealth('MetaWearablesFrame');
/**
 * 2026-08-19 (Tim — "make sure my glasses are gonna connect the next time").
 *
 * This was `Platform.OS === 'android' && _mwHealth.loaded`, which hard-disabled the glasses on iOS —
 * the Swift module ships in a `glasses`-profile build (MWDAT_IOS_ENABLED=1 compiles the SDK in and
 * writes the MWDAT attestation dict), but JS refused to resolve it, so iOS could never see a headset
 * no matter how the pairing went on Meta's side. The Android-only gate predates the iOS module being
 * finished and was never lifted.
 *
 * `_mwHealth.loaded` is the honest test on its own: it is TRUE only when the native module is really
 * present in this binary. A normal TestFlight/APK build has the DAT plugin no-op'd, so the module is
 * absent, this stays null, and every helper below collapses to the same no-op it always did — the
 * Connect-Glasses UI simply doesn't appear. Nothing changes for the shipped build; the difference is
 * that a glasses build now works on both platforms instead of one.
 */
const NativeMod: MetaWearablesFrameNativeModule | null =
  (Platform.OS === 'android' || Platform.OS === 'ios') && _mwHealth.loaded
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
  ensureVoiceCoordination();
  devLog('[mwdat-bridge] subscribed to MetaWearableFrame events');
}

// ─── Voice ↔ glasses audio-session coordination (DAT one-session-per-device) ──
//
// 2026-07-23 (Tim — "tapping the meta glasses just freezes the mic") — the glasses camera stream and
// the phone's caddie audio (mic capture + TTS) contend for the SINGLE Bluetooth audio session; that
// collision is what froze the mic. Implements the long-standing TODO below: when the caddie is
// SPEAKING (and, via the resume delay, through the user's likely spoken reply), PAUSE the camera
// stream so the phone owns the audio cleanly, then resume shortly after it goes quiet. This ONLY ever
// pauses/resumes the camera stream — it never touches the mic/recording path — so worst case is a
// brief stream gap during conversation, never a worse freeze. Debounced so back-to-back utterances
// don't thrash the (expensive) DAT session.
let pausedByVoice = false;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let voiceCoordSub: (() => void) | null = null;
const VOICE_RESUME_DELAY_MS = 6000;

function ensureVoiceCoordination(): void {
  if (voiceCoordSub || !NativeMod) return;
  void import('./voiceService')
    .then((vs) => {
      voiceCoordSub = vs.subscribeToSpeaking((speaking: boolean) => {
        const mod = NativeMod;
        if (!mod) return;
        if (speaking) {
          if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
          // Only pause a stream that's actually running, and only once.
          if (currentStatus.streaming && !pausedByVoice) {
            pausedByVoice = true;
            void mod.stopStreaming().catch(() => {});
            devLog('[mwdat-bridge] paused camera stream for caddie audio (one-session handoff)');
          }
        } else {
          if (!pausedByVoice) return;
          if (resumeTimer) clearTimeout(resumeTimer);
          resumeTimer = setTimeout(() => {
            resumeTimer = null;
            if (!pausedByVoice) return;
            pausedByVoice = false;
            const cfg = effectiveStreamConfig();
            void mod.startStreaming(cfg.quality, cfg.fps)
              .then(() => { lastFrameAt = Date.now(); ensureStaleProbe(); })
              .catch(() => {});
            devLog('[mwdat-bridge] resumed camera stream after caddie audio');
          }, VOICE_RESUME_DELAY_MS);
        }
      });
    })
    .catch(() => { /* voiceService unavailable in some envs — coordination is best-effort */ });
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
  // 2026-07-11 — real DAT module landed (Android v0.8). Report actual state:
  // available = the native module is present; connected/streaming from getStatus().
  if (!NativeMod) return { available: false, connected: false, streaming: false, device: '' };
  try {
    const s = await NativeMod.getStatus();
    return { available: true, connected: !!s.connected, streaming: !!s.streaming, device: s.device || '' };
  } catch {
    return { available: true, connected: false, streaming: false, device: '' };
  }
}

/**
 * 2026-08-07 (Tim — got a raw "NO_ELIGIBLE_DEVICE / DAT_SESSION_FAILED" toast). Map the DAT SDK's
 * machine error codes to an HONEST, actionable one-liner (the app's north star: never a robotic error
 * code). Deliberately does NOT over-promise "just pair in the Meta app" for the eligibility gate — that
 * was the misleading message Tim called out on 07-30 when the glasses were already paired. The raw code
 * is still logged to the issue log for diagnosis; this is only what the human sees.
 */
export function describeGlassesError(code: string | null | undefined, message?: string | null): string {
  const c = (code ?? '').toUpperCase();
  const m = (message ?? '').toLowerCase();
  if (c.includes('BLUETOOTH') || c.includes('NOT_PAIRED') || m.includes('not paired'))
    return 'Your Ray-Bans aren’t paired. Open the Meta AI app, connect them there, then try again.';
  if (c.includes('NO_GLASSES') || c.includes('NO_DEVICE') || c.includes('NOT_CONNECTED'))
    return 'I can’t find your glasses. Make sure they’re connected in the Meta AI app, then try again.';
  if (c.includes('NO_ELIGIBLE_DEVICE') || c.includes('ELIGIBLE'))
    // Honest on both causes: not-connected OR this build isn’t on Meta’s glasses-preview allowlist yet.
    return 'No eligible glasses found. Connect your Ray-Bans in the Meta AI app first — if they’re already connected, this build isn’t approved for the glasses preview yet.';
  if (c.includes('APPLICATION_ID') || m.includes('application id') || m.includes('app id'))
    return 'Glasses aren’t configured in this build yet (missing app registration). This one’s on us — it needs a new build.';
  if (c.includes('PERMISSION') || m.includes('permission'))
    return 'The Meta app hasn’t granted camera access to the glasses. Check permissions in the Meta AI app, then try again.';
  if (c.includes('SESSION') || c.includes('START_FAILED') || c.includes('DAT_SESSION_FAILED'))
    return 'Couldn’t start the glasses session. Open the Meta AI app so the glasses are active, then try the toggle again.';
  if (c.includes('NOT_AVAILABLE') || m.includes('not available'))
    return 'Glasses aren’t available on this build yet — using the phone/cloud features instead.';
  // Unknown code — say something human, keep the code out of the user's face (it's in the log).
  return 'I couldn’t connect to the glasses. Make sure the Meta AI app is open with them connected, then try again.';
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
  // 2026-07-30 (audit #8) — an EXPLICIT stop must cancel any pending voice-coordination RESUME, or a
  // stream the user just turned off silently restarts VOICE_RESUME_DELAY_MS later (and leaves pausedByVoice
  // stuck true, blocking the stale-probe). Clear the timer + reset the flag on every stop.
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  pausedByVoice = false;
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

// 2026-07-11 — the real Android DAT module (v0.8) is now compiled in, so
// `available` reflects actual native-module presence again (NativeMod !== null).
// The stub that forced this false is gone. `connected`/`streaming` still start
// false and only flip once a session/first-frame lands. On a build WITHOUT the
// module (e.g. web, or an old build), NativeMod is null → available stays false.
let currentStatus: GlassesStatus = {
  available: NativeMod !== null,
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
    // 2026-07-23 — don't flag "stale" while we've intentionally paused the stream for caddie audio
    // (no frames arrive during the pause by design); the resume re-arms fresh frames.
    if (pausedByVoice) return;
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
  // 2026-07-30 (audit #21) — skip while paused for caddie audio: currentStatus.streaming stays true
  // during a voice pause, so a background transition would stop+start the stream and fight the pause.
  if (!NativeMod || !currentStatus.streaming || pausedByVoice) return;
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

/**
 * 2026-08-19 — forward an inbound deep link to the DAT SDK so pairing can finish.
 *
 * DAT's handshake is a ROUND TRIP: we deeplink into the Meta AI app, the wearer consents there, and
 * the Meta AI app calls back into us. Until that callback URL reaches the SDK, registration stays in
 * `.registering` and no device session can ever be created — the exact shape of "I consented and the
 * glasses still don't connect". Nothing in this app was forwarding it.
 *
 * Safe to call with EVERY inbound link: the SDK self-detects its own URLs and declines the rest, so
 * our own `smartplay://` routes pass straight through untouched. Never throws — a failure here must
 * not break normal deep-link routing.
 *
 * Returns whether the SDK claimed the URL, and logs it, because a silent no-op is precisely how the
 * missing callback stayed invisible.
 */
export async function handleGlassesAppLink(url: string | null | undefined): Promise<boolean> {
  if (!url || !NativeMod?.handleAppLink) return false;
  try {
    const res = await NativeMod.handleAppLink(url);
    devLog(`[mwdat-bridge] app link ${res?.handled ? 'CLAIMED by DAT' : 'not a DAT link'} → ${url}`);
    return !!res?.handled;
  } catch (e) {
    devLog('[mwdat-bridge] app-link forward failed (non-fatal): ' + String(e));
    return false;
  }
}

/**
 * Attach the inbound-link listener. Call once from the app root. Handles BOTH legs:
 * the cold-start URL (the app was killed while the wearer was consenting in the Meta AI app — the
 * common case, since consent leaves our process) and links delivered while we're already running.
 */
export function startGlassesLinkListener(): () => void {
  if (!NativeMod?.handleAppLink) return () => {};
  let cancelled = false;
  // Cold start: the app was launched BY the callback, so the URL is waiting rather than arriving.
  void Linking.getInitialURL()
    .then((initial) => { if (!cancelled) void handleGlassesAppLink(initial); })
    .catch(() => undefined);
  const sub = Linking.addEventListener('url', ({ url }) => { void handleGlassesAppLink(url); });
  devLog('[mwdat-bridge] glasses app-link listener attached');
  return () => { cancelled = true; sub.remove(); };
}
