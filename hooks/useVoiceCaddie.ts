import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Audio } from 'expo-av';
import { Vibration, Alert, Linking, AppState } from 'react-native';
import { prewarmVoice } from '../services/voiceWarmup';
import { usePathname } from 'expo-router';
import {
  configureAudioForRecording,
  speak,
  speakFromBase64,
  stopSpeaking,
  isSpeaking,
  playLocalFile,
  captureUtterance,
  isCapturing,
  endCaptureEarly,
  RECORDING_OPTIONS,
} from '../services/voiceService';
import { initFillerLibrary } from '../services/fillerLibrary';
import { bagDistances } from '../services/shotStrategy';
import { getCaddieContext, mergeMemoryIntoContext } from '../services/caddieMemoryRetrieval';
import { checkContent } from '../services/contentGuardrail';
import { resolveAckClip } from '../services/quickAckClips';
import { resolveGreetingClip } from '../services/quickGreetingClips';
import { recordFailure as recordVoiceEndpointFailure, recordSuccess as recordVoiceEndpointSuccess } from '../services/voiceCircuitBreaker';
// 2026-05-21 — Consolidation 4: routine voice traces gated through devLog.
import { devLog } from '../services/devLog';
import { isSessionInFlight } from '../services/listeningSession';
import { voiceCommandRouter } from '../services/intents';
import { openToolHandler } from '../services/intents/openToolHandler';
import { quickRoundHandler } from '../services/intents/quickRoundHandler';
import type { AppContext, VoiceIntent } from '../types/voiceIntent';
import type { ToolAction } from '../app/api/kevin+api';
import { useSmartVision } from '../contexts/SmartVisionContext';
import { useKevinPresence } from '../contexts/KevinPresenceContext';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useFamilyStore } from '../store/familyStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { useCageStore } from '../store/cageStore';
import { getRecentTurns, recordUserTurn, recordKevinTurn, isAwaitingFollowUp } from '../services/conversationState';
import { buildFullPracticeContext } from '../services/tutorialContext';
import { useWatchStore } from '../store/watchStore';
import { VoiceState } from '../components/CaddieAvatar';
import { getCourse as getApiCourse, courseSummaryForContext } from '../services/golfCourseApi';
import { generatePatternInsights } from '../services/patternDetection';
import { useGhostStore } from '../store/ghostStore';
import { useSmartFinderStore } from '../store/smartFinderStore';
import { logVoiceError, logTranscribeError, logVoiceSilentFail } from '../services/voiceErrorLog';
import { getApiBaseUrl } from '../services/apiBase';

// ─── CONSTANTS ────────────────────────────

// 2026-05-25 — Bumped 4000→12000. The old 4s hard-cap clipped any
// utterance longer than a single short phrase ("what club"), making
// open conversation with Kevin ("hey Kevin, I've been thinking about
// my approach shots") feel like getting timed out mid-sentence.
// 2026-06-05 — Bumped 12s → 45s. Tim's report: longer questions
// ("on my last shot I was thinking about laying up but ended up
// going for it, what would you have done in that situation?") were
// being cut mid-sentence by the 12s hard cap. The silence-VAD at
// SILENCE_TIMEOUT_MS=4s in services/voiceService.ts is the right
// "user stopped talking" detector — this hard cap is just the
// "user wandered away" backstop. 45s comfortably covers any
// natural question without truncating; user can still tap to stop.
const AUTO_STOP_MS = 45_000;
// 2026-06-07 — Bumped 25s → 40s and 45s → 60s. Tim still hits
// "That took too long" on the first interaction after a fresh app
// launch. Root cause: services/voiceWarmup pre-hits /api/transcribe
// via openai.audio.speech.create (TTS) — which warms the SDK + TLS
// layer but NOT Whisper itself (Whisper is a separate OpenAI model
// with its own first-call cold-start, typically 5-10s). So the first
// real transcribe pays:
//   Lambda warm (good) + Whisper cold (5-10s) + audio upload (1-3s)
//   + Whisper inference (1-3s) = could exceed 25s on slow cellular.
// 40s gives generous headroom for that combined window. Brain
// pushed to 60s for symmetry — the brain prompt cache hit varies
// with conversation history size, and the prior 45s could clip
// the first cold-Sonnet turn on a long context.
const TRANSCRIBE_TIMEOUT_MS = 40000;
const BRAIN_TIMEOUT_MS = 60000;

// 2026-06-06 — handleMicPress silence-VAD config. Mirrors the
// SILENCE_DB_THRESHOLD / SPEECH_DETECT_DB / SILENCE_TIMEOUT_MS in
// services/voiceService.ts (captureUtterance) so the manual-tap path
// behaves identically to the follow-up-listen path. Tim's report:
// "first question waits forever if you don't tap to stop listening"
// — silence-VAD was only on captureUtterance, the first turn (which
// always uses handleMicPress) had no silence detector and only the
// 45s hard cap.
const MIC_SILENCE_DB_THRESHOLD = -40;
const MIC_SPEECH_DETECT_DB = -30;
const MIC_SILENCE_TIMEOUT_MS = 4000;

// 2026-05-26 — Fix BA: client-side close-intent matcher for the
// follow-up listen loop. The brain handles most "no thanks" well, but
// utterances that combine a negation with a close intent ("no, I'm
// good") got parsed as a negative response and sometimes elicited
// another follow-up question ("OK, what wasn't right?"). This gate
// catches the explicit close phrases here and bails the loop BEFORE
// the brain call.
//
// All patterns require the close phrase to be essentially the WHOLE
// utterance — anchored at start, optional trailing punctuation only.
// A real follow-up like "no, stop slicing for me" wouldn't match
// because the close fragment isn't the whole transcript.
const CLOSE_INTENT_PATTERNS: RegExp[] = [
  /^(no[,\s]*)?(i'?m|i\s+am|we'?re|we\s+are)\s+(good|done|fine|cool|all\s*set|all\s*done)\.?$/i,
  /^(no\s*)?(thanks?|thank\s*you)\s*(though)?\.?$/i,
  /^nope[,\s]*i'?m\s+good\.?$/i,
  /^cancel\.?$/i,
  /^never\s*mind\.?$/i,
  /^nvm\.?$/i,
  /^stop\s*talking\.?$/i,
  /^shut\s*up\.?$/i,
  /^i\s*hit\s*it\s*(on|by)\s*accident\.?$/i,
  /^accidental(\s*tap)?\.?$/i,
  /^that('?s|\s+is)?\s+all\.?$/i,
  /^(that('?s|\s+is)?\s+)?all\s*good\.?$/i,
  /^(no[,\s]*)?(that'?s|that\s+is)\s+all\.?$/i,
  /^bye\.?$/i,
  /^later\.?$/i,
  /^talk\s*to\s*you\s*later\.?$/i,
];
function isCloseIntent(transcript: string): boolean {
  const cleaned = transcript.trim().toLowerCase();
  if (!cleaned) return false;
  return CLOSE_INTENT_PATTERNS.some(p => p.test(cleaned));
}

// Phase BM — module-level mic permission cache. Once granted, every tap
// skips the IPC roundtrip. Stays false on first denial / cold launch.
//
// Audit follow-up (2026-05-13) — exported `resetMicPermissionCache()` so
// voicePermissionService.clearMicDenial() can invalidate the cache when
// the user re-enables voice in Settings. Without this reset, a user who
// denied mic → re-granted in OS Settings → flipped voiceEnabled back on
// would still hit the stale `false` cache and Kevin would silently fail
// until app restart.
let micPermissionGranted = false;
export function resetMicPermissionCache(): void {
  micPermissionGranted = false;
  micBlockedPromptShown = false;
}

// Audit follow-up (2026-05-13) — show the "Mic blocked → open Settings"
// Alert at most once per app session so a user who denies and then
// taps the mic ten more times isn't pestered repeatedly. Reset alongside
// the granted cache so resetMicPermissionCache() in voicePermissionService
// gives the user a clean slate on re-enable.
let micBlockedPromptShown = false;

// 2026-06-05 — Recording options moved to services/voiceService.ts
// (RECORDING_OPTIONS export, single source of truth). Drift between
// the two duplicate definitions was a near-miss; one import keeps
// both the manual-tap path here and the captureUtterance path in
// voiceService aligned on format / sample rate / bit rate forever.

// ─── BYPASS PHRASES ───────────────────────

const YARDAGE_PHRASES = [
  "what's my yardage",
  "what is my yardage",
  "how far",
  "how many yards",
  "what's the distance",
  "distance to the pin",
  "yards to the pin",
  "how far to the green",
  "yardage",
  "cuántas yardas",
  "distancia al green",
];

const HERO_PHRASES = [
  "did you get that",
  "save that",
  "hero reel",
  "that's a keeper",
  "got that",
  "save it",
];

const HERO_VIEW_PHRASES = [
  'show me my hero reel',
  'show my best shots',
  'show me my best',
  'hero reel',
  'my best shots',
  'show me my drives',
  'show me my irons',
];

const PENALTY_PHRASES = [
  "penalty",
  "penalty stroke",
  "water",
  "in the water",
  "hit it in the water",
  "ob",
  "out of bounds",
  "lost ball",
  "lost it",
  "drop",
  "take a drop",
  "add a penalty",
];

const MUTE_PHRASES = [
  "mute",
  "be quiet",
  "stop talking",
  "silence",
  "quiet",
  "silenciar",
];

const VISION_PHRASES = [
  "smart vision",
  "analyze the hole",
  "analyze this hole",
  "read the hole",
  "what do you see",
  "hole analysis",
];

// ─── HOOK ─────────────────────────────────

interface UseVoiceCaddieOptions {
  onVoiceStateChange: (state: VoiceState) => void;
  onResponseReceived: (text: string) => void;
  onHeroMoment?: () => void;
  onVisionTrigger?: () => void;
  onHeroReelView?: () => void;
  onToolAction?: (action: ToolAction) => void;
}

/**
 * Phase A.3 refinement — map an expo-router pathname to the surface identifier
 * the help-discovery handler expects. Falls back to 'caddie' for unknown paths
 * so help continues to behave as it did pre-refinement.
 */
function pathnameToSurface(pathname: string | null | undefined): string {
  if (!pathname) return 'caddie';
  const p = pathname.toLowerCase();
  if (p.includes('scorecard')) return 'scorecard';
  if (p.includes('swinglab') || p.includes('swing-lab')) return 'swinglab';
  if (p.includes('dashboard')) return 'dashboard';
  if (p.includes('smartfinder')) return 'smartfinder';
  if (p.includes('smartvision')) return 'smartvision';
  if (p.includes('settings')) return 'settings';
  if (p.includes('recap')) return 'recap';
  if (p.includes('course/')) return 'course-detail';
  if (p.includes('caddie') || p === '/' || p === '/(tabs)') return 'caddie';
  return 'caddie';
}

function normalizeForMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’'".,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitGuestNames(text: string): string[] {
  return text
    .split(/,|\band\b/i)
    .map(name => name.trim())
    .filter(name => name.length > 0)
    .map(name => name.replace(/^(?:my|our|the)\s+/i, ''));
}

function stripLeadIn(text: string): string {
  return text.replace(/^(?:please\s+)?(?:can you\s+|could you\s+|would you\s+|hey\s+\w+\s+|me\s+)?/i, '').trim();
}

function includesAny(text: string, phrases: string[]): boolean {
  return phrases.some(phrase => text.includes(phrase));
}

function buildPreRoundShortcutIntent(transcript: string): { intent_type: 'open_tool' | 'quick_round'; parameters: Record<string, unknown> } | null {
  const cleaned = normalizeForMatch(transcript);
  if (!cleaned) return null;

  const familyHomeCourse = usePlayerProfileStore.getState().homeCourse?.trim() ?? '';

  const toolText = stripLeadIn(cleaned.replace(/^(?:open|show|pull up|go to|launch|bring up|take me to)\s+(?:me\s+)?/i, ''));
  const toolMatchers: Array<{ tool_name: string; aliases: string[] }> = [
    { tool_name: 'smartvision', aliases: ['smart vision', 'smartvision', 'vision', 'analyze the hole', 'read the hole'] },
    { tool_name: 'smartfinder', aliases: ['smart finder', 'smartfinder', 'finder', 'rangefinder', 'course map', 'hole map', 'show me the course', 'show the course', 'the course', 'course'] },
    { tool_name: 'swinglab', aliases: ['swing lab', 'swinglab', 'practice', 'drills', 'library', 'swing library'] },
    { tool_name: 'scorecard', aliases: ['scorecard', 'score card', 'scores', 'show the scorecard'] },
    { tool_name: 'dashboard', aliases: ['dashboard', 'stats', 'overview', 'home stats'] },
    { tool_name: 'settings', aliases: ['settings', 'preferences', 'voice settings', 'audio settings'] },
    { tool_name: 'coach_mode', aliases: ['coach mode', 'coachmode', 'coach', 'watch my student', 'record their swing'] },
    { tool_name: 'cage_mode', aliases: ['cage mode', 'cagemode', 'cage', 'start cage session', 'start practice'] },
    { tool_name: 'library', aliases: ['player library', 'swing library', 'library', 'show my swings', 'my swings', 'show best shots', 'show my best shots', 'best shots'] },
    { tool_name: 'smartmotion', aliases: ['smart motion', 'smartmotion', 'record my swing', 'capture my swing', 'down the line', 'face on'] },
    { tool_name: 'issue_log', aliases: ['issue log', 'bug log', 'log an issue', 'send issue log', 'email issue log'] },
    { tool_name: 'tightlie', aliases: ['tightlie', 'tight lie', 'open tightlie', 'check my lie', 'what should i hit'] },
  ];

  for (const matcher of toolMatchers) {
    if (includesAny(toolText, matcher.aliases)) {
      const params: Record<string, unknown> = { tool_name: matcher.tool_name };
      if (matcher.tool_name === 'smartmotion' && includesAny(toolText, ['down the line', 'face on'])) {
        params.auto_start = true;
        params.angle = toolText.includes('down the line') ? 'down_the_line' : 'face_on';
      }
      if (matcher.tool_name === 'issue_log' && includesAny(toolText, ['send', 'email', 'share', 'export'])) {
        params.send_log = true;
      }
      if (matcher.tool_name === 'coach_mode') {
        const playerMatch = transcript.match(/\b(?:coach|watch my student|watching|i'?m coaching|let's coach)\s+([A-Z][a-zA-Z'-]*)/i);
        if (playerMatch?.[1]) params.player_name = playerMatch[1];
      }
      return { intent_type: 'open_tool', parameters: params };
    }
  }

  if (includesAny(cleaned, ['quick round', 'start a round', 'start round', "let's play", 'let us play', 'play a quick round', 'start another round', 'another round', 'start a quick round'])) {
    const holeCount = /\b9[- ]?hole\b|\blet's play 9\b|\bplay 9\b/.test(cleaned) ? 9 : 18;
    const courseMatch = transcript.match(/\b(?:at|on|for)\s+(.+?)(?:\s+with\s+|\s+today\b|\s+now\b|\s*$)/i);
    const courseHint = courseMatch?.[1]?.trim() || familyHomeCourse;
    const guestMatch = transcript.match(/\bwith\s+(.+?)(?:\s+at\b|\s+on\b|\s+for\b|\s+today\b|\s+now\b|$)/i);
    const guestNames = guestMatch?.[1] ? splitGuestNames(guestMatch[1]) : [];
    const params: Record<string, unknown> = { hole_count: holeCount };
    if (courseHint) params.course_hint = courseHint;
    if (guestNames.length > 0) params.guest_names = guestNames.slice(0, 4);
    return { intent_type: 'quick_round', parameters: params };
  }

  return null;
}

export const useVoiceCaddie = ({
  onVoiceStateChange,
  onResponseReceived,
  onHeroMoment,
  onVisionTrigger,
  onHeroReelView,
  onToolAction,
}: UseVoiceCaddieOptions) => {

  const currentPathname = usePathname();
  const recordingRef    = useRef<Audio.Recording | null>(null);
  const isProcessingRef = useRef(false);
  const autoStopTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 2026-06-06 — Silence-VAD polling timer for handleMicPress.
  // Cleared in clearAutoStop() alongside autoStopTimer.
  const silenceVadTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // 2026-06-06 — User interrupted caddie mid-speech by tapping. Set in
  // handleMicPress's isSpeaking() branch; checked by processAudioUri
  // (and intent-router success branch) after awaiting speak so the
  // follow-up-listen loop is suppressed — otherwise tapping to stop
  // a long answer would immediately open the mic again and feel "stuck."
  // Cleared by handleMicPress at function entry (next user action
  // implicitly clears the prior interrupt).
  const userInterruptedRef = useRef(false);

  // Phase BJ — propagate KevinPresence.isThinking from any voice state
  // change. Speaking is already auto-tracked by KevinPresenceProvider via
  // services/voiceService.subscribeToSpeaking, so we only need to plumb
  // the thinking signal. Wraps the caller's onVoiceStateChange so existing
  // local state (caddie.tsx voiceState) keeps working too.
  const { setIsThinking } = useKevinPresence();
  const wrappedOnVoiceStateChange = useCallback((state: VoiceState) => {
    setIsThinking(state === 'thinking');
    onVoiceStateChange(state);
  }, [setIsThinking, onVoiceStateChange]);

  // Audit follow-up (2026-05-13) — useShallow wrappers on every
  // multi-key destructure so an unrelated store write (theme flip,
  // unrelated setting change, etc.) doesn't force the entire voice
  // hook + every component using it to re-render. Functions and
  // getters are pulled separately via single-key selectors since
  // they're stable references.
  const {
    isRoundActive,
    currentHole,
    currentYardage,
    activeCourse,
    activeCourseId,
    club,
    scores,
    isCompetition,
    mode: roundMode,
    shots,
    courseHoles,
  } = useRoundStore(
    useShallow((s) => ({
      isRoundActive: s.isRoundActive,
      currentHole: s.currentHole,
      currentYardage: s.currentYardage,
      activeCourse: s.activeCourse,
      activeCourseId: s.activeCourseId,
      club: s.club,
      scores: s.scores,
      isCompetition: s.isCompetition,
      mode: s.mode,
      shots: s.shots,
      courseHoles: s.courseHoles,
    }))
  );
  const familyMembers = useFamilyStore(s => s.members);
  const activeFamilyMemberId = useFamilyStore(s => s.active_member_id);
  const activeFamilyMember = useMemo(
    () => familyMembers.find(m => m.id === activeFamilyMemberId && !m.archived) ?? null,
    [familyMembers, activeFamilyMemberId],
  );
  const getCurrentPar = useRoundStore((s) => s.getCurrentPar);
  const courseContextRef = useRef<string | null>(null);
  const courseContextCourseIdRef = useRef<string | null>(null);

  const {
    voiceGender,
    voiceEnabled,
    language,
    responseMode,
  } = useSettingsStore(
    useShallow((s) => ({
      voiceGender: s.voiceGender,
      voiceEnabled: s.voiceEnabled,
      language: s.language,
      responseMode: s.responseMode,
    }))
  );

  useEffect(() => {
    let cancelled = false;
    if (!isRoundActive || !activeCourseId) {
      courseContextRef.current = null;
      courseContextCourseIdRef.current = null;
      return;
    }
    if (courseContextCourseIdRef.current === activeCourseId && courseContextRef.current) {
      return;
    }
    courseContextCourseIdRef.current = activeCourseId;
    courseContextRef.current = null;
    void (async () => {
      try {
        const course = await getApiCourse(activeCourseId);
        if (cancelled || !course) return;
        courseContextRef.current = courseSummaryForContext(course);
      } catch (e) {
        console.warn('[voiceCaddie] course context preload failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCourseId, isRoundActive]);

  // Load the filler library index into memory on first mount — fast, reads
  // AsyncStorage only. Phase AB — also fire-and-forget generateLibrary so
  // existing users whose cache is on a stale voiceHash (e.g. v2) actually
  // upgrade to v3 on next boot. Without this, the V.6 extension fillers +
  // context-aware variants only land for new onboarding users; everyone
  // else keeps hearing the prior pool. generateLibrary internally checks
  // the hash and no-ops if up to date, so it's safe to call every boot.
  const _apiUrlForBoot = getApiBaseUrl();
  const _personaForBoot = useSettingsStore.getState().caddiePersonality;
  const _languageForBoot = useSettingsStore.getState().language;
  useEffect(() => {
    void (async () => {
      try {
        await initFillerLibrary();
        if (useSettingsStore.getState().voiceEnabled && _apiUrlForBoot) {
          const { generateLibrary } = await import('../services/fillerLibrary');
          void generateLibrary(_apiUrlForBoot, _personaForBoot, _languageForBoot)
            .catch(e => console.log('[fillerLibrary] background regen failed', e));
        }
      } catch (e) {
        console.log('[fillerLibrary] init failed', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-06-10 — Warm the voice-pipeline Lambdas when a voice surface mounts AND
  // whenever the app returns to the foreground. Previously prewarmVoice() fired
  // ONLY on the greeting screen, so the first mic tap after navigating to the
  // caddie/cockpit (or after the app had been backgrounded long enough for the
  // Vercel Lambdas to idle out) paid full cold-start — the "thinking forever →
  // took too long" first turn. The 30s dedupe inside prewarmVoice keeps repeated
  // mounts/foregrounds cheap. (This only does anything now that getApiBaseUrl()
  // resolves a real URL — pre-spine-fix it fired "Invalid URL" and warmed nothing.)
  useEffect(() => {
    const warmIfVoice = () => {
      if (useSettingsStore.getState().voiceEnabled) prewarmVoice();
    };
    warmIfVoice(); // entering a voice surface
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') warmIfVoice(); // returning to the app
    });
    return () => sub.remove();
  }, []);

  const {
    name,
    firstName,
    handicap,
    dominantMiss,
    physicalLimitation,
    goal,
    personalBest,
  } = usePlayerProfileStore(
    useShallow((s) => ({
      name: s.name,
      // 2026-05-25 — firstName gets layered through inviteePreferences
      // map so Tim's pre-set salutations ("Uncle Mike" for m.hayes@snet.net)
      // override the default sign-in firstName. Applied here so EVERY
      // brain call receives the right name without changing the store
      // shape. Falls back to s.firstName when no override exists.
      firstName: (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { resolveCaddieSalutation } = require('../data/inviteePreferences') as typeof import('../data/inviteePreferences');
          return resolveCaddieSalutation(s.email, s.firstName);
        } catch {
          return s.firstName;
        }
      })(),
      handicap: s.handicap,
      dominantMiss: s.dominantMiss,
      physicalLimitation: s.physicalLimitation,
      goal: s.goal,
      personalBest: s.personalBest,
    }))
  );

  // dominantMiss from profile has compatible type — just cast for patternDetection
  const profileDominantMiss = dominantMiss as 'left' | 'right' | 'straight' | null;

  const {
    roundsTogether,
    sessionsTogether,
    currentMentalState,
    consecutiveBadHoles,
    isSpiralRisk,
  } = useRelationshipStore(
    useShallow((s) => ({
      roundsTogether: s.roundsTogether,
      sessionsTogether: s.sessionsTogether,
      currentMentalState: s.currentMentalState,
      consecutiveBadHoles: s.consecutiveBadHoles,
      isSpiralRisk: s.isSpiralRisk,
    }))
  );
  // Function refs pulled separately — they're stable across renders
  // and including them in the shallow selector would cost nothing
  // either way, but separating clarifies "these are actions, not data."
  const getTopObservations = useRelationshipStore((s) => s.getTopObservations);
  const markObservationsUsed = useRelationshipStore((s) => s.markObservationsUsed);
  const getRecentHeroMoments = useRelationshipStore((s) => s.getRecentHeroMoments);
  const addHeroMoment = useRelationshipStore((s) => s.addHeroMoment);

  const apiUrl = getApiBaseUrl();
  const currentPar = getCurrentPar();
  const smartVision = useSmartVision();

  // ── CLEAR AUTO STOP ───────────────────────

  const clearAutoStop = () => {
    if (autoStopTimer.current) {
      clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
    }
    if (silenceVadTimer.current) {
      clearInterval(silenceVadTimer.current);
      silenceVadTimer.current = null;
    }
  };

  // ── CHECK BYPASS PHRASES ──────────────────

  const checkBypasses = (transcript: string): {
    handled: boolean;
    response?: string;
    triggerHero?: boolean;
    triggerVision?: boolean;
    triggerHeroReelView?: boolean;
    triggerMute?: boolean;
  } => {
    const t = transcript.toLowerCase();

    if (isRoundActive && PENALTY_PHRASES.some(p => t.includes(p))) {
      useRoundStore.getState().addPenalty(currentHole);
      return { handled: true, response: 'Got it — penalty stroke added.' };
    }

    if (HERO_PHRASES.some(p => t.includes(p))) {
      const kevinSaid = addHeroMoment({
        clipUri: null,
        hole: currentHole,
        club: club ?? '',
        courseName: activeCourse ?? '',
        conditions: '',
        carlosNote: null,
      });
      return { handled: true, response: kevinSaid, triggerHero: true };
    }

    if (YARDAGE_PHRASES.some(p => t.includes(p))) {
      const response = currentYardage
        ? "You're " + currentYardage + ' yards to the center.' +
          (club ? ' ' + club + ' in hand.' : '')
        : 'Check the hole view for your yardage.';
      return { handled: true, response };
    }

    if (VISION_PHRASES.some(p => t.includes(p))) {
      return { handled: true, triggerVision: true, response: 'Taking a look at the hole.' };
    }

    if (HERO_VIEW_PHRASES.some(p => t.includes(p))) {
      return { handled: true, triggerHeroReelView: true, response: 'Here are your best moments.' };
    }

    if (MUTE_PHRASES.some(p => t.includes(p))) {
      return { handled: true, triggerMute: true, response: '' };
    }

    return { handled: false };
  };

  // ── SEND TO BRAIN ─────────────────────────

  const sendToBrain = async (message: string): Promise<{ text: string; audioBase64: string | null; toolAction: ToolAction | null }> => {
    // 2026-06-13 (Cecily) — if the player asked the caddie to SING, reshape the brain
    // message into a playful "attempt to sing" prompt so the caddie gives it a go
    // (charming, brief, kid-friendly) instead of answering flat or refusing.
    // 2026-06-13 (Tim) — "how do I use this / how does X work" → speak the quick how-to
    // for that feature (shared SCREEN_HELP copy, same as the first-time tutorials).
    // Checked first so "how do I play this" is help, not a song request.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sh = require('../services/screenHelp') as typeof import('../services/screenHelp');
      const help = sh.detectHelpRequest(message);
      if (help) {
        const h = sh.getScreenHelp(help.key);
        if (h) return { text: h.spoken, audioBase64: null, toolAction: null };
      }
    } catch { /* non-fatal */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sa = require('../services/singAttempt') as typeof import('../services/singAttempt');
      const sing = sa.detectSingRequest(message);
      if (sing) message = sa.buildSingMessage(sing.song);
    } catch { /* non-fatal — fall back to the literal message */ }
    // 2026-06-13 (Tim/Cecily) — "play [song]" → search the kid-safe portal and open the
    // clean in-app player, short-circuiting the brain with a spoken confirmation.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ps = require('../services/playSongFlow') as typeof import('../services/playSongFlow');
      const handled = await ps.tryPlaySong(message);
      if (handled) return { text: handled.spoken, audioBase64: null, toolAction: null };
    } catch { /* non-fatal — fall through to the brain */ }
    try {
      const topObs = getTopObservations();
      // 2026-05-17 — record the use AFTER we read, so the bump
      // happens exactly once per brain send (not per re-render).
      if (topObs.length > 0) markObservationsUsed(topObs.map(o => o.id));
      const heroMoments = getRecentHeroMoments(2);

      const watchState = useWatchStore.getState();
      const watchSummary = watchState.getSessionSummary();

      // Defensive: a single malformed session in history (e.g. a shape the
      // SmartMotion redesign produced) must never throw here and take the whole
      // brain call down. Guard every field access.
      const recentCageSessions = useCageStore.getState()
        .sessionHistory
        .slice(-3)
        .reverse()
        .map(s => {
          const shotsArr = Array.isArray(s.shots) ? s.shots : [];
          let dateStr = '';
          try {
            if (s.date != null) {
              dateStr = new Date(s.date).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
              });
            }
          } catch { dateStr = ''; }
          return {
            club: s.club,
            shots: shotsArr.length,
            dominantMiss: s.dominantMiss,
            rootCause: s.rootCause,
            summary: s.summary,
            // 2026-05-25 — Fix AJ Phase 2: surface the spoken commentary
            // for the most-recent shot in this session so Kevin / Tank /
            // etc. can answer "what did I just say about that swing".
            last_shot_commentary: shotsArr.length > 0
              ? (shotsArr[shotsArr.length - 1]?.commentary_transcript ?? null)
              : null,
            date: dateStr,
          };
        });

      const ghostContext = useGhostStore.getState().getSummaryText();
      const smartFinderLock = useSmartFinderStore.getState().currentLock;
      const smartFinderContext = smartFinderLock
        ? `SMARTFINDER ACTIVE: User has locked distance of ${smartFinderLock.distance_yards} yards (${smartFinderLock.distance_meters} meters) at compass heading ${Math.round(smartFinderLock.compass_heading)}°. Confidence: ${smartFinderLock.distance_yards >= 50 && smartFinderLock.distance_yards <= 250 ? 'high' : smartFinderLock.distance_yards >= 10 && smartFinderLock.distance_yards <= 400 ? 'medium' : 'low'}. Treat the locked distance as the working number.`
        : null;

      // Build player pattern insights (on-device, sync — cheap enough per-request)
      const patternInsights = generatePatternInsights(shots, {
        currentRoundMode: roundMode,
        scores,
        courseHoles,
        handicap,
        dominantMiss: profileDominantMiss,
      });

      // Build penalty context from already-computed patternInsights raw_stats
      const rs = patternInsights.raw_stats;
      const penaltyLines: string[] = [];
      const totalPenalties = Object.values(rs.penalty_event_count_by_outcome ?? {}).reduce((a, b) => a + (b ?? 0), 0);
      if (totalPenalties > 0) {
        const parts = Object.entries(rs.penalty_event_count_by_outcome ?? {})
          .map(([o, c]) => `${c} ${o}`)
          .join(', ');
        penaltyLines.push(`Recent penalties: ${parts}.`);
      }
      if ((rs.recurring_trouble_holes ?? []).length > 0) {
        penaltyLines.push(`Recurring trouble holes: ${rs.recurring_trouble_holes.join(', ')}.`);
      }
      const penaltyContext = penaltyLines.length > 0 ? penaltyLines.join(' ') : null;

      const courseContext = isRoundActive ? courseContextRef.current : null;
      // 2026-06-06 — Phase 2.5: web-search-grounded course intelligence
      // brief. Cached client-side by services/courseIntelligenceService
      // via the round-prefetch path; null when no fetch has landed yet
      // (off-course, or first turn before prefetch resolves, or cold-
      // launched mid-round before warm runs). Read sync from the
      // module-level memory mirror; if miss, fire-and-forget a warm
      // from AsyncStorage so the NEXT brain call lands the intel.
      let courseIntelligence: string | null = null;
      try {
        if (isRoundActive && activeCourseId) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const intelMod = require('../services/courseIntelligenceService') as typeof import('../services/courseIntelligenceService');
          courseIntelligence = intelMod.getCachedCourseIntelligenceSync(activeCourseId);
          if (!courseIntelligence) {
            // Fire-and-forget warm. Mirror will be populated for next turn.
            void intelMod.warmCourseIntelligenceMirror(activeCourseId);
          }
        }
      } catch { /* non-fatal — brain still works without intel */ }

      // 2026-06-10 — FAIL-SAFE: always attempt the brain. (Removed the
      // breaker short-circuit that pre-skipped the fetch — it caused false
      // "no network" / silent failures on good Wi-Fi. The fetch has its own
      // timeout below and the catch path still routes to the local-status
      // responder fallback if it genuinely fails.)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);

      // 2026-06-13 (audit G5) — the voice path was sending ONLY the CNS memory slice;
      // the LIVE context block (GPS/geometry/hazards/recent shots) the chat path sends
      // was missing. Fetch it and MERGE (same as hooks/useKevin) so the in-round voice
      // brain sees everything. Best-effort; null on failure → unchanged behavior.
      let liveBlock: string | null = null;
      try {
        const uv = await import('../services/unifiedVisionContext');
        liveBlock = (await uv.getUnifiedVisionContext()).promptBlock;
      } catch { /* live context optional */ }

      const res = await fetch(apiUrl + '/api/kevin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message,
          language,
          playerName: name,
          firstName,
          handicap,
          roundsTogether,
          sessionsTogether,
          currentHole,
          currentPar,
          currentYardage,
          // 2026-05-25 — Fix I: yardageInsight carries source + confidence
          // so Kevin's prompt can hedge honestly ("Reading 168 from the
          // static card — GPS is soft right now") instead of asserting
          // a soft GPS number as truth. See services/yardageResolver.ts.
          yardageInsight: (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { buildYardageInsight } = require('../services/yardageResolver') as typeof import('../services/yardageResolver');
              return buildYardageInsight();
            } catch { return null; }
          })(),
          activeCourse,
          activeCourseId,
          courseContext,
          courseIntelligence,
          // 2026-06-10 — CNS Phase 2: learned-memory slice (bag, course/hole
          // history, tendencies). 2026-06-13 (audit G5): now MERGED with the live
          // context block above (was CNS-only) so the voice brain matches the chat path.
          unified_context_block: mergeMemoryIntoContext(
            liveBlock,
            getCaddieContext({ courseId: activeCourseId, hole: currentHole, club }).promptBlock,
          ),
          roundMode,
          patternInsights,
          ghostContext,
          smartFinderContext,
          penaltyContext,
          // 2026-05-25 — Fix AF: pull matching coach refinements for the
          // current user message and ship as a context string the brain
          // prompt embeds verbatim. Empty when no entries match.
          coachKnowledgeContext: (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { getCoachKnowledgeForMessage } = require('../store/coachKnowledgeStore') as typeof import('../store/coachKnowledgeStore');
              return getCoachKnowledgeForMessage(message);
            } catch { return ''; }
          })(),
          isRoundActive,
          isCompetition,
          mentalState: currentMentalState,
          consecutiveBadHoles,
          isSpiralRisk: isSpiralRisk(),
          topObservations: topObs,
          recentHeroMoments: heroMoments,
          dominantMiss,
          physicalLimitation,
          goal,
          personalBest,
          recentCageSessions,
          club,
          scores,
          // Phase BM — slice courseHoles to current ± 1 instead of the full
          // 18-hole array. Kevin only needs the hole he's playing (and the
          // next hole when transitioning); shipping the entire course
          // geometry added 5-15KB to every brain call.
          courseHoles: (() => {
            const all = useRoundStore.getState().courseHoles;
            if (currentHole == null) return all.slice(0, 1);
            return all.filter(h => Math.abs(h.hole - currentHole) <= 1);
          })(),
          responseMode,
          smartVisionContext: smartVision.isOpen ? {
            holeNumber: smartVision.holeNumber,
            par: smartVision.par,
            centerYards: smartVision.centerYards,
            measureYards: smartVision.measureYards,
            analysisText: smartVision.analysisText,
          } : null,
          watchData: watchState.isConnected && watchSummary
            ? {
                averageTempo: watchSummary.averageTempo.toFixed(1),
                dominantFault: watchSummary.dominantTempoFault,
                earlyTransitionRate: Math.round(watchSummary.earlyTransitionRate * 100),
                averageClubSpeed: Math.round(watchSummary.averageClubSpeed),
                swingCount: watchSummary.swings.length,
              }
            : null,
          // Phase V.7+ — client local hour (0-23) so Kevin's prompt can
          // match tone to time of day (groggy AM, calm PM). Cheap to send.
          clientHour: new Date().getHours(),
          // Phase AQ — persistent context blobs from prior synthesis.
          // Read at call time so any newly-synthesized insights show up
          // in the next reply without app restart.
          kevinContext: usePlayerProfileStore.getState().kevinContext,
          persistentPatterns: usePlayerProfileStore.getState().persistentPatterns,
          // 2026-05-26 — Fix AB Phase 1: surface GHIN # so Kevin can
          // answer "what's my GHIN?" and reference it in tournament /
          // posted-score context without forcing the user to re-state
          // it every time. Phase 2 (live GHIN API) will use this as
          // the lookup key.
          ghinNumber: usePlayerProfileStore.getState().ghin_number,
          // 2026-05-26 — Fix BE: Cecily Mode flag. Tim's granddaughter
          // uses the caddie to chat (and helped test ES/EN switching).
          // When true, brain unlocks general-topic free-conversation
          // mode with warm/playful/age-appropriate tone. Default off;
          // adults are unaffected.
          cecilyMode: useSettingsStore.getState().cecilyMode,
          // 2026-05-19 — pipe the player's learned vocabulary into the
          // brain so phrases they've used before inform replies. Tim's
          // "I saw Kevin learned 22 phrases — can he use them?" The
          // top phrases are the ones Kevin has heard most; sending them
          // as background grounding lets the caddie pick up Tim's
          // shorthand instead of staying generic.
          playerVocabulary: (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const vocab = require('../store/vocabularyProfileStore');
              const top = vocab.useVocabularyProfileStore.getState().getTopPhrases(20);
              return Array.isArray(top) && top.length > 0 ? top : null;
            } catch { return null; }
          })(),
          // Phase BR — active practice context from tutorialStore. Null
          // when no tutorials are flagged active. Capped at 3 active.
          practice_context: buildFullPracticeContext(),
          recentCageInsights: useCageStore.getState().recentInsights.slice(-3),
          recentRoundInsights: useRoundStore.getState().recentInsights.slice(-3),
          // Phase AR — within-session conversation buffer for follow-up
          // resolution ("and the wind?" → Kevin knows you mean wind for
          // the prior shot). Cleared after 60s of no activity OR on
          // round/hole change.
          conversationTurns: getRecentTurns().map(t => ({ role: t.role, text: t.text })),
          // Phase BJ — on-course shot context. holeShots is current-hole
          // only (front-loaded for "this hole again" pattern); recentShots
          // is last 5 across the round (round-wide pattern detection).
          // Mapped to the lite shape the server prompt expects.
          holeShots: (() => {
            const all = useRoundStore.getState().shots;
            return all.filter(s => s.hole === (currentHole ?? -1)).map(s => ({
              hole: s.hole,
              shotIndex: s.shot_in_hole_index ?? null,
              direction: s.direction,
              outcome: s.outcome ?? null,
              outcomeText: s.outcome_text ?? null,
              feel: s.swing_feel ?? null,
            }));
          })(),
          recentShots: useRoundStore.getState().shots.slice(-5).map(s => ({
            hole: s.hole,
            shotIndex: s.shot_in_hole_index ?? null,
            club: s.club,
            shape: s.shape,
            direction: s.direction,
            outcome: s.outcome ?? null,
            outcomeText: s.outcome_text ?? null,
            feel: s.swing_feel ?? null,
            distance_yards: s.distance_yards ?? null,
          })),
          // Subjective self-reports so the caddie can ADAPT, not just log.
          // Last 5 emotional states ("I'm frustrated", "feeling locked
          // in") with valence + hole. Pairs with shot `feel` ("rushed")
          // already sent above. Server uses these to adjust tone/coaching.
          emotionalLog: useRoundStore.getState().emotionalLog.slice(-5).map(e => ({
            state: e.state,
            valence: e.valence,
            hole: e.hole,
          })),
          // Player's REAL bag distances (learned avgs, standard fallback) so
          // club/strategy answers use actual numbers, not assumptions. The
          // brain applies the "beyond your longest = two-shot" rule.
          clubDistances: bagDistances(),
          // PGA HOPE follow-up — server-side persona resolution, intensity
          // dial, and Tank soft-intro flag. Read fresh at call time so
          // settings changes apply to the next utterance without restart.
          persona: useSettingsStore.getState().caddiePersonality,
          personaIntensity: useSettingsStore.getState().personaIntensity?.[useSettingsStore.getState().caddiePersonality] ?? 100,
          tankSoftIntro: useSettingsStore.getState().tankSoftIntro,
          // 2026-05-30 — Fix FY: Local Mode → pin brain to TACTICAL
          // tier (Haiku 4.5). Server's classifyQuestion auto-tier is
          // skipped; query gets the cheapest, fastest, least-radio-time
          // path. Server falls back to OpenAI gpt-4o if Haiku errors
          // (same fallback path as today). Sonnet escalation is
          // suppressed in this mode — the user explicitly chose
          // conservation over depth. Omitted when localMode is off so
          // the server's default classifyQuestion behavior is unchanged.
          forceTier: useSettingsStore.getState().localMode === true ? 'TACTICAL' : undefined,
        }),
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        // Throw so the catch's minimal-body retry fires. A non-200 here is
        // often a 413 from the LARGE context body (golfer model + analyses +
        // course geometry + vision can exceed Vercel's payload cap); the
        // minimal retry strips all that and succeeds against the healthy
        // endpoint — so the user still gets a real answer on the first ask.
        throw new Error(`brain_http_${res.status}`);
      }
      recordVoiceEndpointSuccess('kevin');
      const data = await res.json() as { text?: string; audioBase64?: string | null; toolAction?: ToolAction | null };

      // Points — every successful caddie response is a real interaction
      // (3 pts per Tim's spec). Failed / network-error returns above
      // don't qualify, so we only emit on the success path here. Dynamic
      // require avoids any risk of an import cycle through pointsStore.
      try {
        const pointsMod = require('../store/pointsStore');
        pointsMod.usePointsStore.getState().addPoints(3, 'caddie_interaction');
      } catch (e) { console.log('[points] caddie-interaction emit failed:', e); }

      return {
        text:        data.text       ?? 'Got nothing back from the brain. Try again.',
        audioBase64: data.audioBase64 ?? null,
        toolAction:  data.toolAction  ?? null,
      };

    } catch (err) {
      recordVoiceEndpointFailure('kevin');
      console.log('[voice] brain error:', err);
      logVoiceError('kevin_response', err);

      // 2026-06-10 — FAIL-SAFE retry. The big context-building block above can
      // throw (a malformed store entry, a service hiccup) and that would wall
      // the caddie with "Hit a snag" even though the brain endpoint is healthy.
      // Retry ONCE with a MINIMAL body that can't throw — just the message +
      // identity. The endpoint answers fine without the extra context. This is
      // why the caddie now works on the FIRST ask instead of needing retries.
      try {
        const rc = new AbortController();
        const rt = setTimeout(() => rc.abort(), BRAIN_TIMEOUT_MS);
        const retryRes = await fetch(apiUrl + '/api/kevin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: rc.signal,
          body: JSON.stringify({
            message,
            language,
            playerName: name,
            firstName,
            handicap,
            persona: useSettingsStore.getState().caddiePersonality,
          }),
        }).finally(() => clearTimeout(rt));
        if (retryRes.ok) {
          recordVoiceEndpointSuccess('kevin');
          const d = await retryRes.json() as { text?: string; audioBase64?: string | null; toolAction?: ToolAction | null };
          return {
            text: d.text ?? 'Ready when you are.',
            audioBase64: d.audioBase64 ?? null,
            toolAction: d.toolAction ?? null,
          };
        }
      } catch (retryErr) {
        console.log('[voice] brain minimal-retry failed:', retryErr);
      }

      try { Vibration.vibrate(120); } catch {}
      // 2026-06-06 — Phase 3 of on-course resilience sprint. Tim's
      // Echo Hills round hit this catch ~28 times (cellular died at
      // the course); user got "Hit a snag" canned every time. Now
      // first try services/localStatusResponder.tryLocalReply — if
      // the transcript matches a status pattern (yardage, hole, par,
      // score, holes left, tee, course, club, handicap), produce a
      // templated reply from local round state + GPS. Phase 1 device
      // TTS then speaks it via system voice. Coaching / strategy
      // questions fall through to the existing "Hit a snag" return.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const responder = require('../services/localStatusResponder') as typeof import('../services/localStatusResponder');
        const langSafe = (['en', 'es', 'zh'] as const).includes(language as 'en' | 'es' | 'zh')
          ? (language as 'en' | 'es' | 'zh')
          : 'en';
        const local = responder.tryLocalReply(message, langSafe);
        if (local) {
          logVoiceSilentFail('local_responder_hit', {
            queryType: local.queryType,
            language: langSafe,
            transcriptHead: message.slice(0, 60),
          });
          return { text: local.text, audioBase64: null, toolAction: null };
        }
        logVoiceSilentFail('local_responder_miss', {
          transcriptHead: message.slice(0, 60),
          language: langSafe,
        });
      } catch (e) {
        console.log('[voice] localStatusResponder threw (non-fatal):', e);
      }
      // Reached only if the healthy endpoint, the minimal retry, AND the local
      // responder all came up empty — genuinely rare. Keep it warm, not alarmy.
      return { text: 'Give me one sec and ask me again.', audioBase64: null, toolAction: null };
    }
  };

  // ── SPEAK RESPONSE ────────────────────────

  const speakResponse = async (text: string): Promise<void> => {
    if (!voiceEnabled || !text) return;
    // Phase V.7+ — userInitiated: this speakResponse path always answers a
    // user-tapped query, so it speaks at L1 too (the L1 badge would be
    // useless otherwise).
    await speak(text, voiceGender, language, apiUrl, { userInitiated: true });
  };

  // ── FOLLOW-UP LISTEN LOOP (Fix B) ──────────
  //
  // After Kevin's reply ends with a question, this opens the mic for ~6s
  // automatically. If the user answers, the transcript is sent straight
  // to the brain (we know it's an answer, not a fresh command — skip the
  // intent classifier per the existing isAwaitingFollowUp bypass at line
  // 760). If silence, a gentle nudge plays and the mic opens once more.
  // If silence again, we quietly idle.
  // 2026-05-26 — Fix AP Phase 2: continuous-conversation safety rails.
  // These ride alongside the existing isCloseIntent gate. They only
  // activate when settings.continuousConversationMode === true (opt-in).
  // Module-level (per hook instance) refs so recursive calls share the
  // accumulator without prop-drilling.
  const CONTINUOUS_MAX_TURNS = 6;
  const CONTINUOUS_MAX_SESSION_MS = 120_000;
  const continuousTurnCountRef = useRef(0);
  const continuousSessionStartedAtRef = useRef<number>(0);
  const resetContinuousSession = useCallback(() => {
    continuousTurnCountRef.current = 0;
    continuousSessionStartedAtRef.current = Date.now();
  }, []);

  // 2026-06-06 — Hard cap on follow-up recursion depth, ALWAYS applied
  // (independent of continuousConversationMode). Tim's report: "stuck
  // on listening after a few back and forth messages." Root cause: when
  // Kevin keeps asking questions (reply ends with `?`), processFollowUp
  // recursively calls runFollowUpListenLoop with NO depth cap outside
  // continuous mode. Long conversations stack mic-on cycles indefinitely.
  // Cap prevents runaway; user can re-tap to keep going if they want.
  const HARD_FOLLOWUP_DEPTH_CAP = 5;
  const followUpDepthRef = useRef(0);

  const runFollowUpListenLoop = useCallback(async (): Promise<void> => {
    // 2026-06-05 — Bumped 6s → 30s. Same reason as AUTO_STOP_MS above:
    // this is a HARD cap on total mic-on time, not "stop after user
    // stops talking" (the 4s silence-VAD in voiceService.captureUtterance
    // handles that). 6s was killing the mic mid-answer on any follow-up
    // that needed more than a short reply. 30s gives any thoughtful
    // answer breathing room; silence-VAD still ends it the moment
    // the user actually pauses.
    const FOLLOW_UP_CAPTURE_MS = 30_000;
    const processFollowUp = async (transcript: string): Promise<void> => {
      const trimmed = transcript.trim();
      if (!trimmed) return;

      // 2026-05-26 — Fix BA: client-side close-intent gate. The brain
      // is smart enough to NOT ask follow-up questions when the user
      // says "I'm good", but "no, I'm good" gets parsed as a negation
      // + content, often eliciting "OK, what wasn't right?" That's a
      // bad loop. Catch the explicit close phrases here and bail
      // BEFORE the brain call so the conversation actually ends.
      //
      // Phrasing is conservative — only matches utterances that ARE
      // a close intent on their own (the entire transcript). A real
      // question like "no idea, stop slicing for me?" wouldn't match
      // any of these because they require the close phrase to be
      // essentially the whole utterance.
      if (isCloseIntent(trimmed)) {
        console.log('[voice] follow-up close intent matched — ending loop', { transcript: trimmed });
        recordUserTurn(trimmed);
        return;
      }

      // Match the manual-tap pattern: record the user turn, send to
      // brain, speak, then check if Kevin asked ANOTHER question —
      // recurse via this same loop so a multi-turn back-and-forth
      // works ("you good?" → "actually one more thing" → ...).
      recordUserTurn(trimmed);
      wrappedOnVoiceStateChange('thinking');
      const reply = await sendToBrain(trimmed);
      const checked = { ...reply, ...checkContent(reply.text, reply.audioBase64) };
      // 2026-06-04 — Speak BEFORE navigating; see the intent-router branch
      // for the rationale (audio-session race when destination claims mic
      // or camera on mount).
      onResponseReceived(checked.text);
      recordKevinTurn(checked.text);
      wrappedOnVoiceStateChange('speaking');
      await stopSpeaking();
      if (checked.audioBase64 && voiceEnabled) {
        await speakFromBase64(checked.audioBase64, { userInitiated: true });
      } else {
        await speakResponse(checked.text);
      }
      if (checked.toolAction) onToolAction?.(checked.toolAction);
      // Recurse one level if Kevin asked yet another question.
      // 2026-05-26 — Fix AP Phase 2: when continuousConversationMode
      // is ON, ALSO recurse when the reply doesn't end with `?` — but
      // honor the safety rails (turn cap + session-time cap). Recursion
      // still terminates naturally on close-intent (handled above)
      // or on silence-twice (handled in the calling loop body).
      const kevinAskedFollowUp = (checked.text ?? '').trim().endsWith('?');
      const continuous = useSettingsStore.getState().continuousConversationMode;
      let shouldRecurse = kevinAskedFollowUp;
      if (continuous && !kevinAskedFollowUp) {
        const turnsSoFar = continuousTurnCountRef.current;
        const elapsedMs = continuousSessionStartedAtRef.current === 0
          ? 0
          : Date.now() - continuousSessionStartedAtRef.current;
        if (turnsSoFar >= CONTINUOUS_MAX_TURNS) {
          console.log('[voice] continuous-mode turn cap reached — ending loop', { turnsSoFar });
        } else if (elapsedMs >= CONTINUOUS_MAX_SESSION_MS) {
          console.log('[voice] continuous-mode session-time cap reached — ending loop', { elapsedMs });
        } else {
          continuousTurnCountRef.current = turnsSoFar + 1;
          shouldRecurse = true;
        }
      }
      // 2026-06-06 — Hard recursion cap (always applies, not just
      // continuous mode). Prevents the runaway-mic state Tim reported.
      // After 5 turns, the loop ends cleanly; user can tap mic to
      // continue if they want — but the conversation no longer chains
      // mic cycles indefinitely on long question/answer exchanges.
      if (shouldRecurse && followUpDepthRef.current >= HARD_FOLLOWUP_DEPTH_CAP) {
        console.log('[voice] follow-up depth cap reached — ending loop', { depth: followUpDepthRef.current });
        shouldRecurse = false;
      }
      if (shouldRecurse && !userInterruptedRef.current) {
        followUpDepthRef.current += 1;
        await runFollowUpListenLoop();
      }
    };

    try {
      // 2026-05-26 — Fix AP Phase 2: seed the continuous-mode
      // accumulators only on the OUTER call (start of session). The
      // recursive inner calls re-enter runFollowUpListenLoop but
      // shouldn't reset the per-session clock — we only reset when
      // the session is genuinely starting (turn count is still 0
      // OR the previous session timed out).
      if (continuousSessionStartedAtRef.current === 0
          || Date.now() - continuousSessionStartedAtRef.current >= CONTINUOUS_MAX_SESSION_MS) {
        resetContinuousSession();
        // 2026-06-06 — Reset depth ONLY when a genuinely new session
        // starts (same gate as continuous-mode timer). Recursive inner
        // calls keep the same depth counter so the cap actually works.
        followUpDepthRef.current = 0;
      }

      // Round 1
      wrappedOnVoiceStateChange('listening');
      const round1 = await captureUtterance(FOLLOW_UP_CAPTURE_MS, apiUrl, language);
      if (round1 && round1.trim()) {
        await processFollowUp(round1);
        return;
      }
      // 2026-06-08 (audit M2) — if the user tapped to stop during round 1
      // (or its nudge), don't progress to round 2 and re-open the mic.
      if (userInterruptedRef.current) return;
      // Round 2 — gentle nudge then one more listen.
      const nudge = "Did you need some guidance, or are you good?";
      onResponseReceived(nudge);
      recordKevinTurn(nudge);
      wrappedOnVoiceStateChange('speaking');
      await speakResponse(nudge);
      // Re-check after the nudge: a tap-to-stop during the nudge sets this.
      if (userInterruptedRef.current) return;
      wrappedOnVoiceStateChange('listening');
      const round2 = await captureUtterance(FOLLOW_UP_CAPTURE_MS, apiUrl, language);
      if (round2 && round2.trim()) {
        await processFollowUp(round2);
        return;
      }
      // Silent twice — quietly end. No final "okay, talk later" line;
      // user has clearly disengaged.
    } catch (e) {
      console.log('[voice] follow-up listen loop failed (non-fatal):', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceEnabled, voiceGender, language, apiUrl]);

  // ── PROCESS AUDIO URI (shared by manual + VAD) ────

  const processAudioUri = useCallback(async (uri: string, opts?: { source?: 'manual' | 'vad' }): Promise<void> => {
    if (isProcessingRef.current) return;
    const source = opts?.source ?? 'manual';
    try {
      isProcessingRef.current = true;
      // 2026-06-06 — Belt-and-suspenders: clear userInterruptedRef at
      // the top of every fresh processAudioUri so the flag never
      // latches true across sessions. Already cleared at the START
      // branch of handleMicPress, but processAudioUri can also be
      // invoked from the VAD path / programmatic paths that bypass
      // handleMicPress entirely.
      userInterruptedRef.current = false;
      wrappedOnVoiceStateChange('thinking');

      // 2026-06-05 — File-size guard. Matches the captureUtterance
      // pattern. Belt-and-suspenders alongside the <300ms duration
      // gate in handleMicPress — covers the case where Recording
      // status didn't surface a duration but the file is still tiny
      // (some Android OEMs return durationMillis: 0 even on real
      // audio). Silent return — no error toast for what is almost
      // certainly a stray tap.
      try {
        const FS = await import('expo-file-system/legacy');
        const info = await FS.getInfoAsync(uri);
        const size = (info as { size?: number }).size ?? 0;
        if (!info.exists || size < 1024) {
          console.log('[voice] audio file too small (<1KB), skipping transcribe');
          wrappedOnVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }
        // 2026-06-06 — Vercel 4.5 MB request-body cap. Cap client-side
        // at 3.5 MB to avoid the opaque FUNCTION_PAYLOAD_TOO_LARGE 413
        // Tim hit at Echo Hills. Surface to /owner-logs so it's
        // diagnosable when it fires.
        if (size > 3.5 * 1024 * 1024) {
          console.log('[voice] audio file too large (', size, 'bytes), skipping transcribe to avoid Vercel 413');
          logTranscribeError(null, `audio_too_large_${size}_bytes`, { size, source: 'processAudioUri_max_size' });
          wrappedOnVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }
      } catch (e) {
        console.log('[voice] file size probe failed (continuing):', e);
      }

      // 2026-06-10 — FAIL-SAFE: always attempt transcription. (Removed the
      // breaker short-circuit that walled the mic with "Cell signal weak —
      // voice paused" WITHOUT trying — it fired on a single cold-start blip,
      // on perfect Wi-Fi, and because it stopped trying it could never clear.
      // The transcribe fetch has its own timeout; a genuine failure below
      // gives a brief haptic, not a sticky wall.)
      const formData = new FormData();
      formData.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
      formData.append('language', language);

      const transcribeController = new AbortController();
      const transcribeTimeout = setTimeout(() => transcribeController.abort(), TRANSCRIBE_TIMEOUT_MS);

      const transcribeRes = await fetch(apiUrl + '/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: transcribeController.signal,
      }).finally(() => clearTimeout(transcribeTimeout));

      const transcribeData = await transcribeRes.json().catch(() => ({})) as { text?: string; error?: string };
      const transcript = transcribeData.text ?? '';

      // Audit follow-up: distinguish "API broke" from "user was silent".
      // Prior code treated both as "no input"; now a real upstream
      // failure (HTTP non-2xx OR error field present) bubbles a haptic
      // + brief vibration so the user knows to retry rather than
      // assuming the mic missed them. Empty transcript on a 200 is
      // still "user said nothing" — silent return.
      if (!transcribeRes.ok || transcribeData.error) {
        // 2026-06-07 audit r6 — Record failure for circuit breaker.
        recordVoiceEndpointFailure('transcribe');
        console.error('[voice] transcribe failed', transcribeRes.status, transcribeData.error);
        logTranscribeError(transcribeRes.status, transcribeData.error ?? `HTTP ${transcribeRes.status}`);
        try { Vibration.vibrate(120); } catch {}
        // Surface visible feedback — without this, Cockpit users saw the
        // badge cycle listening → idle with no clue why nothing happened
        // (no avatar bubble like Full Mode has). Text reaches the
        // CockpitCaddieScreen advice card and the Full Mode bottom bubble.
        onResponseReceived('Network hiccup on transcribe. Try again.');
        wrappedOnVoiceStateChange('idle');
        isProcessingRef.current = false;
        return;
      }
      recordVoiceEndpointSuccess('transcribe');

      devLog('[voice] transcript:', transcript);

      if (!transcript.trim()) {
        // Silent / unintelligible audio. Common when the mic was too
        // far away or background noise drowned the user out. Tell them
        // so they know to try again louder/closer.
        onResponseReceived("Didn't catch that — try once more, a bit closer to the mic.");
        wrappedOnVoiceStateChange('idle');
        isProcessingRef.current = false;
        return;
      }
      // Note: source-based wake-word filtering removed 2026-05-17 after
      // breaking conversational requests like "how are you" that don't
      // include a caddie name. Spectator-noise filtering returns as an
      // opt-in setting in a follow-up rather than default-on behavior.
      void source;

      // Phase AR — record user turn into the conversation buffer so any
      // follow-up reply that flows out of this query has the prior turn
      // available in its context.
      recordUserTurn(transcript);

      const appContext: AppContext = {
        active_screen: pathnameToSurface(currentPathname),
        active_round: isRoundActive
          ? {
              course: activeCourse,
              mode: roundMode,
              holesPlayed: useRoundStore.getState().getHolesPlayed(),
              totalScore: useRoundStore.getState().getTotalScore(),
              scoreVsPar: useRoundStore.getState().getScoreVsPar(),
            }
          : null,
        current_hole: currentHole,
        recent_shots: shots.slice(-5),
        trust_spectrum_level: 2,
        active_player_name: activeFamilyMember?.firstName ?? null,
        active_player_age: activeFamilyMember?.age ?? null,
        active_player_handicap: activeFamilyMember?.approximate_handicap ?? null,
        active_group_size: familyMembers.filter(m => !m.archived).length,
      };

      const shortcut = buildPreRoundShortcutIntent(transcript);
      if (shortcut) {
        if (shortcut.intent_type === 'open_tool') {
          const result = await openToolHandler.execute({
            intent_type: 'open_tool',
            raw_text: transcript,
            parameters: shortcut.parameters,
            confidence: 'high',
            follow_up_question: null,
            language,
          } as VoiceIntent, appContext);
          if (result.voice_response) {
            onResponseReceived(result.voice_response);
            recordKevinTurn(result.voice_response);
            wrappedOnVoiceStateChange('speaking');
            await speakResponse(result.voice_response);
          }
          if (result.tool_action) onToolAction?.(result.tool_action);
          wrappedOnVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }

        const result = await quickRoundHandler.execute({
          intent_type: 'quick_round',
          raw_text: transcript,
          parameters: shortcut.parameters,
          confidence: 'high',
          follow_up_question: null,
          language,
        } as VoiceIntent, appContext);
        if (result.voice_response) {
          onResponseReceived(result.voice_response);
          recordKevinTurn(result.voice_response);
          wrappedOnVoiceStateChange('speaking');
          await speakResponse(result.voice_response);
        }
        if (result.tool_action) onToolAction?.(result.tool_action);
        const replyEndsWithQuestion = (result.voice_response ?? '').trim().endsWith('?');
        if (replyEndsWithQuestion && voiceEnabled && !userInterruptedRef.current) {
          await runFollowUpListenLoop();
        }
        wrappedOnVoiceStateChange('idle');
        isProcessingRef.current = false;
        return;
      }

      const bypass = checkBypasses(transcript);

      if (bypass.handled) {
        if (bypass.triggerVision) onVisionTrigger?.();
        if (bypass.triggerHero) onHeroMoment?.();
        if (bypass.triggerHeroReelView) onHeroReelView?.();

        if (bypass.triggerMute) {
          await stopSpeaking();
          wrappedOnVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }

        if (bypass.response) {
          onResponseReceived(bypass.response);
          wrappedOnVoiceStateChange('speaking');
          await speakResponse(bypass.response);
          wrappedOnVoiceStateChange('idle');
        }

        isProcessingRef.current = false;
        return;
      }

      // 2026-05-16 — Follow-up bypass. If Kevin's most recent turn was
      // a question (text ends with '?'), the next user utterance is the
      // answer to THAT question, not a fresh intent. Skip voice-command
      // routing entirely so phrases like "send it home" (Tim's Mariners
      // report — after Kevin asked "lay up or send it home?") don't get
      // mis-classified as `navigate home`. The brain receives the full
      // conversation buffer and resolves the follow-up against Kevin's
      // own prior turn.
      const skipIntentRouter = isAwaitingFollowUp();
      if (skipIntentRouter) {
        devLog('[voice] follow-up bypass: Kevin asked a question, routing reply straight to brain');
      }

      // ── Voice command routing — runs after bypasses, before brain ──
      // Builds a snapshot of app state and parses the transcript into a structured
      // intent. If a handler matches with sufficient confidence, we execute it and
      // skip the full brain call. Tactical / conversational queries fall through.
      // Run intent routing only when we're NOT awaiting a follow-up.
      // The follow-up case routes straight to the brain below.
      if (!skipIntentRouter) try {
        let { intent, result } = await voiceCommandRouter.route(transcript, appContext, apiUrl);

        // Phase A.3 ambiguity resolution: if router asks a follow-up, capture one more
        // utterance and re-route. Single retry only — after that, fall through to brain
        // or end the loop. Avoids the "endless clarification" trap.
        if (
          result.follow_up_needed &&
          result.voice_response &&
          (intent.intent_type === 'unknown' || intent.confidence !== 'high')
        ) {
          onResponseReceived(result.voice_response);
          wrappedOnVoiceStateChange('speaking');
          await speakResponse(result.voice_response);
          wrappedOnVoiceStateChange('listening');
          const clarification = await captureUtterance(8000, apiUrl, language);
          if (clarification && clarification.trim()) {
            const second = await voiceCommandRouter.route(clarification, appContext, apiUrl);
            intent = second.intent;
            result = second.result;
          } else {
            // No clarification — surface a hint so Cockpit users see
            // the loop ended without a hanging "?" state.
            onResponseReceived('No problem — try again whenever.');
            wrappedOnVoiceStateChange('idle');
            isProcessingRef.current = false;
            return;
          }
        }

        // 2026-06-06 — `social_greeting` is NO LONGER excluded here.
        // It was excluded when the dispatch path routed social_greeting
        // to the brain (returning success:false). Now that
        // socialGreetingHandler is registered and returns
        // success:true + voice_response, treating it as a non-hit was
        // making the greeting clips dead code AND paying the full
        // brain round-trip on every "hey kevin". Including it here
        // makes the local handler reply fire + the greeting clip play.
        const isCommandHit =
          intent.intent_type !== 'unknown' &&
          intent.intent_type !== 'conversational' &&
          intent.confidence !== 'low' &&
          (result.success || result.follow_up_needed);

        if (isCommandHit) {
          // 2026-06-04 — Order: speak BEFORE onToolAction. Previously
          // navigation fired synchronously and the destination screen
          // (notably SmartFinder → CameraView) mounted + claimed the
          // iOS audio session mid-TTS, chopping "Opening SmartFinder"
          // into "Op—" or silencing it entirely. Awaiting speak first
          // costs ~1.5-2s before nav for tool-action utterances; user
          // accepted that tradeoff to fix the choppy/silent TTS.
          if (result.voice_response) {
            onResponseReceived(result.voice_response);
            recordKevinTurn(result.voice_response);
            wrappedOnVoiceStateChange('speaking');
            // 2026-06-06 — Pre-rendered greeting clip shortcut. When
            // the matched intent is social_greeting and the text comes
            // back as one of the canned per-persona lines, play the
            // bundled MP3 instead of running /api/voice TTS. Saves the
            // same ~$0.001 + 400ms as the ack-clip path. Falls through
            // to speakResponse when no clip matches (e.g. custom
            // persona, which has no rendered greetings).
            const greetPersona = useSettingsStore.getState().caddiePersonality ?? 'kevin';
            const greetClip = intent.intent_type === 'social_greeting'
              ? resolveGreetingClip(result.voice_response, greetPersona)
              : null;
            if (greetClip != null && voiceEnabled) {
              try {
                await playLocalFile(greetClip, undefined, { userInitiated: true });
              } catch (e) {
                console.log('[voice] greeting clip play failed, falling back to speak:', e);
                await speakResponse(result.voice_response);
              }
            } else {
              await speakResponse(result.voice_response);
            }
          }
          if (result.tool_action) onToolAction?.(result.tool_action);
          // 2026-05-25 — Fix Z: when an intent-handler's voice_response
          // is a follow-up question (ends with '?'), auto-open the mic
          // so the user doesn't have to tap again. Mirrors Fix B which
          // does the same for brain-path replies. Closes the gap where
          // log_shot says "Got the shot — which club?" then went idle
          // and left the user stranded — "Hole 6 / Hole 6 / Hole 6"
          // entries with no enrichment.
          const replyEndsWithQuestion = (result.voice_response ?? '').trim().endsWith('?');
          if (replyEndsWithQuestion && voiceEnabled && !userInterruptedRef.current) {
            await runFollowUpListenLoop();
          }
          wrappedOnVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }
      } catch (err) {
        console.log('[voice] command routing error:', err);
        // Fall through to brain on routing errors — never get stuck.
      }

      // 2026-06-10 — Pre-response conversational filler REMOVED. It fired at
      // 400ms, but the warm brain now answers in 4-6s, so the short filler
      // ("Let me see...") finished ~2s in and left 2-4s of dead air before the
      // real reply — or got chopped mid-word on fast turns. Worse, the brain
      // already opens conversationally ("I hear you...", "Yeah, so..."), so the
      // filler double-acknowledged. Cleaner: ask -> brief visual thinking state
      // -> Kevin's natural answer. (Tool-action ack clips below are unaffected —
      // those confirm an action and are still valuable.)
      const rawResponse = await sendToBrain(transcript);
      const kevinResponse = {
        ...rawResponse,
        ...checkContent(rawResponse.text, rawResponse.audioBase64),
      };
      // 2026-06-04 — Speak BEFORE navigating; see the intent-router branch
      // for the rationale. onToolAction moved BELOW the speak await.
      onResponseReceived(kevinResponse.text);
      // Phase AR — record Kevin's reply so the next user follow-up has it
      // available as conversational antecedent.
      recordKevinTurn(kevinResponse.text);
      wrappedOnVoiceStateChange('speaking');
      // Defensive: clear any lingering audio (e.g. an interrupted prior reply)
      // before the answer. stopSpeaking() bumps the speak-queue generation, so
      // any currently-playing clip stops and queued-but-not-running bodies skip.
      await stopSpeaking();
      // 2026-06-06 — Pre-rendered ack-clip shortcut. The brain's
      // defaults map (api/kevin.ts) emits 8 fixed strings for tool
      // actions ("Got it.", "On it.", etc.) that don't need a fresh
      // OpenAI TTS round-trip each time. If a matching pre-rendered
      // mp3 is bundled for the current persona, play that locally;
      // saves ~$0.001 + 400ms per tool fire. Falls back to the
      // standard audioBase64 / speak() path when no clip is bundled
      // (today: all null until scripts/render-ack-clips.ts runs).
      const ackPersona = (useSettingsStore.getState().caddiePersonality ?? 'kevin') as string;
      const ackClip = resolveAckClip(kevinResponse.text, ackPersona);
      if (ackClip != null && voiceEnabled) {
        // playLocalFile expects a uri string; require()'d module ids
        // are passed through Audio.Sound.createAsync which accepts
        // both string and number sources. Cast through unknown.
        try {
          await playLocalFile(ackClip, undefined, { userInitiated: true });
        } catch (e) {
          console.log('[voice] ack clip play failed, falling back to speak:', e);
          if (kevinResponse.audioBase64) {
            await speakFromBase64(kevinResponse.audioBase64, { userInitiated: true });
          } else {
            await speakResponse(kevinResponse.text);
          }
        }
      } else if (kevinResponse.audioBase64 && voiceEnabled) {
        // Phase V.7+ — user-initiated reply, plays at L1 too.
        await speakFromBase64(kevinResponse.audioBase64, { userInitiated: true });
      } else {
        await speakResponse(kevinResponse.text);
      }
      // 2026-06-04 — Navigation fires AFTER speak completes (see brain
      // path comment above).
      if (kevinResponse.toolAction) onToolAction?.(kevinResponse.toolAction);

      // 2026-05-25 — Fix B: auto-listen after Kevin asks a follow-up.
      // When Kevin's reply ends with a question, open the mic for
      // ~6s automatically. If user replies → process via the brain
      // (skipping intent classifier — Kevin's question framed the
      // response). If silence → gentle nudge → 6s more. If silence
      // again → quietly idle. Eliminates the "Kevin asks but isn't
      // listening" gap Tim flagged tonight.
      const kevinText = (kevinResponse.text ?? '').trim();
      const endsWithQuestion = kevinText.endsWith('?');
      if (endsWithQuestion && voiceEnabled && !userInterruptedRef.current) {
        await runFollowUpListenLoop();
      }

      wrappedOnVoiceStateChange('idle');

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      const aborted = err instanceof Error && err.name === 'AbortError'
        || message.toLowerCase().includes('aborted');
      console.log('[voice] process error:', err);
      // 2026-06-07 audit r6 — Most failures here are transcribe-related
      // (the fetch threw or aborted). Record for the circuit breaker
      // so repeated cellular weak-signal stretches degrade /api/transcribe
      // and short-circuit subsequent attempts.
      recordVoiceEndpointFailure('transcribe');
      if (aborted) {
        logTranscribeError(null, message, { source: 'process_audio_abort' });
        onResponseReceived('That took too long. Please try again.');
      } else {
        logVoiceError('process_audio', err);
        // Same Cockpit-visibility rationale as the transcribe/empty paths
        // above — without a text feedback, the badge silently cycled back
        // to idle and Tim had no way to tell whether the mic missed him
        // or the pipeline threw. Keep it warm, not alarmy.
        onResponseReceived('Give me one sec and ask me again.');
      }
      wrappedOnVoiceStateChange('idle');
    } finally {
      isProcessingRef.current = false;
    }
  }, [language, voiceEnabled, voiceGender, currentYardage, currentHole, club, isRoundActive, roundMode]);

  // ── MAIN MIC HANDLER ─────────────────────

  const handleMicPress = useCallback(async () => {
    // 2026-06-04 — Belt-and-suspenders guard: floating KevinBadge
    // routes through this handler instead of listeningSession.toggle,
    // so the toggle-level sessionInFlight check doesn't apply here.
    // KevinBadge dims while locked (visual block) AND this guard
    // blocks functionally so a taps that beats the dim still no-ops.
    if (isSessionInFlight()) return;

    if (isSpeaking()) {
      // 2026-06-06 — Tim's report: tapping to interrupt mid-speech
      // "gets stuck and I have to restart the app." Root cause: the
      // processAudioUri (or intent-router-success) await chain was
      // mid-`await speakResponse/speakFromBase64`. stopSpeaking()
      // kills the sound → speak promise resolves → the caller's NEXT
      // step fires runFollowUpListenLoop() (when Kevin's reply ends
      // with `?`), which OPENS THE MIC. User just signalled "I'm
      // done," app immediately demanded more input — that's the
      // "stuck" state. Set the flag here so the in-flight caller
      // skips its follow-up and goes cleanly idle.
      userInterruptedRef.current = true;
      await stopSpeaking();
      isProcessingRef.current = false;
      wrappedOnVoiceStateChange('idle');
      return;
    }

    // 2026-06-06 — Tap-during-follow-up-listen conflict resolution.
    // Two recording paths exist: (a) this tap path's recordingRef and
    // (b) voiceService.captureUtterance's currentRecording used by
    // runFollowUpListenLoop. If the user taps to end while a follow-up
    // listen is in flight, this handler would otherwise see
    // recordingRef.current === null, fall through to the START branch,
    // and try to create a parallel Audio.Recording — racing the audio
    // session and losing the user's turn. Tim's report: "sometimes
    // tapping creates a conflict with silence-wait." The fix: detect
    // captureUtterance's recording via isCapturing(), end it EARLY
    // (transcribe what was recorded — same as silence-VAD would have),
    // then return. The follow-up loop receives the transcript and
    // processes it normally. Tap and silence-VAD now produce the same
    // outcome — Tim's intuition ("either works") is honored.
    if (isCapturing()) {
      console.log('[voice] tap during follow-up listen — routing to endCaptureEarly');
      endCaptureEarly();
      return;
    }

    if (isProcessingRef.current) return;

    // ── STOP and process ──────────────────
    if (recordingRef.current) {
      clearAutoStop();
      // Flip state to 'thinking' IMMEDIATELY so the badge's listening
      // halo unmounts the instant the user taps stop — without this,
      // the halo keeps pulsing for the 100-500ms that stopAndUnloadAsync
      // takes to resolve before processAudioUri can set 'thinking'.
      // Tim 2026-05-15: "the second question you ask it does not appear
      // that he stops listening and the mic pulses but he does
      // eventually answer." That gap is the bug.
      wrappedOnVoiceStateChange('thinking');

      try {
        // 2026-06-05 — Capture duration BEFORE stopAndUnloadAsync.
        // After unload the status loses durationMillis. Used below to
        // silently skip transcribe for stray double-taps (<300ms),
        // which otherwise round-trip to Whisper, return 502, and
        // surface as a "Network hiccup" toast that reads as a bug.
        let durationMs: number | null = null;
        try {
          const preStop = await recordingRef.current.getStatusAsync();
          const d = (preStop as { durationMillis?: number }).durationMillis;
          if (typeof d === 'number') durationMs = d;
        } catch { /* non-fatal; processAudioUri also has a size guard */ }

        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;

        if (!uri) {
          wrappedOnVoiceStateChange('idle');
          return;
        }

        if (durationMs != null && durationMs < 300) {
          console.log('[voice] tap-record too short (', durationMs, 'ms), skipping transcribe');
          wrappedOnVoiceStateChange('idle');
          return;
        }

        await processAudioUri(uri);

      } catch (err) {
        console.log('[voice] stop error:', err);
        wrappedOnVoiceStateChange('idle');
      }
      return;
    }

    // ── START recording ───────────────────
    // 2026-06-06 — Clear the user-interrupted flag at the start of a
    // fresh capture. The flag was set when the user tapped to interrupt
    // a prior reply; once they're starting a new question, that state
    // is no longer relevant.
    userInterruptedRef.current = false;
    try {
      // Phase BM — cache the mic permission grant in a module-level flag so
      // every subsequent tap skips the 30-80ms IPC roundtrip to the OS
      // permission cache. Re-asks only if the cached value is false.
      if (!micPermissionGranted) {
        const result = await Audio.requestPermissionsAsync();
        if (!result.granted) {
          console.log('[voice] no mic permission', {
            canAskAgain: result.canAskAgain,
            status: result.status,
          });
          // Audit follow-up (2026-05-13) — when iOS / Android has
          // permanently denied (canAskAgain === false), the OS dialog
          // won't appear on subsequent taps. Without this prompt, the
          // user keeps tapping the mic and nothing happens with no
          // explanation. Show a one-shot Alert that routes to Settings.
          // canAskAgain === true means the OS dialog WILL re-appear on
          // the next tap, so we don't need to nag with our own UI.
          if (!result.canAskAgain && !micBlockedPromptShown) {
            micBlockedPromptShown = true;
            Alert.alert(
              'Microphone access needed',
              'Kevin needs the microphone to hear you. Open Settings to enable it.',
              [
                { text: 'Not now', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => { void Linking.openSettings().catch(() => undefined); },
                },
              ],
              { cancelable: true },
            );
          }
          return;
        }
        micPermissionGranted = true;
      }

      // 2026-05-16 — Flip state to 'listening' BEFORE configuring the
      // audio session + creating the new Recording. This tells the VAD
      // hook (whose `enabled` depends on voiceState === 'idle') to
      // release the mic via its cleanup effect. Without this ordering,
      // VAD still owns the mic when Audio.Recording.createAsync fires
      // and the second recording fails silently — exactly Tim's
      // Mariners report of "tap Kevin / no response" while active
      // listening was on. The 80ms delay gives React + the VAD
      // useEffect cleanup time to actually release Audio before we
      // ask for it.
      wrappedOnVoiceStateChange('listening');
      await new Promise<void>(r => setTimeout(r, 80));

      await configureAudioForRecording();

      // 2026-06-06 — Silence-VAD on manual-tap path. Same pattern as
      // captureUtterance: track speech onset (hasSpoken flips true
      // once metering > SPEECH_DETECT_DB), track most-recent loud
      // sample (lastLoudAt), and when (hasSpoken && now - lastLoudAt
      // ≥ SILENCE_TIMEOUT_MS), auto-trigger handleMicPress() to stop
      // and process. Eliminates the "first question waits forever"
      // gap Tim reported — the first turn no longer needs a manual
      // tap to end. 45s AUTO_STOP_MS remains as the wandered-away
      // backstop.
      let micHasSpoken = false;
      let micLastLoudAt = Date.now();
      const { recording } = await Audio.Recording.createAsync(
        { ...RECORDING_OPTIONS, isMeteringEnabled: true },
        (status) => {
          if (!status.isRecording) return;
          const metering = (status as { metering?: number }).metering;
          if (typeof metering !== 'number') return;
          if (metering > MIC_SPEECH_DETECT_DB) micHasSpoken = true;
          if (metering > MIC_SILENCE_DB_THRESHOLD) micLastLoudAt = Date.now();
        },
        100,
      );

      // 2026-06-05 — Same 100ms mic warm-up gap captureUtterance uses.
      // Without it, the first ~50-150ms of audio on a cold mic is
      // partial / zero-amplitude on some Android OEMs, which is the
      // dominant cause of the "third tap to talk works" pattern Tim
      // reports — the first tap's recording is too quiet for Whisper
      // to land a confident transcript, so the user retries.
      await new Promise<void>(r => setTimeout(r, 100));
      micLastLoudAt = Date.now();

      recordingRef.current = recording;
      devLog('[voice] recording started');

      // 2026-06-06 — Silence-VAD polling timer. Checks every 200ms
      // whether the user has stopped talking. When the condition trips,
      // fires handleMicPress() to stop+process (same as a manual tap
      // or AUTO_STOP_MS firing). silenceVadTimerRef gets cleared in
      // the STOP branch via clearAutoStop() — we attach to the same
      // ref pattern so the existing teardown covers it.
      silenceVadTimer.current = setInterval(() => {
        if (!recordingRef.current) return;
        if (micHasSpoken && Date.now() - micLastLoudAt >= MIC_SILENCE_TIMEOUT_MS) {
          handleMicPress();
        }
      }, 200);

      // Auto-stop after AUTO_STOP_MS (hard cap / wandered-away backstop)
      autoStopTimer.current = setTimeout(() => {
        if (recordingRef.current) {
          handleMicPress();
        }
      }, AUTO_STOP_MS);

    } catch (err) {
      console.log('[voice] record error:', err);
      wrappedOnVoiceStateChange('idle');
    }

  }, [
    language,
    voiceEnabled,
    voiceGender,
    currentYardage,
    currentHole,
    club,
    isRoundActive,
  ]);

  return { handleMicPress, processAudioUri };
};
