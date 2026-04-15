import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UserState {
  name: string;
  setName: (name: string) => void;
  firstName: string;
  setFirstName: (n: string) => void;
  lastName: string;
  setLastName: (n: string) => void;
  displayName: string;
  setDisplayName: (n: string) => void;
  handicap: number;
  setHandicap: (h: number) => void;
  goal: 'break100' | 'break90' | 'break80' | 'enjoy' | null;
  setGoal: (goal: 'break100' | 'break90' | 'break80' | 'enjoy') => void;
  isGuest: boolean;
  setIsGuest: (value: boolean) => void;
  hasSeenIntro: boolean;
  setHasSeenIntro: (value: boolean) => void;
  onboardingComplete: boolean;
  setOnboardingComplete: (value: boolean) => void;
  course: string | null;
  setCourse: (course: string) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      name: 'You',
      setName: (name) => set({ name }),
      firstName: '',
      setFirstName: (firstName) => set({ firstName }),
      lastName: '',
      setLastName: (lastName) => set({ lastName }),
      displayName: '',
      setDisplayName: (displayName) => set({ displayName }),
      handicap: 0,
      setHandicap: (h) => set({ handicap: h }),
      goal: null,
      setGoal: (goal) => set({ goal }),
      isGuest: false,
      setIsGuest: (value) => set({ isGuest: value }),
      hasSeenIntro: false,
      setHasSeenIntro: (value) => set({ hasSeenIntro: value }),
      onboardingComplete: false,
      setOnboardingComplete: (value) => set({ onboardingComplete: value }),
      course: null,
      setCourse: (course) => set({ course }),
    }),
    {
      name: 'smartplay-user',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ hasSeenIntro: state.hasSeenIntro, onboardingComplete: state.onboardingComplete, goal: state.goal, name: state.name, firstName: state.firstName, lastName: state.lastName, displayName: state.displayName, handicap: state.handicap }),
    }
  )
);
