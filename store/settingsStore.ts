import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── STATE ────────────────────────────────

interface SettingsState {
  voiceEnabled: boolean;
  voiceGender: 'male' | 'female';
  language: 'en' | 'es' | 'zh';
  discreteMode: boolean;
  responseMode: 'short' | 'neutral' | 'detailed';
  caddiePersonality: 'kevin' | 'serena';

  highContrast: boolean;
  brightMode: boolean;
  castMode: boolean;

  watchConnected: boolean;
  glassesConnected: boolean;

  tutorialsSeen: Record<string, boolean>;

  // ─── ACTIONS ────────────────────────────

  setVoiceEnabled: (v: boolean) => void;
  setVoiceGender: (g: 'male' | 'female') => void;
  setLanguage: (l: 'en' | 'es' | 'zh') => void;
  setDiscreteMode: (v: boolean) => void;
  setResponseMode: (m: 'short' | 'neutral' | 'detailed') => void;
  setCaddiePersonality: (p: 'kevin' | 'serena') => void;
  setHighContrast: (v: boolean) => void;
  setBrightMode: (v: boolean) => void;
  setCastMode: (v: boolean) => void;
  setWatchConnected: (v: boolean) => void;
  setGlassesConnected: (v: boolean) => void;
  markTutorialSeen: (key: string) => void;
  resetTutorials: () => void;
}

// ─── STORE ────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      voiceEnabled: true,
      voiceGender: 'male',
      language: 'en',
      discreteMode: false,
      responseMode: 'neutral',
      caddiePersonality: 'kevin',
      highContrast: false,
      brightMode: false,
      castMode: false,
      watchConnected: false,
      glassesConnected: false,
      tutorialsSeen: {},

      setVoiceEnabled: (v) => set({ voiceEnabled: v }),
      setVoiceGender: (g) => set({ voiceGender: g }),
      setLanguage: (l) => set({ language: l }),
      setDiscreteMode: (v) => set({ discreteMode: v }),
      setResponseMode: (m) => set({ responseMode: m }),
      setCaddiePersonality: (p) => set({ caddiePersonality: p }),
      setHighContrast: (v) => set({ highContrast: v }),
      setBrightMode: (v) => set({ brightMode: v }),
      setCastMode: (v) => set({ castMode: v }),
      setWatchConnected: (v) => set({ watchConnected: v }),
      setGlassesConnected: (v) => set({ glassesConnected: v }),
      markTutorialSeen: (key) =>
        set(s => ({ tutorialsSeen: { ...s.tutorialsSeen, [key]: true } })),
      resetTutorials: () => set({ tutorialsSeen: {} }),
    }),
    {
      name: 'settings-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        voiceEnabled: s.voiceEnabled,
        voiceGender: s.voiceGender,
        language: s.language,
        discreteMode: s.discreteMode,
        responseMode: s.responseMode,
        caddiePersonality: s.caddiePersonality,
        highContrast: s.highContrast,
        brightMode: s.brightMode,
        castMode: s.castMode,
        tutorialsSeen: s.tutorialsSeen,
        // watchConnected / glassesConnected not persisted — rechecked on mount
      }),
    },
  ),
);
