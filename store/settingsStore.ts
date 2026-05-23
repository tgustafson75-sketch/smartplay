import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

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
  // Phase 107 — dev overlay showing live GPS accuracy + mode in the
  // top-left during round-active. Default false (only Tim turns it on
  // for the Garmin comparison test).
  gpsQualityDebugOverlay: boolean;

  theme_preference: 'system' | 'light' | 'dark';
  highContrast: boolean;
  brightMode: boolean;
  castMode: boolean;
  // PGA HOPE follow-up (A1) — when true, BrightMode also bumps text scale
  // and forces icon-button labels to render so low-vision users don't
  // operate the app from muscle memory alone.
  largeText: boolean;
  // PGA HOPE follow-up (A2) — pin TTS captions during voice playback so
  // hearing-impaired participants don't lose the persona-swap handoff
  // line. Defaults true; users can hide if they want a chrome-free UI.
  ttsCaptions: boolean;
  // Re-sim P1 polish — first-time Bluetooth-detected caption surfacing
  // asks once, persists the choice (or 'never' for don't-ask). Avoids
  // silently flipping ttsCaptions on/off as the user pairs/unpairs.
  ttsCaptionsBluetoothPrompt: 'unasked' | 'asked' | 'never';
  // PGA HOPE follow-up (A3) — sequence the round-briefing into one card
  // at a time instead of the all-at-once long-scroll. Lower cognitive
  // load for TBI / first-time users. Mixed-cohort re-sim revealed
  // gen-pop "I want to play, not learn the app" preference too — so
  // this defaults TRUE for the first 5 rounds (auto via getEffectiveSimpleBriefing
  // which checks roundsTogether) unless the user explicitly opts out.
  simpleBriefing: boolean;
  // Sticks once the user toggles the row in Settings either way; gates
  // the "auto-on for first 5 rounds" behavior so an explicit choice
  // always wins over the heuristic.
  simpleBriefingUserTouched: boolean;
  // PGA HOPE follow-up (A5) — per-persona TTS intensity 0..100. Drives
  // playback volume and is forwarded to system prompts so the model
  // can match cadence to the dial. Default Tank=70 (sound-sensitive
  // default), others=100.
  personaIntensity: Record<Persona, number>;
  // PGA HOPE follow-up (Tank softening) — when true, Tank's first
  // utterance with a player drops Marine cadence + signature phrases
  // and uses a neutral introduction. Auto-clears after the player has
  // accepted Tank for at least one full session.
  tankSoftIntro: boolean;

  // 2026-05-21 — Consolidation 1 / Merge C: watchConnected moved to
  // the dedicated watchStore (store/watchStore.ts) so the
  // Settings display, Cage Mode result card, and the upcoming
  // native SDK all share one source of truth. Removed from this
  // store. See also the migrate() block below which strips the
  // field on hydration of persisted state from prior versions.
  glassesConnected: boolean;
  autoListenEnabled: boolean;
  skip_briefings: boolean;
  proactive_kevin_enabled: boolean;
  /** When true, GPS shot detection switches to cart-friendly thresholds —
   *  shorter stationary window (~8s) and current-speed-only suppression
   *  so a sustained cart drive doesn't gate detection forever. */
  cartMode: boolean;
  /** 2026-05-22 — Fix T. When true, holeDetection's polling can auto-call
   *  setCurrentHole on the player's behalf. When false (DEFAULT), the
   *  player manually advances via cockpit stepper / DataStrip arrows /
   *  voice. Auto-advance was racing ahead on real Menifee Palms rounds
   *  (1→3→4 climbing on its own); manual is the safe default. */
  autoHoleAdvance: boolean;
  /** 2026-05-22 — Fix T. When true, shotDetectionService runs during a
   *  round and auto-logs swings via GPS displacement signature. When
   *  false (DEFAULT), the player enters scores manually via stepper /
   *  voice ("I made a 5"). STROKE count then reflects the player's
   *  manual score, not derived from auto-detected shots. */
  autoShotDetection: boolean;
  // 2026-05-17 — Phase 413 — Health Connect just-in-time permission
  // marker. Set to true the first time we ask (whether granted or
  // declined or Health Connect unavailable). Prevents re-asking on
  // every round start. User can clear it from Settings → Health Data
  // → "Re-ask on next round" if they want to grant later.
  hasAskedHealthPermission: boolean;
  /** User-controlled toggle: when on, the active round queries Health
   *  Connect at round-end to attach steps/HR/distance to the
   *  RoundRecord and to inform walking-vs-cart detection. Default true
   *  on Android; iOS users see it disabled with explanatory copy. */
  healthDataEnabled: boolean;
  distance_unit: 'yards' | 'meters';

  tutorialsSeen: Record<string, boolean>;
  // 2026-05-21 — Fix D: per-screen intro open counter. Used to
  // auto-suppress the SmartMotion / Cage Mode 3-line caddie intro
  // after the user has seen it a few times. Keyed by intro slug
  // (e.g. 'smartmotion', 'cage_mode'). Persisted via the standard
  // settings rehydration path so opens carry across launches.
  introOpens: Record<string, number>;
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

  // Phase Cockpit — opt-in alternate Caddie tab layout (v3-style:
  // brand header + HOLE/SHOTS/PUTTS stepper + big SmartFinder card +
  // Vision/Motion/Play/Settings pill row + Tap-to-Ask pill + manual
  // SHOT RESULT backup entry + caddie advice). Defaults false so Full
  // Mode stays the out-of-box experience for everyone. Pure render-path
  // switch — voice plumbing is shared with Full Mode (no remount, no
  // audio interruption when flipped).
  cockpitMode: boolean;

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
  setGpsQualityDebugOverlay: (v: boolean) => void;
  setThemePreference: (p: 'system' | 'light' | 'dark') => void;
  setHighContrast: (v: boolean) => void;
  setBrightMode: (v: boolean) => void;
  setCastMode: (v: boolean) => void;
  setLargeText: (v: boolean) => void;
  setTtsCaptions: (v: boolean) => void;
  setTtsCaptionsBluetoothPrompt: (v: 'unasked' | 'asked' | 'never') => void;
  setSimpleBriefing: (v: boolean) => void;
  setPersonaIntensity: (p: Persona, v: number) => void;
  setTankSoftIntro: (v: boolean) => void;
  // setWatchConnected moved to watchStore.setConnected (Consolidation 1 / Merge C).
  setGlassesConnected: (v: boolean) => void;
  setAutoListenEnabled: (v: boolean) => void;
  setCartMode: (v: boolean) => void;
  // 2026-05-22 — Fix T.
  setAutoHoleAdvance: (v: boolean) => void;
  setAutoShotDetection: (v: boolean) => void;
  setHasAskedHealthPermission: (v: boolean) => void;
  setHealthDataEnabled: (v: boolean) => void;
  setSkipBriefings: (v: boolean) => void;
  setProactiveKevinEnabled: (v: boolean) => void;
  setDistanceUnit: (u: 'yards' | 'meters') => void;
  markTutorialSeen: (key: string) => void;
  incrementIntroOpen: (key: string) => void;
  resetTutorials: () => void;
  setFillerEnabled: (v: boolean) => void;
  setEarbudTapToTalk: (v: boolean) => void;
  setVoiceOnPhoneSpeaker: (v: boolean) => void;
  setKevinGreetingEnabled: (v: boolean) => void;
  setSmartVisionImagery: (v: 'curated' | 'gps' | 'auto') => void;
  setYardageMode: (v: 'live' | 'preround') => void;
  // Phase BL
  setCageAutoClubDetection: (v: boolean) => void;
  // Phase Cockpit
  setCockpitMode: (v: boolean) => void;
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
      gpsQualityDebugOverlay: false,
      theme_preference: 'system' as const,
      highContrast: false,
      brightMode: false,
      castMode: false,
      largeText: false,
      ttsCaptions: true,
      ttsCaptionsBluetoothPrompt: 'unasked' as const,
      // Re-sim P0 #1 — default true; auto-clears via the getEffectiveSimpleBriefing
      // helper after the player has 5+ completed rounds, unless they've
      // explicitly toggled it.
      simpleBriefing: true,
      simpleBriefingUserTouched: false,
      // Re-sim P2 — Harry default 100 → 90 (was a touch loud in carts for
      // multiple players). Tank stays 70 (sound-sensitive default).
      // Note: Harry is soft-removed from active UI (see lib/persona.ts
      // ACTIVE_PERSONAS) but the intensity entry stays so flipping him
      // back active is a single-line edit.
      personaIntensity: { kevin: 100, serena: 100, harry: 90, tank: 70 },
      tankSoftIntro: true,
      glassesConnected: false,
      autoListenEnabled: false,
      // 2026-05-22 — Cart-is-default product principle: ~95% of golfers
      // ride. Default cartMode TRUE so new installs get cart-aware shot
      // thresholds + Fix L's cart-mode hole-detection bonus without
      // needing to touch Settings. Walking users flip to OFF once and
      // their preference persists. Existing users' persisted value
      // (whatever they previously had) wins via the persist middleware.
      cartMode: true,
      // 2026-05-22 — Fix T (TOP PRIORITY after two real rounds at Menifee).
      // Auto hole-advance + auto-shot-detection were racing ahead of the
      // player (1→3→4 climbing on its own). The Fix L threshold tightening
      // tonight wasn't enough — the only correct answer on real cart
      // courses is to put the player in full manual control. GPS keeps
      // driving live yardages on the current hole; everything ELSE
      // (which hole, what stroke count) is the player's call via
      // cockpit stepper, DataStrip ◀/▶ arrows, or voice ("I'm on hole 4"
      // / "I made a 5"). Both default FALSE — auto features are opt-in
      // for the few users who actually want them.
      autoHoleAdvance: false,
      autoShotDetection: false,
      hasAskedHealthPermission: false,
      healthDataEnabled: true,
      skip_briefings: false,
      proactive_kevin_enabled: true,
      distance_unit: 'yards' as const,
      tutorialsSeen: {},
      introOpens: {},
      fillerEnabled: true,
      earbudTapToTalk: true,
      voiceOnPhoneSpeaker: true,
      kevinGreetingEnabled: true,
      smartVisionImagery: 'auto' as const,
      yardageMode: 'live' as const,
      cageAutoClubDetection: true,
      cockpitMode: false,

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
        // 2026-05-21 — Fix Q (Path B): global persona is the single source
        // of truth. Setting it ALSO resets every per-pillar assignment to
        // the same persona so the per-pillar map can never silently
        // contradict the user's global selection ("pick Serena, hear
        // Kevin" — the bleed). Power users can still set a per-pillar
        // override AFTER this via setCaddieForPillar; that's the only way
        // a pillar can differ from global.
        //
        // Persona is the source of truth. voiceGender stays in sync
        // because the TTS path (services/voiceService.speak → /api/voice
        // OpenAI fallback) still keys by gender for the OpenAI voice
        // selection. ElevenLabs voices are keyed by persona directly,
        // but the gender map remains the back-compat fallback.
        const prev = get().caddiePersonality;
        const gender = p === 'serena' ? 'female' : 'male';
        // Defensive voice-race guard (sim-202 follow-up): any caller that
        // flips persona without first stopping in-flight TTS would
        // otherwise leak the prior caddie's voice into the new persona's
        // first utterance. Stop here too so the store invariant holds
        // regardless of caller. Dynamic require avoids the layout/store
        // import cycle.
        if (prev !== p) {
          try {
            const voiceMod = require('../services/voiceService');
            voiceMod.stopSpeaking?.()?.catch?.(() => {});
          } catch { /* ignore */ }
        }
        set({
          caddiePersonality: p,
          voiceGender: gender,
          caddieAssignments: { round: p, cage: p, drills: p, play: p },
        });
        // 2026-05-19 — Persona handoff welcome. When the active caddie
        // changes (manual or via team handoff), the new persona should
        // briefly introduce themselves so the user knows who's on the
        // bag now. userInitiated:true so it bypasses L1 Quiet's
        // scripted-speech gate — switching caddies IS a user-initiated
        // action. 500ms delay lets the prior caddie's stopSpeaking
        // settle before the new voice fires.
        if (prev !== p) {
          const intros: Record<string, string> = {
            kevin: "Hey, Kevin back on the bag. Let's go.",
            serena: "Hi, Serena here. Let's read this together.",
            tank: "Tank stepping in. We're locked in.",
            harry: "Harry here. Show me what you've got.",
          };
          const text = intros[p] ?? `${p} stepping in.`;
          setTimeout(() => {
            try {
              const voiceMod = require('../services/voiceService');
              const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
              const lang = get().language ?? 'en';
              voiceMod.speak?.(text, gender, lang, apiUrl, { userInitiated: true })
                ?.catch?.((e: unknown) => console.log('[persona-handoff] speak failed', e));
            } catch (e) {
              console.log('[persona-handoff] speak setup failed', e);
            }
          }, 500);
        }
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
      setLargeText: (v) => set({ largeText: v }),
      setTtsCaptions: (v) => set({ ttsCaptions: v }),
      setTtsCaptionsBluetoothPrompt: (v) => set({ ttsCaptionsBluetoothPrompt: v }),
      setSimpleBriefing: (v) => set({ simpleBriefing: v, simpleBriefingUserTouched: true }),
      setPersonaIntensity: (p, v) => set((s) => ({
        personaIntensity: {
          ...s.personaIntensity,
          [p]: Math.max(0, Math.min(100, Math.round(v))),
        },
      })),
      setTankSoftIntro: (v) => set({ tankSoftIntro: v }),
      setGlassesConnected: (v) => set({ glassesConnected: v }),
      setAutoListenEnabled: (v) => set({ autoListenEnabled: v }),
      setCartMode: (v) => set({ cartMode: v }),
      // 2026-05-22 — Fix T setters.
      setAutoHoleAdvance: (v) => set({ autoHoleAdvance: v }),
      setAutoShotDetection: (v) => set({ autoShotDetection: v }),
      setHasAskedHealthPermission: (v) => set({ hasAskedHealthPermission: v }),
      setHealthDataEnabled: (v) => set({ healthDataEnabled: v }),
      setSkipBriefings: (v) => set({ skip_briefings: v }),
      setProactiveKevinEnabled: (v) => set({ proactive_kevin_enabled: v }),
      setDistanceUnit: (u) => set({ distance_unit: u }),
      markTutorialSeen: (key) =>
        set(s => ({ tutorialsSeen: { ...s.tutorialsSeen, [key]: true } })),
      incrementIntroOpen: (key) =>
        set(s => ({
          introOpens: { ...s.introOpens, [key]: (s.introOpens?.[key] ?? 0) + 1 },
        })),
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
      setCockpitMode: (v) => set({ cockpitMode: v }),
      // Phase 105 — per-pillar assignment.
      setCaddieForPillar: (pillar, p) => set((s) => ({
        caddieAssignments: { ...s.caddieAssignments, [pillar]: p },
      })),
      resetCaddieAssignments: () => set({
        caddieAssignments: { ...DEFAULT_CADDIE_ASSIGNMENTS },
      }),
      setCaddieSuggestions: (mode) => set({ caddieSuggestions: mode }),
      setGpsQualityDebugOverlay: (v) => set({ gpsQualityDebugOverlay: v }),
    }),
    {
      name: 'settings-store-v2',
      storage: createJSONStorage(() => getPersistStorage()),
      // Phase 105 — bumped to v3 to add caddieAssignments. v2 (and earlier)
      // payloads only carry caddiePersonality; the migrate fn seeds all
      // four pillars to that prior single value so the user's preference
      // is preserved across the restructure. After migration the user
      // can customize per pillar in Settings.
      version: 7,
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
        // PGA HOPE follow-up — seed accessibility + per-persona intensity
        // defaults for users on v3 payloads.
        if (version < 4) {
          if (p.largeText == null) p.largeText = false;
          if (p.ttsCaptions == null) p.ttsCaptions = true;
          if (p.simpleBriefing == null) p.simpleBriefing = false;
          if (p.tankSoftIntro == null) p.tankSoftIntro = true;
          if (p.personaIntensity == null) {
            p.personaIntensity = { kevin: 100, serena: 100, harry: 100, tank: 70 };
          }
        }
        // Re-sim P0 #1 + P2 — auto-on simpleBriefing for new users
        // and lower Harry default. Existing users keep whatever they had;
        // only seed the new userTouched flag (true so existing users
        // don't suddenly get auto-on flipped on them).
        if (version < 5) {
          if (p.simpleBriefingUserTouched == null) p.simpleBriefingUserTouched = true;
          if (p.personaIntensity?.harry === 100) {
            p.personaIntensity = { ...p.personaIntensity, harry: 90 };
          }
          if (p.ttsCaptionsBluetoothPrompt == null) p.ttsCaptionsBluetoothPrompt = 'unasked';
        }
        // v6 — Harry soft-removed (overlaps Kevin's arc per Tim). Migrate
        // any persisted Harry assignment to Kevin so existing users on
        // 'harry' don't get stuck on a hidden persona. Re-enable: add
        // 'harry' back to ACTIVE_PERSONAS in lib/persona.ts.
        if (version < 6) {
          if (p.caddiePersonality === 'harry') p.caddiePersonality = 'kevin';
          if (p.caddieAssignments) {
            const reassigned: CaddieAssignments = { ...p.caddieAssignments };
            (Object.keys(reassigned) as CaddiePillar[]).forEach((pillar) => {
              if (reassigned[pillar] === 'harry') reassigned[pillar] = 'kevin';
            });
            p.caddieAssignments = reassigned;
          }
        }
        // v7 — flip voiceOnPhoneSpeaker default to TRUE for existing users.
        // The old default (false) silently blocked the caddie's voice
        // whenever the user wasn't paired to earbuds/glasses — a confusing
        // failure mode ("avatar acknowledges but doesn't speak"). New
        // default lets the phone speaker play voice; users who want to
        // mute on speaker can flip the toggle off in Settings → Voice.
        if (version < 7) {
          p.voiceOnPhoneSpeaker = true;
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
        gpsQualityDebugOverlay: s.gpsQualityDebugOverlay,
        theme_preference: s.theme_preference,
        highContrast: s.highContrast,
        brightMode: s.brightMode,
        castMode: s.castMode,
        largeText: s.largeText,
        ttsCaptions: s.ttsCaptions,
        ttsCaptionsBluetoothPrompt: s.ttsCaptionsBluetoothPrompt,
        simpleBriefing: s.simpleBriefing,
        simpleBriefingUserTouched: s.simpleBriefingUserTouched,
        personaIntensity: s.personaIntensity,
        tankSoftIntro: s.tankSoftIntro,
        autoListenEnabled: s.autoListenEnabled,
        cartMode: s.cartMode,
        autoHoleAdvance: s.autoHoleAdvance,
        autoShotDetection: s.autoShotDetection,
        // 2026-05-17 — audit B P0: both health-permission flags were
        // missing from partialize, so every cold launch re-asked for
        // Health Connect access on the first round-start. Persisted
        // now so the JIT ask happens once per device install.
        hasAskedHealthPermission: s.hasAskedHealthPermission,
        healthDataEnabled: s.healthDataEnabled,
        skip_briefings: s.skip_briefings,
        proactive_kevin_enabled: s.proactive_kevin_enabled,
        distance_unit: s.distance_unit,
        tutorialsSeen: s.tutorialsSeen,
        introOpens: s.introOpens,
        fillerEnabled: s.fillerEnabled,
        earbudTapToTalk: s.earbudTapToTalk,
        voiceOnPhoneSpeaker: s.voiceOnPhoneSpeaker,
        kevinGreetingEnabled: s.kevinGreetingEnabled,
        smartVisionImagery: s.smartVisionImagery,
        yardageMode: s.yardageMode,
        cageAutoClubDetection: s.cageAutoClubDetection,
        cockpitMode: s.cockpitMode,
        // watchConnected / glassesConnected not persisted — rechecked on mount
      }),
    },
  ),
);

/**
 * Re-sim P0 #1 — effective simpleBriefing combines explicit user choice
 * with an auto-on heuristic for the first 5 rounds. The mixed-cohort
 * re-sim showed gen-pop "I want to play, not learn the app" players
 * benefit from sequenced briefings the same as adaptive HOPE players,
 * so we default it on and let the player opt out once they're settled.
 *
 *   - Explicit ON  → on (always)
 *   - Explicit OFF (userTouched=true) → off (always)
 *   - Default ON + roundsTogether < 5 → on
 *   - Default ON + roundsTogether >= 5 → off (auto-clears at round 5)
 */
export function getEffectiveSimpleBriefing(roundsTogether: number): boolean {
  const s = useSettingsStore.getState();
  if (s.simpleBriefingUserTouched) return s.simpleBriefing;
  // Default-on heuristic: first 5 rounds get the simpler flow.
  if (roundsTogether < 5) return true;
  return s.simpleBriefing;
}
