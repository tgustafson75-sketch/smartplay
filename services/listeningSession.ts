import { Vibration } from 'react-native';
import { BRAIN_FETCH_TIMEOUT_MS as KEVIN_FETCH_TIMEOUT_MS } from '../constants/voiceTimeouts';
import { endsAsQuestion } from './voice/endsAsQuestion';
import { speak, speakFromBase64, stopSpeaking, isSpeaking, captureUtteranceDetailed, releaseExternalMic, playLocalFile, stopCapture, endCaptureEarly, flashCaption, getLastSpokenLine, type CaptureBail, type CaptureResult } from './voiceService';
import { logVoiceSilentFail } from './voiceErrorLog';
import { responseForCaptureBail, shouldRetryCapture } from './voice/captureBail';
import { conversationalBrainTurn } from './conversationalBrain';
import { prewarmVoice, abortVoiceWarmup } from './voiceWarmup';
import { getDialog } from './dialogEngine';
import { ACK_PHRASES, CADDIE_NOTICE_DIDNT_CATCH, CADDIE_NOTICE_MIC_TROUBLE, CADDIE_NOTICE_CONNECTION, CADDIE_NOTICE_ON_US, LISTEN_CUES, GOTIT_CUES } from './caddieAckLines';
import { getTrustLevel } from './trustLevelService';
import { useRoundStore, voicePuttsHole } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { voiceCommandRouter } from './intents';
import { subscribeEarbudTap } from './earbudControl';
import { isSmartMotionRecording, emitSmartMotionCommand } from './smartMotionRecordBus';
import { getCurrentRoute } from './audioRoutingService';
import { routeQuery } from './responseRouter';
// 2026-08-06 (Tim — "no more pre-canned speech; use a subtle earcon, no words" during the think gap). The
// "thinking" earcon: a soft NON-VERBAL tone played ONCE when a turn will take a beat, replacing the old
// spoken filler words ("Let me see...", "Looking at those swings...") — the loudest canned-speech surface.
// Reuses an already-bundled tone so it ships OTA (no new binary needed). [[feels-like-a-real-caddie]]
// eslint-disable-next-line @typescript-eslint/no-require-imports
const THINKING_EARCON: number = require('../assets/audio/tempo/tick.mp3');
const THINKING_EARCON_MS = 180;
// 2026-08-06 (Tim — "when I tap the earbud there's no beep/haptic telling me the caddie is LISTENING; the
// phone's 40 yards away in the cart so I can't see the indicator or feel the phone haptic — I just talk and
// hope"). A distinct "I'm listening" earcon played THROUGH THE AUDIO ROUTE (the earbud, where his ears are)
// the instant the mic opens — the audible go-ahead the phone haptic can't give when the phone is far away.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LISTENING_EARCON: number = require('../assets/audio/tempo/tock.mp3');
const LISTENING_EARCON_MS = 200;
// 2026-08-07 (Tim — "then user will tap again with ANOTHER sound confirming"). A SECOND, DISTINCT tone
// (a crisp tick vs the listening tock) played the instant a tap-again ENDS the utterance — the audible
// "got it, I'm on it" the earbud user needs when the phone's in the cart. Pairs with the spoken capture
// ack below (the caddie then confirms it heard). [[feels-like-a-real-caddie]]
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GOTIT_EARCON: number = require('../assets/audio/tempo/tick.mp3');
const GOTIT_EARCON_MS = 180;
import { getActiveSurface } from './activeSurfaceRegistry';
import { precheckLocalIntent } from './localIntentPrecheck';
import { resolvePendingCourseUtterance } from './pendingDisambiguation';
import { tryLocalReply } from './localStatusResponder';
import { useVoiceHitRateStore } from '../store/voiceHitRateStore';
import type { AppContext, VoiceIntent } from '../types/voiceIntent';
import { buildFullPracticeContext } from './tutorialContext';
import { screenContextForPrompt } from './screenContext';
import { getApiBaseUrl, isConnectionWarmed, getConnectionEvidence } from './apiBase';
import { isAwaitingPutts, awaitingPuttsHole, parsePuttAnswer, clearAwaitingPutts } from './pendingPuttAsk';

// 2026-07-25 (Tim — "first ask errors every time") — cold-aware brain timeout, mirroring useVoiceCaddie.
// The FIRST turn after launch is cold on the Lambda + provider SDK + tool rounds; a fixed 30s aborts it.
// Give the brain a longer budget until the connection is confirmed warm; warm turns keep the tight bound.
const COLD_KEVIN_FETCH_TIMEOUT_MS = 48000;
const kevinTimeout = (): number => (isConnectionWarmed() ? KEVIN_FETCH_TIMEOUT_MS : COLD_KEVIN_FETCH_TIMEOUT_MS);

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
// 2026-07-29 (Tim — "STILL a first-time failure gate in the speaking path, off-course, EVERY first ask")
// — the brain timeout went cold-aware on 07-25, but the INTENT-classify fetch was left at a FIXED 8s.
// On the first ask after launch, /api/voice-intent is a COLD Vercel Lambda (~8-12s cold start + classify)
// — so the 8s bound ABORTED it, the fetch threw / returned !ok, and the turn spoke "I'm having trouble
// connecting." Deterministic first-turn failure. Give the classifier the same cold budget until the
// connection is confirmed warm (warmup completed OR a prior request succeeded); warm turns keep 8s.
const COLD_INTENT_FETCH_TIMEOUT_MS = 22_000;
const intentTimeout = (): number => (isConnectionWarmed() ? INTENT_FETCH_TIMEOUT_MS : COLD_INTENT_FETCH_TIMEOUT_MS);
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
// 2026-07-06 (audit #2) — mirror cooldown for the CLOSE side of toggle().
let sessionCloseTapAt = 0;
const RECORDING_STOP_TAP_COOLDOWN_MS = 1500;
// 2026-08-09 (deferred-minor fix) — the SESSION-CLOSE swallow only exists to eat the same physical
// tap's ~350ms pattern-sub echo. It was reusing the 1.5s camera-release constant, so a REAL shush tap
// within 1.5s of the "I'm done" endpoint tap was silently swallowed while the caddie kept talking.
// 600ms covers the echo + jitter, nothing more. (Camera tap-stop keeps its full 1.5s — audio-session
// release genuinely needs it.)
const TAP_ECHO_SWALLOW_MS = 600;
// 2026-08-07 (regression audit) — timestamp of when the mic actually opened (state → 'listening').
// The endpoint tap (tap-again-to-submit) must be handled BEFORE the sessionInFlight guard, so we need
// a way to swallow the OPEN tap's OWN ~350ms second fire (legacy sub + pattern sub) which would
// otherwise land in 'listening' and end the capture before the user says a word. Any tap within
// LISTEN_ENDPOINT_MIN_MS of the mic opening is that echo, not a real "I'm done".
let listeningStartedAt = 0;
// 2026-08-09 (voice audit P2) — when a tap-to-submit already played the persona-voice "Got it" cue,
// suppress the redundant device-TTS pick-ack so the nice cue isn't clipped by a robotic one. Timestamp
// of the last got-it verbal cue; the capture-end ack checks it.
let gotItCueFiredAt = 0;
const LISTEN_ENDPOINT_MIN_MS = 800;

/**
 * 2026-08-11 (Tim) — "she ends with something like 'what's on your mind today', but doesn't listen."
 *
 * A real caddie who asks you something waits for the answer. This one asked and shut the mic —
 * every clarifying question (follow_up_question), and every brain reply that ended in a question,
 * dropped the user back to a closed session and made THEM tap again to answer a question they had
 * just been asked. That reads as not listening, because functionally it isn't. [[feels-like-a-real-caddie]]
 *
 * So: when the caddie's own last spoken line ends in a question, reopen the mic for the answer.
 *
 * Bounded deliberately. Two consecutive auto-reopens is the cap — a caddie that keeps asking
 * questions is a caddie in a loop, and an unbounded chain would hold the mic open indefinitely on a
 * misheard turn. The chain resets on any user-initiated tap.
 */
const MAX_AUTO_REOPENS = 2;
let autoReopenChain = 0;
/** The last line the caddie spoke before this turn opened — lets us tell "new question" from stale. */
let spokenLineAtOpen: string | null = null;

// Uses the SHARED endsAsQuestion — a naive endsWith('?') is false for "What's on your mind today?
// Take your time.", which is the exact shape Tim reported. See services/voice/endsAsQuestion.ts.
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

// 2026-07-18 (Tim — "vary it so it's natural, not a robot repeating one line") — a rotating set of
// short, natural acknowledgments spoken the moment we finish capturing your voice, so you know it
// heard you before it processes. Kept to clear words that read well in device TTS (no "mm-hmm").
// 2026-07-26 (deep audit) — ack lines + the "Didn't catch that." notice now live in a dependency-free
// module (services/caddieAckLines) so offlineVoiceCache pre-renders them in the persona's REAL voice from
// the SAME source (no drift possible). [[feels-like-a-real-caddie]]
let lastAckIdx = -1;
function pickAck(lang: 'en' | 'es' | 'zh'): string {
  const arr = ACK_PHRASES[lang] ?? ACK_PHRASES.en;
  if (arr.length <= 1) return arr[0] ?? 'Got it.';
  let i = Math.floor(Math.random() * arr.length);
  if (i === lastAckIdx) i = (i + 1) % arr.length; // never immediately repeat the same phrase
  lastAckIdx = i;
  return arr[i];
}

// 2026-08-08 (Tim — his Tozo T6 never hears the 200ms tock; "add our own caddie VERBAL response, not
// canned but logical"). Speak the listen/got-it cue in the CADDIE'S REAL VOICE from the offline persona
// cache — context-picked (mid-round vs off-course), rotating never-repeat, and long enough (~600ms) to
// survive the Bluetooth A2DP→mic route handoff that swallows the short tock. Cache miss (first-ever runs
// before the online warm) → the old earcon, so there is ALWAYS an audible cue. Awaited like the earcon
// was, so the cue can never be self-recorded by the mic that opens right after.
let lastCueIdx = -1;
function pickCue(pool: string[]): string {
  if (pool.length <= 1) return pool[0] ?? '';
  let i = Math.floor(Math.random() * pool.length);
  if (i === lastCueIdx) i = (i + 1) % pool.length;
  lastCueIdx = i;
  return pool[i];
}
async function playVerbalCue(kind: 'listen' | 'gotit', fallbackEarcon: number, fallbackMs: number): Promise<void> {
  try {
    const pool = kind === 'gotit'
      ? GOTIT_CUES
      : (useRoundStore.getState().isRoundActive ? LISTEN_CUES.round : LISTEN_CUES.idle);
    const text = pickCue(pool);
    const s = useSettingsStore.getState();
    const gender: 'male' | 'female' = s.voiceGender === 'female' ? 'female' : 'male';
    const persona = (s.caddiePersonality ?? 'kevin') as string;
    const cache = await import('./offlineVoiceCache');
    const uri = text ? cache.resolveCachedOfflineClipUri(text, gender, persona) : null;
    if (uri) { await playLocalFile(uri, undefined, { userInitiated: true }); return; }
  } catch { /* additive — fall through to the earcon */ }
  try { await playLocalFile(fallbackEarcon, fallbackMs, { userInitiated: true }); } catch { /* non-fatal */ }
}

function setSessionStateMirror(next: SessionState): void {
  const prev = state;
  state = next;
  // 2026-07-18 (Tim — "add a haptic when you tap the caddie/earbud/glasses so you FEEL it's on").
  // Every trigger source (earbud/glasses tap, global mic badge) flows through this chokepoint, so
  // one place covers them all. Best-effort + wrapped — a haptics failure can NEVER affect the
  // voice flow. The "done listening" cue is a spoken "Okay, got it." (see the capture-end block).
  // 2026-08-11 — the tap-confirmation haptic must fire at the TAP, not when the mic finally opens.
  // Holding 'opening' through the verbal cue (so we stop claiming to listen before we do) moved the
  // 'listening' transition ~1s later, which would have made the tap itself feel dead — the opposite
  // of "add a haptic when you tap so you FEEL it's on". Firing on the idle → opening/listening edge
  // keeps the feel immediate and can't double-fire, since opening → listening has prev !== 'idle'.
  if (prev === 'idle' && (next === 'opening' || next === 'listening')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const H = require('expo-haptics');
      void H.impactAsync(H.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch { /* haptics optional */ }
    // 2026-08-07 (Tim — "tapping the earbud should WAKE the screen so functions aren't asleep/resting").
    // A tap-to-talk flows through here from EVERY source (earbud/glasses/mic badge). Exit the app's rest/dim
    // state and reset the idle clock so the pipeline isn't mid-doze when the user starts speaking (the cart
    // case: phone dimmed 40y away). Best-effort — can never affect the voice flow.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../store/restModeStore') as typeof import('../store/restModeStore')).useRestModeStore.getState().exitRest();
    } catch { /* rest store optional */ }
  }
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

/**
 * 2026-08-21 — HEDGED, and found by sweeping guards rather than by another field report.
 *
 * Today's first-turn work hedged the TRANSCRIBE on both mic owners. It did not touch this — and the
 * earbud/hands-free path also runs an INTENT CLASSIFY, which on an unwarmed session waits
 * COLD_INTENT_FETCH_TIMEOUT_MS = 22 SECONDS on a single socket. So the entry point Tim uses most
 * still had a 22-second hang in it, one call away from the thing I had just fixed.
 *
 * A guard was even asserting that 22s as if it were a feature ("earbud/hands-free classify is
 * cold-aware"). It was pinning the wait.
 *
 * Same reasoning as everywhere else today: a hung socket and a slow one are indistinguishable while
 * you wait, so race a second connection instead of betting the budget on the first. A healthy
 * classify answers in well under a second and never hedges.
 */
const CLASSIFY_HEDGE_MS = 2_500;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const once = (budget: number) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), budget);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
  };
  const primary = once(timeoutMs);
  primary.catch(() => {});
  const hedged = (async () => {
    await new Promise(r => setTimeout(r, CLASSIFY_HEDGE_MS));
    const alt = once(Math.max(5_000, timeoutMs - CLASSIFY_HEDGE_MS));
    alt.catch(() => {});
    return alt;
  })();
  return Promise.any([primary, hedged]);
}

/**
 * 2026-08-19 (Tim, after a round: "I got ignored most of the time on the course today").
 *
 * A TAP THAT VANISHES IS THE WORST THING THIS SESSION CAN DO. toggle() has seven guards that return
 * early — echo swallows, cooldowns, and the in-flight lock — and every one of them returned in
 * complete silence: no earcon, no haptic, no log line. On a phone in your pocket with earbuds in,
 * silence is the ONLY channel the player has, so "swallowed on purpose" and "the app is dead" are
 * indistinguishable. You tap again, that is swallowed too, and the honest report is exactly the one
 * Tim gave: ignored.
 *
 * The worst offender is the in-flight lock. `sessionInFlight` is true through 'opening' AND
 * 'thinking' — the whole brain round-trip, which on a cold first turn is several seconds. During that
 * window the caddie has heard you, is working, and says nothing at all; a second tap is discarded
 * without acknowledgement. The player has no way to tell that from a mic that never opened.
 *
 * So: every swallow now (a) acknowledges with a short haptic, so a pocketed phone confirms the tap
 * registered, and (b) logs WHICH guard ate it, so the next round says definitively which of these
 * fires in the field instead of leaving us to reason about it. Deliberately NOT changing what the
 * guards decide — the dedupe/echo logic is load-bearing and was each written for a real double-fire.
 * What changes is that a swallow is no longer invisible. [[feels-like-a-real-caddie]]
 */
function swallowedTap(guard: string, extra?: Record<string, unknown>): void {
  try { Vibration.vibrate(18); } catch { /* haptics optional */ }
  console.log(`[path4:voice] tap_swallowed guard=${guard} state=${state}`);
  try {
    logVoiceSilentFail('tap_swallowed', { source: 'listeningSession', guard, sessionState: state, ...extra });
  } catch { /* never throw from a guard */ }
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
  if (Date.now() - recordingStopTapAt < RECORDING_STOP_TAP_COOLDOWN_MS) { swallowedTap('recording_stop_cooldown'); return; }
  // 2026-08-07 (regression audit — the endpoint branch below was DEAD: sessionInFlight is true for the
  // whole 'listening' window, so `if (sessionInFlight) return` swallowed the tap-again endpoint before it
  // could run). Handle the endpoint HERE, before that guard. A tap while the mic is OPEN means "I'm done,
  // submit" — end the capture early (transcribe what we have) + play the distinct got-it earcon.
  if (state === 'listening') {
    // Swallow the OPEN tap's own ~350ms echo (it lands in 'listening' but isn't a real "done" tap)...
    if (Date.now() - listeningStartedAt < LISTEN_ENDPOINT_MIN_MS) { swallowedTap('open_tap_echo'); return; }
    // ...and dedupe THIS endpoint tap's own double-fire (echo window only).
    if (Date.now() - sessionCloseTapAt < TAP_ECHO_SWALLOW_MS) return;
    sessionCloseTapAt = Date.now();
    endCaptureEarly();
    if (useSettingsStore.getState().voiceEnabled) {
      // 2026-08-08 (Tim) — the caddie SAYS it heard you ("Got it." in the persona voice, cached);
      // earcon only as first-run fallback. Not awaited — capture already ended, nothing to self-record.
      gotItCueFiredAt = Date.now(); // P2: tells the capture-end flow to skip its device-TTS pick-ack
      void playVerbalCue('gotit', GOTIT_EARCON, GOTIT_EARCON_MS).catch(() => {});
    }
    return;
  }
  // 2026-06-04 — Ignore re-tap during in-flight processing window.
  // See sessionInFlight comment above for rationale.
  if (sessionInFlight) { swallowedTap('session_in_flight'); return; }
  // 2026-07-06 (voice-lifecycle audit #2) — same double-fire as the recording-stop
  // branch, on the CLOSE side: one physical tap reaches toggle() twice (legacy sub
  // immediately + pattern sub ~350ms later). During 'responding' sessionInFlight is
  // already false, so tap #1 closed the session and tap #2 saw 'idle' and REOPENED
  // the mic right after the user tried to shush the caddie. Swallow toggles for a
  // short window after any close — the ECHO window only (600ms): reusing the 1.5s camera-release
  // constant here meant a genuine shush tap at a fast-responding caddie was eaten for a full 1.5s
  // after every "I'm done" endpoint tap.
  if (Date.now() - sessionCloseTapAt < TAP_ECHO_SWALLOW_MS) { swallowedTap('close_tap_echo'); return; }
  if (state === 'idle') {
    sessionInFlight = true;
    // A deliberate tap starts a fresh conversation — clear any auto-reopen chain the caddie's own
    // questions had built up, so the cap only ever bounds ONE run of unanswered questions.
    autoReopenChain = 0;
    await openSession();
  } else {
    // 'responding' (shush the caddie) or any other non-idle, non-listening state. The 'listening'
    // endpoint is handled above, before the sessionInFlight guard.
    sessionCloseTapAt = Date.now();
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
/**
 * 2026-08-12 (Tim, on 5G) — "we have the five G signal, but it's saying we can't connect… If
 * verified signal, guard error states."
 *
 * This single line was spoken for EVERY failure in this module — a handler throwing, the brain
 * returning empty, a slow turn — and every one of them blamed the user's connection. On full signal
 * that isn't just wrong, it's the app telling him his phone is broken when the phone is fine.
 *
 * Blaming the network now requires evidence that the network is at fault. getConnectionEvidence()
 * knows when our host last answered: if it answered seconds ago, the connection is provably not the
 * problem and we say something true instead. [[caddie-failsafe-no-walls]]
 */
// 2026-08-17 — the wording moved to services/caddieAckLines (the shared, dependency-free source),
// because the tap path needs the SAME lines: its aborted-transcribe branch was speaking "Didn't
// catch that" for what is plainly a connection failure. Two copies of a line is two chances to fix
// only one of them.
const FAILURE_FALLBACK: Record<string, string> = CADDIE_NOTICE_CONNECTION;
/** Connection is provably fine — own the failure instead of blaming their signal. */
const FAILURE_ON_US: Record<string, string> = CADDIE_NOTICE_ON_US;
/** 2026-08-17 — the mic-failed line for a language, from the one shared source (see caddieAckLines). */
function micTroubleFor(lang: 'en' | 'es' | 'zh'): string {
  return CADDIE_NOTICE_MIC_TROUBLE[lang] ?? CADDIE_NOTICE_MIC_TROUBLE.en;
}

function failureFallbackFor(lang: string | null | undefined): string {
  const key = (lang ?? 'en').toLowerCase().slice(0, 2);
  const pool = getConnectionEvidence().provenRecently ? FAILURE_ON_US : FAILURE_FALLBACK;
  return pool[key] ?? pool.en;
}

/**
 * Speak an honest "couldn't respond" message for the user's language
 * and pulse a short vibration, so dead silence never reads as broken.
 * Used by every silent-failure branch in this module (chat fallback
 * fetch errors, handler throws, outer catch). Cheap and idempotent —
 * the speak() call already serializes with stopSpeaking().
 */
/**
 * 2026-07-30 (voice audit #1) — a CUSTOM caddie must ship its chosen base persona + name on EVERY
 * /api/kevin body (this file's speculative, in-round-diagnostic, and small-talk fallbacks), or the
 * server defaults custom → Kevin's spec + onyx voice. Spread this into each kevin body. Best-effort.
 */
// 2026-08-09 (voice audit P1) — the small-talk kevin fallback (speculative + fresh) dropped every
// brain-steering setting (Kids Mode / response length / persona-intensity dial / Tank soft-intro) and
// keyed persona off the GLOBAL pick, so on the rare triple-failure / legacy path the fallback caddie
// behaved wrong + bled personas. This forwards the SAME steering the primary brain sends, with persona
// resolved to the ACTIVE per-pillar caddie. kevin ignores fields it doesn't use, so it's safe to spread.
function kevinSteering(): Record<string, unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const s = require('../store/settingsStore').useSettingsStore.getState();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const active = (require('./caddieResolver') as typeof import('./caddieResolver')).getActiveCaddie();
    const dial = s.personaIntensity?.[active];
    return {
      persona: active,
      responseMode: s.responseMode ?? 'neutral',
      cecilyMode: s.cecilyMode ?? false,
      personaIntensity: typeof dial === 'number' && Number.isFinite(dial) ? dial : 100,
      tankSoftIntro: s.tankSoftIntro ?? false,
      ...customCaddieFields(),
    };
  } catch {
    return { ...customCaddieFields() };
  }
}

function customCaddieFields(): { customCaddieBasePersona: string; customCaddieName: string | null } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('../store/playerProfileStore').usePlayerProfileStore.getState();
    return { customCaddieBasePersona: p.customCaddieBasePersona ?? 'kevin', customCaddieName: p.customCaddieName ?? null };
  } catch { return { customCaddieBasePersona: 'kevin', customCaddieName: null }; }
}

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
  // Snapshot what the caddie had last said, so the end-of-turn check below can tell a question the
  // caddie just ASKED from a stale line left over from an earlier turn.
  spokenLineAtOpen = getLastSpokenLine();
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
  /**
   * 2026-08-12 — was `prewarmVoice(true)`. Same reversal as the on-screen mic: firing five warmup
   * POSTs here saturated the per-host connection pool at exactly the moment the earbud turn needed
   * it. Release them instead. See services/voiceWarmup for the millisecond-level evidence.
   */
  abortVoiceWarmup();

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

  // Phase 1 — NO canned spoken opener.
  // 2026-07-26 (Tim — "we were supposed to remove the canned speech when I tap the earbuds w/ haptics;
  // unify the caddie mic and take out the prompts") — a tap-to-listen no longer announces itself with a
  // scripted line ("Yeah?" / the earbud_open dialog). The HAPTIC at the trigger chokepoint + the
  // universal "Listening…" status strip are the confirmation now — consistent across every mic source
  // (earbud, glasses, the mic badge). Go straight to the mic. `ttsAllowed` is still computed above and
  // used by the reply path below.
  void ttsAllowed;
  console.log('[path4:voice] opener_done (canned opener removed — haptic + Listening strip)');

  // Phase 2 — open mic for utterance
  //
  // 2026-08-11 (Tim) — "when I tap to talk, the first message gets cut off, and then she says she
  // can't hear me." The state flipped to 'listening' HERE, which lights the Listening… strip — but
  // the mic does not open until after the awaited verbal cue below, roughly a second later. So the
  // caddie was inviting him to speak while it was still speaking its own go-ahead and recording
  // nothing. He answered the invitation, the opening words went nowhere, and the truncated
  // transcript came back as "I didn't catch that". The state now stays 'opening' (which the status
  // strip already renders honestly as "One sec…") until the microphone is actually about to
  // capture. [[feels-like-a-real-caddie]]
  // 2026-08-06 (Tim — "no beep telling me the caddie is listening; the phone's 40y away in the cart").
  // 2026-08-08 (Tim — Tozo T6 never hears the 200ms tock; "add our own caddie VERBAL response, not canned
  // but logical"). The caddie now SAYS the go-ahead in its own voice — context-picked + rotating (cached
  // persona render; playVerbalCue falls back to the tock until the first online warm). AWAITED before the
  // mic opens so the cue can't be self-recorded. A spoken word also survives the BT route handoff that
  // swallowed the tock. userInitiated:true so it fires even at L1/Quiet (the user just tapped).
  /**
   * 2026-08-17 (Tim — "it goes 'I'm here', and then right away almost goes 'I didn't catch that'").
   *
   * THE MIC WAS NEVER OURS TO OPEN. The Caddie tab hands its own mic to the player after proactive
   * speech, and that recording sits open holding the microphone. A tap here then spoke the go-ahead
   * cue — "I'm here." — and only afterwards asked for the mic, which captureUtterance refused
   * because the tap path already had it. Nothing was recorded, and the empty result was announced
   * as "Didn't catch that.": the caddie inviting you to speak, refusing to listen, and blaming you
   * for the silence, in about a second.
   *
   * Claim the microphone BEFORE promising to listen. A deliberate tap outranks a recording the user
   * never asked for, so take it back first and cue second — then the invitation is true when it's
   * spoken. [[feels-like-a-real-caddie]] [[hands-free-zero-setup-is-the-product]]
   */
  const handover = await releaseExternalMic().catch(() => 'none' as const);
  if (handover !== 'none') console.log(`[path4:voice] mic_handover=${handover}`);
  if (handover === 'submitted') {
    // The tap path was holding a capture the player had ALREADY spoken into, so this tap is the
    // endpoint of that utterance, not the start of a new one — it is now being transcribed and
    // answered. Opening a second turn on top would talk over the reply to the player's own words.
    setSessionStateMirror('idle');
    return;
  }

  if (settings.voiceEnabled) {
    try { await playVerbalCue('listen', LISTENING_EARCON, LISTENING_EARCON_MS); } catch { /* non-fatal */ }
  }
  // 2026-08-06 (voice audit) — the earcon is awaited (~200ms), during which cancelMic is still null. If the
  // user cancels (a second tap → closeSession → state 'idle') DURING the earcon, stopCapture would be a
  // no-op and we'd open a phantom 12s recording after the session already closed. Re-check state here so a
  // cancel-during-earcon never opens the mic at all.
  // 2026-08-11 — the guard now checks 'opening', since that is the state we hold through the cue.
  if (state !== 'opening') return;

  // The cue has finished and capture begins on the next line — this is the first honest moment to
  // claim we are listening, so the strip, the halo and the tap-again endpoint all arm here.
  setSessionStateMirror('listening');
  listeningStartedAt = Date.now(); // 2026-08-07 — arms the tap-again endpoint (see toggle())
  console.log('[audit:voice] listening engaged');
  const t_capture_start = Date.now();
  console.log('[path4:voice] capture_start');
  /**
   * 2026-08-17 — one capture attempt. Factored out ONLY so the recovery below can run a second,
   * fresh one; the parameters are byte-identical to the single attempt this replaced.
   */
  const runCapture = async (): Promise<CaptureResult> => {
    try {
      // 2026-05-25 — Bumped 8s→12s. Open-mic users need room to express a
      // full thought during casual conversation ("hey Kevin, how are you
      // doing today, I've been working on my driver"). 8s was clipping
      // mid-sentence on natural-pace speech.
      const captureP = captureUtteranceDetailed(12_000, apiUrl, settings.language);
      cancelMic = () => {
        // Phase V.7 — real cancel via stopCapture; the recording stops
        // immediately and captureUtterance resolves with null.
        void stopCapture().catch(() => {});
      };
      return await captureP;
    } catch (e) {
      console.log('[listeningSession] capture failed', e);
      return { text: null, bail: 'error', heardSpeech: false, durationMs: null };
    } finally {
      cancelMic = null;
    }
  };
  let capture: CaptureResult = await runCapture();

  /**
   * 2026-08-17 — RESTART FRESH, ported from the tap path (useVoiceCaddie's `restartFresh`, added
   * 2026-08-12). That path learned months ago that a mic which never opened, or one that died
   * underneath us, means "try again" — not "tell the user we didn't hear them". The mic/earbud
   * path never got the lesson, so identical hardware trouble ended one surface in a retry and the
   * other in a fake apology. Same recovery, both paths now.
   *
   * Bounded to a SINGLE retry, and only for the two bails that mean the microphone itself failed:
   *   - mic_busy — the handover above lost a race with another recorder; take it and try again.
   *   - error    — the recording died mid-capture (an audio-session reconfigure, typically).
   * A capture that genuinely heard nothing is NOT retried; re-opening the mic on a user who simply
   * didn't speak is exactly the hot-mic behavior the standdown fix removed.
   */
  if (shouldRetryCapture(capture.bail) && (state as SessionState) === 'listening') {
    console.log(`[path4:voice] capture_retry after bail=${capture.bail}`);
    logVoiceSilentFail('listen_capture_retry', { source: 'listeningSession', bail: capture.bail });
    if (capture.bail === 'mic_busy') await releaseExternalMic().catch(() => false);
    capture = await runCapture();
  }
  const utterance: string | null = capture.text;
  const bail: CaptureBail | null = capture.bail;
  // 2026-08-11 — read through the cast: the `state !== 'opening'` guard above narrows the
  // module-level `state` to 'opening' for the rest of this function, and TS can't see that
  // setSessionStateMirror('listening') reassigned it. Runtime value is 'listening' here.
  const captureCancelled = (state as SessionState) !== 'listening' || !utterance || !utterance.trim();
  console.log(`[path4:voice] capture_done text_len=${utterance?.trim().length ?? 0} cancelled=${captureCancelled}`);
  if ((state as SessionState) !== 'listening') return;

  if (!utterance || !utterance.trim()) {
    /**
     * 2026-08-17 — SAY THE TRUE THING. Every no-transcript outcome used to speak the one line
     * "Didn't catch that.", which is a statement about the user's voice. It was spoken when the mic
     * was busy and never opened, when the recording died, and when Whisper returned a 502 — none of
     * which the user did, and only one of which they can fix by repeating themselves.
     *
     * Three honest outcomes now, keyed on WHY (services/voiceService CaptureBail):
     *   - the mic never worked  → own it, and say the mic is the problem
     *   - the transcribe failed → the existing evidence-aware connection line (which already
     *                             refuses to blame the network when our host answered seconds ago)
     *   - genuinely heard nothing → "Didn't catch that.", which is now TRUE when it is spoken
     * [[feels-like-a-real-caddie]] [[illustration-data-points]]
     */
    // The rule itself lives in services/voice/captureBail (pure + jest-owned), so "what may the
    // caddie claim happened" is one tested fact rather than a chain of inline booleans that a
    // future branch can quietly contradict.
    const say = responseForCaptureBail(bail);
    const micNeverOpened = say === 'mic_trouble';
    const transcribeFailed = say === 'connection';
    // A deliberate cancel (and an OS permission prompt) is not ours to talk over.
    const silentBail = say === 'silent';

    // 2026-08-17 — a deliberate cancel is the user doing exactly what they meant to; it is not a
    // failure and must never reach the issue log (voice_silent_fail schedules an auto-send, so
    // logging cancels here would have mailed Tim every time he shushed the caddie).
    if (!silentBail) logVoiceSilentFail('listen_no_transcript', {
      source: 'listeningSession',
      bail,
      // 2026-08-17 — lets a field report tell "the mic was open and the player said nothing" from
      // "the mic was never open", which the old log could not.
      heardSpeech: capture.heardSpeech,
      durationMs: capture.durationMs,
    });

    try {
      const settingsNow = useSettingsStore.getState();
      const lang = (['en', 'es', 'zh'] as const).includes(settingsNow.language as never) ? (settingsNow.language as 'en' | 'es' | 'zh') : 'en';
      // 2026-07-20 (bug-hunt fix) — respect the phone-speaker mute: the opener + every real
      // reply are suppressed on the phone speaker when voiceOnPhoneSpeaker is off, but this
      // device-TTS notice bypassed that gate and spoke aloud on a route the user muted.
      if (!silentBail && settingsNow.voiceEnabled && (route !== 'phone_speaker' || allowPhoneSpeaker)) {
        if (transcribeFailed) {
          await speakHonestFailure(lang, settingsNow.voiceGender, apiUrl);
        } else {
          const { speakDeviceNotice } = await import('./voiceService');
          const line = micNeverOpened ? micTroubleFor(lang) : CADDIE_NOTICE_DIDNT_CATCH;
          await speakDeviceNotice(line, lang, settingsNow.voiceGender).catch(() => {});
        }
      }
    } catch { /* notice is best-effort */ }
    setSessionStateMirror('idle');
    return;
  }
  const t_capture_end = Date.now();
  lastCaptureEndMs = t_capture_end;

  // 2026-07-18 (Tim — spoken "got it" ack on capture end, VARIED so it feels natural). Immediate
  // device-TTS confirmation that we heard you, THEN it processes. Best-effort + gated on
  // voiceEnabled; the real response (persona voice) supersedes it via the one-voice invariant, so
  // a fast answer simply cuts the short ack — never talks over it in a stacked way.
  try {
    const settingsAck = useSettingsStore.getState();
    // 2026-07-20 (bug-hunt fix) — same phone-speaker mute respect as the opener/replies:
    // don't speak the "got it" ack aloud on the phone speaker when the user muted it.
    // 2026-08-09 (voice audit P2) — skip this device-TTS ack when a tap-to-submit just played the
    // persona "Got it" cue (within 4s): firing it here stops the mp3 mid-word (one-voice invariant) and
    // replaces a natural cue with a robotic stutter. Silence/VAD-ended captures (no tap cue) still ack.
    const gotItRecent = Date.now() - gotItCueFiredAt < 4000;
    if (settingsAck.voiceEnabled && !gotItRecent && (route !== 'phone_speaker' || allowPhoneSpeaker)) {
      const lang = (['en', 'es', 'zh'] as const).includes(settingsAck.language as never) ? (settingsAck.language as 'en' | 'es' | 'zh') : 'en';
      const { speakDeviceNotice } = await import('./voiceService');
      void speakDeviceNotice(pickAck(lang), lang, settingsAck.voiceGender).catch(() => {});
    }
  } catch { /* ack is best-effort — never blocks the turn */ }

  // Phase 3 — classify + respond
  setSessionStateMirror('thinking');
  // Phase P — TTFA instrumentation. t0 = capture end.
  const t0 = Date.now();
  try {
    // 2026-07-29 (audit fix #2 — earbud disambiguation dead-end). When a quick-round utterance
    // matched several courses, the caddie asked "which one?" and stashed the candidates. The on-screen
    // mic path (useVoiceCaddie) resolves the follow-up ("the Valley one" / "Austin" / "the first one")
    // against them BEFORE classification — but THIS hands-free / earbud / watch turn path never did,
    // so on earbuds the answer was re-classified from scratch (which drops the list) and the round
    // never started. Mirror the useVoiceCaddie intercept: resolve → speak the confirm line → done.
    // Returns null on a non-match (strict matcher), so a normal command falls straight through to the
    // precheck/classify below untouched — it never hijacks or false-starts.
    const courseResolved = resolvePendingCourseUtterance(utterance);
    if (courseResolved) {
      const resolveAllowed = settings.voiceEnabled && (route !== 'phone_speaker' || allowPhoneSpeaker);
      if ((state as SessionState) === 'thinking') setSessionStateMirror('responding');
      if (resolveAllowed && getSessionState() === 'responding') {
        await stopSpeaking().catch(() => {});
        if (getSessionState() === 'responding') {
          await speak(courseResolved.confirmLine, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
            .catch((e) => console.log('[listeningSession] course-resolve speak failed', e));
        }
      }
      setSessionStateMirror('idle');
      return;
    }

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
    /**
     * 2026-08-12 — the open putt question, on the earbud / global-mic path too.
     *
     * Tim answers the caddie hands-free as often as by tapping, and this path runs its own
     * classification, so without this a bare "two" here becomes a score exactly as it did on the
     * tap path. Same shared state and strict parser as the on-screen mic.
     */
    if (isAwaitingPutts()) {
      const answered = parsePuttAnswer(utterance);
      if (answered !== null) {
        const rs = useRoundStore.getState();
        rs.logPutts(awaitingPuttsHole() ?? voicePuttsHole(rs), answered);
        clearAwaitingPutts();
        const line = `Got it — ${answered} putt${answered !== 1 ? 's' : ''}.`;
        if ((state as SessionState) === 'thinking') setSessionStateMirror('responding');
        if (settings.voiceEnabled && (route !== 'phone_speaker' || allowPhoneSpeaker)) {
          await stopSpeaking().catch(() => {});
          await speak(line, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
            .catch((e) => console.log('[listeningSession] putt-answer speak failed', e));
        }
        setSessionStateMirror('idle');
        return;
      }
      clearAwaitingPutts();
    }

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
          // 2026-08-09 (voice audit P1) — full steering + ACTIVE persona (was global + no steering).
          ...kevinSteering(),
        }),
      }, kevinTimeout()).catch(() => null);

      const parseRes = await fetchWithTimeout(`${apiUrl}/api/voice-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AI-Provider': settings.aiProvider ?? 'gemini' },
        // 2026-05-21 — Fix Q: pass active persona so the classifier's
        // follow-up question (if any) is styled in the user's selected
        // caddie's voice, not the voiceGender-derived Kevin/Serena default.
        body: JSON.stringify({
          text: utterance,
          voiceGender: settings.voiceGender ?? 'male',
          // 2026-08-09 (pass-2 P3) — active per-pillar persona for consistent clarifier styling.
          persona: (require('./caddieResolver') as typeof import('./caddieResolver')).getActiveCaddie(),
          ...customCaddieFields(),
        }),
      }, intentTimeout());
      if (!parseRes.ok) {
        speculativeController?.abort();
        // 2026-07-06 (voice-lifecycle audit #8a) — this was a SILENT return: the user
        // heard the opener, spoke, and got dead air. Speak the honest failure line
        // (same treatment the diagnostic + small-talk branches already have).
        // 2026-07-06 (voice-parity F4) — this branch runs BEFORE the state moves to
        // 'responding' (that happens at line ~534, after a SUCCESSFUL parse). At a
        // parse FAILURE the state is still 'thinking' (set at openSession), so the
        // old `=== 'responding'` guard was never true → the honest line never fired
        // (the exact dead-air this block was added to fix). Check the state actually
        // set here so the failure line speaks.
        if (ttsAllowed && getSessionState() === 'thinking') {
          await speakHonestFailure(settings.language, settings.voiceGender, apiUrl).catch(() => {});
        }
        setSessionStateMirror('idle');
        return;
      }
      /**
       * 2026-08-20 (JSON-cast audit) — VALIDATE, don't assert.
       *
       * This cast told TypeScript the classifier had returned a VoiceIntent. It had not necessarily
       * returned anything of the sort: an error body, a proxy page, a truncated response, or a shape
       * change all land here as "a VoiceIntent" with an undefined intent_type. Downstream, dispatch()
       * tests for 'conversational' and for 'unknown' — undefined matches NEITHER, so a malformed
       * response slipped past both and fell into handler lookup carrying nothing usable.
       *
       * The honest reading of "the classifier gave us something we don't recognise" is exactly the
       * one the system already has a good answer for: unknown / low confidence. That routes to the
       * local status responder first and then the brain, which is what should happen when we do not
       * understand the player — instead of walking into the handler table with an undefined type.
       *
       * This is the class behind three separate defects this month (recommend_club twice,
       * courseToHoles yesterday): a cast asserting network data into a shape the compiler then
       * believes. Casting is not parsing.
       */
      const parsedIntent = await parseRes.json() as Partial<VoiceIntent> | null;
      const knownType = typeof parsedIntent?.intent_type === 'string' && parsedIntent.intent_type.length > 0;
      if (!knownType) {
        console.log('[path4:voice] classifier returned an unrecognisable shape — treating as unknown');
        logVoiceSilentFail('intent_shape_invalid', { source: 'listeningSession', got: Object.keys(parsedIntent ?? {}).slice(0, 6).join(',') });
      }
      intent = (knownType
        ? parsedIntent
        : { ...(parsedIntent ?? {}), intent_type: 'unknown', confidence: 'low' }) as VoiceIntent;
      // 2026-08-08 (2-week audit V2 — earbud "open settings" dead-ended). The cloud classifier returns
      // NO raw_text (the VoiceIntent typing masked it), and the 08-07 EXPLICIT_OPEN gate in
      // openToolHandler reads intent.raw_text to find the open/show verb — so every classifier-routed
      // tool open on THIS path evaluated the gate against '' and got bounced to the brain even when the
      // user literally said "open". Backfill from the utterance we already hold (the watch path at
      // handleTranscribedUtterance already does exactly this). Also un-breaks the send-log verb
      // fallback, coach-name regex, record-intent backstop, and catalog lookup on raw_text.
      if (!intent.raw_text) intent.raw_text = utterance;
      // Cloud escalation — the local precheck + local-primary both missed, so we paid
      // the classifier (and usually the brain). The metric Tim watches: this should
      // trend DOWN relative to local as the CNS brain grows.
      try { useVoiceHitRateStore.getState().recordCloud(`cloud:${intent.intent_type}`, Date.now()); } catch { /* non-fatal */ }
    }
    const t_intent = Date.now();
    console.log(`[path4:voice] intent=${intent.intent_type} topic=${(intent.parameters?.query_topic as string | undefined) ?? 'none'}`);
    if ((state as SessionState) !== 'thinking') return;

    setSessionStateMirror('responding');

    // 2026-07-06 (voice audit — H1 on the hands-free path) / 2026-07-07 (re-audit fix) —
    // the DISRUPTIVE_OPEN gate that lives in useVoiceCaddie was MISSING here, so over the
    // earbud / global mic a medium-confidence misread of NARRATIVE ("I want to work on my
    // putting") could yank a tool open uninvited — on the owner's #1 surface. If a
    // classifier tool-OPEN intent isn't HIGH confidence, don't fire it: make it an OFFER
    // (confirm-before-open) and let the mic re-open. Data capture / queries (log_shot,
    // state_yardage, etc.) are NOT gated — only tool-opens.
    //
    // This MUST run BEFORE handler.execute(): `navigate` (next/prev hole) and
    // `media_capture` (open camera / autoRecord) act synchronously INSIDE execute(),
    // so gating after the handler ran let the action fire anyway — and a repeated
    // "next hole" then advanced TWICE. `open_tool` defers to result.tool_action, so it
    // was the only one the old post-handler placement actually caught. Gate here and all
    // three are truly held until the user re-confirms.
    const DISRUPTIVE_OPEN_INTENTS = new Set(['open_tool', 'media_capture', 'navigate']);
    if (DISRUPTIVE_OPEN_INTENTS.has(intent.intent_type) && intent.confidence !== 'high') {
      // 2026-07-20 (bug-hunt fix) — this gate returns without consuming the speculative
      // brain call, so abort it (matches the handler + small-talk exit paths) instead of
      // leaking an in-flight billed /api/kevin fetch whose result is discarded.
      speculativeController?.abort();
      await stopSpeaking().catch(() => {});
      if (ttsAllowed && getSessionState() === 'responding') {
        await speak(
          'Want me to open that? Just say it again and I will.',
          settings.voiceGender, intent.language ?? settings.language, apiUrl,
          { userInitiated: true },
        ).catch(() => {});
      }
      setSessionStateMirror('idle');
      return;
    }

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
      // 2026-08-06 (Tim — no pre-canned speech; earcon only). The router still decides WHEN a turn warrants
      // a "hang on, thinking" signal (decision.filler), but instead of speaking a canned bridge word we play
      // ONE soft non-verbal earcon. The caddie then SPEAKS only the real AI answer — never a template. Kept
      // as fillerP (awaited before speak below) so the earcon never gets cut off mid-tone by the response.
      t_filler_start = Date.now();
      const tStart = t_filler_start;
      console.log(`[path4:voice] earcon_start category=${decision.filler}`);
      fillerP = playLocalFile(THINKING_EARCON, THINKING_EARCON_MS)
        .then(() => { console.log(`[path4:voice] earcon_end ms=${Date.now() - tStart}`); })
        .catch(() => {});
    }

    // Phase BH — in-round diagnostic Coach. When the user describes a
    // multi-shot pattern and asks "why", route to /api/kevin Sonnet with
    // register='coach' override + inRoundDiagnostic flag. The Coach
    // prompt sub-branch returns ~30-45s of pattern reasoning.
    if (intent.intent_type === 'in_round_diagnostic' && round.isRoundActive) {
      // 2026-07-20 (bug-hunt fix) — this branch fires its OWN /api/kevin diagnostic call and
      // returns without consuming the speculative one; abort the speculative fetch up front so
      // we don't run two concurrent billed /api/kevin calls for a single utterance.
      speculativeController?.abort();
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
          // 2026-08-09 (pass-2 C1) — persona + intensity off the ACTIVE per-pillar caddie, not the global
          // pick (this in-round diagnostic is a brain-answer; global bled the wrong persona/dial).
          persona: (require('./caddieResolver') as typeof import('./caddieResolver')).getActiveCaddie(),
          ...customCaddieFields(),
          personaIntensity: settingsStore.personaIntensity?.[(require('./caddieResolver') as typeof import('./caddieResolver')).getActiveCaddie()] ?? 100,
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
        }, kevinTimeout());
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
              const r = await conversationalBrainTurn(utterance, { timeoutMs: kevinTimeout() });
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
                  if (r.audioBase64) await speakFromBase64(r.audioBase64, { userInitiated: true, caption: r.text }).catch((e) => console.log('[listeningSession] pipecat speakFromBase64 failed', e));
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
                // 2026-08-09 (voice audit P1) — full steering + ACTIVE persona (was global + no steering).
                ...kevinSteering(),
              }),
            }, kevinTimeout());
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
                  await speakFromBase64(replyAudio, { userInitiated: true, caption: reply })
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
          // 2026-08-06 (Tim — earcon only, no words): on a long wait (e.g. a ~13s vision read) play the same
          // soft earcon again as a subtle "still working" pulse instead of a spoken extension filler
          // ("Still working through this..."). Spaced so it's a gentle beat, not a rattle; the loop re-checks
          // readiness between pulses.
          await playLocalFile(THINKING_EARCON, THINKING_EARCON_MS).catch(() => {});
          await new Promise((r) => setTimeout(r, 1800));
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
          const r = await conversationalBrainTurn(utterance, { timeoutMs: kevinTimeout() });
          if (r.toolActions?.length) {
            const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
            dispatchConversationalToolActions(r.toolActions);
          }
          if (r.text && responseAllowed && getSessionState() === 'responding') {
            await stopSpeaking().catch(() => {});
            if (getSessionState() === 'responding') {
              if (r.audioBase64) await speakFromBase64(r.audioBase64, { userInitiated: true, caption: r.text }).catch((e) => console.log('[listeningSession] route_to_brain speakFromBase64 failed', e));
              else await speak(r.text, settings.voiceGender, intent.language ?? settings.language, apiUrl, { userInitiated: true }).catch((e) => console.log('[listeningSession] route_to_brain speak failed', e));
            }
          } else if (r.text && !responseAllowed) {
            // 2026-07-30 (voice/brain audit H1 — Tim: "user should be able to voice off and still get
            // ALL the text responses"). Earbud/hands-free path: voice muted (or phone-speaker gate) → still
            // SHOW the brain's reply so a hands-free turn is never a silent dead turn.
            try { flashCaption?.(r.text, 7000); } catch { /* non-fatal */ }
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
      } else if (result.voice_response && !responseAllowed) {
        // 2026-07-30 (voice/brain audit H1 — Tim: "voice off and still get ALL the text responses").
        // Earbud/hands-free with voice muted (or phone-speaker gated) → SHOW the handler's reply so the
        // turn isn't silently dead. tool_action (below) still dispatches regardless.
        try { flashCaption?.(result.voice_response, 7000); } catch { /* non-fatal */ }
      } else if (!result.voice_response && responseAllowed) {
        // 2026-05-21 — Fix I shape A: handler returned no voice_response
        // (e.g. an internal failure path with no fallback string). Don't
        // leave the pill idle in silence — speak an honest "having
        // trouble" line. Some handlers legitimately have no spoken reply
        // (e.g. navigation tool_actions that route the user); those set
        // result.tool_action, which we still execute below. For the
        // pure-no-output case the user gets the localized failure line.
        // 2026-07-26 (deep audit S2) — but a SUCCESSFUL handler that chose
        // silence (acknowledge: "thanks"/"okay"/"got it" → success:true,
        // voice_response:null, side_effects:['acknowledge']) was falling in
        // here and speaking "I'm having trouble connecting" on a totally
        // normal ack. Only speak the failure line when the handler actually
        // FAILED (success === false) — an intentional silent-success stays
        // silent, matching the text/watch path which guards on voice_response.
        if (!result.tool_action && result.success === false && getSessionState() === 'responding') {
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

  // 2026-08-11 (Tim — "she ends with something like 'what's on your mind today', but doesn't
  // listen"). If the caddie just ASKED something, keep the mic for the answer instead of making him
  // tap again to reply to a question he didn't ask for. See MAX_AUTO_REOPENS for why this is capped.
  const finalLine = getLastSpokenLine();
  const askedSomething = finalLine !== spokenLineAtOpen && endsAsQuestion(finalLine);
  if (askedSomething && autoReopenChain < MAX_AUTO_REOPENS && useSettingsStore.getState().voiceEnabled) {
    autoReopenChain += 1;
    console.log('[path4:voice] auto_reopen_after_question', { chain: autoReopenChain });
    // Mirror what toggle() does for a real tap: setSessionStateMirror already cleared the in-flight
    // lock on the way to 'idle', so re-arm it here or a stray earbud echo would open a SECOND
    // session on top of the one we're about to start.
    sessionInFlight = true;
    void openSession().catch((e) => {
      console.log('[listeningSession] auto-reopen failed', e);
      sessionInFlight = false;
      setSessionStateMirror('idle');
    });
    return;
  }
  autoReopenChain = 0;
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
/**
 * 2026-07-30 (Tim — iPad "stuck listening, and tapping to stop won't stop"). Public force-close so the
 * on-screen mic (useVoiceCaddie.handleMicPress) can ALWAYS cancel a hands-free/VAD session that's in
 * flight or hung on a cold transcribe — instead of no-oping and leaving the user trapped. Idempotent,
 * never throws (cancelling must never crash).
 */
export function forceCloseSession(): void {
  try { closeSessionInternal('user_close'); } catch { /* never throw from a force-close */ }
}

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
  // 2026-07-25 (Tim — "give all mics a universal state display; not sure he's going to answer") — this
  // TYPED / watch path never drove the shared listening state, so the universal status strip showed
  // nothing after you hit send. Set 'thinking' now (strip shows "Thinking…" immediately) and reset to
  // idle in finally; the caddie's ANSWER shows via the voiceService caption while it speaks. Drive the
  // store directly (not the session-machine mirror, which arms voice-session watchdogs).
  const setSharedState = (s: 'thinking' | 'idle') => {
    try { require('../store/listeningSessionStore').useListeningSessionStore.getState().setState(s); } catch { /* non-fatal */ }
  };
  setSharedState('thinking');
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
          // 2026-08-09 (pass-2 P3) — active per-pillar persona for consistent clarifier styling.
          persona: (require('./caddieResolver') as typeof import('./caddieResolver')).getActiveCaddie(),
          ...customCaddieFields(),
        }),
      }, intentTimeout());
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
        const r = await conversationalBrainTurn(text, { timeoutMs: kevinTimeout() });
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
        if (r.text) {
          const { speak, speakFromBase64, flashCaption } = await import('./voiceService');
          if (ttsAllowed) {
            if (r.audioBase64) {
              await speakFromBase64(r.audioBase64, { userInitiated: true, caption: r.text }).catch(() => undefined);
            } else {
              await speak(r.text, settings.voiceGender, intent.language ?? settings.language ?? 'en', apiUrl, { userInitiated: true })
                ?.catch?.(() => undefined);
            }
          } else {
            // 2026-08-01 (tester — "took out canned greetings, now I type 'hi' and nothing happens").
            // With voice OFF (or the phone-speaker gate), still SHOW the brain's reply so a TYPED
            // question always gets a visible answer instead of silence.
            try { flashCaption?.(r.text, 7000); } catch { /* non-fatal */ }
          }
        } else {
          // 2026-07-30 (voice/brain audit H5) — brain returned EMPTY (timeout / flaky signal). Don't leave
          // a dead turn on the watch/earbud: speak the honest "trouble connecting" line, or caption it muted.
          if (ttsAllowed) { try { await speakHonestFailure(settings.language, settings.voiceGender, apiUrl); } catch { /* non-fatal */ } }
          // 2026-08-20 — caption the SAME line the caddie would have spoken. This was a hardcoded
          // third wording ("Having trouble connecting — try again in a moment"), so a voice-off user
          // read different words than a voice-on user heard — and it ALWAYS blamed the connection,
          // even when getConnectionEvidence proves the host answered seconds ago. That is the line
          // Tim had removed from the spoken path on 2026-08-12; it survived here because the muted
          // branch was written separately and nothing tied the two to one source.
          else { try { flashCaption?.(failureFallbackFor(settings.language), 6000); } catch { /* non-fatal */ } }
        }
      } catch (e) {
        console.log('[handsFree-route] conversational fallback failed:', e);
      }
      return;
    }
    // 2026-07-30 (voice audit #3) — the watch/typed path had NO disruptive-open confidence gate (the mic
    // + earbud paths both require confidence==='high' for open_tool/media_capture/navigate). A medium-
    // confidence watch-STT misread of ordinary speech could yank a tool open or advance the hole. Mirror
    // the gate: at less-than-high confidence, OFFER instead of acting (open_course already self-gates).
    const DISRUPTIVE_OPEN_INTENTS = new Set(['open_tool', 'media_capture', 'navigate']);
    if (DISRUPTIVE_OPEN_INTENTS.has(intent.intent_type) && intent.confidence !== 'high') {
      const offer = 'Want me to open that? Just say it again and I will.';
      if (settings.voiceEnabled ?? true) {
        await speak(offer, settings.voiceGender, intent.language ?? settings.language ?? 'en', apiUrl, { userInitiated: true })?.catch?.(() => undefined);
      } else {
        try { flashCaption?.(offer, 6000); } catch { /* non-fatal */ }
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
        const r = await conversationalBrainTurn(text, { timeoutMs: kevinTimeout() });
        if (r.toolActions?.length) {
          const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
          dispatchConversationalToolActions(r.toolActions);
        }
        if (r.text) {
          const route2 = getCurrentRoute();
          const allowPhoneSpeaker2 = (settings as unknown as { voiceOnPhoneSpeaker?: boolean }).voiceOnPhoneSpeaker === true;
          const ttsAllowed2 = (settings.voiceEnabled ?? true) && (route2 !== 'phone_speaker' || allowPhoneSpeaker2);
          const { speak, speakFromBase64, flashCaption } = await import('./voiceService');
          if (ttsAllowed2) {
            if (r.audioBase64) await speakFromBase64(r.audioBase64, { userInitiated: true, caption: r.text }).catch(() => undefined);
            else await speak(r.text, settings.voiceGender, intent.language ?? settings.language ?? 'en', apiUrl, { userInitiated: true })?.catch?.(() => undefined);
          } else {
            // 2026-08-01 (tester) — show the reply for a TYPED turn even when voice is muted.
            try { flashCaption?.(r.text, 7000); } catch { /* non-fatal */ }
          }
        } else {
          // 2026-07-30 (voice/brain audit H5) — empty brain reply → honest line, don't leave dead air.
          const route2 = getCurrentRoute();
          const allowPhoneSpeaker2 = (settings as unknown as { voiceOnPhoneSpeaker?: boolean }).voiceOnPhoneSpeaker === true;
          const ttsAllowed2 = (settings.voiceEnabled ?? true) && (route2 !== 'phone_speaker' || allowPhoneSpeaker2);
          if (ttsAllowed2) { try { await speakHonestFailure(settings.language, settings.voiceGender, apiUrl); } catch { /* non-fatal */ } }
          // Same one-source rule as the sibling branch above.
          else { try { flashCaption?.(failureFallbackFor(settings.language), 6000); } catch { /* non-fatal */ } }
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
  } finally {
    // Clear "Thinking…"; the response text keeps showing via the caption/speaking signals while the
    // caddie is talking, then the strip hides once speech ends.
    setSharedState('idle');
  }
}
