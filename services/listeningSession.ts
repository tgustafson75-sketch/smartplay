import { Vibration } from 'react-native';

import { BRAIN_FETCH_TIMEOUT_MS as KEVIN_FETCH_TIMEOUT_MS, COLD_BRAIN_FETCH_TIMEOUT_MS as COLD_KEVIN_FETCH_TIMEOUT_MS } from '../constants/voiceTimeouts';
import { endsAsQuestion } from './voice/endsAsQuestion';
import { raceHedged, type HedgeAttempt } from './voice/hedgedFetch';
import { speak, speakFromBase64, stopSpeaking, captureUtteranceDetailed, releaseExternalMic, playLocalFile, stopCapture, endCaptureEarly, flashCaption, getLastSpokenLine, isCapturing, isExternalMicActive, isSpeaking, isSpeakingUserInitiated, type CaptureBail, type CaptureResult } from './voiceService';
import { logVoiceSilentFail, logVoiceDiag, describeError } from './voiceErrorLog';
import { noteTurnState, noteTurnIntent, noteTurnClosing, noteTurnActed } from './voice/turnAnswerWatch';
import { adviceIsStillWorthSaying, captureShotEpoch, currentTurnEpoch } from './adviceFreshness';
import { responseForCaptureBail, shouldRetryCapture } from './voice/captureBail';
import { conversationalBrainTurn } from './conversationalBrain';
import { abortVoiceWarmup } from './voiceWarmup';
import { noteUserTurn, getUserTurnEpoch } from './userTurnClock';
import { noteCaddieTurn } from './funnelEvents';
import { takeCaddiePaywallBlock, CADDIE_PAYWALL_DEFERRED_LINE } from './featureAccess';
import { getDialog } from './dialogEngine';
import { ACK_PHRASES, CADDIE_NOTICE_DIDNT_CATCH, CADDIE_NOTICE_MIC_NEEDS_APP, CADDIE_NOTICE_MIC_OFF, CADDIE_NOTICE_MIC_TROUBLE, GOTIT_CUES, TRUST_L1_OPENER } from './caddieAckLines';
import { settleForegroundForMic, micMayBeRefusedNow } from './appForeground';
import { getTrustLevel } from './trustLevelService';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { voiceCommandRouter } from './intents';
import { subscribeEarbudTap } from './earbudControl';
import { isSmartMotionRecording, emitSmartMotionCommand } from './smartMotionRecordBus';

import { routeQuery } from './responseRouter';
import { getActiveSurface } from './activeSurfaceRegistry';
import { precheckLocalIntent } from './localIntentPrecheck';
import { resolvePendingCourseUtterance } from './pendingDisambiguation';
import { useVoiceHitRateStore } from '../store/voiceHitRateStore';
import type { AppContext, VoiceIntent } from '../types/voiceIntent';
import { getApiBaseUrl, isEndpointWarmed, markEndpointWarmed } from './apiBase';
import { tryAnswerOpenQuestion } from './pendingPuttAsk';
import { isFlagEnabled } from '../store/flagStore';
import { isAwaitingFollowUp, recordUserTurn, recordKevinTurn } from './conversationState';
import { carriesYardageCorrection } from './intents/stateYardageHandler';
import { beginTurnForOffer, isAnsweringOffer } from './voice/pendingOpenOffer';
import { preBrainReply, shapeForBrain } from './voice/preBrainTurn';
import { resultWantsBrain } from './voiceCommandRouter';
import type { BrainReply } from './conversationalBrain';
// 2026-08-06 (Tim — "no more pre-canned speech; use a subtle earcon, no words" during the think gap). The
// "thinking" earcon: a soft NON-VERBAL tone played ONCE when a turn will take a beat, replacing the old
// spoken filler words ("Let me see...", "Looking at those swings...") — the loudest canned-speech surface.
// Reuses an already-bundled tone so it ships OTA (no new binary needed). [[feels-like-a-real-caddie]]
 
const THINKING_EARCON: number = require('../assets/audio/tempo/tick.mp3');
const THINKING_EARCON_MS = 180;
// 2026-08-06 (Tim — "when I tap the earbud there's no beep/haptic telling me the caddie is LISTENING; the
// phone's 40 yards away in the cart so I can't see the indicator or feel the phone haptic — I just talk and
// hope"). A distinct "I'm listening" earcon played THROUGH THE AUDIO ROUTE (the earbud, where his ears are)
// the instant the mic opens — the audible go-ahead the phone haptic can't give when the phone is far away.
 
const LISTENING_EARCON: number = require('../assets/audio/tempo/tock.mp3');
const LISTENING_EARCON_MS = 200;
// 2026-08-07 (Tim — "then user will tap again with ANOTHER sound confirming"). A SECOND, DISTINCT tone
// (a crisp tick vs the listening tock) played the instant a tap-again ENDS the utterance — the audible
// "got it, I'm on it" the earbud user needs when the phone's in the cart. Pairs with the spoken capture
// ack below (the caddie then confirms it heard). [[feels-like-a-real-caddie]]
 
const GOTIT_EARCON: number = require('../assets/audio/tempo/tick.mp3');
const GOTIT_EARCON_MS = 180;

// 2026-07-25 (Tim — "first ask errors every time") — cold-aware brain timeout, mirroring useVoiceCaddie.
// The FIRST turn after launch is cold on the Lambda + provider SDK + tool rounds; a fixed 30s aborts it.
// Give the brain a longer budget until the connection is confirmed warm; warm turns keep the tight bound.
// 2026-09-28 — per FUNCTION, like transcribe since 08-20. isConnectionWarmed() is flipped by the boot
// ping and by ANY success, so a never-touched brain or classifier got the warm budget and aborted cold.
const kevinTimeout = (): number => (isEndpointWarmed('/api/kevin') ? KEVIN_FETCH_TIMEOUT_MS : COLD_KEVIN_FETCH_TIMEOUT_MS);

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
const intentTimeout = (): number => (isEndpointWarmed('/api/voice-intent') ? INTENT_FETCH_TIMEOUT_MS : COLD_INTENT_FETCH_TIMEOUT_MS);
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
/**
 * 2026-08-23 — LOCAL_PRIMARY_TYPES deleted with the local-first intercept it drove. It listed the
 * 16 query types answered without ever calling the brain, and it included the two a caddie exists
 * for: yardage and wind. Kept nowhere, because a list of "questions the caddie does not get asked"
 * is the shape of the problem, not a thing to preserve.
 */

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
// 2026-10-30 (caddie-voice-1) — typed / watch turns still answering (handleTranscribedUtterance). They
// never raise sessionInFlight, so toggle() reads this count to drop a tap while one is in flight.
let typedTurnsInFlight = 0;
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
/**
 * 2026-10-27 (Sentry P9: too_short, heardSpeech true, durationMs 0, iPhone) — an "I'm done" tap asks for
 * the persona "Got it" cue, and the capture-end ack plays it once the recording has STOPPED. It used to
 * play at the tap, over the still-live recorder: playback sets allowsRecordingIOS false, which makes
 * expo-av pause the iOS recorder without banking its time (EXAV.m:275-278, 622-624), so the capture
 * read 0 ms, was dropped as too_short, and the player's words were thrown away.
 */
let gotItOnCaptureEnd = false;

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
/** When the open tap landed — lets an echo be told from a real second press during 'opening'. */
let sessionOpenTapAt = 0;
/** A real tap arrived while the mic was still opening: skip the go-ahead cue and listen now. */
let skipOpenCue = false;
/** Hard ceiling on one listen. See the note at the capture call site — outdoors this is what stops it. */
const MAX_UTTERANCE_MS = 8_000;
let autoReopenChain = 0;
/** The last line the caddie spoke before this turn opened — lets us tell "new question" from stale. */
let spokenLineAtOpen: string | null = null;

/**
 * 2026-10-15 (review G2) — WHICH SESSION OWNS THE TURN.
 *
 * `state` is module-global, and a turn is many awaits long (capture, classify, a cold brain call of
 * up to 48s, speech). A player who shushes a slow turn, taps again and asks again has TWO turns in
 * flight: when the old brain call finally lands, the old turn wrote 'idle' over the new session's
 * 'listening' — the new capture then returned into a state it no longer recognised and the question
 * was dropped (still billed) — or the old answer was spoken during the new turn.
 *
 * Every openSession takes a serial; every close bumps it. A turn checks it after each await and
 * before every state write or speak, so a turn the player closed, or one a newer session replaced,
 * can no longer touch anything. The same bump IS the closed-by-user flag: a turn closed mid-reply
 * never reaches the auto-reopen tail, so a shush is not answered by the mic opening again.
 */
let sessionSerial = 0;
/** Aborts the in-flight brain request of the live turn when the session is closed. */
let turnAbort: AbortController | null = null;

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
// TTS playback (long replies can hit 40-50s for Serena multi-
// sentence answers). 90s comfortably covers that with headroom.
/**
 * 2026-08-27 — RE-DERIVE THIS WHEN A TIMEOUT MOVES. The arithmetic above is the arithmetic of
 * 2026-05-26 and two of its terms have since changed underneath it: the classifier's "~3s" became
 * COLD_INTENT_FETCH_TIMEOUT_MS = 22s (07-29) and the brain's "up to 30s" became
 * COLD_KEVIN_FETCH_TIMEOUT_MS = 48s (07-25). Neither commit came back here.
 *
 * The watchdog re-arms on every state transition, so the budget that matters is the LONGEST SINGLE
 * STATE, not the whole turn — and 'responding' now holds a cold brain call (48s) plus TTS render and
 * playback (40-50s on a long answer). That is 88-98s against a 90s force-close, i.e. the watchdog
 * can fire on a turn that is working. It closes the session mid-answer, and every speak branch is
 * gated on the session still being 'responding'.
 *
 * Raised to 150s, derived from the real constants rather than the old ones, with headroom for the
 * same reason the original had it. This is a WATCHDOG against a wedged session, not a response-time
 * budget — the fetches carry their own timeouts and are what actually bound a slow turn. Making it
 * generous costs a stuck session a longer wait; making it too tight costs a good answer.
 * [[my-measurement-is-the-least-reliable-part]]
 */
const DORMANCY_MAX_MS = 150_000;
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
/** What a cue actually played — the spoken line (empty when none was picked) and whether it was the
 *  caddie's own cached clip or the earcon fallback. openSession logs it as the Path 4 opener marker. */
type VerbalCueResult = { text: string; via: 'clip' | 'earcon' };
async function playVerbalCue(kind: 'listen' | 'gotit', fallbackEarcon: number, fallbackMs: number): Promise<VerbalCueResult> {
  let text = '';
  try {
    /**
     * 2026-08-23 — the LISTEN opener now comes from pickOpener() (role + trust aware, via the
     * dialog templates) instead of the two flat LISTEN_CUES pools, which knew only round vs idle.
     *
     * Both halves matter: the text source AND the audio. These lines are pre-rendered in the
     * persona's voice by services/offlineVoiceCache; a line missing from OFFLINE_LINES resolves to
     * no clip and this function falls through to an EARCON — the caddie replaced by a beep. The
     * three roles' earbud_open templates were added there in the same change for exactly that
     * reason.
     */
    text = kind === 'gotit' ? pickCue(GOTIT_CUES) : pickOpener();
    // Review G2 (finding 7) — the active caddie and its gender: the same pair the clips are warmed under.
    const { persona, gender } = (require('./voiceService') as typeof import('./voiceService')).activeVoice();
    const cache = await import('./offlineVoiceCache');
    const uri = text ? cache.resolveCachedOfflineClipUri(text, gender, persona) : null;
    if (uri) { await playLocalFile(uri, undefined, { userInitiated: true }); return { text, via: 'clip' }; }
  } catch { /* additive — fall through to the earcon */ }
  try { await playLocalFile(fallbackEarcon, fallbackMs, { userInitiated: true }); } catch { /* non-fatal */ }
  return { text, via: 'earcon' };
}

function setSessionStateMirror(next: SessionState): void {
  const prev = state;
  state = next;
  // 2026-10-01 — a turn that ends with nothing heard or read is reported, whatever the exit.
  noteTurnState(prev, next);
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
      const H = require('expo-haptics');
      void H.impactAsync(H.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch { /* haptics optional */ }
    // 2026-08-07 (Tim — "tapping the earbud should WAKE the screen so functions aren't asleep/resting").
    // A tap-to-talk flows through here from EVERY source (earbud/glasses/mic badge). Exit the app's rest/dim
    // state and reset the idle clock so the pipeline isn't mid-doze when the user starts speaking (the cart
    // case: phone dimmed 40y away). Best-effort — can never affect the voice flow.
    try {
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

/**
 * 2026-10-28 (voice engineering review, VOICE-ENG-2) — THE HEDGE NEVER CANCELLED. The inline race
 * here slept 2.5s and then POSTed the utterance again whether or not the first classify had already
 * answered, and nothing aborted the loser — so every healthy turn paid /api/voice-intent twice. It
 * now races through services/voice/hedgedFetch.raceHedged, the one owner the transcribe paths use:
 * the hedge is never opened once the primary answers, and the losing connection is aborted. `signal`
 * (the session's turnAbort) cancels both attempts when the player closes the turn.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const attempt = (isHedge: boolean): HedgeAttempt<Response> => {
    // A turn closed before the hedge woke opens no second connection.
    if (signal?.aborted) return { result: Promise.reject(new Error('aborted')), abort: () => {} };
    const budget = isHedge ? Math.max(5_000, timeoutMs - CLASSIFY_HEDGE_MS) : timeoutMs;
    const controller = new AbortController();
    const abort = (): void => { try { controller.abort(); } catch { /* aborting never throws */ } };
    const timeout = setTimeout(abort, budget);
    signal?.addEventListener('abort', abort);
    // The turn's abort stays linked through the body read, so a close mid-read cancels that too.
    const result = fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
    return { result, abort };
  };
  return raceHedged(attempt, CLASSIFY_HEDGE_MS);
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
/**
 * 2026-10-28 (VOICE-ENG-1) — AN ECHO IS NOT A LOST TAP. `echo` marks a guard that absorbed the SAME
 * press arriving a second time (iOS fires two remote commands for one button; a glasses temple
 * jitters). The press it echoes already acted and already buzzed, so an echo gets no second haptic
 * and is kept on device as a diag instead of mailed as tap_swallowed — the 10-13 and 10-25 rule for
 * the 'opening' echo, applied to every echo guard.
 */
function swallowedTap(guard: string, extra?: Record<string, unknown>, opts?: { echo?: boolean }): void {
  const echo = opts?.echo === true;
  if (!echo) { try { Vibration.vibrate(18); } catch { /* haptics optional */ } }
  console.log(`[path4:voice] tap_swallowed guard=${guard} state=${state}${echo ? ' echo=1' : ''}`);
  try {
    (echo ? logVoiceDiag : logVoiceSilentFail)(echo ? 'tap_echo_absorbed' : 'tap_swallowed', { source: 'listeningSession', guard, sessionState: state, ...extra });
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

// 2026-10-28 (recheck VC-4) — which states drop a tap, for the mic badge's dim. A leaf module so the
// badge can read it without loading the whole voice graph; it must stay in step with toggle() below.
export { tapIsDroppedIn, avatarTapRoute } from './voice/tapIsDroppedIn';

/**
 * 2026-10-28 (recheck VC-R2-1) — AN AUTOMATIC MIC HAND-OFF YIELDS TO A SESSION THE PLAYER OPENED.
 *
 * The Caddie tab hands the mic over on its own after a reply that asks a question (onReadyToListen),
 * after the get-to-know opener, and after a SmartMotion set. All three called the avatar's tap
 * handler, which reads a live session as a TAP on it. But the commonest moment for the player to
 * press the badge, the bottom bar or an earbud is while the caddie is asking — so the hand-off then
 * landed on HIS session: during 'opening' it force-closed it (cue cut, turn gone), during 'listening'
 * it ended his capture at ~0 s ("Didn't catch that"). Nothing said why.
 *
 * The hand-off is an offer of the turn. If a session is open the player has already taken it, so the
 * offer is dropped — logged on device, never mailed: nothing failed.
 */
export function handMicToPlayer(open: () => void, from: string): boolean {
  if (sessionInFlight || state !== 'idle' || typedTurnsInFlight > 0) {
    try { logVoiceDiag('auto_listen_yielded', { source: 'listeningSession', from, sessionState: state }); } catch { /* diag only */ }
    return false;
  }
  open();
  return true;
}

/**
 * Toggle the listening session. Open if idle; close if any other state.
 */
export async function toggle(): Promise<void> {
  /**
   * 2026-09-06 — remote kill switch for the voice caddie. toggle() is the SINGLE chokepoint the
   * earbud tap, the badge tap and handsFreeOrchestrator all route through (see the note below), so
   * gating here kills every way of opening a listening session with one check.
   *
   * Silent return, not an error line: the mic simply does not engage (ENGINEERING-PRINCIPLES #3).
   * Typed questions still reach the caddie — this switch kills the MICROPHONE path, not the brain.
   */
  if (!isFlagEnabled('voice_caddie')) return;
  // 2026-06-16 (Tim — earbud-tap-to-stop) — if Smart Motion is actively RECORDING,
  // the camera owns the mic. A tap must STOP the capture, NOT open a listen session
  // (opening one races the camera's audio = "Only one Recording object" crash). This
  // is the single chokepoint: the earbud tap, the badge and the watch's single tap (through
  // handsFreeOrchestrator) route through toggle(). After recording stops the mic frees and the
  // next tap opens listening normally.
  if (isSmartMotionRecording()) {
    recordingStopTapAt = Date.now();
    emitSmartMotionCommand('stop');
    return;
  }
  // 2026-06-16 (Tim) — a single press could reach toggle() twice. Since 2026-10-28 (VOICE-ENG-1)
  // handsFreeOrchestrator no longer re-toggles an earbud 'single', but iOS still fires two remote
  // commands for one button. The recording-stop branch above returns WITHOUT opening a session, so a
  // duplicate would see recording already stopped and open listening right over the just-freed mic.
  // Swallow toggles for a short window after a tap-stop (the duplicate + the camera's audio-session
  // release); only the part inside the echo window is an echo.
  if (Date.now() - recordingStopTapAt < RECORDING_STOP_TAP_COOLDOWN_MS) {
    const msSinceStop = Date.now() - recordingStopTapAt;
    swallowedTap('recording_stop_cooldown', { msSinceStop }, { echo: msSinceStop < TAP_ECHO_SWALLOW_MS });
    return;
  }
  // 2026-08-07 (regression audit — the endpoint branch below was DEAD: sessionInFlight is true for the
  // whole 'listening' window, so `if (sessionInFlight) return` swallowed the tap-again endpoint before it
  // could run). Handle the endpoint HERE, before that guard. A tap while the mic is OPEN means "I'm done,
  // submit" — end the capture early (transcribe what we have) + play the distinct got-it earcon.
  if (state === 'listening') {
    /**
     * Swallow the OPEN tap's own echo — the same press arriving a second time (earbudControl's
     * pattern detector fires 'single' ~350 ms after the tap). It can land in 'listening' only when it
     * cut the open cue short, so it arrives just after the mic opens.
     *
     * 2026-10-27 (Sentry PA/PB: msSinceOpen 397 and 495, real presses eaten) — MEASURED FROM THE TAP.
     * This used to be 800 ms from the moment the mic opened. That was right on 08-07, when 'listening'
     * began at the tap; since 08-11 it begins only after the spoken open cue, so the window reached
     * a second or more past the press and ate real "I'm done" taps. An echo belongs to the tap.
     */
    if (Date.now() - sessionOpenTapAt < TAP_ECHO_SWALLOW_MS) {
      swallowedTap('open_tap_echo', { msSinceOpenTap: Date.now() - sessionOpenTapAt, windowMs: TAP_ECHO_SWALLOW_MS }, { echo: true });
      return;
    }
    // ...and dedupe THIS endpoint tap's own double-fire (echo window only).
    if (Date.now() - sessionCloseTapAt < TAP_ECHO_SWALLOW_MS) return;
    sessionCloseTapAt = Date.now();
    // The "Got it" cue plays at capture end, after the recorder stops (see gotItOnCaptureEnd).
    gotItOnCaptureEnd = true;
    endCaptureEarly();
    return;
  }
  // 2026-06-04 — Ignore re-tap during in-flight processing window.
  // See sessionInFlight comment above for rationale.
  /**
   * 2026-08-22 (Tim's field log: guard session_in_flight, sessionState 'opening', on turns 1, 10 and
   * 38) — a tap during the mic-OPENING window was discarded outright, echo or not.
   *
   * The echo needs discarding: one physical tap reaches toggle() twice, ~350ms apart. A tap a second
   * later is a person, and dropping it silently is the defect — they pressed, nothing happened, and
   * nothing told them why. Opening can take a moment on a cold mic, which is exactly when someone
   * presses again.
   *
   * So: echoes still die; a genuine tap during 'opening' is acted on.
   *
   * 2026-10-28 (Tim) — it means "I'm ready", not "I'm done": a press while the cue is still playing
   * cuts the cue and opens the mic. Treating it as the endpoint closed a recording too short to hold
   * a word, and the caddie answered his press with "Didn't catch that."
   */
  if (sessionInFlight) {
    const isEcho = Date.now() - sessionOpenTapAt < TAP_ECHO_SWALLOW_MS;
    if (!isEcho && state === 'opening') {
      skipOpenCue = true;
      void stopSpeaking('screen:services-listeningsession').catch(() => {});
      // 2026-10-13 — acted on, not swallowed. Mailing it as tap_swallowed filed a "failure" for a tap
      // that worked — 34 alerts in 20 min from two store reviewers tapping through onboarding. Kept on
      // device; the haptic still acknowledges.
      try { Vibration.vibrate(18); } catch { /* haptics optional */ }
      logVoiceDiag('tap_skipped_open_cue', { source: 'listeningSession', sessionState: state });
      return;
    }
    /**
     * 2026-10-25 (Sentry MD, MP, N2, NG — every one guard session_in_flight, sessionState 'opening') —
     * that is the ECHO: the same press arriving a second time (iOS fires play and togglePlayPause for
     * one button; Android's pattern sub fires ~350ms after the legacy sub), absorbed by design while
     * the tap it echoes is already opening the mic. Mailing it filed a failure for a tap that worked.
     * Kept on device; a non-echo swallow in any other state is still reported.
     */
    if (isEcho && state === 'opening') {
      logVoiceDiag('tap_echo_absorbed', { source: 'listeningSession', sessionState: state, msSinceOpenTap: Date.now() - sessionOpenTapAt });
      return;
    }
    swallowedTap('session_in_flight');
    return;
  }
  /**
   * 2026-10-30 (caddie-voice-1) — A TYPED TURN IS IN FLIGHT TOO. handleTranscribedUtterance (the bottom
   * bar's send, the watch) drives only the shared store to 'thinking' and never raises sessionInFlight,
   * so the guard above passed the tap and opened a mic over an answer still coming back — while the
   * badge and the bar, which read that same store through micTapLook, dimmed for it. Dropped here like
   * a voice turn's tap, so the dim tells the truth on every path.
   */
  if (state === 'idle' && typedTurnsInFlight > 0) { swallowedTap('typed_turn_in_flight'); return; }
  // 2026-07-06 (voice-lifecycle audit #2) — same double-fire as the recording-stop
  // branch, on the CLOSE side: one physical tap could reach toggle() twice (until 2026-10-28 the
  // orchestrator's pattern sub re-toggled ~350ms later; iOS still sends two commands for one press).
  // During 'responding' sessionInFlight is
  // already false, so tap #1 closed the session and tap #2 saw 'idle' and REOPENED
  // the mic right after the user tried to shush the caddie. Swallow toggles for a
  // short window after any close — the ECHO window only (600ms): reusing the 1.5s camera-release
  // constant here meant a genuine shush tap at a fast-responding caddie was eaten for a full 1.5s
  // after every "I'm done" endpoint tap.
  if (Date.now() - sessionCloseTapAt < TAP_ECHO_SWALLOW_MS) { swallowedTap('close_tap_echo', { msSinceClose: Date.now() - sessionCloseTapAt }, { echo: true }); return; }
  /**
   * 2026-09-01 (Tim, on the glasses: "I think it just mirrors earbud behavior... this is why it
   * works") — HE IS RIGHT, AND IT PREDICTS THE STOP-TAP BUG.
   *
   * The glasses are a Bluetooth audio device, so a temple tap is an ordinary media key on the earbud
   * path. But AVRCP from glasses jitters more than from earbuds, so a tap's SECOND event can land
   * just OUTSIDE the echo window above — honoured as a fresh tap, reopening the mic the player just
   * closed. That reads exactly as "doesn't react well to a stop tap".
   *
   * Not retuning the window on a hunch: this only RECORDS a reopen that follows a close closely
   * enough to be suspicious. If the field log shows these clustered just past the window, the
   * constant is wrong; if it shows nothing, the stop tap is being lost somewhere else.
   */
  {
    const sinceClose = Date.now() - sessionCloseTapAt;
    if (sessionCloseTapAt > 0 && sinceClose < TAP_ECHO_SWALLOW_MS * 4) {
      try {
        logVoiceSilentFail('tap_reopen_after_close', {
          source: 'listeningSession', msSinceClose: sinceClose, echoWindowMs: TAP_ECHO_SWALLOW_MS, sessionState: state,
        });
      } catch { /* never throw from a diagnostic */ }
    }
  }
  if (state === 'idle') {
    sessionInFlight = true;
    sessionOpenTapAt = Date.now();
    skipOpenCue = false;
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
 * RESTORED 2026-08-23, and connected this time.
 *
 * I deleted this earlier the same day for having no callers. That was the wrong call and Tim named
 * it: *"there's almost nothing in this app that's arbitrary… they're just not all connected how and
 * where they should be. Don't just go willy-nilly deleting. Say: where SHOULD this be?"*
 *
 * It was never dead — it was a complete capability with one missing wire. Role inference (arena →
 * psychologist, in-round → caddie, otherwise coach) and trust-level gating (L1 gets a terse "Yeah?"
 * rather than chat), routed to getDialog(role, 'earbud_open') whose templates exist for ALL THREE
 * roles in constants/dialogTemplates. Everything built; nothing calling it.
 *
 * The earbud opener now comes from here instead of the flat LISTEN_CUES pools, so tapping in on the
 * range greets you as the coach, between shots as the psychologist, and in a round as the caddie —
 * which is what the templates were written for.
 */
function pickOpener(): string {
  const round = useRoundStore.getState();
  const trustLevel = getTrustLevel();
  const surface = getActiveSurface();

  const role: 'caddie' | 'coach' | 'psychologist' =
    surface === 'arena' ? 'psychologist' :
    round.isRoundActive ? 'caddie' : 'coach';

  // L1 has not earned conversation yet — acknowledge and listen, do not chat.
  if (trustLevel === 1) return TRUST_L1_OPENER;

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
/** 2026-08-17 — the mic-failed line for a language, from the one shared source (see caddieAckLines). */
function micTroubleFor(lang: 'en' | 'es' | 'zh'): string {
  return CADDIE_NOTICE_MIC_TROUBLE[lang] ?? CADDIE_NOTICE_MIC_TROUBLE.en;
}

/**
 * 2026-10-15 — the honest notice is chosen on EVIDENCE (services/caddieFailureReply → reachability):
 * our failure → owned; measured-slow → "trouble connecting"; proven no internet → what still works.
 * This picked "I'm having trouble connecting" whenever our host had not answered recently — which is
 * also exactly what a cold or broken backend looks like on full signal.
 */
function failureFallbackFor(lang: string | null | undefined): string {
  return (require('./caddieFailureReply') as typeof import('./caddieFailureReply')).failureNoticeSync(lang);
}

/**
 * Speak an honest "couldn't respond" message for the user's language
 * and pulse a short vibration, so dead silence never reads as broken.
 * Used by every silent-failure branch in this module (chat fallback
 * fetch errors, handler throws, outer catch). Cheap and idempotent —
 * the speak() call already serializes with stopSpeaking().
 */
/**
 * 2026-08-23 — kevinSteering() deleted. It existed to spread persona + the four brain-steering
 * settings into this file's three hand-built /api/kevin bodies. There are no hand-built bodies here
 * any more: services/caddieRequestBody emits all five, resolved the same way, for every surface.
 * A helper whose whole job was "remember to include these" is exactly the shape that becomes stale
 * the moment a sixth setting is added and only some callers are updated.
 *
 * customCaddieFields() survives below — /api/voice-intent is a different endpoint with its own
 * contract, and it still needs the caddie's name to style a clarifying question.
 */

/** The player is answering the caddie's own question: a conversational turn, straight to the brain. */
function answerToCaddie(utterance: string): VoiceIntent {
  return {
    intent_type: 'conversational',
    parameters: { raw_utterance: utterance, answers_caddie: true },
    confidence: 'high',
    follow_up_question: null,
    raw_text: utterance,
  };
}

/**
 * 2026-10-27 (Brain review B10) — the shared pre-brain step (help, song, sing, plain-speak), then one
 * brain turn. The avatar mic ran these; every brain turn on this file's routes skipped them.
 */
async function brainTurnWithPreStep(utterance: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<BrainReply> {
  const spoken = await preBrainReply(utterance);
  if (spoken) return { text: spoken, audioBase64: null, toolActions: [], source: 'kevin' };
  // The reshape is for the model only; history and the style learner keep what he said.
  return conversationalBrainTurn(shapeForBrain(utterance), { ...opts, heard: utterance });
}

function customCaddieFields(): { customCaddieBasePersona: string; customCaddieName: string | null } {
  try {
    const p = require('../store/playerProfileStore').usePlayerProfileStore.getState();
    return { customCaddieBasePersona: p.customCaddieBasePersona ?? 'kevin', customCaddieName: p.customCaddieName ?? null };
  } catch { return { customCaddieBasePersona: 'kevin', customCaddieName: null }; }
}

export async function speakHonestFailure(
  language: 'en' | 'es' | 'zh' | null | undefined,
  voiceGender: 'male' | 'female',
  apiUrl: string,
): Promise<boolean> {
  const epoch = getUserTurnEpoch();
  const msg = await (require('./caddieFailureReply') as typeof import('./caddieFailureReply')).failureNotice(language);
  // Review (10-15): the notice now waits on the internet check. A turn the player started in that
  // window must not be cut off by the stopSpeaking below, nor talked over.
  // Only a turn that is REALLY there: the epoch also moves for a VAD false start or a tap that never
  // became a turn, and dropping the notice then left the player with nothing (third review, 10-15).
  if (getUserTurnEpoch() !== epoch && (isCapturing() || isExternalMicActive())) {
    console.log('[listeningSession] honest-failure notice dropped — a newer turn is live');
    return false;
  }
  try { Vibration.vibrate(120); } catch {}
  try { await stopSpeaking('screen:services-listeningsession').catch(() => {}); } catch {}
  try {
    await speak(msg, voiceGender, language ?? 'en', apiUrl, { userInitiated: true });
  } catch (e) { console.log('[listeningSession] failure-fallback speak threw', e); }
  return true;
}

/**
 * 2026-08-27 (Tim, first turn after launch — "I asked Serena, and she thought for a while, and then
 * just didn't answer… I didn't get an issue log out of it").
 *
 * THE BRANCHES THAT SPOKE WERE COMPLETE. THE ONES THAT DIDN'T WERE MISSING.
 *
 * Every route_to_brain site in this file was written as three branches — speak the answer, caption
 * it when voice is off, apologise when the brain came back empty — and each gated speaking on
 * `getSessionState() === 'responding'`. THREE combinations fell through all three branches and did
 * nothing at all:
 *
 *   1. the brain ANSWERED, voice was on, and the session had left 'responding' while we waited.
 *      A cold first turn waits up to 48s for the brain (COLD_KEVIN_FETCH_TIMEOUT_MS) on top of a
 *      22s cold classify — any tap, earbud press, close or dormancy force-close inside that window
 *      drops a REAL ANSWER on the floor. The caddie had the words and never said them.
 *   2. the brain came back empty AND voice was muted (or the phone-speaker gate was shut) — no
 *      caption, where the sibling hands-free branch 250 lines down captions failureFallbackFor().
 *   3. the brain came back empty and the session had moved on.
 *
 * NONE OF THE THREE LOGGED. logVoiceSilentFail is how a dead turn becomes visible to us, and a
 * fallthrough with no `else` cannot call it — which is precisely why the field report arrived with
 * an empty issue log attached. The absence of the entry WAS the evidence.
 *
 * So delivery stops being three hand-written branches per call site — four sites, and the two mic
 * ones had already drifted from the two hands-free ones — and becomes ONE function with a total
 * contract:
 *
 *      A TURN THE PLAYER STARTED ALWAYS ENDS IN SOMETHING THEY CAN PERCEIVE.
 *
 * In order: speak the answer → caption the answer when we may not speak, INCLUDING when the session
 * moved on (a real answer is shown, never discarded) → answer from device state → the honest
 * failure line, spoken or captioned from the one shared source. Only when every one of those is
 * impossible does it fall through, and then it ALWAYS logs.
 *
 * [[caddie-failsafe-no-walls]] [[no-half-fixes-enforce-every-surface]] [[feels-like-a-real-caddie]]
 */
async function deliverBrainReply(opts: {
  /**
   * The brain's reply. `toolActions` is read straight off it (every caller passes the whole
   * BrainReply) so the freshness check needs no change at any of the ten call sites — the site that
   * got missed would have been the one that stayed broken.
   */
  reply: { text: string | null; audioBase64: string | null; toolActions?: readonly unknown[] | null };
  utterance: string;
  language: string | null | undefined;
  voiceGender: 'male' | 'female';
  apiUrl: string;
  /** voiceEnabled AND the phone-speaker gate, resolved by the caller that owns that judgment. */
  ttsAllowed: boolean;
  /** Call site, for the issue log — so "always the mic" and "only hands-free" are distinguishable. */
  site: string;
  /**
   * The mic path speaks only while the session is still 'responding' (a tap mid-answer means the
   * player moved on and must not be talked over). The hands-free / typed / watch path has no such
   * session and passes false.
   */
  requireResponding: boolean;
  /**
   * 2026-10-15 (review G2) — false once the session that started this turn was closed or replaced.
   * Such a turn never speaks (a newer turn may be 'responding' right now), and if the brain gave
   * nothing it owes the player nothing either: they ended it. Omitted by the typed / watch path.
   */
  isCurrent?: () => boolean;
  /**
   * 2026-09-05 — the shot the player was standing over when this turn STARTED, and the tools the
   * turn ended up calling. Together they answer "is this advice still about the shot he is facing?"
   * Both optional: a caller that passes neither behaves exactly as before.
   */
  positionEpoch?: string | null;
  toolActions?: readonly unknown[] | null;
}): Promise<void> {
  const { reply, utterance, voiceGender, apiUrl, ttsAllowed, site, requireResponding } = opts;
  const lang: 'en' | 'es' | 'zh' = (['en', 'es', 'zh'] as const).includes(opts.language as never)
    ? (opts.language as 'en' | 'es' | 'zh')
    : 'en';
  const current = (): boolean => opts.isCurrent?.() ?? true;
  const maySpeak = (): boolean => ttsAllowed && current() && (!requireResponding || getSessionState() === 'responding');
  const caption = (line: string, ms: number): boolean => {
    try { flashCaption?.(line, ms); return true; } catch { return false; }
  };

  let text = reply.text?.trim() || null;

  /**
   * 2026-09-28 (1.0.2) — no answer because the PLAN declined the turn (featureAccess.mayTalkToCaddie),
   * not because anything failed. Off-round the paywall is already open and says its own piece; in a
   * round the caddie says the plans will show after it. Either way, never the failure line.
   */
  if (!text) {
    const block = takeCaddiePaywallBlock();
    if (block && !block.deferred) return;
    if (block?.deferred) text = CADDIE_PAYWALL_DEFERRED_LINE;
  }
  // A turn the player closed (or a newer session replaced) with no answer in hand: nothing is owed —
  // no local answer, no failure line over whatever they are doing now.
  if (!text && !current()) {
    logVoiceDiag('brain_reply_after_close', { source: site, sessionState: getSessionState() });
    return;
  }

  // 1 — The caddie answered. Say it.
  if (text) {
    /**
     * 2026-09-05 (Tim) — unless he has already played the shot it was about. "By the time I get to
     * the green, Serena was giving me my layout for the shot I just hit." A club call for a lie he
     * is not standing in is worse than silence. Captioned, not binned — same contract as an answer
     * that arrives after the session moved on. See services/adviceFreshness.ts.
     */
    if (!adviceIsStillWorthSaying(opts.positionEpoch ?? currentTurnEpoch(), opts.toolActions ?? reply.toolActions ?? null)) {
      const shown = caption(text, 7000);
      logVoiceSilentFail('advice_overtaken_by_play', {
        source: site, captioned: shown, epochNow: captureShotEpoch(), utteranceHead: utterance.slice(0, 60),
      });
      return;
    }
    // 2026-10-27 (Brain review B3) — the caddie's line is the last turn, so a question he ends on is
    // one the next utterance answers — on this path, as on the avatar mic (useCaddieTabMic records it).
    try { recordKevinTurn(text); } catch { /* non-fatal */ }
    if (maySpeak()) {
      await stopSpeaking('screen:services-listeningsession').catch(() => {});
      if (maySpeak()) {
        if (reply.audioBase64) {
          await speakFromBase64(reply.audioBase64, { userInitiated: true, caption: text })
            .catch((e) => console.log(`[${site}] speakFromBase64 failed`, e));
        } else {
          await speak(text, voiceGender, lang, apiUrl, { userInitiated: true })
            .catch((e) => console.log(`[${site}] speak failed`, e));
        }
        return;
      }
    }
    /**
     * Muted, gated, or the session moved while the brain was thinking. The answer is REAL — the
     * player asked and the caddie found it — so it goes on screen rather than in the bin, and the
     * fact that it was never SPOKEN is recorded. This is the case that produced Tim's report.
     */
    const shown = caption(text, 7000);
    logVoiceSilentFail('brain_reply_not_spoken', {
      source: site,
      shown,
      ttsAllowed,
      sessionState: getSessionState(),
      replyHead: text.slice(0, 60),
    });
    return;
  }

  // 2 — No answer from the brain. TRY TO ANSWER BEFORE APOLOGISING: the device holds the GPS, the
  //     bag and the green, and a local club call beats "I'm having trouble connecting" every time.
  let localAnswer: string | null = null;
  try {
    // 2026-10-15 — the shared rule 1: a "no data" reply ("No GPS lock yet") is not an answer.
    localAnswer = (require('./caddieFailureReply') as typeof import('./caddieFailureReply')).localAnswer(utterance, lang);
  } catch { /* the local answer is a bonus, never a dependency */ }
  if (localAnswer) {
    if (maySpeak()) {
      await stopSpeaking('screen:services-listeningsession').catch(() => {});
      await speak(localAnswer, voiceGender, lang, apiUrl, { userInitiated: true })
        .catch((e) => console.log(`[${site}] local-answer speak failed`, e));
    } else {
      caption(localAnswer, 7000);
    }
    return;
  }

  // 3 — Nothing left but the truth, in the SAME words whether it is heard or read.
  let delivered = false;
  if (maySpeak()) {
    try { delivered = await speakHonestFailure(lang, voiceGender, apiUrl); }
    catch (e) { console.log(`[${site}] honest-failure speak threw`, e); }
  }
  if (!delivered) delivered = caption(failureFallbackFor(lang), 6000);
  // Logged whether it was spoken or read: a turn that reached here is a turn the caddie could not
  // answer, and that is the class worth counting.
  logVoiceSilentFail('turn_ended_without_answer', {
    source: site,
    delivered,
    ttsAllowed,
    sessionState: getSessionState(),
    utteranceHead: utterance.slice(0, 60),
  });
}

/** How long a press may wait for iOS to finish bringing the app forward (cold launch, unlock). */
const FOREGROUND_GRACE_MS = 1_500;

async function openSession(origin: 'tap' | 'auto_reopen' = 'tap') {
  // Review G2 — this session's serial. live() is false once a close or a newer session replaced it;
  // setMine / mine are the only way this turn writes or reads the shared state from here on.
  const mySerial = ++sessionSerial;
  const live = (): boolean => mySerial === sessionSerial;
  const setMine = (next: SessionState): void => { if (live()) setSessionStateMirror(next); };
  const mine = (s: SessionState): boolean => live() && getSessionState() === s;
  turnAbort = new AbortController();
  const brainSignal = turnAbort.signal;
  setMine('opening');
  gotItOnCaptureEnd = false;   // every session, tapped or auto-reopened, starts without a pending cue
  /**
   * 2026-10-25 (Sentry NB–NH, a relaunch mid-round) — a press that lands while iOS is still bringing
   * the app forward (cold launch, unlock) waits briefly for 'active'. It never refuses: still not
   * active after the wait, the mic is tried exactly as before (a locked phone with a live audio
   * session may be allowed to record). The one thing it refuses is a STALE press — JS suspended
   * mid-wait, the timer firing minutes later — which would open a mic nobody is talking into.
   */
  if ((await settleForegroundForMic(FOREGROUND_GRACE_MS)) === 'stale') {
    logVoiceDiag('mic_press_stale', { source: 'listeningSession', origin });
    setMine('idle');
    return;
  }
  if (!live()) return;
  /**
   * Review G2 (finding 6) — a tap is the player starting to talk. If the caddie is mid-way through
   * something it started ON ITS OWN (a proactive line, a briefing), the go-ahead cue below would
   * queue behind it and the mic would wait for the end of a speech nobody asked for. A real caddie
   * stops and listens. Speech the player asked for (an answer still playing) is left alone — the
   * unchanged behaviour, so the cue follows it rather than cutting off a reply they wanted.
   */
  if (isSpeaking() && !isSpeakingUserInitiated()) {
    await stopSpeaking('screen:services-listeningsession').catch(() => {});
  }
  // Snapshot what the caddie had last said, so the end-of-turn check below can tell a question the
  // caddie just ASKED from a stale line left over from an earlier turn.
  spokenLineAtOpen = getLastSpokenLine();
  const settings = useSettingsStore.getState();
  const apiUrl = getApiBaseUrl();
  // 2026-10-28 (recheck VC-6) — `source=` is the documented field (docs/critical-paths.md Path 4).
  // Every physical source (earbud, glasses, badge) reaches here through toggle() as 'tap'; the
  // caddie re-opening the mic after its own question is 'auto_reopen'.
  console.log(`[path4:voice] tap_open trust=${getTrustLevel()} source=${origin}`);

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
   *
   * 2026-09-28 — the release moved to the upload itself (voiceService.captureUtteranceDetailed); the
   * capture window uses no connection. Opening the session records the TURN, so a proactive line
   * still waiting on the brain stands down instead of speaking over this one.
   */
  noteUserTurn();
  noteCaddieTurn('earbud'); // 1.0.2 funnel: first_caddie_turn (fires once)

  /**
   * 2026-08-29 — "Voice on Phone Speaker" RETIRED (Tim). The route no longer gates speech.
   *
   * The toggle asked the player to answer a question the app can now answer itself, and it had not
   * changed an outcome since 2026-05: migration v7 force-set it TRUE for everyone, deliberately,
   * because suppressing on the speaker was "a confusing failure mode (avatar acknowledges but
   * doesn't speak)". So `route !== 'phone_speaker' || allowPhoneSpeaker` has evaluated to true on
   * every device ever since — a dead term that read like a live gate.
   *
   * Removing it is behaviour-identical, which is the point: the setting is gone from Settings, and
   * the decision it encoded stays exactly where v7 put it. The live route is still detected — it
   * drives captions, not silence. [[hands-free-zero-setup-is-the-product]]
   */
  const trustLevel = getTrustLevel();

  /**
   * 2026-10-28 (recheck VC-6) — THE OPENER IS SPOKEN, AT EVERY TRUST LEVEL. This block used to log
   * "opener_done (canned opener removed — haptic + Listening strip)" from the 07-26 removal, and a
   * comment above it called L1 "a hard suppress for the spoken opener". Neither has been true since
   * 08-08/08-23: playVerbalCue below speaks pickOpener() in the caddie's voice with userInitiated:true
   * — at L1 the terse TRUST_L1_OPENER "Yeah?", at L2+ the role's earbud_open line — because the
   * player just tapped and a spoken go-ahead survives the BT route handoff a tock does not. The log
   * line and the Path 4 L1 pass criterion both described the removed behaviour, so the checklist
   * could neither pass nor fail truthfully. opener_done is now logged AFTER the cue, saying what
   * played.
   *
   * What L1 DOES suppress is the filler: `ttsAllowed` gates the "thinking" earcon and its long-wait
   * pulses further down, so a Quiet turn is go-ahead, silence, answer.
   */
  const ttsAllowed = settings.voiceEnabled && trustLevel !== 1;

  /**
   * 2026-10-28 (recheck VOICE-ENG-R2-2) — A MIC THE PLAYER REFUSED IS NOT OURS TO PROMISE. With the
   * permission permanently denied, the go-ahead cue played, captureUtterance's request came back
   * refused with no dialog, and bail 'no_permission' is 'silent' (it assumes the OS prompt is on
   * screen). So the caddie said "What's on your mind?" and then nothing, every press, with no caption
   * and no log — and an earbud press with the phone pocketed could never have seen a prompt anyway.
   * Checked before the cue: say where the fix is instead. Logged as diag, not mailed: the player's
   * own setting is not a defect, but the owner log must show why his presses go nowhere.
   */
  // Loaded lazily: voicePermissionService pulls in expo-av, which a screen importing this module must
  // not need just to render. A load failure fails open (the mic is tried as before).
  const micBlocked = await import('./voicePermissionService').then((m) => m.isMicPermissionBlocked(), () => false);
  if (micBlocked) {
    logVoiceDiag('mic_permission_blocked', { source: 'listeningSession', origin });
    const lang = (['en', 'es', 'zh'] as const).includes(settings.language as never) ? (settings.language as 'en' | 'es' | 'zh') : 'en';
    const line = CADDIE_NOTICE_MIC_OFF[lang];
    try { flashCaption(line); } catch { /* caption optional */ }
    if (settings.voiceEnabled) {
      try {
        const { speakDeviceNotice } = await import('./voiceService');
        await speakDeviceNotice(line, lang, settings.voiceGender);
      } catch { /* notice is best-effort */ }
    }
    setMine('idle');
    return;
  }
  if (!live()) return;

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
    setMine('idle');
    return;
  }

  /**
   * 2026-10-28 (recheck VOICE-ENG-R3-2) — NO GO-AHEAD AFTER THE CADDIE'S OWN QUESTION.
   *
   * An auto-reopen exists because the caddie just ASKED something ("Driver or three wood off this
   * tee?"). Speaking the go-ahead on top — "What's the play?" — put a second, different question
   * after the first, and held the mic closed for the ~1 s it played: the player who answered the
   * question straight away lost his first words, the 08-11 defect on every reopen. The question is
   * the invitation; the mic opens at once.
   */
  let opener: VerbalCueResult | null = null;
  if (settings.voiceEnabled && !skipOpenCue && origin !== 'auto_reopen') {
    try { opener = await playVerbalCue('listen', LISTENING_EARCON, LISTENING_EARCON_MS); } catch { /* non-fatal */ }
  }
  skipOpenCue = false;
  console.log(`[path4:voice] opener_done allowed=${settings.voiceEnabled} text=${JSON.stringify(opener?.text ?? '')} via=${opener?.via ?? 'none'} trust=${trustLevel}`);
  // 2026-08-06 (voice audit) — the earcon is awaited (~200ms), during which cancelMic is still null. If the
  // user cancels (a second tap → closeSession → state 'idle') DURING the earcon, stopCapture would be a
  // no-op and we'd open a phantom 12s recording after the session already closed. Re-check state here so a
  // cancel-during-earcon never opens the mic at all.
  // 2026-08-11 — the guard now checks 'opening', since that is the state we hold through the cue.
  if (state !== 'opening') return;
  if (!live()) return; // a newer session opened while the cue played — it owns the mic now

  // The cue has finished and capture begins on the next line — this is the first honest moment to
  // claim we are listening, so the strip, the halo and the tap-again endpoint all arm here.
  setSessionStateMirror('listening');
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
      /**
       * 2026-08-22 (Tim, on course) — "if you're on a course and you're speaking, the listening goes
       * on too long, and that introduces more exterior noise." His log: durationMs 12151, i.e. the
       * full old cap, every time.
       *
       * The adaptive noise floor normally ends the capture on silence long before this. Outdoors it
       * often cannot: wind, a cart, and playing partners keep the level above the floor, so the VAD
       * never sees silence and the recording runs to the cap — collecting exactly the ambient noise
       * that then ruins the transcript. The cap is the only thing bounding it in that case.
       *
       * A golfer's question is short ("what should I hit from 150, into the wind" is ~3s). 8s still
       * leaves generous headroom over any real ask while cutting a third of the noise the old cap
       * let in. VAD still ends it earlier whenever it can.
       */
      const captureP = captureUtteranceDetailed(MAX_UTTERANCE_MS, apiUrl, settings.language);
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
   * 2026-10-25 (Sentry ND/NF → NH → NC) — THE RECORDING WAS REFUSED BECAUSE THE APP IS NOT UP. iOS
   * would not start it ("recording not started") with the app in the background; the retry below hit
   * the same wall and the turn ended in "my mic didn't open — tap me again", which no tap fixes while
   * the app stays behind the lock screen. Say the one thing that works, for a tap and for the
   * auto-reopen after a caddie question alike (the player is answering into this mic). Foreground
   * failures are untouched: they still retry and still own the mic trouble.
   */
  if (capture.bail === 'error' && micMayBeRefusedNow() && (state as SessionState) === 'listening' && live()) {
    logVoiceSilentFail('mic_needs_foreground', { source: 'listeningSession', origin });
    const s = useSettingsStore.getState();
    const lang = (['en', 'es', 'zh'] as const).includes(s.language as never) ? (s.language as 'en' | 'es' | 'zh') : 'en';
    const line = CADDIE_NOTICE_MIC_NEEDS_APP[lang];
    try { flashCaption(line); } catch { /* caption optional */ }
    if (s.voiceEnabled) {
      try {
        const { speakDeviceNotice } = await import('./voiceService');
        await speakDeviceNotice(line, lang, s.voiceGender);
      } catch { /* notice is best-effort */ }
    }
    setMine('idle');
    return;
  }

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
  if (shouldRetryCapture(capture.bail) && (state as SessionState) === 'listening' && live()) {
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
  // Review G2 — 'listening' may be a NEWER session's (closed, re-tapped, listening again). Its
  // capture is still running; this one's result must not answer, notice, or idle on top of it.
  if (!live()) return;

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
    /**
     * 2026-09-04 (Tim — three emails in five minutes, each carrying the SAME failure twice) —
     * DON'T REPORT THE CONSEQUENCE AS A SECOND FAILURE.
     *
     * When `bail` is 'transcribe_failed', captureUtterance has ALREADY logged the real cause a few
     * milliseconds earlier — `transcribe_error: transcribe_http, status: 504`. This line then
     * reported the downstream effect of that same event as an independent problem, so every
     * transcribe outage arrived as two bullets: the cause, and the fact that the cause had an
     * effect. Two entries, one defect, and the email twice as long for no extra information.
     *
     * Still logged, as 'diag' — on-device it is genuinely useful, because heardSpeech and
     * durationMs say whether the mic was open and whether the player actually spoke, which the
     * transcribe error alone cannot tell you. It just stops being mailed as its own issue.
     *
     * Every other bail reason still reports normally: those have no upstream entry, so this line
     * is the only record that the turn died. [[missing-log-entry-is-the-evidence]]
     */
    const alreadyReportedUpstream = bail === 'transcribe_failed';
    /**
     * 2026-10-13 — NOBODY SPOKE IS NOT A FAILURE. bail 'empty' is set only AFTER Whisper transcribed the
     * audio and returned nothing (voiceService captureUtterance). With heardSpeech false too, the meter
     * and the transcriber agree: the mic worked and no one talked. That is a person who opened the mic
     * and didn't speak — two store reviewers did it 34 times in 20 minutes, every one mailed as a
     * failure. Kept on device. heardSpeech TRUE with an empty transcript stays reportable: that is
     * "I talked and it ignored me", the one this line exists for.
     */
    const nobodySpoke = bail === 'empty' && capture.heardSpeech === false;
    /**
     * 2026-10-28 (VOICE-ENG-3) — the player ended the capture themselves before saying anything (an
     * "I'm done" tap, typically one queued during 'opening'), so the recording is under the
     * transcribe floor. They did what they meant to; the honest "Didn't catch that" still tells them
     * nothing was sent, but it is not mailed as a failure.
     */
    const endedByTap = gotItOnCaptureEnd;
    gotItOnCaptureEnd = false;
    const tapEndedEmpty = endedByTap && bail === 'too_short' && capture.heardSpeech === false;
    if (!silentBail) (alreadyReportedUpstream || nobodySpoke || tapEndedEmpty ? logVoiceDiag : logVoiceSilentFail)('listen_no_transcript', {
      source: 'listeningSession',
      endedByTap,
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
      // reply are no longer route-gated (the phone-speaker toggle was retired 08-29), but this
      // device-TTS notice bypassed that gate and spoke aloud on a route the user muted.
      if (!silentBail && settingsNow.voiceEnabled) {
        if (transcribeFailed) {
          await speakHonestFailure(lang, settingsNow.voiceGender, apiUrl);
        } else {
          const { speakDeviceNotice } = await import('./voiceService');
          const line = micNeverOpened ? micTroubleFor(lang) : CADDIE_NOTICE_DIDNT_CATCH;
          await speakDeviceNotice(line, lang, settingsNow.voiceGender).catch(() => {});
        }
      }
    } catch { /* notice is best-effort */ }
    setMine('idle');
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
    // A tap-ended capture gets the persona "Got it" cue (2026-08-08, Tim: the caddie SAYS it heard
    // you; earcon only as first-run fallback) — played HERE, now the recorder has stopped. A silence-
    // ended capture gets the varied device-TTS ack. One or the other, never both (voice audit P2).
    const tapEnded = gotItOnCaptureEnd;
    gotItOnCaptureEnd = false;
    if (settingsAck.voiceEnabled && tapEnded) {
      void playVerbalCue('gotit', GOTIT_EARCON, GOTIT_EARCON_MS).catch(() => {});
    } else if (settingsAck.voiceEnabled) {
      const lang = (['en', 'es', 'zh'] as const).includes(settingsAck.language as never) ? (settingsAck.language as 'en' | 'es' | 'zh') : 'en';
      const { speakDeviceNotice } = await import('./voiceService');
      void speakDeviceNotice(pickAck(lang), lang, settingsAck.voiceGender).catch(() => {});
    }
  } catch { /* ack is best-effort — never blocks the turn */ }

  // Phase 3 — classify + respond
  setMine('thinking');
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
      const resolveAllowed = settings.voiceEnabled;
      if (mine('thinking')) setSessionStateMirror('responding');
      if (resolveAllowed && mine('responding')) {
        await stopSpeaking('screen:services-listeningsession').catch(() => {});
        if (mine('responding')) {
          await speak(courseResolved.confirmLine, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
            .catch((e) => console.log('[listeningSession] course-resolve speak failed', e));
        }
      }
      endTurn(mySerial);
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
      // A handler that asks the brain answers in his language, and a shush cancels it (Review G2).
      language: settings.language,
      signal: brainSignal,
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
    {
      const answered = tryAnswerOpenQuestion(utterance);
      if (answered) {
        if (mine('thinking')) setSessionStateMirror('responding');
        if (settings.voiceEnabled && mine('responding')) {
          await stopSpeaking('screen:services-listeningsession').catch(() => {});
          await speak(answered.line, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
            .catch((e) => console.log('[listeningSession] putt-answer speak failed', e));
        }
        endTurn(mySerial);
        return;
      }
    }

    /**
     * 2026-10-27 (Brain review B3 / B4) — THE CADDIE'S QUESTION OWNS THE ANSWER, ON THIS PATH TOO.
     *
     * Only the avatar mic checked whether Kevin had just asked something. Here, "Go for it or lay up
     * short of the creek?" answered with "go for it" hit the precheck's risk-mode rule: aggressive for
     * the rest of the round, "Aggressive it is", and no club. Same rule as useVoiceCaddie: an answer
     * to the caddie's question goes to the caddie, unless it carries a yardage correction (the router
     * owns those) — and a yes to "Want me to open that?" is that open, confirmed.
     *
     * Read BEFORE this turn is recorded: the record makes this turn the last one.
     */
    const offeredOpen = beginTurnForOffer(utterance);
    const answeringCaddie = !offeredOpen && !isAnsweringOffer() && isAwaitingFollowUp() && !carriesYardageCorrection(utterance);
    try { recordUserTurn(utterance); } catch { /* non-fatal */ }

    let intent: VoiceIntent | null = offeredOpen
      ?? (answeringCaddie ? answerToCaddie(utterance) : precheckLocalIntent(utterance));
    // Local-first health metric ([[self-growing-agent-architecture]]) — a precheck hit
    // answered without the cloud classifier. Pure observation; never gates the flow.
    if (intent) {
      try { useVoiceHitRateStore.getState().recordLocal(`precheck:${intent.intent_type}`, Date.now()); } catch { /* non-fatal */ }
    }
    /**
     * 2026-06-16 (Tim — "I speak but he waits 4-5s, then thinks") — a SPECULATIVE brain call fired
     * in parallel with the classifier, so the brain's network + LLM time overlapped the classify
     * instead of stacking behind it. ~0.7-1s off every conversational turn.
     *
     * 2026-08-27 — DELETED, because it had not shaved a millisecond off anything since 07-01.
     *
     * It was consumed in exactly one place: the small-talk kevin block below. On 07-01 the mic
     * convergence put conversationalBrainTurn IN FRONT of that block, gated on
     * `voiceOrchestrator === 'pipecat'` — and that gate is unconditionally true on every device.
     * The v15 migration force-sets 'pipecat' for every existing install, the store default is
     * 'pipecat' for every new one, and setVoiceOrchestrator had NO caller in any screen. (The
     * setting itself was deleted 2026-08-29 — OPEN-ITEMS §22.) So the
     * pipecat branch always ran, and its first two statements aborted the speculative call and
     * nulled the promise before anything could read it.
     *
     * Which means: every conversational earbud / badge turn fired a full /api/kevin request — the
     * complete union payload, a Lambda invocation, model tokens — and threw the answer away, 100%
     * of the time, for eight weeks. Every other exit path had an `abort()` too, each added by a
     * bug-hunt that noticed the leak on ONE branch and patched that branch. Five aborts accumulated
     * around a call that nothing could ever consume; not one of them asked whether the call should
     * still be fired at all.
     *
     * The remaining latency argument does not survive either: the answer now comes from
     * conversationalBrainTurn, which cannot start until the classifier returns, so the overlap this
     * was written for no longer exists to be captured. [[two-owners-is-the-root-cause]]
     */
    if (!intent) {
      // ── LOCAL-FIRST (2026-06-16, Tim) ──────────────────────────────────────
      // Before paying ANY cloud round-trip, try to answer the ask instantly from
      // device state (GPS / round / bag / CNS memory) via the same responder used
      // as the offline fallback. For the deterministic, accuracy-safe query types
      // this skips the classifier AND the brain — the 4-5s "then he thinks" gap —
      // and works with no signal (TTS still voices it, with the device-TTS fallback
      // when /api/voice is unreachable). Strategic/coaching asks aren't in the set,
      // so they still get the richer brain online. Pure win, no downgrade.
      /**
       * 2026-08-23 (Tim's call) — LOCAL-FIRST IS GONE. Every spoken question reaches the caddie.
       *
       * This block answered 16 query types — yardage_middle/front/back, wind, last_shot,
       * course_memory, score, hole, par — WITHOUT calling the brain at all. Its own log line said
       * so: "(skipped classify+brain)". It was added as a pure-win speed optimisation, and on the
       * two questions a caddie exists to answer it was the opposite:
       *
       *   "how far to the green"  → "150 yards to the middle of the green."
       *   "what's the wind doing" → a number, from services/localStatusResponder
       *
       * In NO persona (2 persona references across its 960 lines; offlineCaddie has zero), and as a
       * bare number — which the caddie's own answer doctrine calls a failure: "It's 158 is something
       * he could read off a screen; you are on the bag to convert it into a decision." So the
       * hazard carries, the player's tendencies, the conditions and the club call were all bypassed
       * at precisely the moment they mattered, including the weather wired in the same day.
       *
       * Tim: "everything is everything… the caddie is the person that knows everything, the brain,
       * the central nervous system. There should have been no way we went off reservation and
       * started creating separate paths."
       *
       * The local responder still exists as an OFFLINE answer when the brain genuinely cannot be
       * reached — that is a failure being handled honestly, not a second caddie answering first.
       */

      /**
       * Review G2 (finding 5, 2026-10-15) — A CLASSIFIER FAILURE IS NOT THE END OF THE TURN.
       *
       * A non-ok /api/voice-intent spoke the failure notice and idled; a throw or timeout fell into the
       * outer catch, which skipped even the local answer. Either way the question never reached the
       * brain. The classifier's job is TOOL ROUTING — a question does not need it — so its failure
       * means exactly "no tool intent": synthesise a conversational intent and carry on to the brain,
       * which owns the local answer and the honest line if it fails too. Same rule the typed / watch
       * path adopted on 08-26.
       */
      let parseRes: Response | null = null;
      try {
        parseRes = await fetchWithTimeout(`${apiUrl}/api/voice-intent`, {
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
        }, intentTimeout(), brainSignal);
      } catch (e) {
        console.log('[listeningSession] classifier threw — routing to the brain as a plain question', e);
      }
      if (parseRes?.ok) markEndpointWarmed('/api/voice-intent');
      const classifierFailed = !parseRes || !parseRes.ok;
      if (classifierFailed) {
        logVoiceDiag('classifier_failed_to_brain', { source: 'listeningSession', status: parseRes?.status ?? null });
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
      const parsedIntent = classifierFailed ? null : await parseRes!.json().catch(() => null) as Partial<VoiceIntent> | null;
      const knownType = typeof parsedIntent?.intent_type === 'string' && parsedIntent.intent_type.length > 0;
      if (!knownType && !classifierFailed) {
        console.log('[path4:voice] classifier returned an unrecognisable shape — treating as unknown');
        logVoiceSilentFail('intent_shape_invalid', { source: 'listeningSession', got: Object.keys(parsedIntent ?? {}).slice(0, 6).join(',') });
      }
      intent = (classifierFailed
        ? { intent_type: 'conversational', confidence: 'low', raw_text: utterance }
        : knownType
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
    noteTurnIntent(intent.intent_type);
    if ((state as SessionState) !== 'thinking') return;
    if (!live()) return;

    setSessionStateMirror('responding');

    // The disruptive-open gate (open / navigate / capture at less than high confidence → OFFER) is
    // voiceCommandRouter.dispatch's, which the handler branch below goes through. It used to be copied
    // here, before execute(); dispatch also runs it before execute, and it remembers the offer (B4).

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

    /**
     * 2026-10-28 (Brain review r3) — the in-round diagnostic ("why am I slicing it") is
     * inRoundDiagnosticHandler's, through dispatch below, like every other route. This file had its
     * own branch here (Phase BH), which asked the brain the classifier's SUMMARY ("swing today") with
     * no evidence-order doctrine, no live vision block and no offline evidence gate — and, because
     * `heard` defaulted to that summary, filed "swing today" in the shared history and the style
     * learner as the player's words. b16a169f fixed exactly that in the handler; this twin kept it.
     * The card push it alone had now lives in the handler, so every route gets the card.
     */

    // Phase BS audit (2026-05-14) — small-talk fallback. The voice-intent
    // classifier returns intent_type === 'unknown' for greetings and
    // chit-chat ("how are you", "thanks", "what's up"). Previously the
    // session fell through with no voice_response, producing a silent
    // drop after the filler played — users assumed Kevin didn't hear them
    // and the magic moment was gone. Now: if intent has a clarifying
    // follow_up_question, speak that. Otherwise route the raw utterance
    // to /api/kevin for a conversational reply.
    if (!voiceCommandRouter.getHandler(intent.intent_type) && mine('responding')) {
      const responseAllowed = settings.voiceEnabled;
      await fillerP;
      if (responseAllowed) {
        if (intent.follow_up_question) {
          if (mine('responding')) {
            await stopSpeaking('screen:services-listeningsession').catch(() => {});
            if (mine('responding')) {
              await speak(intent.follow_up_question, settings.voiceGender, intent.language ?? settings.language, apiUrl, { userInitiated: true })
                .catch((e) => console.log('[listeningSession] follow_up speak failed', e));
              try { recordKevinTurn(intent.follow_up_question); } catch { /* non-fatal */ }
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
          let firstTimedOut = false;
          let firstRefused = false;
          // 2026-07-01 (whole-app audit — MIC CONVERGENCE) — route the badge / earbud / hands-free
          // conversational turn to the SAME unified pipecat brain the caddie-tab mic uses.
          // conversationalBrainTurn falls back to legacy kevin internally on any pipecat failure, and
          // on a total miss (null text) we still fall through to the untouched kevin block below — so
          // this can never break the earbud path worse than before.
          // 2026-08-29 (OPEN-ITEMS §22) — was wrapped in `if (voiceOrchestrator === 'pipecat')`, a
          // setting with no UI setter that the v15 migration force-set, so the test could only ever
          // be true and the absent `else` was a legacy path nothing could reach. Unwrapped.
          try {
            const r = await brainTurnWithPreStep(utterance, { timeoutMs: kevinTimeout(), signal: brainSignal });
            firstTimedOut = !!r.timedOut;
            firstRefused = !!r.refused;
            // 2026-07-01 (re-audit — voice H2) — dispatch service-safe tool actions
            // (switch_caddie / navigate) the conversational brain returned; this
            // branch previously spoke the reply but dropped them.
            if (r.toolActions?.length) {
              const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
              dispatchConversationalToolActions(r.toolActions);
            noteTurnActed();
            }
            /**
             * 2026-08-27 — the fifth brain site, and it had the same hole as the other four: the
             * reply was spoken only while the session was still 'responding', with nothing at all
             * for the case where it wasn't. A cold turn can sit here for the better part of a
             * minute. Handing it to the deliverer means a reply that arrives late is SHOWN rather
             * than binned, and the fact that it was never heard is logged.
             */
            if (r.text) {
              await deliverBrainReply({
                reply: r,
                utterance,
                language: settings.language,
                voiceGender: settings.voiceGender,
                apiUrl,
                ttsAllowed: responseAllowed,
                site: 'listeningSession.conversational',
                isCurrent: live,
                requireResponding: true,
              });
              chatSpoken = true;
            }
          } catch (e) { console.log('[listeningSession] conversational turn failed', e); }
          /**
           * ONE RETRY, SAME QUESTION, SAME CADDIE — not a ladder to a lesser one.
           *
           * 2026-08-27 — this was a raw /api/kevin fetch with its own hand-built body, its own
           * timeout, its own response-shape parsing and its own error handling: the last brain
           * transport in this file that did not go through askCaddie. It also never wrote the turn
           * to the shared conversation history, because appendConversationTurn has exactly ONE caller
           * (caddieBrain), so any turn this block answered was invisible to the NEXT one — the very
           * amnesia services/voice/conversationHistory was created to end.
           *
           * caddieBrain's own header says the fallback ladder was deleted on 08-23 ("four different
           * caddies, each thinner than the last, and the player could not tell which one had
           * answered"). It was deleted THERE. Here it survived, one layer up, in a file that reads
           * as if it had not.
           *
           * A second attempt is still worth making — a cold Lambda that missed its budget usually
           * answers on the retry. So the retry stays and the SECOND CADDIE goes: the same call,
           * the same payload, the same history, once more. [[no-half-fixes-enforce-every-surface]]
           */
          /**
           * 2026-10-27 (Brain review F7) — BUT NOT AFTER OUR OWN TIMEOUT. A timed-out first attempt is
           * still running on the server and will be billed in full; a retry pays for a second turn and
           * makes him wait another whole window. useVoiceCaddie learned this on 09-23 ("ourTimeout");
           * this path never did, so the two routes had opposite rules.
           *
           * 2026-10-28 (Brain recheck R7) — NOR AFTER A REFUSAL. The server answered, and what it said
           * was that the brain is down (followUpBrainTurn's rule since round 5): a retry only runs the
           * whole server ladder again before he hears the failure line.
           */
          if (!chatSpoken && live() && !firstTimedOut && !firstRefused) try { // a shushed turn does not retry (voice seam review)
            const retry = await brainTurnWithPreStep(utterance, { timeoutMs: kevinTimeout(), signal: brainSignal });
            if (retry.toolActions?.length) {
              const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
              dispatchConversationalToolActions(retry.toolActions);
            }
            if (retry.text) {
              await deliverBrainReply({
                reply: retry,
                utterance,
                language: settings.language,
                voiceGender: settings.voiceGender,
                apiUrl,
                ttsAllowed: responseAllowed,
                site: 'listeningSession.conversational_retry',
                isCurrent: live,
                requireResponding: true,
              });
              chatSpoken = true;
            }
          } catch (e) {
            console.log('[listeningSession] conversational retry failed', e);
          }
          /**
           * 2026-08-27 — the last-resort line was itself gated on responseAllowed AND the session
           * still being 'responding', so the one branch whose whole job is "never leave dead air"
           * had two ways to leave dead air. The deliverer owns those judgments now: it reaches for
           * a device answer first, speaks or captions the honest line, and logs either way.
           */
          if (!chatSpoken) {
            await deliverBrainReply({
              reply: { text: null, audioBase64: null },
              utterance,
              language: settings.language,
              voiceGender: settings.voiceGender,
              apiUrl,
              ttsAllowed: responseAllowed,
              site: 'listeningSession.conversational_exhausted',
              isCurrent: live,
              requireResponding: true,
            });
          }
        }
      }
      // Review G2 (finding 1) — through the shared tail: "What's on your mind today?" and every
      // clarifying follow_up_question reopen the mic for the answer.
      endTurn(mySerial);
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
      // 2026-10-27 (Brain review B6) — through dispatch, not handler.execute: dispatch is where the
      // kill switch, the low-confidence rule, the TightLie round gate and the disruptive-open offer
      // live, and calling execute directly skipped all four on this path.
      const handlerP = voiceCommandRouter.dispatch(intent, ctx)
        .finally(() => { resultReady = true; });

      await fillerP;

      if (ttsAllowed) {
        for (let i = 0; i < 2 && !resultReady && mine('responding'); i++) {
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
      const toBrain = resultWantsBrain(result);
      if (!toBrain && result.success && (result.tool_action || !result.voice_response)) noteTurnActed();

      // Phase V.7+ — the response is user-initiated (mic-tap reply), so it
      // speaks at L1 too via { userInitiated: true }. Opener + filler stay
      // suppressed at L1 above. voiceEnabled is still enforced inside speak(); the phone-speaker
      // route no longer gates anything (toggle retired 2026-08-29).
      const responseAllowed = settings.voiceEnabled;
      // 2026-07-04 (Tim — "AI front and center") — the handler DEFERRED this judgment
      // read (shot_strategy) to the conversational caddie brain. Answer with Claude
      // (pipecat→kevin inside conversationalBrainTurn) + dispatch any tool actions; on a
      // total brain miss (signal drop) fall back to the offline caddie (local club-call).
      //
      // 2026-10-27 (Brain review B5) — and a handler that DECLINED (success:false, nothing to say,
      // nothing to do) is handing the turn over too. This path used to speak the "having trouble"
      // line over a non-owner's "read my reminders" — a failure that never happened.
      if (toBrain && !live()) {
        // 2026-10-28 (Brain review r3) — a turn the player shushed owes him nothing. The diagnostic now
        // comes through here, and its aborted read declines; that must not go on to a brain turn.
        endTurn(mySerial);
        return;
      }
      if (toBrain) {
        try {
          const r = await brainTurnWithPreStep(utterance, { timeoutMs: kevinTimeout(), signal: brainSignal });
          if (r.toolActions?.length) {
            const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
            dispatchConversationalToolActions(r.toolActions);
            noteTurnActed();
          }
          await deliverBrainReply({
            reply: r,
            utterance,
            language: intent.language ?? settings.language,
            voiceGender: settings.voiceGender,
            apiUrl,
            ttsAllowed: responseAllowed,
            site: 'listeningSession.route_to_brain',
            isCurrent: live,
            requireResponding: true,
          });
        } catch (e) {
          /**
           * conversationalBrainTurn swallows its own failures and hands back text:null, so reaching
           * this catch means the TOOL DISPATCH or its dynamic import threw — and the player is still
           * owed an answer. This used to be a bare console.log: the turn ended here, silently, with
           * nothing in the issue log.
           */
          console.log('[listeningSession] route_to_brain failed', e);
          logVoiceSilentFail('route_to_brain_threw', { source: 'listeningSession', error: describeError(e) });
          await deliverBrainReply({
            reply: { text: null, audioBase64: null },
            utterance,
            language: intent.language ?? settings.language,
            voiceGender: settings.voiceGender,
            apiUrl,
            ttsAllowed: responseAllowed,
            site: 'listeningSession.route_to_brain_catch',
            isCurrent: live,
            requireResponding: true,
          }).catch((e2) => console.log('[listeningSession] route_to_brain recovery failed', e2));
        }
        // Review G2 (finding 1) — through the shared tail, so a deferred read that asks back listens.
        endTurn(mySerial);
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
        // Review G2 — a stale turn must not stop the NEWER turn's speech either: check first.
        if (!mine('responding')) {
          endTurn(mySerial);
          return;
        }
        await stopSpeaking('screen:services-listeningsession').catch(() => {});
        if (!mine('responding')) {
          endTurn(mySerial);
          return;
        }
        // 2026-05-24 — Prefer the classifier-detected utterance language
        // over the user's Settings language so a Spanish/Chinese
        // utterance is spoken back through eleven_multilingual_v2 with
        // matching pronunciation. Falls through to settings.language
        // when the classifier didn't emit one (older Vercel route,
        // English transcript, or no triggers matched).
        await speak(result.voice_response, settings.voiceGender, intent.language ?? settings.language, apiUrl, { userInitiated: true });
        try { recordKevinTurn(result.voice_response); } catch { /* non-fatal */ }
      } else if (result.voice_response && !responseAllowed) {
        // 2026-07-30 (voice/brain audit H1 — Tim: "voice off and still get ALL the text responses").
        // Earbud/hands-free with voice muted (or phone-speaker gated) → SHOW the handler's reply so the
        // turn isn't silently dead. tool_action (below) still dispatches regardless.
        try { flashCaption?.(result.voice_response, 7000); } catch { /* non-fatal */ }
        try { recordKevinTurn(result.voice_response); } catch { /* non-fatal */ }
      }
      // 2026-10-27 (Brain review B5) — the old "no voice_response and success:false → speak the
      // having-trouble line" branch is gone: that exact result is a DECLINE, and resultWantsBrain sent
      // it to the caddie above. A silent success (acknowledge) stays silent, as it always did.
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
      // Route no longer gates speech — see the "Voice on Phone Speaker" retirement note above.
      if (settingsFresh.voiceEnabled && live() && getSessionState() !== 'idle') {
        await speakHonestFailure(
          settingsFresh.language,
          settingsFresh.voiceGender,
          getApiBaseUrl(),
        );
      }
    } catch (innerErr) { console.log('[listeningSession] outer-catch fallback failed', innerErr); }
  }

  endTurn(mySerial);
}

/**
 * The end of every turn that got as far as an answer — the ONE place a caddie's question reopens
 * the mic.
 *
 * Review G2 (finding 1, 2026-10-15) — this tail was inline at the bottom of openSession, and the
 * three branches a BRAIN reply comes back through (conversational — including every clarifying
 * follow_up_question — route_to_brain and in_round_diagnostic) each did their own
 * `setSessionStateMirror('idle'); return;` above it. So the case the tail was written for — the
 * caddie asking "What's on your mind today?" — never reached it. Every branch now ends here.
 *
 * A turn whose session was closed (a shush, the dormancy watchdog) or replaced by a newer one ends
 * with NOTHING here: no 'idle' written over the newer session, and no reopen after the player
 * deliberately closed it (finding 3).
 */
function endTurn(serial: number): void {
  if (serial !== sessionSerial) return;
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
    void openSession('auto_reopen').catch((e) => {
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
  console.log(`[path4:voice] close reason=${reason}`);
  noteTurnClosing(reason);
  // Review G2 — the turn in flight belongs to a session that no longer exists: retire its serial so
  // it can neither write state nor speak nor reopen, and abort its brain request.
  sessionSerial += 1;
  try { turnAbort?.abort(); } catch { /* aborting must never throw */ }
  turnAbort = null;
  // Phase BM — always stopSpeaking (drops the isSpeaking() guard). The guard
  // missed the gap between speechId++ and Sound.createAsync returning where
  // currentSound is still null but a TTS fetch is in-flight; a session-close
  // tap during that window otherwise left the pending utterance to play.
  void stopSpeaking('screen:services-listeningsession').catch(() => {});
  // Cancel mic if listening (Phase V.7 — now actually stops the recording)
  if (cancelMic) {
    try { cancelMic(); } catch {}
    cancelMic = null;
  }
  // Belt + suspenders: ensure no orphan recording survives.
  void stopCapture().catch(() => {});
  setSessionStateMirror('idle');
  noteTurnClosing(null);
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
  // 2026-09-28 — the typed / watch path is a real turn too, and it goes straight to the network.
  noteUserTurn();
  abortVoiceWarmup();
  noteCaddieTurn('typed'); // 1.0.2 funnel: first_caddie_turn (fires once)
  // 2026-07-25 (Tim — "give all mics a universal state display; not sure he's going to answer") — this
  // TYPED / watch path never drove the shared listening state, so the universal status strip showed
  // nothing after you hit send. Set 'thinking' now (strip shows "Thinking…" immediately) and reset to
  // idle in finally; the caddie's ANSWER shows via the voiceService caption while it speaks. Drive the
  // store directly (not the session-machine mirror, which arms voice-session watchdogs).
  const setSharedState = (s: 'thinking' | 'idle') => {
    try { require('../store/listeningSessionStore').useListeningSessionStore.getState().setState(s); } catch { /* non-fatal */ }
  };
  // 2026-10-30 (caddie-voice-1) — typed turns are counted, so toggle() drops taps for as long as any of
  // them is answering. Only a turn that starts from idle owns the shared state: a typed turn during a
  // live voice session must not overwrite that session's state, nor write 'idle' over it.
  const drivesStore = state === 'idle' && !sessionInFlight;
  if (drivesStore) setSharedState('thinking');
  /**
   * 2026-08-26 — RECORD THE PLAYER'S TURN. This function is what the global bottom bar sends a
   * TYPED question to, what the watch sends a dictated one to, and what handsFreeOrchestrator
   * routes through — i.e. every surface whose words did not come from the microphone here.
   *
   * The mic path gets both of these for free: captureUtteranceDetailed() logs the transcript, and
   * useVoiceCaddie calls recordUserTurn() before it sends. Nothing did either for this path, so a
   * question you TYPED was absent from the persisted conversation log (the CNS distill, the round
   * recap, "what did you just say") and absent from the 3-minute continuity buffer — which is why
   * a typed "how far to the green?" followed by a typed "and the wind?" had nothing to resolve
   * "the wind" against, while the same two questions spoken aloud worked.
   *
   * Both writes are best-effort and mirror the mic path exactly, including its ordering: the turn
   * is recorded BEFORE the brain call, so the request carries it. caddieRequestBody merges this
   * buffer with pipecatHistory and drops exact role+text repeats, so a turn that lands in both
   * is told to the caddie once.
   */
  // 2026-10-27 (Brain review B3 / B4) — the caddie's question owns the answer here too; see the
  // earbud path. Read before this turn is recorded, because recording it makes it the last turn.
  const offeredOpen = beginTurnForOffer(text);
  const answeringCaddie = !offeredOpen && !isAnsweringOffer() && isAwaitingFollowUp() && !carriesYardageCorrection(text);
  try { require('../store/conversationLogStore').useConversationLog.getState().logUser(text, Date.now()); } catch { /* non-fatal */ }
  try { recordUserTurn(text); } catch { /* non-fatal */ }
  typedTurnsInFlight += 1;
  try {
    const settings = useSettingsStore.getState();
    const round = useRoundStore.getState();
    const apiUrl = getApiBaseUrl();
    /**
     * 2026-10-27 (Brain review B10) — THE OPEN PUTT QUESTION, here too. Every other surface answers
     * "How many putts?" before classifying anything (pendingPuttAsk: missing it on one surface was ~50
     * of the "2 putts became an eagle" reports). The watch dictates "two" straight into this function;
     * offline the turn fell to a failed brain call and the putt count was lost.
     */
    const answered = tryAnswerOpenQuestion(text);
    if (answered) {
      if (settings.voiceEnabled ?? true) {
        await speak(answered.line, settings.voiceGender, settings.language ?? 'en', apiUrl, { userInitiated: true })?.catch?.(() => undefined);
      } else {
        try { flashCaption?.(answered.line, 6000); } catch { /* non-fatal */ }
      }
      try { recordKevinTurn(answered.line); } catch { /* non-fatal */ }
      return;
    }
    // 2026-07-04 (clean-audit H5) — the watch path went straight to the cloud and
    // silently died offline. Try the LOCAL precheck first, like both other paths.
    let intent = offeredOpen ?? (answeringCaddie ? answerToCaddie(text) : precheckLocalIntent(text));
    if (!intent) {
      // Review G2 (finding 5) — a THROW (timeout, no route) is the same "no tool intent" as a non-ok:
      // it used to fall to the outer catch below, a console.log, and the player got nothing at all.
      let parseRes: Response | null = null;
      try {
        parseRes = await fetchWithTimeout(`${apiUrl}/api/voice-intent`, {
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
      } catch (e) {
        console.log('[handsFree-route] classifier threw — routing to the brain as a plain question', e);
      }
      if (parseRes?.ok) markEndpointWarmed('/api/voice-intent');
      /**
       * 2026-08-26 — A CLASSIFIER FAILURE IS NOT THE END OF THE TURN.
       *
       * This logged and returned, so a 500 or a timeout from /api/voice-intent left the player with
       * NOTHING — on the surface the global bottom bar sends every TYPED question to, and the one
       * the watch and hands-free use. Type a question while that route is unhappy and the caddie
       * simply says nothing back. Every other terminal branch in this function speaks, captions, or
       * offers; this one was the hole.
       *
       * The classifier's job is TOOL ROUTING. A question does not need it. So a failure here means
       * exactly "no tool intent", which is already a case this function handles well: the no-handler
       * branch below routes to the conversational brain, falls back to a local answer from device
       * state, and only then says an honest failure line. Falling into it is a strict improvement
       * over silence and reuses the tested path rather than inventing a second one.
       */
      if (parseRes && !parseRes.ok) {
        console.log(`[handsFree-route] classifier non-ok ${parseRes.status} — routing to the brain as a plain question`);
      }
      intent = parseRes?.ok ? await parseRes.json().catch(() => null) : null;
      if (!intent) {
        intent = { intent_type: 'conversational', confidence: 'low', raw_text: text } as VoiceIntent;
      }
    }
    // 2026-07-04 (clean-audit M4) — the cloud classifier response carries no
    // raw_text; handlers' raw-text fallbacks (catalog lookup, hole parse, coach
    // name) silently died on this path. Always carry the utterance.
    //
    // 2026-08-26 — `if (!intent) return;` stood here and is now unreachable: the classifier branch
    // above always ends holding an intent, synthesising a conversational one when the route fails.
    // Left in place it would read as a live silent exit, which is the shape the new LOCK exists to
    // forbid, so it goes rather than being exempted.
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
        const r = await brainTurnWithPreStep(text, { timeoutMs: kevinTimeout() });
        // 2026-07-01 (re-audit — voice H2) — dispatch the service-safe tool actions
        // the brain returned (switch_caddie / navigate) so a hands-free "switch to
        // Tank" / "open SmartFinder" actually happens instead of only being spoken.
        if (r.toolActions?.length) {
          const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
          dispatchConversationalToolActions(r.toolActions);
            noteTurnActed();
        }
        // 2026-07-01 (re-audit — voice H1) — respect the SAME phone-speaker gate the
        // main path uses: don't talk out loud when audio is on the phone speaker and
        // "Voice on phone speaker" is off. voiceEnabled is still enforced inside speak().
        const ttsAllowed = (settings.voiceEnabled ?? true);
        /**
         * 2026-08-27 — the three branches that used to live here (speak / caption / apologise, plus
         * a hand-rolled answerOffline pass) are now the shared delivery contract. They said the same
         * things as the mic path's three branches, in different code, which is how the two drifted:
         * this one had the local-answer fallback the mic path lacked on 08-26, and the mic path had
         * captions this one lacked. One function, one contract, no drift. See deliverBrainReply.
         */
        await deliverBrainReply({
          reply: r,
          utterance: text,
          language: intent.language ?? settings.language,
          voiceGender: settings.voiceGender,
          apiUrl,
          ttsAllowed,
          site: 'handsFree-route.conversational',
          // No listening session behind a typed / watch / hands-free turn — nothing to be interrupted.
          requireResponding: false,
        });
      } catch (e) {
        console.log('[handsFree-route] conversational fallback failed:', e);
        logVoiceSilentFail('handsfree_conversational_threw', { source: 'handsFree-route', error: describeError(e) });
        await deliverBrainReply({
          reply: { text: null, audioBase64: null },
          utterance: text,
          language: intent.language ?? settings.language,
          voiceGender: settings.voiceGender,
          apiUrl,
          ttsAllowed: (settings.voiceEnabled ?? true),
          site: 'handsFree-route.conversational_catch',
          requireResponding: false,
        }).catch((e2) => console.log('[handsFree-route] conversational recovery failed', e2));
      }
      return;
    }
    // The disruptive-open gate is voiceCommandRouter.dispatch's (below), as on the earbud path.
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
      language: intent.language ?? settings.language,
    };
    // 2026-10-27 (Brain review B6) — through dispatch: the kill switch, low confidence → the caddie,
    // the TightLie round gate and the remembered open offer, none of which execute() applies.
    const result = await voiceCommandRouter.dispatch(intent, ctx);
    // 2026-07-04 (clean-audit C2) — in pipecat mode the judgment reads (shot_strategy)
    // DEFER to the conversational brain; this path used to ignore the flag → total
    // silence on "what's the play" from the watch. Mirror the earbud branch.
    // 2026-10-27 (Brain review B5) — a decline (success:false, nothing to say or do) is a brain turn
    // too. This path used to say nothing at all to a non-owner's typed "read my reminders".
    if (resultWantsBrain(result)) {
      try {
        const r = await brainTurnWithPreStep(text, { timeoutMs: kevinTimeout() });
        if (r.toolActions?.length) {
          const { dispatchConversationalToolActions } = await import('./voice/conversationalToolDispatch');
          dispatchConversationalToolActions(r.toolActions);
            noteTurnActed();
        }
        const ttsAllowed2 = (settings.voiceEnabled ?? true);
        /**
         * 2026-08-27 — and this branch never had the local fallback at all: an empty brain reply
         * went straight to the apology while the device held the GPS and the bag. Three sites, three
         * different sets of capabilities for the same failure. deliverBrainReply is now the only
         * one, so a fix lands on all of them or on none.
         */
        await deliverBrainReply({
          reply: r,
          utterance: text,
          language: intent.language ?? settings.language,
          voiceGender: settings.voiceGender,
          apiUrl,
          ttsAllowed: ttsAllowed2,
          site: 'handsFree-route.route_to_brain',
          requireResponding: false,
        });
      } catch (e) {
        console.log('[handsFree-route] route_to_brain failed:', e);
        logVoiceSilentFail('handsfree_route_to_brain_threw', { source: 'handsFree-route', error: describeError(e) });
        await deliverBrainReply({
          reply: { text: null, audioBase64: null },
          utterance: text,
          language: intent.language ?? settings.language,
          voiceGender: settings.voiceGender,
          apiUrl,
          ttsAllowed: (settings.voiceEnabled ?? true),
          site: 'handsFree-route.route_to_brain_catch',
          requireResponding: false,
        }).catch((e2) => console.log('[handsFree-route] route_to_brain recovery failed', e2));
      }
      return;
    }
    if (result?.voice_response) {
      void speak(result.voice_response, settings.voiceGender, intent.language ?? settings.language ?? 'en', apiUrl, { userInitiated: true })
        ?.catch?.(() => undefined);
      try { recordKevinTurn(result.voice_response); } catch { /* non-fatal */ }
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
    typedTurnsInFlight -= 1;
    if (drivesStore && typedTurnsInFlight === 0) setSharedState('idle');
  }
}
