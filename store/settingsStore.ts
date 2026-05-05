import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Phase 105 — Team Caddie Architecture ─────────────────────────────────────

export type Persona = 'kevin' | 'serena' | 'harry' | 'tank';
export type CaddiePillar = 'round' | 'cage' | 'drills' | 'play';

// Per-pillar default assignments. The user can override any pillar in Settings.
// Defaults reflect each caddie's natural fit.
export const DEFAULT_CADDIE_ASSIGNMENTS: Record<CaddiePillar, Persona> = {
  round: 'kevin',   // steady conversational companion on the course
  cage: 'tank',     // intensity + standards in cage practice
  drills: 'serena', // measured professional for technical drill work
  play: 'kevin',    // balanced companion for Arena / fun gameplay
};

export type CaddieAssignments = Record<CaddiePillar, Persona>;

// ─── STATE ────────────────────────────────

interface SettingsState {
  voiceEnabled: boolean;
  voiceGender: 'male' | 'female';
  language: 'en' | 'es' | 'zh';
  discreteMode: boolean;
  responseMode: 'short' | 'neutral' | 'detailed';
  // Phase 105 — single caddiePersonality is preserved as the "current
  // primary persona" used by surfaces that pre-date the team architecture
  // (greeting, intro, tools menu cycler). New per-pillar usage should
  // call getActiveCaddie(pillar) via services/caddieResolver instead.
  caddiePersonality: Persona;
  // Phase 105 — per-pillar caddie assignments. Defaults applied on first
  // launch; existing users with only caddiePersonality migrate at hydrate
  // (see persist `migrate` callback below).
  caddieAssignments: CaddieAssignments;
  // Phase 106 — caddie team handoff suggestions.
  // 'on'   = caddies offer suggestions verbally + visually (default)
  // 'soft' = visual card only, no voice interruption
  // 'off'  = no suggestions, user controls all assignments manually
  caddieSuggestions: 'on' | 'soft' | 'off';

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
  // Phase BL — auto club recognition during cage practice. When true,
  // the cage session shows the "ID club" camera button and accepts
  // voice intents like "switching to 6-iron". When false, only the
  // manual tap-grid picker is exposed. Voice intents still parse the
  // utterance but show the manual picker instead of registering.
  cageAutoClubDetection: boolean;

  // ─── ACTIONS ────────────────────────────

  setVoiceEnabled: (v: boolean) => void;
  setVoiceGender: (g: 'male' | 'female') => void;
  setLanguage: (l: 'en' | 'es' | 'zh') => void;
  setDiscreteMode: (v: boolean) => void;
  setResponseMode: (m: 'short' | 'neutral' | 'detailed') => void;
  setCaddiePersonality: (p: Persona) => void;
  // Phase 105 — assign / read per-pillar caddie. setCaddieForPillar updates
  // one pillar; resetCaddieAssignments restores defaults.
  setCaddieForPillar: (pillar: CaddiePillar, p: Persona) => void;
  resetCaddieAssignments: () => void;
  setCaddieSuggestions: (mode: 'on' | 'soft' | 'off') => void;
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
  // Phase BL
  setCageAutoClubDetection: (v: boolean) => void;
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
      caddieAssignments: { ...DEFAULT_CADDIE_ASSIGNMENTS },
      caddieSuggestions: 'on' as const,
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
      cageAutoClubDetection: true,

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
      setCaddiePersonality: (p) => {
        // Persona is the source of truth. voiceGender stays in sync
        // because the TTS path (services/voiceService.speak → /api/voice
        // OpenAI fallback) still keys by gender for the OpenAI voice
        // selection. ElevenLabs voices are keyed by persona directly,
        // but the gender map remains the back-compat fallback.
        const prev = get().caddiePersonality;
        const gender = p === 'serena' ? 'female' : 'male';
        set({ caddiePersonality: p, voiceGender: gender });
        // Persona switch invalidates the persona-keyed audio caches so
        // the user doesn't keep hearing the prior caddie's filler clips
        // or a cached briefing in the prior caddie's voice. Dynamic
        // require avoids module-load cycles.
        if (prev !== p) {
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
      setCageAutoClubDetection: (v) => set({ cageAutoClubDetection: v }),
      // Phase 105 — per-pillar assignment.
      setCaddieForPillar: (pillar, p) => set((s) => ({
        caddieAssignments: { ...s.caddieAssignments, [pillar]: p },
      })),
      resetCaddieAssignments: () => set({
        caddieAssignments: { ...DEFAULT_CADDIE_ASSIGNMENTS },
      }),
      setCaddieSuggestions: (mode) => set({ caddieSuggestions: mode }),
    }),
    {
      name: 'settings-store-v2',
      storage: createJSONStorage(() => AsyncStorage),
      // Phase 105 — bumped to v3 to add caddieAssignments. v2 (and earlier)
      // payloads only carry caddiePersonality; the migrate fn seeds all
      // four pillars to that prior single value so the user's preference
      // is preserved across the restructure. After migration the user
      // can customize per pillar in Settings.
      version: 3,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<SettingsState> & {
          caddiePersonality?: Persona;
          caddieAssignments?: CaddieAssignments;
        };
        if (version < 3 && !p.caddieAssignments) {
          const prior: Persona = p.caddiePersonality ?? 'kevin';
          p.caddieAssignments = {
            round: prior,
            cage: prior,
            drills: prior,
            play: prior,
          };
        }
        return p as SettingsState;
      },
      partialize: (s) => ({
        voiceEnabled: s.voiceEnabled,
        voiceGender: s.voiceGender,
        language: s.language,
        discreteMode: s.discreteMode,
        responseMode: s.responseMode,
        caddiePersonality: s.caddiePersonality,
        caddieAssignments: s.caddieAssignments,
        caddieSuggestions: s.caddieSuggestions,
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
        cageAutoClubDetection: s.cageAutoClubDetection,
        // watchConnected / glassesConnected not persisted — rechecked on mount
      }),
    },
  ),
);
