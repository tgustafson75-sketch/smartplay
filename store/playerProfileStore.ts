import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── STATE ────────────────────────────────

interface PlayerProfileState {
  name: string;
  firstName: string;
  handicap: number;
  dominantMiss: 'left' | 'right' | 'straight' | null;
  physicalLimitation: string | null;
  goal: string | null;
  personalBest: number | null;
  homeCourse: string | null;
  preferredTee: 'front' | 'middle' | 'back';
  isSetupComplete: boolean;
  has_completed_onboarding: boolean;
  default_mode: 'break_100' | 'break_90' | 'break_80' | 'free_play' | null;

  // ─── ACTIONS ────────────────────────────

  setName: (name: string) => void;
  setHandicap: (hcp: number) => void;
  setDominantMiss: (miss: 'left' | 'right' | 'straight' | null) => void;
  setPhysicalLimitation: (limitation: string | null) => void;
  setGoal: (goal: string | null) => void;
  setPersonalBest: (score: number | null) => void;
  setHomeCourse: (course: string | null) => void;
  setPreferredTee: (tee: 'front' | 'middle' | 'back') => void;
  completeSetup: () => void;
  completeOnboarding: () => void;
  setDefaultMode: (m: 'break_100' | 'break_90' | 'break_80' | 'free_play') => void;
}

// ─── STORE ────────────────────────────────

export const usePlayerProfileStore = create<PlayerProfileState>()(
  persist(
    (set) => ({
      name: '',
      firstName: '',
      handicap: 18,
      dominantMiss: null,
      physicalLimitation: null,
      goal: null,
      personalBest: null,
      homeCourse: null,
      preferredTee: 'middle',
      isSetupComplete: false,
      has_completed_onboarding: false,
      default_mode: null,

      setName: (name) =>
        set({ name, firstName: name.split(' ')[0] ?? name }),
      setHandicap: (hcp) => set({ handicap: hcp }),
      setDominantMiss: (miss) => set({ dominantMiss: miss }),
      setPhysicalLimitation: (l) => set({ physicalLimitation: l }),
      setGoal: (goal) => set({ goal }),
      setPersonalBest: (score) => set({ personalBest: score }),
      setHomeCourse: (course) => set({ homeCourse: course }),
      setPreferredTee: (tee) => set({ preferredTee: tee }),
      completeSetup: () => set({ isSetupComplete: true }),
      completeOnboarding: () => set({ has_completed_onboarding: true }),
      setDefaultMode: (m) => set({ default_mode: m }),
    }),
    {
      name: 'player-profile-v2',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
