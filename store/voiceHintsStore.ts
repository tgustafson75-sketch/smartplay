import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * Tracks one-time voice discovery hints + permission state across app restarts.
 * Each hint flag flips to true the first time it's shown and stays true forever
 * (or until the user explicitly resets via settings).
 */
interface VoiceHintsState {
  // Onboarding "Meet Kevin" interaction
  meet_kevin_completed: boolean;
  meet_kevin_skipped: boolean;
  // First-round contextual hints
  first_tee_shown: boolean;
  first_shot_shown: boolean;
  first_tool_shown: boolean;
  // Vocabulary banner
  vocab_banner_shown: boolean;
  // Permission state — persistent across app sessions
  mic_permission_denied: boolean;
  mic_permission_granted_at: number | null;
  // Total voice-logged shots — drives the vocab banner threshold
  voice_logged_shot_count: number;
  // Configurable banner threshold (no code change to tune)
  vocab_banner_threshold: number;

  markMeetKevinCompleted: () => void;
  markMeetKevinSkipped: () => void;
  markFirstTeeShown: () => void;
  markFirstShotShown: () => void;
  markFirstToolShown: () => void;
  markVocabBannerShown: () => void;
  setMicDenied: (v: boolean) => void;
  setMicGranted: () => void;
  incrementVoiceShotCount: () => void;
  resetAll: () => void;
}

export const useVoiceHintsStore = create<VoiceHintsState>()(
  persist(
    (set) => ({
      meet_kevin_completed: false,
      meet_kevin_skipped: false,
      first_tee_shown: false,
      first_shot_shown: false,
      first_tool_shown: false,
      vocab_banner_shown: false,
      mic_permission_denied: false,
      mic_permission_granted_at: null,
      voice_logged_shot_count: 0,
      vocab_banner_threshold: 5,

      markMeetKevinCompleted: () => set({ meet_kevin_completed: true }),
      markMeetKevinSkipped: () => set({ meet_kevin_skipped: true }),
      markFirstTeeShown: () => set({ first_tee_shown: true }),
      markFirstShotShown: () => set({ first_shot_shown: true }),
      markFirstToolShown: () => set({ first_tool_shown: true }),
      markVocabBannerShown: () => set({ vocab_banner_shown: true }),
      setMicDenied: (v) => set({ mic_permission_denied: v }),
      setMicGranted: () => set({ mic_permission_denied: false, mic_permission_granted_at: Date.now() }),
      incrementVoiceShotCount: () => set(s => ({ voice_logged_shot_count: s.voice_logged_shot_count + 1 })),
      resetAll: () => set({
        meet_kevin_completed: false,
        meet_kevin_skipped: false,
        first_tee_shown: false,
        first_shot_shown: false,
        first_tool_shown: false,
        vocab_banner_shown: false,
        mic_permission_denied: false,
        mic_permission_granted_at: null,
        voice_logged_shot_count: 0,
      }),
    }),
    {
      name: 'voice-hints-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
