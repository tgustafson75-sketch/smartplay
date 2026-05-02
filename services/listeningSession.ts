import { Linking } from 'react-native';
import { speak, stopSpeaking, isSpeaking, captureUtterance, playLocalFile } from './voiceService';
import { getDialog } from './dialogEngine';
import { getTrustLevel } from './trustLevelService';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { voiceCommandRouter } from './intents';
import { subscribeEarbudTap } from './earbudControl';
import { getCurrentRoute } from './audioRoutingService';
import { routeQuery } from './responseRouter';
import { getClipForCategory } from './fillerLibrary';
import { getActiveSurface } from './activeSurfaceRegistry';
import type { AppContext } from '../types/voiceIntent';

// ─── External URL allowlist ───────────────────────────────────────────────────
// Audit P1 follow-up: server tool_use responses can include open_url actions.
// Internal routes (starting with '/') are dispatched via router.push as before.
// External (http(s)://) URLs go through isAllowedExternalUrl first to prevent
// open-redirect via a compromised / malformed server response.
const ALLOWED_HOSTS = [
  'smartplaycaddie.com',
  'support.smartplaycaddie.com',
  'apps.apple.com',
  'play.google.com',
  'golfcourseapi.com',
];

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(
      allowed => host === allowed || host.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

/**
 * Phase O — Listening session orchestrator.
 *
 * Single-tap on earbud (or any other "talk" trigger) opens a listening
 * session: Kevin speaks an opener appropriate to the current role + trust
 * level, then opens the mic for an utterance, parses through the existing
 * voice intent pipeline, and speaks the response.
 *
 * Tap again at any phase closes the session (interrupts TTS, cancels mic
 * capture).
 *
 * Input source-agnostic: subscribes to `earbudControl` for taps but the
 * same `toggle()` API can be invoked by any other source — on-screen
 * button, voice command, future watch tap.
 */

type SessionState = 'idle' | 'opening' | 'listening' | 'thinking' | 'responding';

let state: SessionState = 'idle';
let cancelMic: (() => void) | null = null;
let unsubEarbud: (() => void) | null = null;

/**
 * Start listening for earbud taps (called once on app boot or by the first
 * surface that wants to receive them).
 */
export function initListeningSession(): void {
  if (unsubEarbud) return;
  unsubEarbud = subscribeEarbudTap(() => { void toggle(); });
}

export function getSessionState(): SessionState {
  return state;
}

/**
 * Toggle the listening session. Open if idle; close if any other state.
 */
export async function toggle(): Promise<void> {
  if (state === 'idle') {
    await openSession();
  } else {
    closeSession();
  }
}

/**
 * Pick an opener based on the current role (Caddie if active round, Coach if
 * Practice surface, Psychologist for between-shot walks) and trust level.
 * Returns the spoken opener text.
 */
function pickOpener(): string {
  const round = useRoundStore.getState();
  const trustLevel = getTrustLevel();
  const surface = getActiveSurface();

  // Phase R — Role inference now reads activeSurfaceRegistry for richer
  // routing. Arena → Psychologist (between-shot conversation register).
  // Active round → Caddie. Otherwise Coach.
  const role: 'caddie' | 'coach' | 'psychologist' =
    surface === 'arena' ? 'psychologist' :
    round.isRoundActive ? 'caddie' : 'coach';

  // Trust-level-aware opener selection. L1 = terse "Yeah?"; L4 = engaged.
  if (trustLevel === 1) return 'Yeah?';

  return getDialog(role, 'earbud_open');
}

async function openSession() {
  state = 'opening';
  const settings = useSettingsStore.getState();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // Audio routing safety: if route is the phone speaker AND the user hasn't
  // opted into "Voice on phone speaker", suppress TTS — show text instead.
  const route = getCurrentRoute();
  const allowPhoneSpeaker = (settings as unknown as { voiceOnPhoneSpeaker?: boolean }).voiceOnPhoneSpeaker === true;
  const ttsAllowed = settings.voiceEnabled && (route !== 'phone_speaker' || allowPhoneSpeaker);

  // Phase 1 — speak opener
  const opener = pickOpener();
  if (ttsAllowed && opener) {
    try {
      await speak(opener, settings.voiceGender, settings.language, apiUrl);
    } catch (e) {
      console.log('[listeningSession] opener TTS failed', e);
    }
    if (state !== 'opening') return;  // user cancelled mid-opener
  }

  // Phase 2 — open mic for utterance
  state = 'listening';
  let utterance: string | null = null;
  try {
    const captureP = captureUtterance(8_000, apiUrl, settings.language);
    cancelMic = () => {
      // captureUtterance doesn't expose a native cancel; the timeout will
      // fire. We simply stop processing the result if state changes.
    };
    utterance = await captureP;
  } catch (e) {
    console.log('[listeningSession] capture failed', e);
  }
  cancelMic = null;
  if (state !== 'listening') return;

  if (!utterance || !utterance.trim()) {
    state = 'idle';
    return;
  }

  // Phase 3 — classify + respond
  state = 'thinking';
  // Phase P — TTFA instrumentation. t0 = capture end.
  const t0 = Date.now();
  try {
    const round = useRoundStore.getState();
    const ctx: AppContext = {
      active_screen: round.isRoundActive ? 'caddie' : 'swinglab',
      active_round: round.isRoundActive
        ? {
            course: round.activeCourse,
            mode: round.mode,
            holesPlayed: round.getHolesPlayed(),
            totalScore: round.getTotalScore(),
            scoreVsPar: round.getScoreVsPar(),
          }
        : null,
      current_hole: round.isRoundActive ? round.currentHole : null,
      recent_shots: round.shots.slice(-5),
      trust_spectrum_level: getTrustLevel(),
    };

    // Parse intent via the existing classifier
    const parseRes = await fetch(`${apiUrl}/api/voice-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: utterance }),
    });
    if (!parseRes.ok) {
      state = 'idle';
      return;
    }
    const intent = await parseRes.json();
    const t_intent = Date.now();
    if (state !== 'thinking') return;

    state = 'responding';

    // Phase P — fire filler (if router prescribes one) in parallel with handler.
    // playLocalFile is non-blocking start; we await it later before speak() so
    // the real response doesn't cancel the filler mid-clip.
    const role: 'caddie' | 'coach' | 'psychologist' = round.isRoundActive ? 'caddie' : 'coach';
    const decision = routeQuery(intent.intent_type, {
      role,
      trust_level: getTrustLevel() as 1 | 2 | 3 | 4,
      topic: intent.parameters?.query_topic ?? null,
    });
    let fillerP: Promise<void> = Promise.resolve();
    let t_filler_start: number | null = null;
    if (decision.filler && ttsAllowed) {
      const clip = getClipForCategory(decision.filler);
      if (clip) {
        t_filler_start = Date.now();
        fillerP = playLocalFile(clip.audio_path).catch(() => {});
      }
    }

    const handler = voiceCommandRouter.getHandler(intent.intent_type);
    if (handler) {
      const result = await handler.execute(intent, ctx);
      // Wait for the filler to finish before the real response so transitions
      // are clean rather than cut. If no filler fired, this resolves instantly.
      await fillerP;
      const t_response_start = Date.now();
      if (result.voice_response && ttsAllowed) {
        console.log('[ttfa]', JSON.stringify({
          intent: intent.intent_type,
          topic: intent.parameters?.query_topic ?? null,
          filler: decision.filler,
          intent_ms: t_intent - t0,
          filler_start_ms: t_filler_start != null ? t_filler_start - t0 : null,
          response_start_ms: t_response_start - t0,
        }));
        await speak(result.voice_response, settings.voiceGender, settings.language, apiUrl);
      }
      // Phase R/S — dispatch tool_action.open_url. Internal routes (e.g.
      // swing library jumps, SmartVision opens) go through router.push as
      // before. External URLs (http/https) are allowlisted to prevent
      // open-redirect through a compromised / malformed server response.
      const ta = result.tool_action;
      if (ta && (ta as { type?: string }).type === 'open_url') {
        const url = (ta as { type: 'open_url'; url: string }).url;
        if (typeof url !== 'string' || url.length === 0) {
          console.warn('[listeningSession] tool_action.open_url missing url');
        } else if (url.startsWith('/')) {
          try {
            const router = require('expo-router').router;
            router.push(url);
          } catch (e) {
            console.log('[listeningSession] nav failed', e);
          }
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
          if (isAllowedExternalUrl(url)) {
            void Linking.openURL(url).catch((e) => {
              console.log('[listeningSession] external open failed', e);
            });
          } else {
            console.warn('[listeningSession] Rejected non-allowlisted URL:', url);
          }
        } else {
          console.warn('[listeningSession] Rejected unsupported URL scheme:', url);
        }
      }
    }
  } catch (e) {
    console.log('[listeningSession] respond failed', e);
  }

  state = 'idle';
}

function closeSession() {
  // Stop any in-flight TTS
  if (isSpeaking()) {
    void stopSpeaking().catch(() => {});
  }
  // Cancel mic if listening
  if (cancelMic) {
    try { cancelMic(); } catch {}
    cancelMic = null;
  }
  state = 'idle';
}
