/**
 * useVoiceController — connects voice input to app actions and ElevenLabs output.
 *
 * PIPELINE
 * ────────
 *   User taps mic button
 *       │
 *   useVoiceInput (STT — expo-speech-recognition)
 *       │  transcript
 *   detectCommand (CommandEngine)
 *       │  CommandKey
 *   handleVoice  (this hook)
 *       │  dispatches app callbacks + speaks via VoiceManager
 *   VoiceManager.speak() → ElevenLabs
 *
 * VOICE MODE
 * ──────────
 *   voiceMode = 'manual'  — mic button only (current)
 *   voiceMode = 'wake'    — passive always-on trigger (future, not yet enabled)
 *
 *   To switch in future: change VOICE_MODE constant to 'wake' and wire a
 *   wake-word detector (e.g. Porcupine) to call startListening().
 *
 * USAGE
 * ─────
 *   const voice = useVoiceController({
 *     distance:        displayDistance,
 *     recommendedClub: caddie.recommendedClub ?? club,
 *     currentHole,
 *     onNextHole:      () => setCurrentHole(currentHole + 1),
 *     onPrevHole:      () => setCurrentHole(currentHole - 1),
 *     onShowMap:       () => setShowHolePreview(true),
 *     onPuttMode:      () => setPuttMode(true),
 *     onShowScorecard: () => router.push('/scorecard'),
 *     onLogShot:       recordShot,
 *     onStartVideo:    startVideo,
 *   });
 *
 *   // In JSX:
 *   <VoiceMicButton listening={voice.listening} onPress={voice.toggle} />
 */

import { useCallback, useRef } from 'react';
import { useVoiceInput } from './useVoiceInput';
import { detectCommand, type CommandKey } from './CommandEngine';
import type { VoiceCommand } from '../../services/voiceCommandParser';
import { speak, PRIORITY } from '../../core/voice/VoiceManager';
import { getFollowUp, type FollowUpContext, type FollowUpPersonality } from './FollowUpEngine';
import { formatDistance, formatClub, formatAdvice, formatShotLogged } from './ResponseFormatter';
import type { ResponseMode } from '../../store/settingsStore';

// ─────────────────────────────────────────────────────────────────────────────
// Voice mode — 'manual' until wake word is integrated
// ─────────────────────────────────────────────────────────────────────────────

/** Current voice activation mode.
 *  'manual' = mic button only.
 *  'wake'   = future passive wake-word detection (not yet enabled). */
export const VOICE_MODE: 'manual' | 'wake' = 'manual';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceControllerContext {
  /** Current yardage to the target */
  distance?:        number | null;
  /** Caddie's recommended club */
  recommendedClub?: string | null;
  /** Current hole number */
  currentHole?:     number;
  /** Callbacks the controller can trigger */
  onNextHole?:      () => void;
  onPrevHole?:      () => void;
  onShowMap?:       () => void;
  onPuttMode?:      () => void;
  onShowScorecard?: () => void;
  onLogShot?:       () => void;
  onStartVideo?:    () => void;
  onGetAdvice?:     () => string;
  /**
   * Called for any transcript that doesn't match a known command.
   * Returns the caddie response to speak, or null to speak nothing.
   * Wire Focus Mode here: onFreeformQuery = (q) => handleFocusInput(q, ctx, ai)
   */
  onFreeformQuery?: (transcript: string) => Promise<string | null>;
  // ── Follow-up context (optional — enables split-delivery responses) ──────
  /** Follow-up game context passed to FollowUpEngine */
  followUpContext?:   FollowUpContext;
  /** Personality flavour for follow-up phrasing */
  followUpPersonality?: FollowUpPersonality;
  /** Response verbosity style — short | neutral | detailed */
  responseStyle?: ResponseMode;
  /** Personality mode — calm | aggressive | coach */
  personality?: FollowUpPersonality;
}

export interface UseVoiceControllerReturn {
  /** True while mic is actively recording */
  listening:     boolean;
  /** Last transcript text (partial or final) */
  transcript:    string;
  /** Start listening (called by mic button or wake-word detector) */
  startListening: () => Promise<void>;
  /** Stop listening manually */
  stopListening:  () => void;
  /** Toggle listening on/off — convenient for mic button onPress */
  toggle:         () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useVoiceController(ctx: VoiceControllerContext = {}): UseVoiceControllerReturn {

  // Prevents stacking multiple follow-ups within the same interaction
  const followUpSentRef = useRef(false);
  const followUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Command handler — called on every final transcript ───────────────────
  const handleCommand = useCallback((command: CommandKey | VoiceCommand, transcript: string) => {
    console.log('[VoiceController] command:', command, '|', transcript);

    // Reset follow-up guard for each new command
    followUpSentRef.current = false;
    if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);

    const style  = ctx.responseStyle  ?? 'neutral';
    const persona = ctx.personality    ?? ctx.followUpPersonality ?? 'calm';

    /** Speak main response immediately; schedule a short follow-up after 800 ms
     *  if FollowUpEngine returns one and this interaction hasn't sent one yet. */
    const speakWithFollowUp = (main: string, intent: CommandKey) => {
      void speak(main, PRIORITY.STRATEGY);
      if (!followUpSentRef.current && ctx.followUpContext) {
        const follow = getFollowUp({
          intent,
          context:     ctx.followUpContext,
          personality: persona,
        });
        if (follow) {
          followUpSentRef.current = true;
          followUpTimerRef.current = setTimeout(() => {
            void speak(follow, PRIORITY.STRATEGY);
          }, 800);
        }
      }
    };

    switch (command) {
      case 'GET_DISTANCE': {
        const msg = formatDistance(ctx.distance, style, persona);
        speakWithFollowUp(msg, 'GET_DISTANCE');
        break;
      }

      case 'GET_CLUB': {
        const msg = formatClub(ctx.recommendedClub, style, persona);
        speakWithFollowUp(msg, 'GET_CLUB');
        break;
      }

      case 'GET_ADVICE': {
        const advice = ctx.onGetAdvice?.();
        const msg = formatAdvice(advice, style, persona);
        speakWithFollowUp(msg, 'GET_ADVICE');
        break;
      }

      case 'LOG_SHOT':
      case 'RECORD_SHOT': {
        ctx.onLogShot?.();
        void speak(formatShotLogged(style, persona), PRIORITY.AMBIENT);
        break;
      }

      case 'START_VIDEO': {
        ctx.onStartVideo?.();
        void speak('Recording.', PRIORITY.AMBIENT);
        break;
      }

      case 'NEXT_HOLE': {
        ctx.onNextHole?.();
        const next = (ctx.currentHole ?? 0) + 1;
        void speak(`Hole ${next}.`, PRIORITY.STRATEGY);
        break;
      }

      case 'PREV_HOLE': {
        ctx.onPrevHole?.();
        const prev = (ctx.currentHole ?? 2) - 1;
        void speak(`Back to hole ${prev}.`, PRIORITY.STRATEGY);
        break;
      }

      case 'PUTT_MODE': {
        ctx.onPuttMode?.();
        void speak('Putt mode on. Read the break.', PRIORITY.STRATEGY);
        break;
      }

      case 'SHOW_SCORECARD': {
        ctx.onShowScorecard?.();
        break;
      }

      case 'SHOW_MAP': {
        ctx.onShowMap?.();
        break;
      }

      case 'TAKE_PHOTO':
        // Photo capture not yet wired — no-op
        void speak('Photo not available.', PRIORITY.AMBIENT);
        break;

      default: {
        // Route unrecognized speech through Focus Mode engine if provided
        if (ctx.onFreeformQuery) {
          void ctx.onFreeformQuery(transcript).then((reply) => {
            if (reply) void speak(reply, PRIORITY.STRATEGY);
          });
        }
        break;
      }
    }
  }, [ctx]);

  // ── STT hook ──────────────────────────────────────────────────────────────
  const { listening, transcript, startListening, stopListening } = useVoiceInput({
    onTranscript: (text, isFinal) => {
      // Partial transcripts available here — could update a live display
      if (__DEV__ && !isFinal) console.log('[VoiceController] partial:', text);
    },
    onCommand: handleCommand,
  });

  // ── Toggle — convenient for mic button ────────────────────────────────────
  const toggle = useCallback(() => {
    if (listening) stopListening();
    else void startListening();
  }, [listening, startListening, stopListening]);

  return { listening, transcript, startListening, stopListening, toggle };
}
