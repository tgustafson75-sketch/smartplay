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
  /**
   * 2026-08-31 (Tim, after an on-course session: "we still have that canned speech when you hit
   * stop recording") — how many times the caddie has TAUGHT the go-again commands.
   *
   * The line was not wrong, it was repeated. All five of its variants are the same shape — a menu
   * read aloud: "Say run it back and I'll start it, or name a club." That is an instruction manual,
   * and reciting it after every single set is what makes a caddie sound like a recording. A person
   * tells you how it works once and then just waits. [[feels-like-a-real-caddie]]
   */
  go_again_taught_count: number;

  /** Count one teaching of the go-again commands. Saturates — it only ever needs to go up. */
  noteGoAgainTaught: () => void;
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
      go_again_taught_count: 0,

      noteGoAgainTaught: () => set((st) => ({ go_again_taught_count: (st.go_again_taught_count ?? 0) + 1 })),
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
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      /**
       * 2026-08-31 (v2) — AN EXISTING PLAYER HAS ALREADY BEEN TAUGHT.
       *
       * `go_again_taught_count` was added today to stop the caddie reciting the go-again commands
       * after every set. It defaults to 0 — correct for a new install, WRONG for everyone already
       * using the app, who would have been taught the menu two more times before it went quiet. Tim
       * has heard that line a hundred times; hearing it twice more is not a fix.
       *
       * A persisted voice-hints blob only exists for someone who has already used the app, so its
       * presence IS the evidence. Seeded to the threshold so they go straight to the short form.
       * New installs have no blob, migrate never runs, and they get taught properly.
       */
      version: 2,
      migrate: (s, version) => {
        if (!s || typeof s !== 'object') return s as never;
        const p = s as Record<string, unknown>;
        if (version < 2 && p.go_again_taught_count == null) p.go_again_taught_count = 2;
        return p as never;
      },
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
