import { Vibration } from 'react-native';
import { BRAIN_FETCH_TIMEOUT_MS as KEVIN_FETCH_TIMEOUT_MS } from '../constants/voiceTimeouts';
import { speak, speakFromBase64, stopSpeaking, isSpeaking, captureUtterance, playLocalFile, stopCapture } from './voiceService';
import { conversationalBrainTurn } from './conversationalBrain';
import { prewarmVoice } from './voiceWarmup';
import { getDialog } from './dialogEngine';
import { getTrustLevel } from './trustLevelService';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { voiceCommandRouter } from './intents';
import { subscribeEarbudTap } from './earbudControl';
import { isSmartMotionRecording, emitSmartMotionCommand } from './smartMotionRecordBus';
import { getCurrentRoute } from './audioRoutingService';
import { routeQuery } from './responseRouter';
import { getClipForCategory, getFallbackTextForCategory } from './fillerLibrary';
import { getActiveSurface } from './activeSurfaceRegistry';
import { precheckLocalIntent } from './localIntentPrecheck';
import { tryLocalReply } from './localStatusResponder';
import { useVoiceHitRateStore } from '../store/voiceHitRateStore';
import type { AppContext, VoiceIntent } from '../types/voiceIntent';
import { buildFullPracticeContext } from './tutorialContext';
import { screenContextForPrompt } from './screenContext';
import { getApiBaseUrl } from './apiBase';

// 2026-07-04 (clean-audit) — the external-URL allowlist moved to
// services/voice/conversationalToolDispatch.ts (the one tool dispatcher);
// all tool_action dispatch on this path now routes through it.

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

const INTENT_FETCH_TIMEOUT_MS = 8_000;
// 2026-06-23 (smoke-test) — match useVoiceCaddie BRAIN_TIMEOUT_MS (30s) so the
// active-listen path doesn't abort a healthy-but-slow brain the tap path would keep.

// 2026-06-16 (Tim — local-first, "on course no wifi" + speed) — localStatusResponder
// query types that are DETERMINISTIC + accuracy-safe to answer INSTANTLY from device
// state, skipping the cloud classify + brain entirely (and their network round-trips).
// Promoted to PRIMARY (answered before the cloud) when the local precheck misses.
// Intentionally EXCLUDED: 'hole_info' (strategic "what's the play" — the brain's
// narrative is richer online; localStatusResponder stays its OFFLINE fallback), and
// 'no_round'/anything not an answer. This only adds an instant path — it never blocks
// the cloud for asks not in this set, so nothing existing is downgraded.
// 2026-07-03 (Tim — "AI front and center") — dropped the JUDGMENT types
// (club_recommend / plays_like / reach) from the instant local-primary set so they
// route to the caddie brain (the AI leads the read). They remain the OFFLINE safety
// net via answerOffline→tryLocalReply. Pure facts still answer instantly + local.
const LOCAL_PRIMARY_TYPES: ReadonlySet<string> = new Set([
  'yardage_middle', 'yardage_front', 'yardage_back', 'course_memory',
  'wind', 'last_shot',
  'score_round', 'hole_current', 'par_current', 'holes_left',
  'tee_box', 'course_name', 'club_current', 'handicap',
  'routine_saved', 'routine_recall',
]);
const LOCAL_REPLY_LANGS = ['en', 'es', 'zh'] as const;

let state: SessionState = 'idle';
let cancelMic: (() => void) | null = null;
let unsubEarbud: (() => void) | null = null;

// 2026-06-04 — Re-tap lock during the in-flight processing window
// (opening → listening → thinking). Prevents currentSpeechId
// preemption when the user double-taps during the 6-10s pipeline
// (mic record + transcribe + intent classify + brain + TTS).
// Cleared automatically by setSessionStateMirror when state →
// 'responding' (Kevin starts speaking — user can interrupt) or
// 'idle' (done / error / close). Exported getter for non-React
// consumers; React UI should subscribe to listeningSessionStore.state
// directly for reactive updates.
let sessionInFlight = false;
// 2026-06-16 (Tim — earbud-tap-to-stop) — timestamp of the last tap that STOPPED a
// Smart Motion recording; toggles within the cooldown are swallowed so the duplicate
// tap signal (immediate sub + ~350ms pattern) can't open listening over the just-
// freed mic.
let recordingStopTapAt = 0;
const RECORDING_STOP_TAP_COOLDOWN_MS = 1500;
export function isSessionInFlight(): boolean {
  return sessionInFlight;
}

// 2026-05-26 — Fix AP Phase 1: defensive time-gated dormancy. Safety
// net that guarantees the listening session can't get stuck in any
// non-idle state for more than DORMANCY_MAX_MS. Protects against:
//   - Network hangs that leave 'thinking' stuck
//   - Audio session that didn't close cleanly on a response
//   - captureUtterance throws that bypass the normal idle transition
//   - The user walking away mid-session and the phone never closing
//
// Approach is conservative: a single watchdog timer that rearms on
// every state change. As long as the session keeps moving (idle →
// opening → listening → thinking → responding → idle), each transition
// resets the clock. If state stays stuck for the full window without
// transitioning, the watchdog fires closeSession() with a logged
// reason so post-mortem is honest.
//
// 90s window chosen to accommodate the longest legitimate path:
// listening (up to 12s) + classifier (~3s) + brain (up to 30s) +
// TTS playback (long replies can hit 40-50s for Tank/Serena multi-
// sentence answers). 90s comfortably covers that with headroom.
const DORMANCY_MAX_MS = 90_000;
let dormancyTimer: ReturnType<typeof setTimeout> | null = null;

function clearDormancyTimer(): void {
  if (dormancyTimer) {
    clearTimeout(dormancyTimer);
    dormancyTimer = null;
  }
}

function armDormancyTimer(forState: SessionState): void {
  clearDormancyTimer();
  if (forState === 'idle') return;
  dormancyTimer = setTimeout(() => {
    // Re-check current state at firing — if a state change crossed
    // with the timer (race), don't slam idle on a session that just
    // finished and re-armed.
    if (state === 'idle') return;
    console.warn(
      `[listeningSession] dormancy timeout in state='${state}' after ${DORMANCY_MAX_MS}ms — force-closing`,
    );
    try { closeSessionInternal('dormancy_timeout'); } catch (e) {
      console.log('[listeningSession] dormancy force-close threw', e);
    }
  }, DORMANCY_MAX_MS);
}

/**
 * Helper: every internal state change goes through this so the
 * listeningSessionStore (subscribed by BrandHeaderRow + other UI
 * surfaces) sees every transition. Without this mirror the badge halo
 * stays dark even when listening is active.
 *
 * 2026-05-26 — also arms/clears the dormancy watchdog so the session
 * can't get stuck in non-idle longer than DORMANCY_MAX_MS.
 */
// path4 response-phase boundary timing. Set at capture end so the
// response_start marker (emitted from the state chokepoint below) can
// report ms-since-capture across every response branch.
let lastCaptureEndMs: number | null = null;

function setSessionStateMirror(next: SessionState): void {
  const prev = state;
  state = next;
  // [path4:voice] response phase boundaries. Centralised here (not at the
  // ~5 scattered speak() sites) so every branch — diagnostic, small-talk,
  // handler, abort — emits exactly one start/end pair and the markers can't
  // drift out of sync with the flow. The precise audio-start timing still
  // lives in the [ttfa] line; this is the coarse grep boundary for MIN VERIFY.
  if (next === 'responding' && prev !== 'responding') {
    console.log(`[path4:voice] response_start ms_since_capture=${lastCaptureEndMs != null ? Date.now() - lastCaptureEndMs : -1}`);
  } else if (next === 'idle' && prev === 'responding') {
    console.log('[path4:voice] response_end');
  }
  // 2026-06-04 — Clear in-flight lock when the processing window
  // ends. 'responding' = Kevin starts speaking (user can interrupt
  // by tapping which routes through closeSession). 'idle' = the
  // session is fully done OR an error/close path returned.
  if (next === 'responding' || next === 'idle') {
    sessionInFlight = false;
  }
  armDormancyTimer(next);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useListeningSessionStore } = require('../store/listeningSessionStore');
    useListeningSessionStore.getState().setState(next);
  } catch (e) {
    console.log('[listeningSession] state mirror failed', e);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

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

export function isActiveListeningEnabled(): boolean {
  return useSettingsStore.getState().autoListenEnabled;
}

/**
 * Toggle the listening session. Open if idle; close if any other state.
 */
export async function toggle(): Promise<void> {
  // 2026-06-16 (Tim — earbud-tap-to-stop) — if Smart Motion is actively RECORDING,
  // the camera owns the mic. A tap must STOP the capture, NOT open a listen session
  // (opening one races the camera's audio = "Only one Recording object" crash). This
  // is the single chokepoint: BOTH the boot-level earbud tap and handsFreeOrchestrator's
  // single-tap route through toggle(). After recording stops the mic frees and the
  // next tap opens listening normally.
  if (isSmartMotionRecording()) {
    recordingStopTapAt = Date.now();
    emitSmartMotionCommand('stop');
    return;
  }
  // 2026-06-16 (Tim) — a single tap reaches toggle() TWICE (the boot-level earbud
  // sub fires immediately; handsFreeOrchestrator's 'single' pattern fires ~350ms
  // later). Normally sessionInFlight dedupes that, but the recording-stop branch
  // above returns WITHOUT opening a session — so the 350ms follow-up would see
  // recording already stopped and open listening right over the just-freed mic.
  // Swallow toggles for a short window after a tap-stop (covers the pattern
  // follow-up + the camera's audio-session release).
  if (Date.now() - recordingStopTapAt < RECORDING_STOP_TAP_COOLDOWN_MS) return;
  // 2026-06-04 — Ignore re-tap during in-flight processing window.
  // See sessionInFlight comment above for rationale.
  if (sessionInFlight) return;
  if (state === 'idle') {
    sessionInFlight = true;
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

  // Trust-level-aware opener selection. L1 stays silent (gated below);
  // L2 = terse "Yeah?"; L3 = engaged.
  if (trustLevel === 1) return 'Yeah?';

  return getDialog(role, 'earbud_open');
}

// 2026-05-21 — Fix I: localized fallback message spoken when the caddie
// response path silently fails (non-2xx, empty body, network throw,
// handler exception). Replaces dead silence with an honest "having
// trouble" line so the user knows something went wrong instead of
// assuming the mic missed them. NOT a fabricated answer — only the
// error string is spoken. Same string is also returned server-side
// by api/kevin's outer catch (Fix I shape C) so the contract is
// consistent across all failure surfaces.
const FAILURE_FALLBACK: Record<string, string> = {
  en: "I'm having trouble connecting — try that again.",
  es: 'Tengo problemas para conectarme — inténtalo de nuevo.',
  zh: '我连接遇到问题——请再试一次。',
};
function failureFallbackFor(lang: string | null | undefined): string {
  const key = (lang ?? 'en').toLowerCase().slice(0, 2);
  return FAILURE_FALLBACK[key] ?? FAILURE_FALLBACK.en;
}

/**
 * Speak an honest "couldn't respond" message for the user's language
 * and pulse a short vibration, so dead silence never reads as broken.
 * Used by every silent-failure branch in this module (chat fallback
 * fetch errors, handler throws, outer catch). Cheap and idempotent —
 * the speak() call already serializes with stopSpeaking().
 */
export async function speakHonestFailure(
  language: 'en' | 'es' | 'zh' | null | undefined,
  voiceGender: 'male' | 'female',
  apiUrl: string,
): Promise<void> {
  const msg = failureFallbackFor(language);
  try { Vibration.vibrate(120); } catch {}
  try { await stopSpeaking().catch(() => {}); } catch {}
  try {
    await speak(msg, voiceGender, language ?? 'en', apiUrl, { userInitiated: true });
  } catch (e) { console.log('[listeningSession] failure-fallback speak threw', e); }
}

async function openSession() {
  setSessionStateMirror('opening');
  const settings = useSettingsStore.getState();
  const apiUrl = getApiBaseUrl();
  console.log(`[path4:voice] tap_open trust=${getTrustLevel()}`);

  // 2026-06-15 (Tim — ~5s lag, wants ~3s) — warm the WHOLE voice chain the
  // instant listening opens. The manual-tap path already prewarms at mic-press;
  // the earbud/active-listening path did NOT, so the first turn after idle paid
  // full cold-start (transcribe + intent + kevin + voice Lambdas, sequentially)
  // on top of generation. Firing it here means every endpoint heats up DURING
  // the opener-speak + capture window — by the time the transcript is ready they
  // re hot. 2026-06-16 — FORCE (bypass the 30s dedupe): a tap to talk is an explicit
  // signal the user is about to use voice, so warm the chain NOW even if a passive
  // warmup ran recently — it overlaps the capture and removes the cold-first-tap lag.
  if (settings.voiceEnabled) prewarmVoice(true);

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
  console.log(`[path4:voice] opener_done allowed=${ttsAllowed && !!opener}`);

  // Phase 2 — open mic for utterance
  setSessionStateMirror('listening');
  console.log('[audit:voice] listening engaged');
  const t_capture_start = Date.now();
  console.log('[path4:voice] capture_start');
  let utterance: string | null = null;
  try {
    // 2026-05-25 — Bumped 8s→12s. Open-mic users need room to express a
    // full thought during casual conversation ("hey Kevin, how are you
    // doing today, I've been working on my driver"). 8s was clipping
    // mid-sentence on natural-pace speech.
    const captureP = captureUtterance(12_000, apiUrl, settings.language);
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
  const captureCancelled = state !== 'listening' || !utterance || !utterance.trim();
  console.log(`[path4:voice] capture_done text_len=${utterance?.trim().length ?? 0} cancelled=${captureCancelled}`);
  if (state !== 'listening') return;

  if (!utterance || !utterance.trim()) {
    setSessionStateMirror('idle');
    return;
  }
  const t_capture_end = Date.now();
  lastCaptureEndMs = t_capture_end;

  // Phase 3 — classify + respond
  setSessionStateMirror('thinking');
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

    // 2026-06-15 (Tim — tap-to-talk record must be deterministic, not a cloud
    // coin-flip) — try the LOCAL precheck first. When Smart Motion is open it
    // routes record/watch/stop straight to media_capture (the recorder arms
    // instantly — no cloud round-trip, no brain detour that loops on "want me to
    // watch your swing?"). It also covers the usual high-frequency phrases. On a
    // miss it falls through to the cloud classifier exactly as before.
    let intent: VoiceIntent | null = precheckLocalIntent(utterance);
    // Local-first health metric ([[self-growing-agent-architecture]]) — a precheck hit
    // answered without the cloud classifier. Pure observation; never gates the flow.
    if (intent) {
      try { useVoiceHitRateStore.getState().recordLocal(`precheck:${intent.intent_type}`, Date.now()); } catch { /* non-fatal */ }
    }
    // 2026-06-16 (Tim — "I speak but he waits 4-5s, then thinks") — on a precheck
    // MISS the turn is almost always conversational and routes to /api/kevin anyway;
    // the classifier (/api/voice-intent) only decides IF a deterministic handler
    // should run, and the brain takes the RAW utterance (not the intent). So fire a
    // SPECULATIVE brain call in PARALLEL with the classifier instead of stacking
    // brain-after-classify — the brain's network+LLM time overlaps the classify
    // (~0.7-1s shaved off every conversational turn, which matters most on weak
    // signal). If the classifier ends up routing to a handler/diagnostic, this
    // result is just dropped. Body matches the small-talk path below exactly.
    let speculativeBrainP: Promise<Response | null> | null = null;
    let speculativeController: AbortController | null = null;
    if (!intent) {
      // ── LOCAL-FIRST (2026-06-16, Tim) ──────────────────────────────────────
      // Before paying ANY cloud round-trip, try to answer the ask instantly from
      // device state (GPS / round / bag / CNS memory) via the same responder used
      // as the offline fallback. For the deterministic, accuracy-safe query types
      // this skips the classifier AND the brain — the 4-5s "then he thinks" gap —
      // and works with no signal (TTS still voices it, with the device-TTS fallback
      // when /api/voice is unreachable). Strategic/coaching asks aren't in the set,
      // so they still get the richer brain online. Pure win, no downgrade.
      const localLang = (LOCAL_REPLY_LANGS as readonly string[]).includes(settings.language)
        ? (settings.language as 'en' | 'es' | 'zh')
        : 'en';
      let localPrimary: { text: string; queryType: string } | null = null;
      try { localPrimary = tryLocalReply(utterance, localLang); } catch { localPrimary = null; }
      if (localPrimary && localPrimary.text && LOCAL_PRIMARY_TYPES.has(localPrimary.queryType)) {
        console.log(`[path4:voice] local_primary type=${localPrimary.queryType} (skipped classify+brain)`);
        try { useVoiceHitRateStore.getState().recordLocal(`local_primary:${localPrimary.queryType}`, Date.now()); } catch { /* non-fatal */ }
        const localAllowed =
          settings.voiceEnabled &&
          (route !== 'phone_speaker' || allowPhoneSpeaker);
        if ((state as SessionState) === 'thinking') setSessionStateMirror('responding');
        if (localAllowed && getSessionState() === 'responding') {
          await stopSpeaking().catch(() => {});
          if (getSessionState() === 'responding') {
            await speak(localPrimary.text, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
              .catch((e) => console.log('[listeningSession] local-primary speak failed', e));
          }
        }
        setSessionStateMirror('idle');
        return;
      }

      speculativeController = new AbortController();
      speculativeBrainP = fetchWithTimeout(`${apiUrl}/api/kevin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AI-Provider': settings.aiProvider ?? 'gemini' },
        signal: speculativeController.signal,
        body: JSON.stringify({
          message: utterance,
          language: settings.language,
          currentHole: round.isRoundActive ? round.currentHole : null,
          currentYardage: round.currentYardage ?? null,
          activeCourse: round.activeCourse,
          holeNotes: round.holeNotes,
          isRoundActive: round.isRoundActive,
          voiceGender: settings.voiceGender ?? 'male',
          persona: settings.caddiePersonality,
        }),
      }, KEVIN_FETCH_TIMEOUT_MS).catch(() => null);

      const parseRes = await fetchWithTimeout(`${apiUrl}/api/voice-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AI-Provider': settings.aiProvider ?? 'gemini' },
        // 2026-05-21 — Fix Q: pass active persona so the classifier's
        // follow-up question (if any) is styled in the user's selected
        // caddie's voice, not the voiceGender-derived Kevin/Serena default.
        body: JSON.stringify({
          text: utterance,
          voiceGender: settings.voiceGender ?? 'male',
          persona: settings.caddiePersonality,
        }),
      }, INTENT_FETCH_TIMEOUT_MS);
      if (!parseRes.ok) {
        speculativeController?.abort();
        setSessionStateMirror('idle');
        return;
      }
      intent = await parseRes.json() as VoiceIntent;
      // Cloud escalation — the local precheck + local-primary both missed, so we paid
      // the classifier (and usually the brain). The metric Tim watches: this should
      // trend DOWN relative to local as the CNS brain grows.
      try { useVoiceHitRateStore.getState().recordCloud(`cloud:${intent.intent_type}`, Date.now()); } catch { /* non-fatal */ }
    }
    const t_intent = Date.now();
    console.log(`[path4:voice] intent=${intent.intent_type} topic=${(intent.parameters?.query_topic as string | undefined) ?? 'none'}`);
    if ((state as SessionState) !== 'thinking') return;

    setSessionStateMirror('responding');

    // Phase P — fire filler (if router prescribes one) in parallel with handler.
    // playLocalFile is non-blocking start; we await it later before speak() so
    // the real response doesn't cancel the filler mid-clip.
    const role: 'caddie' | 'coach' | 'psychologist' = round.isRoundActive ? 'caddie' : 'coach';
    const decision = routeQuery(intent.intent_type, {
      role,
      trust_level: getTrustLevel() as 1 | 2 | 3,
      topic: (intent.parameters?.query_topic as string | undefined) ?? null,
    });
    let fillerP: Promise<void> = Promise.resolve();
    let t_filler_start: number | null = null;
    if (decision.filler && ttsAllowed) {
      const clip = getClipForCategory(decision.filler);
      if (clip) {
        t_filler_start = Date.now();
        const tStart = t_filler_start;
        console.log(`[path4:voice] filler_start category=${decision.filler} cached=true`);
        fillerP = playLocalFile(clip.audio_path, clip.duration_ms)
          .then(() => { console.log(`[path4:voice] filler_end ms=${Date.now() - tStart}`); })
          .catch(() => {});
      } else {
        // Phase V.7 — local audio cache not ready (e.g. just after a
        // voiceHash bump). Fall through to live TTS so the user hears a
        // bridge instead of dead silence between intent and response.
        const fallbackText = getFallbackTextForCategory(decision.filler);
        if (fallbackText) {
          t_filler_start = Date.now();
          const tStart = t_filler_start;
          console.log(`[path4:voice] filler_start category=${decision.filler} cached=false`);
          fillerP = speak(fallbackText, settings.voiceGender, settings.language, apiUrl)
            .then(() => { console.log(`[path4:voice] filler_end ms=${Date.now() - tStart}`); })
            .catch(() => {});
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
          holeNotes: round.holeNotes,
          recentShots: round.shots.slice(-10),
          kevinContext: profile.kevinContext ?? null,
          persistentPatterns: profile.persistentPatterns ?? null,
          practice_context: buildFullPracticeContext(),
          screen_context: screenContextForPrompt(),
          register: 'coach',
          inRoundDiagnostic: true,
          voiceGender: settingsStore.voiceGender ?? 'male',
          // PGA HOPE follow-up — persona, intensity dial, Tank soft-intro.
          persona: settingsStore.caddiePersonality,
          personaIntensity: settingsStore.personaIntensity?.[settingsStore.caddiePersonality] ?? 100,
          tankSoftIntro: settingsStore.tankSoftIntro,
        };
        await fillerP;
        // 2026-05-21 — Fix I shape A: track whether anything was spoken
        // and fall back to the honest failure line otherwise.
        let diagnosticSpoken = false;
        const r = await fetchWithTimeout(`${apiUrl}/api/kevin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-AI-Provider': settingsStore.aiProvider ?? 'gemini' },
          body: JSON.stringify(apiUrlBody),
        }, KEVIN_FETCH_TIMEOUT_MS);
        if (r.ok) {
          const j = await r.json() as { text?: string; audioBase64?: string };
          if (j.text && ttsAllowed && getSessionState() === 'responding') {
            await stopSpeaking().catch(() => {});
            if (getSessionState() !== 'responding') {
              setSessionStateMirror('idle');
              return;
            }
            await speak(j.text, settings.voiceGender, settings.language, apiUrl, { userInitiated: true });
            diagnosticSpoken = true;
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
        } else {
          console.log('[listeningSession] in_round_diagnostic non-ok:', r.status);
        }
        if (!diagnosticSpoken && ttsAllowed && getSessionState() === 'responding') {
          await speakHonestFailure(settings.language, settings.voiceGender, apiUrl);
        }
      } catch (e) {
        console.log('[listeningSession] in_round_diagnostic failed', e);
        if (ttsAllowed && getSessionState() === 'responding') {
          await speakHonestFailure(settings.language, settings.voiceGender, apiUrl);
        }
      }
      setSessionStateMirror('idle');
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
    if (!voiceCommandRouter.getHandler(intent.intent_type) && (state as SessionState) === 'responding') {
      const responseAllowed =
        settings.voiceEnabled &&
        (route !== 'phone_speaker' || allowPhoneSpeaker);
      await fillerP;
      if (responseAllowed) {
        if (intent.follow_up_question) {
          if (getSessionState() === 'responding') {
            await stopSpeaking().catch(() => {});
            if (getSessionState() === 'responding') {
              await speak(intent.follow_up_question, settings.voiceGender, intent.language ?? settings.language, apiUrl, { userInitiated: true })
                .catch((e) => console.log('[listeningSession] follow_up speak failed', e));
            }
          }
        } else {
          // 2026-05-21 — Fix I shape A: every silent-failure branch below
          // now speaks an honest fallback line instead of letting the pill
          // go dark. Three failure modes were dropping silently pre-fix:
          //   (1) chatRes.ok === false (500/503/504 from Vercel timeout
          //       or upstream model failure)
          //   (2) chatRes.ok === true but reply text is empty / wrong shape
          //   (3) fetch itself throws (network error, AbortController)
          let chatSpoken = false;
          // 2026-07-01 (whole-app audit — MIC CONVERGENCE) — route the badge / earbud / hands-free
          // conversational turn to the SAME unified pipecat brain the caddie-tab mic uses.
          // conversationalBrainTurn falls back to legacy kevin internally on any pipecat failure, and
          // on a total miss (null text) we still fall through to the untouched kevin block below — so
          // this can never break the earbud path worse than before. Gated on voiceOrchestrator.
          if ((settings.voiceOrchestrator ?? 'pipecat') === 'pipecat') {
            try {
              speculativeController?.abort();
              speculativeBrainP = null;
              const r = await conversationalBrainTurn(utterance, { timeoutMs: KEVIN_FETCH_TIMEOUT_MS });
              // 2026-07-01 (re-audit — voice H2) — dispatch service-safe tool actions
              // (switch_caddie / navigate) the conversational brain returned; this
              // branch previously spoke the reply but dropped them.
              if (r.toolActions?.length) {
                const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
                dispatchConversationalToolActions(r.toolActions);
              }
              if (r.text && getSessionState() === 'responding') {
                await stopSpeaking().catch(() => {});
                if (getSessionState() === 'responding') {
                  if (r.audioBase64) await speakFromBase64(r.audioBase64, { userInitiated: true }).catch((e) => console.log('[listeningSession] pipecat speakFromBase64 failed', e));
                  else await speak(r.text, settings.voiceGender, settings.language, apiUrl, { userInitiated: true }).catch((e) => console.log('[listeningSession] pipecat speak failed', e));
                  chatSpoken = true;
                }
              }
            } catch (e) { console.log('[listeningSession] pipecat conversational failed → kevin', e); }
          }
          if (!chatSpoken) try {
            // 2026-06-16 — prefer the SPECULATIVE brain call fired in parallel with
            // the classifier above; it's already in flight, so the classify time was
            // overlapped instead of stacked. Falls back to a fresh call if it wasn't
            // fired (precheck hit) or errored. Same body either way.
            const chatRes = (speculativeBrainP && await speculativeBrainP) || await fetchWithTimeout(`${apiUrl}/api/kevin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-AI-Provider': settings.aiProvider ?? 'gemini' },
              body: JSON.stringify({
                message: utterance,
                language: settings.language,
                currentHole: round.isRoundActive ? round.currentHole : null,
                currentYardage: round.currentYardage ?? null,
                activeCourse: round.activeCourse,
                holeNotes: round.holeNotes,
                isRoundActive: round.isRoundActive,
                // 2026-05-21 — Fix Q: pass active persona + voiceGender
                // so the small-talk reply uses the user's selected caddie
                // instead of falling through to the server's Kevin default
                // (lib/persona.ts resolvePersona → 'kevin' fallback). This
                // was the #1 cross-persona bleed channel — voice replies
                // to "hey Tank, how are you" were coming back as Kevin.
                voiceGender: settings.voiceGender ?? 'male',
                persona: settings.caddiePersonality,
              }),
            }, KEVIN_FETCH_TIMEOUT_MS);
            if (chatRes.ok) {
              const chatJson = await chatRes.json() as { text?: string; audioBase64?: string | null };
              // /api/kevin returns { text, audioBase64, toolAction } — not
              // { response }. The earlier shape mismatch silently dropped
              // every small-talk fallback ("hey Tank, how are you") through
              // the listening pill. Prefer the audioBase64 path so the
              // user hears the canonical persona voice when present.
              //
              // Fix I shape C — /api/kevin's outer catch now returns
              // 200 with {text: localizedFallback, audioBase64: null}
              // on exception. So even server-side failures land here
              // with a non-empty `text` and we just speak it (no audio).
              const reply = typeof chatJson?.text === 'string' ? chatJson.text : null;
              const replyAudio = typeof chatJson?.audioBase64 === 'string' ? chatJson.audioBase64 : null;
              if (reply && getSessionState() === 'responding') {
                await stopSpeaking().catch(() => {});
                if (getSessionState() !== 'responding') {
                  setSessionStateMirror('idle');
                  return;
                }
                if (replyAudio) {
                  await speakFromBase64(replyAudio, { userInitiated: true })
                    .catch((e) => console.log('[listeningSession] chat fallback speakFromBase64 failed', e));
                } else {
                  await speak(reply, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
                    .catch((e) => console.log('[listeningSession] chat fallback speak failed', e));
                }
                chatSpoken = true;
              }
            } else {
              console.log('[listeningSession] chat fallback non-ok:', chatRes.status);
            }
          } catch (e) {
            console.log('[listeningSession] chat fallback fetch failed', e);
          }
          if (!chatSpoken && responseAllowed && getSessionState() === 'responding') {
            await speakHonestFailure(settings.language, settings.voiceGender, apiUrl);
          }
        }
      }
      setSessionStateMirror('idle');
      return;
    }

    const handler = voiceCommandRouter.getHandler(intent.intent_type);
    if (handler) {
      speculativeController?.abort();
      speculativeBrainP = null;
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
        for (let i = 0; i < 2 && !resultReady && (state as SessionState) === 'responding'; i++) {
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
      // 2026-07-04 (Tim — "AI front and center") — the handler DEFERRED this judgment
      // read (shot_strategy) to the conversational caddie brain. Answer with Claude
      // (pipecat→kevin inside conversationalBrainTurn) + dispatch any tool actions; on a
      // total brain miss (signal drop) fall back to the offline caddie (local club-call).
      if (result.route_to_brain) {
        try {
          const r = await conversationalBrainTurn(utterance, { timeoutMs: KEVIN_FETCH_TIMEOUT_MS });
          if (r.toolActions?.length) {
            const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
            dispatchConversationalToolActions(r.toolActions);
          }
          if (r.text && responseAllowed && getSessionState() === 'responding') {
            await stopSpeaking().catch(() => {});
            if (getSessionState() === 'responding') {
              if (r.audioBase64) await speakFromBase64(r.audioBase64, { userInitiated: true }).catch((e) => console.log('[listeningSession] route_to_brain speakFromBase64 failed', e));
              else await speak(r.text, settings.voiceGender, intent.language ?? settings.language, apiUrl, { userInitiated: true }).catch((e) => console.log('[listeningSession] route_to_brain speak failed', e));
            }
          } else if (!r.text && responseAllowed && getSessionState() === 'responding') {
            const offLang = (['en', 'es', 'zh'] as const).includes(settings.language as never) ? (settings.language as 'en' | 'es' | 'zh') : 'en';
            const off = require('./offlineCaddie').answerOffline(utterance, offLang) as { text?: string } | null;
            if (off?.text) await speak(off.text, settings.voiceGender, settings.language, apiUrl, { userInitiated: true }).catch(() => {});
            else await speakHonestFailure(settings.language, settings.voiceGender, apiUrl);
          }
        } catch (e) { console.log('[listeningSession] route_to_brain failed', e); }
        setSessionStateMirror('idle');
        return;
      }
      if (result.voice_response && responseAllowed) {
        console.log('[ttfa]', JSON.stringify({
          intent: intent.intent_type,
          topic: intent.parameters?.query_topic ?? null,
          filler: decision.filler,
          capture_ms: t_capture_end - t_capture_start,
          intent_ms: t_intent - t0,
          filler_start_ms: t_filler_start != null ? t_filler_start - t0 : null,
          handler_ms: t_response_start - t_intent,
          response_start_ms: t_response_start - t0,
        }));
        // Cancel any in-flight / queued filler so the real response
        // doesn't queue behind a long conversational bridge — Tim's
        // "generic-then-relevant" disconnect on the 2nd question.
        await stopSpeaking().catch(() => {});
        if (getSessionState() !== 'responding') {
          setSessionStateMirror('idle');
          return;
        }
        // 2026-05-24 — Prefer the classifier-detected utterance language
        // over the user's Settings language so a Spanish/Chinese
        // utterance is spoken back through eleven_multilingual_v2 with
        // matching pronunciation. Falls through to settings.language
        // when the classifier didn't emit one (older Vercel route,
        // English transcript, or no triggers matched).
        await speak(result.voice_response, settings.voiceGender, intent.language ?? settings.language, apiUrl, { userInitiated: true });
      } else if (!result.voice_response && responseAllowed) {
        // 2026-05-21 — Fix I shape A: handler returned no voice_response
        // (e.g. an internal failure path with no fallback string). Don't
        // leave the pill idle in silence — speak an honest "having
        // trouble" line. Some handlers legitimately have no spoken reply
        // (e.g. navigation tool_actions that route the user); those set
        // result.tool_action, which we still execute below. For the
        // pure-no-output case the user gets the localized failure line.
        if (!result.tool_action && getSessionState() === 'responding') {
          await speakHonestFailure(settings.language, settings.voiceGender, apiUrl);
        }
      }
      // Phase R/S — dispatch tool_action.open_url. Internal routes (e.g.
      // swing library jumps, SmartVision opens) go through router.push as
      // before. External URLs (http/https) are allowlisted to prevent
      // open-redirect through a compromised / malformed server response.
      const ta = result.tool_action;
      // 2026-07-04 (clean-audit H4) — this dispatch handled ONLY open_url /
      // navigate / navigate_replace, so an earbud "open SmartVision" (which
      // returns {type:'open_smartvision'}) spoke its line and opened NOTHING.
      // Route EVERY tool_action through the full service dispatcher (it covers
      // all ToolAction types incl. the open_* trio with paywall gates, and keeps
      // the same open_url allowlist).
      if (ta) {
        try {
          const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
          dispatchConversationalToolActions([ta]);
        } catch (e) {
          console.log('[listeningSession] tool_action dispatch failed', e);
        }
      }
    }
  } catch (e) {
    // 2026-05-21 — Fix I shape A: outer catch used to log silently and
    // leave the pill idle. Now also speaks the honest failure line so
    // the user gets a tactile + audible signal instead of dead silence.
    // Read settings fresh in case the throw happened before the outer
    // settings binding was created (defensive).
    console.log('[listeningSession] respond failed', e);
    try {
      const settingsFresh = useSettingsStore.getState();
      const routeAllowed = getCurrentRoute() !== 'phone_speaker' ||
        (settingsFresh as unknown as { voiceOnPhoneSpeaker?: boolean }).voiceOnPhoneSpeaker === true;
      if (settingsFresh.voiceEnabled && routeAllowed && getSessionState() !== 'idle') {
        await speakHonestFailure(
          settingsFresh.language,
          settingsFresh.voiceGender,
          getApiBaseUrl(),
        );
      }
    } catch (innerErr) { console.log('[listeningSession] outer-catch fallback failed', innerErr); }
  }

  setSessionStateMirror('idle');
}

function closeSession() {
  closeSessionInternal('user_close');
}

/**
 * 2026-05-26 — Fix AP Phase 1: internal close with reason tag so the
 * dormancy watchdog can call this without spoofing a user tap, and
 * the close log carries WHY it happened (debugging stuck-session
 * reports later: 'dormancy_timeout' vs 'user_close' is the line you
 * want in logcat).
 */
function closeSessionInternal(reason: 'user_close' | 'dormancy_timeout') {
  console.log(`[path4:voice] close (reason=${reason})`);
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
  setSessionStateMirror('idle');
}

/**
 * 2026-05-22 — Hands-Free path: classify + route a pre-transcribed
 * utterance WITHOUT opening the phone's listening session (no mic
 * recording, no opener, no filler — just classify → handler → speak).
 * Used by the watch bridge when the watch transcribes on-device and
 * relays text to the phone via handsFreeOrchestrator.
 *
 * Defensive: empty / whitespace utterances no-op. Classifier errors
 * fall back silently (no annoying error voice for a watch tap that
 * was probably a misfire).
 */
export async function handleTranscribedUtterance(utterance: string): Promise<void> {
  const text = (utterance ?? '').trim();
  if (!text) return;
  try {
    const settings = useSettingsStore.getState();
    const round = useRoundStore.getState();
    const apiUrl = getApiBaseUrl();
    // 2026-07-04 (clean-audit H5) — the watch path went straight to the cloud and
    // silently died offline. Try the LOCAL precheck first, like both other paths.
    let intent = precheckLocalIntent(text);
    if (!intent) {
      const parseRes = await fetchWithTimeout(`${apiUrl}/api/voice-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AI-Provider': settings.aiProvider ?? 'gemini' },
        body: JSON.stringify({
          text,
          voiceGender: settings.voiceGender ?? 'male',
          persona: settings.caddiePersonality,
        }),
      }, INTENT_FETCH_TIMEOUT_MS);
      if (!parseRes.ok) {
        console.log(`[handsFree-route] classifier non-ok ${parseRes.status}`);
        return;
      }
      intent = await parseRes.json();
    }
    // 2026-07-04 (clean-audit M4) — the cloud classifier response carries no
    // raw_text; handlers' raw-text fallbacks (catalog lookup, hole parse, coach
    // name) silently died on this path. Always carry the utterance.
    if (!intent) return;
    if (!intent.raw_text) intent.raw_text = text;
    const handler = voiceCommandRouter.getHandler(intent.intent_type);
    if (!handler) {
      // 2026-07-01 (audit — MIC CONVERGENCE) — the watch / hands-free path used to
      // DROP any non-tool intent (greetings, questions, chit-chat) into SILENCE, so
      // "watch" mode felt deaf to anything conversational. Route it to the SAME
      // unified brain the caddie-tab + earbud paths use. conversationalBrainTurn is
      // pipecat-first with an always-there kevin fallback (and honors the kevin
      // orchestrator), so this answers in BOTH modes and can't regress below silence.
      console.log(`[handsFree-route] no tool handler for ${intent.intent_type} → conversational`);
      try {
        const r = await conversationalBrainTurn(text, { timeoutMs: KEVIN_FETCH_TIMEOUT_MS });
        // 2026-07-01 (re-audit — voice H2) — dispatch the service-safe tool actions
        // the brain returned (switch_caddie / navigate) so a hands-free "switch to
        // Tank" / "open SmartFinder" actually happens instead of only being spoken.
        if (r.toolActions?.length) {
          const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
          dispatchConversationalToolActions(r.toolActions);
        }
        // 2026-07-01 (re-audit — voice H1) — respect the SAME phone-speaker gate the
        // main path uses: don't talk out loud when audio is on the phone speaker and
        // "Voice on phone speaker" is off. voiceEnabled is still enforced inside speak().
        const route = getCurrentRoute();
        const allowPhoneSpeaker = (settings as unknown as { voiceOnPhoneSpeaker?: boolean }).voiceOnPhoneSpeaker === true;
        const ttsAllowed = (settings.voiceEnabled ?? true) && (route !== 'phone_speaker' || allowPhoneSpeaker);
        if (r.text && ttsAllowed) {
          const { speak, speakFromBase64 } = await import('./voiceService');
          if (r.audioBase64) {
            await speakFromBase64(r.audioBase64, { userInitiated: true }).catch(() => undefined);
          } else {
            await speak(r.text, settings.voiceGender, intent.language ?? settings.language ?? 'en', apiUrl, { userInitiated: true })
              ?.catch?.(() => undefined);
          }
        }
      } catch (e) {
        console.log('[handsFree-route] conversational fallback failed:', e);
      }
      return;
    }
    const ctx: AppContext = {
      active_screen: 'watch_voice',
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
      // 2026-07-04 (clean-audit L5) — read the REAL trust level (was hardcoded 3).
      trust_spectrum_level: (() => { try { return getTrustLevel() as 1 | 2 | 3; } catch { return 2 as const; } })(),
    };
    void settings;
    const result = await handler.execute(intent, ctx);
    // 2026-07-04 (clean-audit C2) — in pipecat mode the judgment reads (shot_strategy)
    // DEFER to the conversational brain; this path used to ignore the flag → total
    // silence on "what's the play" from the watch. Mirror the earbud branch.
    if (result?.route_to_brain) {
      try {
        const r = await conversationalBrainTurn(text, { timeoutMs: KEVIN_FETCH_TIMEOUT_MS });
        if (r.toolActions?.length) {
          const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
          dispatchConversationalToolActions(r.toolActions);
        }
        if (r.text) {
          const { speak, speakFromBase64 } = await import('./voiceService');
          if (r.audioBase64) await speakFromBase64(r.audioBase64, { userInitiated: true }).catch(() => undefined);
          else await speak(r.text, settings.voiceGender, intent.language ?? settings.language ?? 'en', apiUrl, { userInitiated: true })?.catch?.(() => undefined);
        }
      } catch (e) { console.log('[handsFree-route] route_to_brain failed:', e); }
      return;
    }
    if (result?.voice_response) {
      const { speak } = await import('./voiceService');
      void speak(result.voice_response, settings.voiceGender, intent.language ?? settings.language ?? 'en', apiUrl, { userInitiated: true })
        ?.catch?.(() => undefined);
    }
    // 2026-07-04 (clean-audit C2) — dispatch the handler's tool_action. This path
    // spoke "Opening SmartFinder" and then... nothing. The full service dispatcher
    // handles every ToolAction type now.
    if (result?.tool_action) {
      try {
        const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
        dispatchConversationalToolActions([result.tool_action]);
      } catch (e) { console.log('[handsFree-route] tool_action dispatch failed:', e); }
    }
  } catch (e) {
    console.log('[handsFree-route] failed:', e);
  }
}
