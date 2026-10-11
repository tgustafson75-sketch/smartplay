/**
 * 2026-10-10 — Sightline slice 1: one hands-free loop between the Meta glasses and Kevin, on Android,
 * in the glasses dev variant only (services/glassesGate). It REUSES Kevin's paths; it adds none:
 *
 *   "Hey Meta, start SmartPlay Caddie"  → the DAT voice-invocation stream (native, answered exactly once)
 *                                         → the Caddie screen + Kevin listening through the SAME
 *                                           push-to-talk chokepoint the earbud tap uses
 *                                           (listeningSession.toggle).
 *   "what do you see" / "read my lie"   → with a glasses session active, ONE still from the glasses
 *                                         (stream started for the capture, stopped right after — battery
 *                                         and heat) → enrichedLieAnalysis, the same /api/lie-analysis
 *                                         vision path TightLie uses → spoken through speak().
 *
 * No new endpoint, no on-device model, no banner or toast. Errors go to the dev log and the issue log,
 * each with its own code.
 */
import { isGlassesSurfaceEnabled } from './glassesGate';
import { devLog } from './devLog';

type MetaWearablesNative = import('../glasses-modules/meta-wearables').MetaWearablesNative;

/** The glasses module is loaded here, on first use, never at the top of a file a store build bundles. */
function metaWearables(): MetaWearablesNative | null {
  try {
    return (require('../glasses-modules/meta-wearables') as typeof import('../glasses-modules/meta-wearables')).metaWearables();
  } catch { return null; }
}

let started = false;
let sessionActive = false;
let lastStreamState = 'STOPPED';
const subscriptions: { remove(): void }[] = [];

function logError(kind: string, code: unknown): void {
  devLog(`[sightline] ${kind}: ${String(code)}`);
  try {
    (require('../store/issueLogStore') as typeof import('../store/issueLogStore')).useIssueLogStore.getState()
      .addAppEvent('sightline_error', { kind, code: String(code ?? '') }, 'diag');
  } catch { /* the log is a courtesy */ }
}

/** Is a glasses session up (so a "what do you see" should come from the glasses, not the phone)? */
export function glassesSessionActive(): boolean {
  return started && sessionActive && metaWearables() != null;
}

async function ensureSession(mw: MetaWearablesNative): Promise<void> {
  if (sessionActive) return;
  const reg = mw.getRegistrationState();
  // REGISTERING = a hand-off to the Meta AI app is already in flight (the SDK reverts it after 30 s).
  // Registering again from here is what bounced the player between the two apps.
  if (reg === 'REGISTERING') return;
  if (reg !== 'REGISTERED') { mw.register(); return; }   // Meta AI app hands back through the SDK's intent
  try {
    await mw.startSession();
    if (!started) { mw.stopSession(); return; }   // the switch went off while the session was starting
    sessionActive = true;
  } catch (e) { logError('session', (e as { code?: string })?.code ?? e); }
}

/**
 * Boot hook (app/_layout): start now if allowed, start when the remote switch turns on, and STOP a
 * running session when it turns off — the kill switch kills, it does not just stop new starts.
 */
export function watchSightline(): () => void {
  const sync = () => { if (isGlassesSurfaceEnabled()) startSightline(); else stopSightline(); };
  sync();
  try {
    const { useFlagStore } = require('../store/flagStore') as typeof import('../store/flagStore');
    return useFlagStore.subscribe(sync);
  } catch { return () => {}; }
}

/** Tear down: listeners off, the session (and with it the stream) stopped. A no-op when not started. */
export function stopSightline(): void {
  if (!started) return;
  started = false;
  for (const sub of subscriptions.splice(0)) { try { sub.remove(); } catch { /* already gone */ } }
  const mw = metaWearables();
  if (mw && sessionActive) {
    try { mw.stopSession(); } catch (e) { logError('stop_session', e); }   // native stopSession stops the stream too
  }
  sessionActive = false;
  lastStreamState = 'STOPPED';
}

/** A no-op outside the glasses variant or with the switch off. */
export function startSightline(): void {
  if (started || !isGlassesSurfaceEnabled()) return;
  const mw = metaWearables();
  if (!mw) return;
  started = true;
  const on = (m: MetaWearablesNative, ev: string, cb: (p: Record<string, unknown>) => void) => { subscriptions.push(m.addListener(ev, cb)); };

  on(mw, 'onVoiceInvocation', () => {
    void (async () => {
      try {
        (require('./safeBack') as typeof import('./safeBack')).goToTab('caddie');
        const ls = await import('./listeningSession');
        if (ls.getSessionState() === 'idle') await ls.toggle();   // the earbud tap's own path
      } catch (e) { logError('voice_invocation', e); }
    })();
  });
  on(mw, 'onVoiceInvocationError', (p) => logError('voice_invocation_error', p.code));
  on(mw, 'onSessionError', (p) => {
    logError('session_error', p.code);
    if (['SESSION_ENDED_BY_DEVICE', 'DEVICE_DISCONNECTED', 'SESSION_ALREADY_STOPPED'].includes(String(p.code))) sessionActive = false;
  });
  on(mw, 'onStreamState', (p) => { lastStreamState = String(p.state ?? lastStreamState); });
  on(mw, 'onStreamError', (p) => logError('stream_error', p.code));
  on(mw, 'onRegistrationState', (p) => { if (p.state === 'REGISTERED') void ensureSession(mw); });
  void ensureSession(mw);
}

async function waitForStreaming(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (lastStreamState === 'STREAMING' || lastStreamState === 'STARTED') return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

let cameraPermissionAsked = false;

/**
 * Read the shot through the glasses: one still → the TightLie vision path → spoken. Returns true when it
 * handled the request (the caller then does NOT open the phone camera), false to fall back to the phone.
 */
export async function readThroughGlasses(): Promise<boolean> {
  const mw = metaWearables();
  if (!mw || !glassesSessionActive()) return false;
  try {
    if (!cameraPermissionAsked) {
      cameraPermissionAsked = true;
      const status = await mw.requestCameraPermission();
      if (status !== 'GRANTED') { logError('camera_permission', status); return false; }
    }
    await mw.startStream({ quality: 'LOW', fps: 2 });
    let uri: string;
    try {
      if (!(await waitForStreaming(5_000))) { logError('stream', 'NOT_STREAMING'); return false; }
      uri = await mw.capturePhoto();
    } finally {
      mw.stopStream();   // capture on demand only — never left streaming (battery, heat)
    }
    const FS = await import('expo-file-system/legacy');
    const imageBase64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    const settings = (require('../store/settingsStore') as typeof import('../store/settingsStore')).useSettingsStore.getState();
    const { enrichedLieAnalysis } = await import('./lieAnalysisService');
    const read = await enrichedLieAnalysis({ imageBase64, imageMediaType: 'image/jpeg', voiceGender: settings.voiceGender === 'female' ? 'female' : 'male' });
    if (!read?.voice_summary) return false;
    const { speak } = await import('./voiceService');
    const { getApiBaseUrl } = await import('./apiBase');
    await speak(read.voice_summary, settings.voiceGender, settings.language, getApiBaseUrl(), { userInitiated: true });
    return true;
  } catch (e) {
    logError('read', (e as { code?: string })?.code ?? e);
    return false;
  }
}
