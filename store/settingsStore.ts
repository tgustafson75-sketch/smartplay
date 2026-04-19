import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PlayerMode       = 'beginner' | 'break90' | 'break80';
export type RiskDefault      = 'safe' | 'neutral' | 'attack';
export type VoiceStyle       = 'calm' | 'aggressive';
export type VoiceGender      = 'male' | 'female';
export type ResponseMode     = 'short' | 'neutral' | 'detailed';
export type CaddiePersonality = 'calm' | 'aggressive' | 'coach';

interface SettingsState {
  // Voice
  voiceEnabled:  boolean;
  setVoiceEnabled: (v: boolean) => void;
  voiceStyle:    VoiceStyle;
  setVoiceStyle: (s: VoiceStyle) => void;
  voiceGender:   VoiceGender;
  setVoiceGender: (g: VoiceGender) => void;

  // Player mode
  playerMode:    PlayerMode;
  setPlayerMode: (m: PlayerMode) => void;

  // Risk default
  riskDefault:   RiskDefault;
  setRiskDefault: (r: RiskDefault) => void;

  // Display
  highContrast:  boolean;
  setHighContrast: (v: boolean) => void;
  brightMode:    boolean;
  setBrightMode: (v: boolean) => void;

  // Caddie personality
  caddiePersonality:    CaddiePersonality;
  setCaddiePersonality: (p: CaddiePersonality) => void;

  // Response verbosity
  responseMode:    ResponseMode;
  setResponseMode: (m: ResponseMode) => void;

  // Performance
  lowPowerMode:    boolean;
  setLowPowerMode: (v: boolean) => void;

  // SmartVision
  autoSmartVision:         boolean;
  setAutoSmartVision:      (v: boolean) => void;
  smartVisionSetupDone:    boolean;
  setSmartVisionSetupDone: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      voiceEnabled:    true,
      setVoiceEnabled: (v) => set({ voiceEnabled: v }),

      voiceStyle:      'calm',
      setVoiceStyle:   (s) => set({ voiceStyle: s }),

      voiceGender:     'male',
      setVoiceGender:  (g) => set({ voiceGender: g }),

      playerMode:      'beginner',
      setPlayerMode:   (m) => set({ playerMode: m }),

      riskDefault:     'neutral',
      setRiskDefault:  (r) => set({ riskDefault: r }),

      highContrast:    false,
      setHighContrast: (v) => set({ highContrast: v }),

      brightMode:      false,
      setBrightMode:   (v) => set({ brightMode: v }),

      caddiePersonality:    'calm',
      setCaddiePersonality: (p) => set({ caddiePersonality: p }),

      responseMode:    'short',
      setResponseMode: (m) => set({ responseMode: m }),

      lowPowerMode:    false,
      setLowPowerMode: (v) => set({ lowPowerMode: v }),

      autoSmartVision:         false,
      setAutoSmartVision:      (v) => set({ autoSmartVision: v }),
      smartVisionSetupDone:    false,
      setSmartVisionSetupDone: (v) => set({ smartVisionSetupDone: v }),
    }),
    {
      name: 'smartplay-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
