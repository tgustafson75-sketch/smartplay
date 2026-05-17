import { useRef, useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Audio } from 'expo-av';
import { Vibration, Alert, Linking } from 'react-native';
import { usePathname } from 'expo-router';
import {
  configureAudioForRecording,
  speak,
  speakFromBase64,
  stopSpeaking,
  isSpeaking,
  playLocalFile,
  captureUtterance,
} from '../services/voiceService';
import {
  initFillerLibrary,
  isLibraryGenerated,
  getClipForCategory,
  classifyQuery,
} from '../services/fillerLibrary';
import { checkContent } from '../services/contentGuardrail';
import { voiceCommandRouter } from '../services/intents';
import type { AppContext } from '../types/voiceIntent';
import type { ToolAction } from '../app/api/kevin+api';
import { useSmartVision } from '../contexts/SmartVisionContext';
import { useKevinPresence } from '../contexts/KevinPresenceContext';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
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

// ─── CONSTANTS ────────────────────────────

const AUTO_STOP_MS = 4000;

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

// 16kHz mono 32kbps — 4x smaller than HIGH_QUALITY, same Whisper accuracy
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.LOW,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32000,
  },
};

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
  const getCurrentPar = useRoundStore((s) => s.getCurrentPar);
  const getPlanForHole = useRoundStore((s) => s.getPlanForHole);

  const {
    voiceGender,
    voiceEnabled,
    discreteMode,
    language,
    responseMode,
    fillerEnabled,
  } = useSettingsStore(
    useShallow((s) => ({
      voiceGender: s.voiceGender,
      voiceEnabled: s.voiceEnabled,
      discreteMode: s.discreteMode,
      language: s.language,
      responseMode: s.responseMode,
      fillerEnabled: s.fillerEnabled,
    }))
  );

  // Load the filler library index into memory on first mount — fast, reads
  // AsyncStorage only. Phase AB — also fire-and-forget generateLibrary so
  // existing users whose cache is on a stale voiceHash (e.g. v2) actually
  // upgrade to v3 on next boot. Without this, the V.6 extension fillers +
  // context-aware variants only land for new onboarding users; everyone
  // else keeps hearing the prior pool. generateLibrary internally checks
  // the hash and no-ops if up to date, so it's safe to call every boot.
  const _apiUrlForBoot = process.env.EXPO_PUBLIC_API_URL ?? '';
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
      firstName: s.firstName,
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
  const getRecentHeroMoments = useRelationshipStore((s) => s.getRecentHeroMoments);
  const addHeroMoment = useRelationshipStore((s) => s.addHeroMoment);

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const currentPar = getCurrentPar();
  const smartVision = useSmartVision();

  // ── CLEAR AUTO STOP ───────────────────────

  const clearAutoStop = () => {
    if (autoStopTimer.current) {
      clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
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
    try {
      const topObs = getTopObservations();
      const heroMoments = getRecentHeroMoments(2);

      const watchState = useWatchStore.getState();
      const watchSummary = watchState.getSessionSummary();

      const recentCageSessions = useCageStore.getState()
        .sessionHistory
        .slice(-3)
        .reverse()
        .map(s => ({
          club: s.club,
          shots: s.shots.length,
          dominantMiss: s.dominantMiss,
          rootCause: s.rootCause,
          summary: s.summary,
          date: new Date(s.date).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
          }),
        }));

      const holePlan = getPlanForHole(currentHole);
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

      // Load course context for active API rounds (cache hit = fast; miss = brief network fetch)
      let courseContext: string | null = null;
      if (isRoundActive && activeCourseId) {
        try {
          const course = await getApiCourse(activeCourseId);
          if (course) courseContext = courseSummaryForContext(course);
        } catch (e) {
          console.warn('[voiceCaddie] course context load failed:', e);
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);

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
          activeCourse,
          activeCourseId,
          courseContext,
          roundMode,
          patternInsights,
          holePlan,
          ghostContext,
          smartFinderContext,
          penaltyContext,
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
          // PGA HOPE follow-up — server-side persona resolution, intensity
          // dial, and Tank soft-intro flag. Read fresh at call time so
          // settings changes apply to the next utterance without restart.
          persona: useSettingsStore.getState().caddiePersonality,
          personaIntensity: useSettingsStore.getState().personaIntensity?.[useSettingsStore.getState().caddiePersonality] ?? 100,
          tankSoftIntro: useSettingsStore.getState().tankSoftIntro,
        }),
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        // Phase V.7+ — short haptic so Tim feels the network blip even if
        // he's not looking at the screen. Bubble text + speakResponse local
        // TTS still show/play; this just adds a tactile "something went
        // wrong" signal he can sense without glancing down.
        try { Vibration.vibrate(120); } catch {}
        return { text: 'Sorry, lost you for a moment. Try again.', audioBase64: null, toolAction: null };
      }
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
      console.log('[voice] brain error:', err);
      try { Vibration.vibrate(120); } catch {}
      return { text: 'Hit a snag on my end. Try again.', audioBase64: null, toolAction: null };
    }
  };

  // ── SPEAK RESPONSE ────────────────────────

  const speakResponse = async (text: string): Promise<void> => {
    if (!voiceEnabled || !text) return;
    if (discreteMode) {
      Vibration.vibrate(200);
      return;
    }
    // Phase V.7+ — userInitiated: this speakResponse path always answers a
    // user-tapped query, so it speaks at L1 too (the L1 badge would be
    // useless otherwise).
    await speak(text, voiceGender, language, apiUrl, { userInitiated: true });
  };

  // ── PROCESS AUDIO URI (shared by manual + VAD) ────

  const processAudioUri = useCallback(async (uri: string): Promise<void> => {
    if (isProcessingRef.current) return;
    try {
      isProcessingRef.current = true;
      wrappedOnVoiceStateChange('thinking');

      const formData = new FormData();
      formData.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
      formData.append('language', language);

      const transcribeController = new AbortController();
      const transcribeTimeout = setTimeout(() => transcribeController.abort(), 10000);

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
        console.error('[voice] transcribe failed', transcribeRes.status, transcribeData.error);
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

      console.log('[voice] transcript:', transcript);

      if (!transcript.trim()) {
        // Silent / unintelligible audio. Common when the mic was too
        // far away or background noise drowned the user out. Tell them
        // so they know to try again louder/closer.
        onResponseReceived("Didn't catch that — try once more, a bit closer to the mic.");
        wrappedOnVoiceStateChange('idle');
        isProcessingRef.current = false;
        return;
      }

      // Phase AR — record user turn into the conversation buffer so any
      // follow-up reply that flows out of this query has the prior turn
      // available in its context.
      recordUserTurn(transcript);

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
        console.log('[voice] follow-up bypass: Kevin asked a question, routing reply straight to brain');
      }

      // ── Voice command routing — runs after bypasses, before brain ──
      // Builds a snapshot of app state and parses the transcript into a structured
      // intent. If a handler matches with sufficient confidence, we execute it and
      // skip the full brain call. Tactical / conversational queries fall through.
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
      };

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

        const isCommandHit =
          intent.intent_type !== 'unknown' &&
          intent.confidence !== 'low' &&
          (result.success || result.follow_up_needed);

        if (isCommandHit) {
          if (result.tool_action) onToolAction?.(result.tool_action);
          if (result.voice_response) {
            onResponseReceived(result.voice_response);
            wrappedOnVoiceStateChange('speaking');
            await speakResponse(result.voice_response);
          }
          wrappedOnVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }
      } catch (err) {
        console.log('[voice] command routing error:', err);
        // Fall through to brain on routing errors — never get stuck.
      }

      // Fire filler clip in parallel with the brain call.
      // playLocalFile claims the audio singleton — when speakFromBase64 / speakResponse
      // runs below, it bumps speechId and naturally cancels any still-playing filler.
      if (voiceEnabled && !discreteMode && fillerEnabled && isLibraryGenerated()) {
        const clip = getClipForCategory(classifyQuery(transcript));
        if (clip) playLocalFile(clip.audio_path).catch(() => {});
      }

      const rawResponse = await sendToBrain(transcript);
      const kevinResponse = {
        ...rawResponse,
        ...checkContent(rawResponse.text, rawResponse.audioBase64),
      };
      if (kevinResponse.toolAction) onToolAction?.(kevinResponse.toolAction);
      onResponseReceived(kevinResponse.text);
      // Phase AR — record Kevin's reply so the next user follow-up has it
      // available as conversational antecedent.
      recordKevinTurn(kevinResponse.text);
      wrappedOnVoiceStateChange('speaking');
      if (kevinResponse.audioBase64 && voiceEnabled && !discreteMode) {
        // Phase V.7+ — user-initiated reply, plays at L1 too.
        await speakFromBase64(kevinResponse.audioBase64, { userInitiated: true });
      } else {
        await speakResponse(kevinResponse.text);
      }
      wrappedOnVoiceStateChange('idle');

    } catch (err) {
      console.log('[voice] process error:', err);
      // Same Cockpit-visibility rationale as the transcribe/empty paths
      // above — without a text feedback, the badge silently cycled back
      // to idle and Tim had no way to tell whether the mic missed him
      // or the pipeline threw.
      onResponseReceived('Hit a snag on my end. Try again.');
      wrappedOnVoiceStateChange('idle');
    } finally {
      isProcessingRef.current = false;
    }
  }, [language, voiceEnabled, discreteMode, voiceGender, fillerEnabled, currentYardage, currentHole, club, isRoundActive, roundMode]);

  // ── MAIN MIC HANDLER ─────────────────────

  const handleMicPress = useCallback(async () => {
    if (isSpeaking()) {
      await stopSpeaking();
      isProcessingRef.current = false;
      wrappedOnVoiceStateChange('idle');
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
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;

        if (!uri) {
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

      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);

      recordingRef.current = recording;
      console.log('[voice] recording started');

      // Auto-stop after AUTO_STOP_MS
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
    discreteMode,
    voiceGender,
    currentYardage,
    currentHole,
    club,
    isRoundActive,
  ]);

  return { handleMicPress, processAudioUri };
};
