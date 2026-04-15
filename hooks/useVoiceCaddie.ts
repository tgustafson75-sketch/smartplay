import { useRef } from 'react';
import { speak as playElevenLabsAudio } from '../services/voiceService';

/**
 * useVoiceCaddie
 *
 * Full voice pipeline + intelligent response layer:
 *  1. Variation Engine    — rotates phrases so nothing feels repetitive
 *  2. Pattern Awareness   — detects repeated miss direction (last 5 shots)
 *  3. Emotional Awareness — catches frustration words, responds calmly
 *  4. Proactive Coaching  — hole-change nudge (call proactiveCoach(hole))
 *  5. Voice Selection     — male/female English voice, auto-loaded on init
 *  6. Silence debounce    — handleSpeech / startMaxWindow / cancelSilence
 *  7. Respond pipeline    — simplify → acknowledge → no-overlap delay → speak
 */
export const useVoiceCaddie = () => {
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenRef = useRef(0);
  const isSpeakingRef = useRef(false);
  // Mute gate — set by the parent screen whenever quietMode or voiceEnabled changes
  const mutedRef = useRef(false);

  /** Call this whenever quietMode or voiceEnabled changes. guardedSpeak will
   * return early silently when muted=true, matching the behaviour of the
   * component-level speak() hook. */
  const setMuted = (quietMode: boolean, voiceEnabled: boolean): void => {
    mutedRef.current = quietMode || !voiceEnabled;
  };

  // ── 5. ElevenLabs profile selection only ───────────────────────────────────
  const genderPrefRef = useRef<'male' | 'female'>('male');

  // Keep the same two curated ElevenLabs voices, but nudge the feel slightly
  // quicker for a more natural caddie cadence on device.
  const GENDER_OPTS = {
    male:   { rate: 0.94, pitch: 0.92 },
    female: { rate: 0.97, pitch: 1.02 },
  } as const;

  /** Switch between the two fixed ElevenLabs profiles only. */
  const setVoiceGender = (gender: 'male' | 'female') => {
    genderPrefRef.current = gender;
  };

  /**
   * Pre-process text so the TTS engine breathes naturally.
   * TTS engines pause on punctuation — strategic commas and periods are the
   * single biggest lever for making synthetic speech sound human.
   */
  const humanizeText = (text: string): string => {
    return (
      text
        // Expand common golf abbrevs so TTS pronounces them correctly
        .replace(/\bPW\b/g, 'pitching wedge')
        .replace(/\bSW\b/g, 'sand wedge')
        .replace(/\bLW\b/g, 'lob wedge')
        .replace(/\byds\b/gi, 'yards')
        // Numbers followed by "yards" — pause after for emphasis
        .replace(/(\d+)\s*yards/gi, '$1 yards,')
        // Add a breath after sentence starters so they don't rush
        .replace(/^(Alright|Here's the play|Stay with me|Got it|Sure thing|Copy that|With you),?\s/i,
          (m) => m.trimEnd() + ', ')
        // Ensure sentences end with period so TTS pauses
        .replace(/([^.!?,])\s*$/, '$1.')
    );
  };

  /**
   * Returns consistent cadence options for the active ElevenLabs profile.
   * Pitch and rate are tuned for naturalness, not extremes.
   */
  const getSpeakOpts = (overrides?: { rate?: number; pitch?: number }) => {
    const defaults = GENDER_OPTS[genderPrefRef.current];
    return {
      rate: overrides?.rate ?? defaults.rate,
      pitch: overrides?.pitch ?? defaults.pitch,
    };
  };

  // ── 1. Variation Engine ──────────────────────────────────────────────────────
  // Each key holds a pool + a cursor so we cycle without immediate repeats.
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

  /** Pick a fresh tempo cue (never repeats immediately). */
  const getTempoCue = () => pick('tempo', TEMPO_CUES);

  // ── 2. Pattern Awareness ─────────────────────────────────────────────────────
  // Component passes its shot list; we inspect the tail here.
  const checkMissPattern = (recentResults: string[]): string | null => {
    if (recentResults.length < 3) return null;
    const last5 = recentResults.slice(-5);
    const rightCount = last5.filter((r) => r === 'right').length;
    const leftCount  = last5.filter((r) => r === 'left').length;
    if (rightCount >= 3) return "You're starting to leak right — stay smooth and let the club release.";
    if (leftCount  >= 3) return "You keep pulling left — stay through the ball and let it go.";
    return null;
  };

  // ── 3. Emotional Awareness ───────────────────────────────────────────────────
  const FRUSTRATION_WORDS = ['terrible', 'awful', 'bad', 'hate', 'what am i doing', 'can\'t hit', 'useless', 'garbage'];

  const detectFrustration = (text: string): boolean =>
    FRUSTRATION_WORDS.some((w) => text.toLowerCase().includes(w));

  const CALM_RESPONSES = [
    "Shake it off — we're good. Next one smooth.",
    "That's golf. Reset and trust your swing.",
    'Let that one go. Next shot is yours.',
    "Breathe. You've got this — stay with me.",
  ];

  /** Returns a calm reply if frustration detected, null otherwise. */
  const getFrustrationReply = (text: string): string | null =>
    detectFrustration(text) ? pick('calm', CALM_RESPONSES) : null;

  const guardedSpeak = async (text: string): Promise<void> => {
    const finalText = humanizeText(text);
    const now = Date.now();
    if (!finalText?.trim()) return;
    if (mutedRef.current) return;           // respect quietMode / voiceEnabled
    if (now - lastSpokenRef.current < 5000) return;
    if (isSpeakingRef.current) return;

    try {
      isSpeakingRef.current = true;
      lastSpokenRef.current = now;
      await playElevenLabsAudio(finalText, genderPrefRef.current);
    } catch {
      // no-op
    } finally {
      isSpeakingRef.current = false;
    }
  };

  // ── 4. Proactive Coaching ────────────────────────────────────────────────────
  // Fires every 2–3 holes (randomly chosen each time) so it never feels mechanical.
  // Waits 1.2s after hole change so it doesn't interrupt any other speech.
  const proactiveCoachNextRef = { current: 2 + Math.floor(Math.random() * 2) }; // 2 or 3
  const proactiveCoach = (hole: number) => {
    if (hole < 2) return;
    if ((hole - 1) % proactiveCoachNextRef.current !== 0) return;
    // Randomise next interval: 2 or 3 holes
    proactiveCoachNextRef.current = 2 + Math.floor(Math.random() * 2);
    const cue = pick('proactive', PROACTIVE_CUES);
    setTimeout(() => { void guardedSpeak(cue); }, 1200);
  };

  // ── Text pipeline ────────────────────────────────────────────────────────────

  const addAcknowledgement = (text: string): string =>
    `${pick('ack', ACKS)} ${text}`;

  const simplifyResponse = (text: string): string => {
    if (!text) return '';
    const firstSentence = text.split('.')[0];
    return firstSentence.split(' ').slice(0, 12).join(' ') + '.';
  };

  /**
   * Single guarded response pipeline for ElevenLabs.
   * Trims the message, adds a small natural delay, and never overlaps playback.
   */
  const respond = (text: string, _options?: { rate?: number; pitch?: number }) => {
    const simple = simplifyResponse(text);
    const finalText = addAcknowledgement(simple);
    const delay = 200 + Math.random() * 100;
    setTimeout(() => {
      void guardedSpeak(finalText);
    }, delay);
  };

  // ── Silence / listening timers ───────────────────────────────────────────────

  /** Reset silence countdown on each partial result. Fires after 1800 ms of silence. */
  const handleSpeech = (text: string | undefined, onSilence: (t?: string) => void) => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(() => onSilence(text), 1800);
  };

  /** Hard maximum listening window. Default 4000 ms. */
  const startMaxWindow = (onTimeout: () => void, ms = 4000) => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(onTimeout, ms);
  };

  /** Cancel any pending silence / max-window timer. */
  const cancelSilence = () => {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  };

  return {
    respond,
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
  };
};
