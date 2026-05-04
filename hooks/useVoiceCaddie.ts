/**
 * useVoiceCaddie — Global AI Caddie Voice Hook
 *
 * SINGLE entry point for ALL voice interactions across the app.
 * All speech is routed through VoiceEngine — zero direct voiceService calls.
 *
 * Pipeline: IDLE → LISTENING → PROCESSING → SPEAKING → IDLE
 *
 * Built-in intelligence:
 *  1. Variation Engine    — rotates phrases so nothing feels repetitive
 *  2. Pattern Awareness   — detects repeated miss direction (last 5 shots)
 *  3. Emotional Awareness — catches frustration words, responds calmly
 *  4. Proactive Coaching  — hole-change nudge (every 2–3 holes)
 *  5. Voice Selection     — male/female ElevenLabs voice
 *  6. Global state        — voiceStore drives ALL overlays/UI simultaneously
 *
 * Rules enforced:
 *  - NEVER call speak() directly from UI
 *  - NEVER start mic outside this hook
 *  - ALL flows go through triggerVoice() or the auto-speak helpers
 *  - VoiceEngine is the sole arbiter of what plays and when
 */

import { useRef } from 'react';
import { VoiceController } from '../services/VoiceController';
import {
  speakJob,
  cancelAll as _engineCancelAll,
  canSpeak  as _engineCanSpeak,
  PRIORITY,
} from '../services/VoiceEngine';
import { startSTT, stopSTT } from '../services/sttService';
import { getAIResponse } from '../services/aiService';
import { getCaddieResponseV2 } from '../services/caddieBrainV2';
import { setGlobalGender } from '../services/voiceService';
import { useVoiceStore } from '../store/voiceStore';
import { useSettingsStore } from '../store/settingsStore';
import { parseVoiceCommand } from '../services/voiceCommandParser';
import { USE_CADDIE_V2 } from '../constants/caddieConfig';
import { useSituationalContext } from './useSituationalContext';
import { COURSE_GPS } from '../features/courses/data/courseGPS';
import {
  VoiceIntelligence,
  autoSpeak as viAutoSpeak,
  getIntroMessage,
  getPreShotMessage,
  getShotFeedback,
  resetIntro,
  shouldSpeak as viShouldSpeak,
  record as viRecord,
} from '../services/VoiceIntelligence';

export { PRIORITY };

/** Look up the booking URL for a course by name — falls back to golfnow.com */
const getCourseBookingUrl = (courseName: string): string => {
  const entry = COURSE_GPS.find(
    (c) => c.name.toLowerCase() === courseName.toLowerCase()
  );
  return entry?.bookingUrl ?? 'https://www.golfnow.com';
};

export const useVoiceCaddie = () => {
  const silenceTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef       = useRef(false);
  const genderPrefRef  = useRef<'male' | 'female'>('male');

  // ── Situational awareness ─────────────────────────────────────────────────
  const { adjustForContext, updateHeartRate } = useSituationalContext();

  // ── Global voice store (shared across ALL tabs) ───────────────────────────
  const setVoiceState     = useVoiceStore((s) => s.setVoiceState);
  const setTranscript     = useVoiceStore((s) => s.setTranscript);
  const setCaddieResponse = useVoiceStore((s) => s.setCaddieResponse);
  const voiceState        = useVoiceStore((s) => s.voiceState);

  // ── Settings store — for voice command side-effects ────────────────────────
  const setBrightMode   = useSettingsStore((s) => s.setBrightMode);
  const setResponseMode = useSettingsStore((s) => s.setResponseMode);
  const responseMode    = useSettingsStore((s) => s.responseMode);
  const discreteMode    = useSettingsStore((s) => s.discreteMode);

  // Sync the local genderPrefRef with the persisted settingsStore voiceGender.
  // Without this the ref defaults to 'male' and the user's Female/Serena
  // toggle in the tools menu never reaches this hook's speakJob calls — they
  // stayed Kevin while the avatar swapped to Serena.
  const persistedVoiceGender = useSettingsStore((s) => s.voiceGender) as 'male' | 'female';
  if (genderPrefRef.current !== persistedVoiceGender) {
    genderPrefRef.current = persistedVoiceGender;
  }

  /** Call this whenever quietMode or voiceEnabled changes. */
  const setMuted = (quietMode: boolean, voiceEnabled: boolean): void => {
    mutedRef.current = quietMode || !voiceEnabled;
  };

  /** Switch between the two fixed ElevenLabs profiles. */
  const setVoiceGender = (gender: 'male' | 'female') => {
    genderPrefRef.current = gender;
    setGlobalGender(gender);
  };

  // ── ElevenLabs cadence tuning ─────────────────────────────────────────────
  // Kept for backward compat — callers that read getSpeakOpts() still get values.
  const GENDER_OPTS = {
    male:   { rate: 0.94, pitch: 0.92 },
    female: { rate: 0.97, pitch: 1.02 },
  } as const;

  const getSpeakOpts = (overrides?: { rate?: number; pitch?: number }) => {
    const defaults = GENDER_OPTS[genderPrefRef.current];
    return {
      rate:  overrides?.rate  ?? defaults.rate,
      pitch: overrides?.pitch ?? defaults.pitch,
    };
  };

  // ── 1. Variation Engine ───────────────────────────────────────────────────
  const varCursor = useRef<Record<string, number>>({});

  const pick = (key: string, pool: string[]): string => {
    const cur = varCursor.current[key] ?? 0;
    const phrase = pool[cur % pool.length];
    varCursor.current[key] = (cur + 1) % pool.length;
    return phrase;
  };

  const ACKS = ['Got it.', 'Alright.', 'Yep.', 'Sure thing.', 'Copy that.', 'With you.'];

  const TEMPO_CUES = [
    'Stay smooth through it.',
    'Nice and easy — trust the pace.',
    'Good tempo. Stay with that.',
    "That's your swing right there.",
    'Easy does it through the ball.',
    'Stay patient and let it go.',
  ];

  const PROACTIVE_CUES = [
    'One thought this hole — smooth tempo.',
    'Pick your target early and commit to it.',
    'Stay patient out here — one shot at a time.',
    "This hole is yours. Let's keep it simple.",
    "Let's stay smooth this hole.",
    'Stay patient here.',
    'Trust your swing.',
  ];

  const getTempoCue = () => pick('tempo', TEMPO_CUES);

  // ── 2. Pattern Awareness ──────────────────────────────────────────────────
  const checkMissPattern = (recentResults: string[]): string | null => {
    if (recentResults.length < 3) return null;
    const last5      = recentResults.slice(-5);
    const rightCount = last5.filter((r) => r === 'right').length;
    const leftCount  = last5.filter((r) => r === 'left').length;
    if (rightCount >= 3) return "You're starting to leak right — stay smooth and let the club release.";
    if (leftCount  >= 3) return "You keep pulling left — stay through the ball and let it go.";
    return null;
  };

  // ── 3. Emotional Awareness ────────────────────────────────────────────────
  const FRUSTRATION_WORDS = [
    'terrible', 'awful', 'bad', 'hate', 'what am i doing',
    "can't hit", 'useless', 'garbage',
    "isn't working", 'not working', 'give up',
    'frustrated', 'hopeless', 'never', 'done',
  ];

  const detectFrustration = (text: string): boolean =>
    FRUSTRATION_WORDS.some((w) => text.toLowerCase().includes(w));

  const CALM_RESPONSES = [
    "Shake it off — we're good. Next one smooth.",
    "That's golf. Reset and trust your swing.",
    'Let that one go. Next shot is yours.',
    "Breathe. You've got this — stay with me.",
  ];

  const getFrustrationReply = (text: string): string | null =>
    detectFrustration(text) ? pick('calm', CALM_RESPONSES) : null;

  // ── Text pipeline helpers ─────────────────────────────────────────────────

  const addAcknowledgement = (text: string): string =>
    `${pick('ack', ACKS)} ${text}`;

  const simplifyResponse = (text: string): string => {
    if (!text) return '';
    return text.split('.')[0].split(' ').slice(0, 12).join(' ') + '.';
  };

  /**
   * Pre-process text so TTS engine breathes naturally.
   */
  const humanizeText = (text: string): string => {
    return text
      .replace(/\bPW\b/g, 'pitching wedge')
      .replace(/\bSW\b/g, 'sand wedge')
      .replace(/\bLW\b/g, 'lob wedge')
      .replace(/\byds\b/gi, 'yards')
      .replace(/(\d+)\s*yards/gi, '$1 yards,')
      .replace(
        /^(Alright|Here's the play|Stay with me|Got it|Sure thing|Copy that|With you),?\s/i,
        (m) => m.trimEnd() + ', ',
      )
      .replace(/([^.!?,])\s*$/, '$1.');
  };
  /** Returns a miss-pattern reply if transcript asks about misses, null otherwise. */
  const getMissPatternReply = (text: string): string | null => {
    const lower = text.toLowerCase();
    if (!/(miss|slice|hook|pull|push|right|left)/.test(lower)) return null;
    return getFrustrationReply(text);
  };

  // ── Core speak function — ALL speech routes through here ──────────────────
  /**
   * guardedSpeak — the single low-level speak call in this hook.
   * Routes through VoiceEngine so every emission is tracked and deduplicated.
   *
   * @param text      The final (humanized) text to speak
   * @param priority  VoiceEngine priority constant
   */
  const guardedSpeak = async (text: string, priority: number = PRIORITY.AMBIENT): Promise<void> => {
    const finalText = humanizeText(text);
    if (!finalText?.trim()) return;
    if (mutedRef.current) return;
    // Advisory check — avoid building state transitions for messages that VoiceEngine will drop
    if (!_engineCanSpeak(finalText, priority)) return;
    await speakJob(finalText, priority, genderPrefRef.current, setVoiceState);
  };

  // ── respond — called by caddie tab for non-mic text responses ─────────────
  /**
   * Speak a caddie response immediately (no delay).
   * Uses STRATEGY priority — will not interrupt active SHOT/CRITICAL speech.
   */
  const respond = (text: string): void => {
    const simple    = simplifyResponse(text);
    const finalText = addAcknowledgement(simple);
    void guardedSpeak(finalText, PRIORITY.STRATEGY);
  };

  // ── Dual V1/V2 caddie handler ────────────────────────────────────────────
  /**
   * handleUserInput — Routes transcript through V1 or V2 caddie brain.
   *
   * V2 (rule-based):
   *   - Synchronous, instant responses
   *   - Handles special signals: __START_CAMERA__, __SHOW_OVERLAY__
   *   - No AI calls, fully deterministic
   *
   * V1 (AI-powered):
   *   - Async OpenAI integration via aiService
   *   - Frustration + pattern detection
   *   - Situational context adjustment
   */
  const handleUserInput = async (
    input: string,
    inputContext?: Record<string, any>,
  ): Promise<void> => {
    if (USE_CADDIE_V2) {
      // ── V2 Path: Rule-based, synchronous caddie brain ────────────────────
      const shots = inputContext?.shots || [];
      const setPracticeSession = inputContext?.setPracticeSession;
      const response = getCaddieResponseV2(
        input,
        inputContext ?? {},
        shots,
        setPracticeSession
      );

      console.log('V2 RESPONSE:', response);

      // Handle special signals from V2
      if (response === '__START_CAMERA__') {
        if (inputContext?.onStartCameraRecording) {
          inputContext.onStartCameraRecording();
        }
        const reply = 'Got it.';
        setCaddieResponse(reply);
        await guardedSpeak(reply, PRIORITY.STRATEGY);
        return;
      }

      if (response === '__SHOW_OVERLAY__') {
        if (inputContext?.onShowOverlay) {
          inputContext.onShowOverlay();
        }
        const reply = 'Here you go.';
        setCaddieResponse(reply);
        await guardedSpeak(reply, PRIORITY.STRATEGY);
        return;
      }

      // Normal V2 response — speak directly
      setCaddieResponse(response);
      await guardedSpeak(response, PRIORITY.STRATEGY);
      return;
    }

    // ── V1 Path: AI-powered caddie (fallback) ────────────────────────────
  // Preserve legacy behavior when V2 is disabled.
    const frustrationReply = input ? getFrustrationReply(input) : null;
    const missReply        = input ? getMissPatternReply(input) : null;
    // Tee time intent detection — handled before AI to give instant response
    const lowerInput = input.toLowerCase();
    const isTeeTimeIntent =
      lowerInput.includes('tee time') ||
      lowerInput.includes('book a tee') ||
      lowerInput.includes('book tee') ||
      lowerInput.includes('reserve a tee') ||
      lowerInput.includes('make a reservation') ||
      lowerInput.includes('schedule a round') ||
      lowerInput.includes('book a round');

    let response: string;
    if (isTeeTimeIntent) {
      const courseName = (inputContext as any)?.activeCourse ?? '';
      const url = getCourseBookingUrl(courseName);
      const spokenResponse = `Opening tee times for ${courseName || 'your course'}. Booking page coming right up.`;
      const finalText = addAcknowledgement(humanizeText(spokenResponse));
      setCaddieResponse(finalText);
      await VoiceController.speak(finalText, setVoiceState, genderPrefRef.current as unknown as null);
      try {
        const { openBrowserAsync } = await import('expo-web-browser');
        await openBrowserAsync(url);
      } catch {
        // Browser unavailable — caddie already spoke.
      }
      return;
    } else if (frustrationReply) {
      response = frustrationReply;
    } else if (missReply) {
      response = missReply;
    } else {
      response = await getAIResponse(input, inputContext ?? {}, responseMode);
    }

    // Apply situational context adjustment (pressure-aware tone) — modifies string only
    const adjustedResponse = adjustForContext(response);
    const finalText = input.trim()
      ? addAcknowledgement(humanizeText(adjustedResponse))
      : humanizeText(adjustedResponse);
    setCaddieResponse(finalText);

    // Preserve legacy V1 speaking path.
    await VoiceController.speak(finalText, setVoiceState, genderPrefRef.current as unknown as null);
  };

  // ── 4. Proactive Coaching ─────────────────────────────────────────────────
  // Natural 1.2s delay after hole change — deliberate pacing, not a race condition.
  const proactiveCoachNextRef = useRef(2 + Math.floor(Math.random() * 2)); // 2 or 3

  const proactiveCoach = (hole: number) => {
    if (hole < 2) return;
    if (discreteMode) return; // suppress proactive cues in discrete mode
    if ((hole - 1) % proactiveCoachNextRef.current !== 0) return;
    proactiveCoachNextRef.current = 2 + Math.floor(Math.random() * 2);
    const cue = pick('proactive', PROACTIVE_CUES);
    // 1.2s delay is intentional — lets any hole-transition speech finish first
    setTimeout(() => { void guardedSpeak(cue, PRIORITY.AMBIENT); }, 1200);
  };

  // ── Silence / listening timers ────────────────────────────────────────────

  const handleSpeech = (text: string | undefined, onSilence: (t?: string) => void) => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(() => onSilence(text), 1800);
  };

  const startMaxWindow = (onTimeout: () => void, ms = 4000) => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(onTimeout, ms);
  };

  const cancelSilence = () => {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  };

  // ── Global pipeline: triggerVoice ─────────────────────────────────────────
  /**
   * triggerVoice(context?)
   *
   * Runs the complete IDLE → LISTENING → PROCESSING → SPEAKING → IDLE pipeline.
   * Pass optional round context so the AI can give hole-aware advice.
   *
   * @param context  { hole, distance, club, missPattern, par }
   */
  const triggerVoice = async (context?: Record<string, any>) => {
    if (mutedRef.current) return;
    // Hard guard: never start a new pipeline while voice is already active
    if (voiceState !== 'IDLE') return;
    try {
      // LISTENING phase — VoiceController registers with VoiceEngine
      const transcript = await VoiceController.startListening(
        () => startSTT(setTranscript),
        setVoiceState,
      );

      // null means session was already active — bail
      if (transcript === null) return;

      // Empty transcript + no context — nothing useful to say
      if (!transcript && !context) {
        setVoiceState('IDLE');
        return;
      }

        // ── Yardage query — bypass AI entirely, answer instantly ─────────────
      if (transcript) {
        const t = transcript.toLowerCase();
        const isYardageQuery = (
          t.includes('yardage') ||
          t.includes('how far') ||
          t.includes('how many yards') ||
          t.includes('distance') && (t.includes('pin') || t.includes('flag') || t.includes('green') || t.includes('hole')) ||
          /\bhow\s+far\b/.test(t) ||
          /\byard(s)?\b/.test(t) && (t.includes('how') || t.includes('far') || t.includes('what'))
        );
        if (isYardageQuery && context?.distance) {
          const yards = Math.round(Number(context.distance));
          const reply = `${yards} yards.`;
          setCaddieResponse(reply);
          await guardedSpeak(reply, PRIORITY.STRATEGY);
          return;
        }

        // ── Club query — bypass AI, answer with current club instantly ────
        const isClubQuery = (
          t.includes('what club') ||
          t.includes('which club') ||
          t.includes('what should i hit') ||
          t.includes('what do i hit') ||
          /\bclub\b/.test(t) && (t.includes('use') || t.includes('take') || t.includes('what') || t.includes('which'))
        );
        if (isClubQuery && context?.club) {
          const reply = `${context.club}.`;
          setCaddieResponse(reply);
          await guardedSpeak(reply, PRIORITY.STRATEGY);
          return;
        }

        // ── Mark shot command — bypass AI, acknowledge instantly ─────────
        const isMarkShot = (
          t.includes('mark shot') ||
          t.includes('mark ball') ||
          t.includes('shot logged') ||
          t.includes('log shot') ||
          t.includes('record shot')
        );
        if (isMarkShot) {
          const reply = 'Shot marked.';
          setCaddieResponse(reply);
          // Notify caller via context so UI can also call handleMarkShot
          if (context?.onMarkShot) (context.onMarkShot as () => void)();
          await guardedSpeak(reply, PRIORITY.STRATEGY);
          return;
        }

        const isSmartVisionCommand = (
          t.includes('smartvision') ||
          t.includes('smart vision') ||
          t.includes('smart view') ||
          t.includes('hole view') ||
          t.includes('open vision') ||
          t.includes('show vision')
        );
        const openSmartVision =
          context?.onOpenSmartVision ?? context?.onStartVideo ?? context?.onShowMap;
        if (USE_CADDIE_V2 && isSmartVisionCommand && typeof openSmartVision === 'function') {
          const reply = 'Opening SmartVision.';
          setCaddieResponse(reply);
          (openSmartVision as () => void)();
          await guardedSpeak(reply, PRIORITY.STRATEGY);
          return;
        }

        const isSmartMotionCommand = (
          t.includes('smartmotion') ||
          t.includes('smart motion') ||
          t.includes('swing lab') ||
          t.includes('open swing lab') ||
          t.includes('open smart motion') ||
          t.includes('show smart motion')
        );
        if (USE_CADDIE_V2 && isSmartMotionCommand && typeof context?.onOpenSmartMotion === 'function') {
          const reply = 'Opening SmartMotion.';
          setCaddieResponse(reply);
          (context.onOpenSmartMotion as () => void)();
          await guardedSpeak(reply, PRIORITY.STRATEGY);
          return;
        }
      }

      // ── Voice command interception — runs BEFORE AI pipeline ─────────────
      if (transcript) {
        const command = parseVoiceCommand(transcript);
        if (command !== null) {
          let confirmMsg = '';
          switch (command) {
            case 'bright':
              setBrightMode(true);
              confirmMsg = 'Bright mode.';
              break;
            case 'dark':
              setBrightMode(false);
              confirmMsg = 'Play mode.';
              break;
            case 'auto':
              // Auto mode resets bright to off (system default)
              setBrightMode(false);
              confirmMsg = 'Auto mode.';
              break;
            case 'short':
              setResponseMode('short');
              confirmMsg = 'Short responses.';
              break;
            case 'detailed':
              setResponseMode('detailed');
              confirmMsg = 'More detail.';
              break;
          }
          setCaddieResponse(confirmMsg);
          await guardedSpeak(confirmMsg, PRIORITY.STRATEGY);
          return;
        }
      }

      // PROCESSING phase
      setVoiceState('PROCESSING');
      console.log('[VoiceEngine] VOICE PROCESSING');
      console.log(`[useVoiceCaddie] AI INPUT: "${transcript ?? '(context-only)'}"`);

      // Route through V1/V2 handler
      await handleUserInput(transcript ?? '', context);

      // Hard safety: if speech is dropped/blocked, never leave UI stuck in PROCESSING.
      if (useVoiceStore.getState().voiceState === 'PROCESSING') {
        setVoiceState('IDLE');
      }

    } catch (e) {
      console.error('[useVoiceCaddie] pipeline error:', e);
      setVoiceState('IDLE');
    }
  };

  /** Cancel any active voice pipeline and reset to IDLE */
  const cancelVoice = () => {
    cancelSilence();
    void _engineCancelAll(setVoiceState);
  };

  // ── Voice Intelligence auto-speak helpers ─────────────────────────────────
  // These all go through guardedSpeak which routes through VoiceEngine.

  /** Speak once on app launch or round start. OK to call on every render — fires only once. */
  const speakIntro = async (trigger: 'app' | 'round' = 'app') => {
    if (discreteMode) return;
    const msg = getIntroMessage(trigger);
    if (!msg) return;
    if (!viShouldSpeak(msg, PRIORITY.AMBIENT)) return;
    const didSpeak = await guardedSpeak(msg, PRIORITY.AMBIENT);
    viRecord(msg, PRIORITY.AMBIENT);
  };

  /** Speak pre-shot distance advice. Respects cooldown — safe to call on GPS updates. */
  const speakPreShot = async (ctx: { distance: number; club?: string }) => {
    if (discreteMode) return;
    const msg = getPreShotMessage(ctx);
    if (!msg) return;
    if (!viShouldSpeak(msg, PRIORITY.STRATEGY)) return;
    if (!_engineCanSpeak(msg, PRIORITY.STRATEGY)) return;
    await guardedSpeak(msg, PRIORITY.STRATEGY);
    viRecord(msg, PRIORITY.STRATEGY);
  };

  /** Speak post-shot feedback. Pass recentResults for pattern detection. */
  const speakShotFeedback = async (
    result: 'left' | 'right' | 'straight',
    recentResults: string[] = [],
  ): Promise<boolean> => {
    const msg = getShotFeedback(result, recentResults);
    if (!msg) return false;
    if (!viShouldSpeak(msg, PRIORITY.SHOT)) return false;
    if (!_engineCanSpeak(msg, PRIORITY.SHOT)) return false;
    await guardedSpeak(msg, PRIORITY.SHOT);
    viRecord(msg, PRIORITY.SHOT);
    return true;
  };

  return {
    // ── Global pipeline ──
    triggerVoice,
    cancelVoice,
    voiceState,

    // ── Respond + coaching ──
    respond,
    handleUserInput,
    getTempoCue,
    checkMissPattern,
    getFrustrationReply,
    proactiveCoach,
    setVoiceGender,
    setMuted,
    getSpeakOpts,
    humanizeText,
    handleSpeech,
    startMaxWindow,
    cancelSilence,

    // ── Voice Intelligence ──
    speakIntro,
    speakPreShot,
    speakShotFeedback,
    resetIntro,
    VoiceIntelligence,
    PRIORITY,

    // ── Situational awareness ──
    updateHeartRate,
  };
};

