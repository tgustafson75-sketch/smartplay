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

  theme_preference: 'system' | 'light' | 'dark';
  highContrast: boolean;
  brightMode: boolean;
  castMode: boolean;

  watchConnected: boolean;
  glassesConnected: boolean;
  autoListenEnabled: boolean;
  skip_briefings: boolean;
  proactive_kevin_enabled: boolean;
  distance_unit: 'yards' | 'meters';

  tutorialsSeen: Record<string, boolean>;
  fillerEnabled: boolean;
  // Phase O — earbud tap-to-talk control
  earbudTapToTalk: boolean;
  voiceOnPhoneSpeaker: boolean;
  kevinGreetingEnabled: boolean;
  // Phase AW — SmartVision imagery source.
  // 'curated' = bundled hole screenshots (always works, no GPS required).
  // 'gps'     = live Mapbox satellite tile + draggable F/M/B markers
  //             (requires hole geometry with tee+green coords).
  // 'auto'    = use 'gps' when geometry available, fall back to 'curated'.
  smartVisionImagery: 'curated' | 'gps' | 'auto';
  // Phase AY — yardage source. 'live' uses GPS-driven calculations.
  // 'preround' uses static courseHoles values (good for planning before
  // Start Round, or as a manual fallback if GPS gets stale and the user
  // wants to fall back to the scorecard's nominal numbers). Toggling
  // back to 'live' fires a fresh GPS read (synthetic Mark) so the
  // current position re-anchors the live yardages.
  yardageMode: 'live' | 'preround';

  // ─── ACTIONS ────────────────────────────

  setVoiceEnabled: (v: boolean) => void;
  setVoiceGender: (g: 'male' | 'female') => void;
  setLanguage: (l: 'en' | 'es' | 'zh') => void;
  setDiscreteMode: (v: boolean) => void;
  setResponseMode: (m: 'short' | 'neutral' | 'detailed') => void;
  setCaddiePersonality: (p: 'kevin' | 'serena') => void;
  setThemePreference: (p: 'system' | 'light' | 'dark') => void;
  setHighContrast: (v: boolean) => void;
  setBrightMode: (v: boolean) => void;
  setCastMode: (v: boolean) => void;
  setWatchConnected: (v: boolean) => void;
  setGlassesConnected: (v: boolean) => void;
  setAutoListenEnabled: (v: boolean) => void;
  setSkipBriefings: (v: boolean) => void;
  setProactiveKevinEnabled: (v: boolean) => void;
  setDistanceUnit: (u: 'yards' | 'meters') => void;
  markTutorialSeen: (key: string) => void;
  resetTutorials: () => void;
  setFillerEnabled: (v: boolean) => void;
  setEarbudTapToTalk: (v: boolean) => void;
  setVoiceOnPhoneSpeaker: (v: boolean) => void;
  setKevinGreetingEnabled: (v: boolean) => void;
  setSmartVisionImagery: (v: 'curated' | 'gps' | 'auto') => void;
  setYardageMode: (v: 'live' | 'preround') => void;
}

// ─── STORE ────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      voiceEnabled: true,
      voiceGender: 'male',
      language: 'en',
      discreteMode: false,
      responseMode: 'neutral',
      caddiePersonality: 'kevin',
      theme_preference: 'system' as const,
      highContrast: false,
      brightMode: false,
      castMode: false,
      watchConnected: false,
      glassesConnected: false,
      autoListenEnabled: false,
      skip_briefings: false,
      proactive_kevin_enabled: true,
      distance_unit: 'yards' as const,
      tutorialsSeen: {},
      fillerEnabled: true,
      earbudTapToTalk: true,
      voiceOnPhoneSpeaker: false,
      kevinGreetingEnabled: true,
      smartVisionImagery: 'auto' as const,
      yardageMode: 'live' as const,

      setVoiceEnabled: (v) => set({ voiceEnabled: v }),
      setVoiceGender: (g) => set({ voiceGender: g }),
      setLanguage: (l) => {
        const prev = get().language;
        set({ language: l });
        // Phase V.7+ — invalidate audio caches keyed by language so the user
        // doesn't hear the prior language's filler clips or a cached briefing
        // until next app boot. Dynamic require avoids module-load cycles
        // (settingsStore is imported by both fillerLibrary and briefingGenerator).
        if (prev !== l) {
          try {
            const fillerMod = require('../services/fillerLibrary');
            void fillerMod.clearLibrary?.().catch?.(() => {});
          } catch { /* ignore */ }
          try {
            const briefMod = require('../services/briefingGenerator');
            briefMod.clearBriefingCache?.();
          } catch { /* ignore */ }
        }
      },
      setDiscreteMode: (v) => set({ discreteMode: v }),
      setResponseMode: (m) => set({ responseMode: m }),
      setCaddiePersonality: (p) => set({ caddiePersonality: p }),
      setThemePreference: (p) => set({ theme_preference: p }),
      setHighContrast: (v) => set({ highContrast: v }),
      setBrightMode: (v) => set({ brightMode: v }),
      setCastMode: (v) => set({ castMode: v }),
      setWatchConnected: (v) => set({ watchConnected: v }),
      setGlassesConnected: (v) => set({ glassesConnected: v }),
      setAutoListenEnabled: (v) => set({ autoListenEnabled: v }),
      setSkipBriefings: (v) => set({ skip_briefings: v }),
      setProactiveKevinEnabled: (v) => set({ proactive_kevin_enabled: v }),
      setDistanceUnit: (u) => set({ distance_unit: u }),
      markTutorialSeen: (key) =>
        set(s => ({ tutorialsSeen: { ...s.tutorialsSeen, [key]: true } })),
      resetTutorials: () => set({ tutorialsSeen: {} }),
      setFillerEnabled: (v) => set({ fillerEnabled: v }),
      setEarbudTapToTalk: (v) => set({ earbudTapToTalk: v }),
      setVoiceOnPhoneSpeaker: (v) => set({ voiceOnPhoneSpeaker: v }),
      setKevinGreetingEnabled: (v) => set({ kevinGreetingEnabled: v }),
      setSmartVisionImagery: (v) => set({ smartVisionImagery: v }),
      setYardageMode: (v) => {
        const prev = get().yardageMode;
        set({ yardageMode: v });
        // When flipping back to 'live', fire a fresh GPS read so live
        // yardages re-anchor to the user's actual position. Acts as a
        // manual fallback for the Mark button when GPS goes stale.
        if (prev === 'preround' && v === 'live') {
          (async () => {
            try {
              const sf = await import('../services/smartFinderService');
              await sf.refreshFix();
              const bus = await import('../services/positionMarkBus');
              await bus.forceMarkPosition().catch(() => {});
            } catch (e) { console.log('[settings] yardageMode live refresh failed:', e); }
          })();
        }
      },
    }),
    {
      name: 'settings-store-v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        voiceEnabled: s.voiceEnabled,
        voiceGender: s.voiceGender,
        language: s.language,
        discreteMode: s.discreteMode,
        responseMode: s.responseMode,
        caddiePersonality: s.caddiePersonality,
        theme_preference: s.theme_preference,
        highContrast: s.highContrast,
        brightMode: s.brightMode,
        castMode: s.castMode,
        autoListenEnabled: s.autoListenEnabled,
        skip_briefings: s.skip_briefings,
        proactive_kevin_enabled: s.proactive_kevin_enabled,
        distance_unit: s.distance_unit,
        tutorialsSeen: s.tutorialsSeen,
        fillerEnabled: s.fillerEnabled,
        earbudTapToTalk: s.earbudTapToTalk,
        voiceOnPhoneSpeaker: s.voiceOnPhoneSpeaker,
        kevinGreetingEnabled: s.kevinGreetingEnabled,
        smartVisionImagery: s.smartVisionImagery,
        yardageMode: s.yardageMode,
        // watchConnected / glassesConnected not persisted — rechecked on mount
      }),
    },
  ),
);
