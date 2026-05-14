import { Linking } from 'react-native';
import { speak, stopSpeaking, isSpeaking, captureUtterance, playLocalFile, stopCapture } from './voiceService';
import { getDialog } from './dialogEngine';
import { getTrustLevel } from './trustLevelService';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { voiceCommandRouter } from './intents';
import { subscribeEarbudTap } from './earbudControl';
import { getCurrentRoute } from './audioRoutingService';
import { routeQuery } from './responseRouter';
import { getClipForCategory, getFallbackTextForCategory } from './fillerLibrary';
import { getActiveSurface } from './activeSurfaceRegistry';
import type { AppContext } from '../types/voiceIntent';
import { buildFullPracticeContext } from './tutorialContext';

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
  console.log(`[path4:voice] tap_open trust=${getTrustLevel()}`);

  // Audio routing safety: if route is the phone speaker AND the user hasn't
  // opted into "Voice on phone speaker", suppress TTS — show text instead.
  // Phase V.7+ — Quiet (L1) is also a hard suppress for the spoken opener
  // and any filler. The user gets text-only feedback at L1; voice is only
  // for L2+. This closes the leak where "Yeah?" played on every earbud tap.
  const route = getCurrentRoute();
  const allowPhoneSpeaker = (settings as unknown as { voiceOnPhoneSpeaker?: boolean }).voiceOnPhoneSpeaker === true;
  const trustLevel = getTrustLevel();
  const ttsAllowed =
    settings.voiceEnabled &&
    trustLevel !== 1 &&
    (route !== 'phone_speaker' || allowPhoneSpeaker);

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
  console.log('[audit:voice] listening engaged');
  let utterance: string | null = null;
  try {
    const captureP = captureUtterance(8_000, apiUrl, settings.language);
    cancelMic = () => {
      // Phase V.7 — real cancel via stopCapture; the recording stops
      // immediately and captureUtterance resolves with null.
      void stopCapture().catch(() => {});
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
      body: JSON.stringify({ text: utterance, voiceGender: settings.voiceGender ?? 'male' }),
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
      trust_level: getTrustLevel() as 1 | 2 | 3 | 4 | 5,
      topic: intent.parameters?.query_topic ?? null,
    });
    let fillerP: Promise<void> = Promise.resolve();
    let t_filler_start: number | null = null;
    if (decision.filler && ttsAllowed) {
      const clip = getClipForCategory(decision.filler);
      if (clip) {
        t_filler_start = Date.now();
        fillerP = playLocalFile(clip.audio_path, clip.duration_ms).catch(() => {});
      } else {
        // Phase V.7 — local audio cache not ready (e.g. just after a
        // voiceHash bump). Fall through to live TTS so the user hears a
        // bridge instead of dead silence between intent and response.
        const fallbackText = getFallbackTextForCategory(decision.filler);
        if (fallbackText) {
          t_filler_start = Date.now();
          fillerP = speak(fallbackText, settings.voiceGender, settings.language, apiUrl).catch(() => {});
        }
      }
    }

    // Phase BH — in-round diagnostic Coach. When the user describes a
    // multi-shot pattern and asks "why", route to /api/kevin Sonnet with
    // register='coach' override + inRoundDiagnostic flag. The Coach
    // prompt sub-branch returns ~30-45s of pattern reasoning.
    if (intent.intent_type === 'in_round_diagnostic' && round.isRoundActive) {
      const patternText = (intent.parameters?.pattern_text as string | undefined) ?? utterance;
      const wantsCard = intent.parameters?.wants_card === true;
      try {
        const profile = require('../store/playerProfileStore').usePlayerProfileStore.getState();
        const settingsStore = require('../store/settingsStore').useSettingsStore.getState();
        const apiUrlBody = {
          message: patternText,
          language: settingsStore.language ?? 'en',
          playerName: profile.name ?? '',
          firstName: profile.firstName ?? '',
          handicap: profile.handicap ?? 18,
          dominantMiss: profile.dominantMiss ?? null,
          missType: profile.missType ?? null,
          experienceContext: profile.experienceContext ?? null,
          isRoundActive: true,
          currentHole: round.currentHole,
          activeCourse: round.activeCourse,
          courseHoles: round.courseHoles,
          recentShots: round.shots.slice(-10),
          kevinContext: profile.kevinContext ?? null,
          persistentPatterns: profile.persistentPatterns ?? null,
          practice_context: buildFullPracticeContext(),
          register: 'coach',
          inRoundDiagnostic: true,
          voiceGender: settingsStore.voiceGender ?? 'male',
          // PGA HOPE follow-up — persona, intensity dial, Tank soft-intro.
          persona: settingsStore.caddiePersonality,
          personaIntensity: settingsStore.personaIntensity?.[settingsStore.caddiePersonality] ?? 100,
          tankSoftIntro: settingsStore.tankSoftIntro,
        };
        await fillerP;
        const r = await fetch(`${apiUrl}/api/kevin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiUrlBody),
        });
        if (r.ok) {
          const j = await r.json() as { text?: string; audioBase64?: string };
          if (j.text && ttsAllowed) {
            await speak(j.text, settings.voiceGender, settings.language, apiUrl, { userInitiated: true });
          }
          // If user wanted card, push to the new diagnostic-card screen
          // with the reasoning text as a param so it can render +
          // re-play audio without re-querying Sonnet.
          if (wantsCard && j.text) {
            try {
              const router = require('expo-router').router;
              router.push({
                pathname: '/diagnostic-card',
                params: { pattern: patternText, reasoning: j.text },
              });
            } catch (e) { console.log('[listeningSession] diagnostic-card nav failed', e); }
          }
        }
      } catch (e) {
        console.log('[listeningSession] in_round_diagnostic failed', e);
      }
      state = 'idle';
      return;
    }

    // Phase BS audit (2026-05-14) — small-talk fallback. The voice-intent
    // classifier returns intent_type === 'unknown' for greetings and
    // chit-chat ("how are you", "thanks", "what's up"). Previously the
    // session fell through with no voice_response, producing a silent
    // drop after the filler played — users assumed Kevin didn't hear them
    // and the magic moment was gone. Now: if intent has a clarifying
    // follow_up_question, speak that. Otherwise route the raw utterance
    // to /api/kevin for a conversational reply.
    if (!voiceCommandRouter.getHandler(intent.intent_type) && state === 'responding') {
      const responseAllowed =
        settings.voiceEnabled &&
        (route !== 'phone_speaker' || allowPhoneSpeaker);
      await fillerP;
      if (responseAllowed) {
        if (intent.follow_up_question) {
          await speak(intent.follow_up_question, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
            .catch((e) => console.log('[listeningSession] follow_up speak failed', e));
        } else {
          try {
            const chatRes = await fetch(`${apiUrl}/api/kevin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: utterance,
                language: settings.language,
                currentHole: round.isRoundActive ? round.currentHole : null,
                currentYardage: round.currentYardage ?? null,
                activeCourse: round.activeCourse,
                isRoundActive: round.isRoundActive,
              }),
            });
            if (chatRes.ok) {
              const chatJson = await chatRes.json();
              const reply = typeof chatJson?.response === 'string' ? chatJson.response : null;
              if (reply) {
                await speak(reply, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
                  .catch((e) => console.log('[listeningSession] chat fallback speak failed', e));
              }
            }
          } catch (e) {
            console.log('[listeningSession] chat fallback fetch failed', e);
          }
        }
      }
      state = 'idle';
      return;
    }

    const handler = voiceCommandRouter.getHandler(intent.intent_type);
    if (handler) {
      // Phase V.6 — race the handler against filler completion. If the
      // handler hasn't resolved by the time the first filler ends, play
      // an extension filler ('Still working through this...') and re-check.
      // Up to 2 extensions bridge ~5-8s of additional perceived latency
      // before the real response. Vision queries can still take ~13s; the
      // user no longer hears dead silence between 'Let me see...' and the
      // response.
      let resultReady = false;
      const handlerP = handler.execute(intent, ctx)
        .finally(() => { resultReady = true; });

      await fillerP;

      if (ttsAllowed) {
        for (let i = 0; i < 2 && !resultReady && state === 'responding'; i++) {
          const ext = getClipForCategory('extension');
          if (ext) {
            await playLocalFile(ext.audio_path, ext.duration_ms).catch(() => {});
          } else {
            // Phase V.7 — same fallback as primary filler.
            const extText = getFallbackTextForCategory('extension');
            if (!extText) break;
            await speak(extText, settings.voiceGender, settings.language, apiUrl).catch(() => {});
          }
        }
      }

      const result = await handlerP;
      const t_response_start = Date.now();
      // Phase V.7+ — the response is user-initiated (mic-tap reply), so it
      // speaks at L1 too via { userInitiated: true }. Opener + filler stay
      // suppressed at L1 above. Still respect voiceEnabled + phone-speaker
      // route via isVoiceAllowed inside speak().
      const responseAllowed =
        settings.voiceEnabled &&
        (route !== 'phone_speaker' || allowPhoneSpeaker);
      if (result.voice_response && responseAllowed) {
        console.log('[ttfa]', JSON.stringify({
          intent: intent.intent_type,
          topic: intent.parameters?.query_topic ?? null,
          filler: decision.filler,
          intent_ms: t_intent - t0,
          filler_start_ms: t_filler_start != null ? t_filler_start - t0 : null,
          response_start_ms: t_response_start - t0,
        }));
        await speak(result.voice_response, settings.voiceGender, settings.language, apiUrl, { userInitiated: true });
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
  console.log('[path4:voice] close');
  // Phase BM — always stopSpeaking (drops the isSpeaking() guard). The guard
  // missed the gap between speechId++ and Sound.createAsync returning where
  // currentSound is still null but a TTS fetch is in-flight; a session-close
  // tap during that window otherwise left the pending utterance to play.
  void stopSpeaking().catch(() => {});
  // Cancel mic if listening (Phase V.7 — now actually stops the recording)
  if (cancelMic) {
    try { cancelMic(); } catch {}
    cancelMic = null;
  }
  // Belt + suspenders: ensure no orphan recording survives.
  void stopCapture().catch(() => {});
  state = 'idle';
}
