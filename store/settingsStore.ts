import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

// ─── Phase 105 — Team Caddie Architecture ─────────────────────────────────────

// 2026-06-06 — 'custom' is the user's self-generated caddie (selfie
// portrait + recorded clips + chosen name). Keep this union in sync
// with lib/persona.ts. See lib/persona.ts for the canonical maps;
// this duplicate type literal exists for back-compat with the
// existing intent-handler imports that already pull Persona from
// settingsStore.
export type Persona = 'kevin' | 'serena' | 'harry' | 'tank' | 'custom';
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
  /** 2026-05-28 — Fix FS: flipped true by onRehydrateStorage once
   *  AsyncStorage finishes loading the persisted state. Consumers that
   *  read persona/voice/language at boot (greeting audio kickoff, app
   *  _layout glassesMode pre-config, etc.) must gate on this to avoid
   *  reading the in-memory DEFAULTS while the persisted values are
   *  still on disk. See the long onRehydrateStorage comment below. */
  hasHydrated: boolean;
  /** 2026-05-30 — Fix FY: Local Mode.
   *
   *  Tim: "I would rather know and work in local mode than get
   *  frustrated or have my users get frustrated by quirky behavior."
   *
   *  When TRUE:
   *   - voiceService.speak() suppresses proactive utterances; only
   *     userInitiated:true (mic-tap responses, hero-moment confirmations)
   *     produces audio.
   *   - useVoiceCaddie tries a local nav-only intent classifier
   *     BEFORE the brain call ("open SmartMotion", "quiet mode",
   *     "resume") — zero network for those.
   *   - When the brain IS hit, the request body includes
   *     forceTier: 'TACTICAL' so api/kevin pins to Haiku 4.5 instead
   *     of classifyQuestion-driven Sonnet escalation. Faster, cheaper,
   *     less radio time.
   *   - A small leaf indicator appears next to the Tools pill so the
   *     user knows which mode they're in. Honest, not alarming.
   *
   *  What stays unchanged in Local Mode (deliberately not gated):
   *   - GPS cadence (already tiered; Tim: "GPS needs to be the first
   *     priority of working")
   *   - Yardage / hole navigation (GPS-dependent — high regression risk
   *     if local intent classifier got these wrong)
   *   - SmartMotion / Cage Mode (short sessions, full power fine)
   *   - Shot tracking, scorecard, course images (already local-only)
   *
   *  Defaults to false — opt-in toggle. */
  localMode: boolean;
  voiceEnabled: boolean;
  /** 2026-06-04 — Coach Mode toggle. When false, hides the "Coach X"
   *  pill on the Caddie tab and the Coach Mode CTA + shared-group card
   *  on the Dashboard. Default true so existing users with rosters keep
   *  the surface they already see. Tim: don't bury the toggle in
   *  Settings — surfaced in the Caddie-tab expandable actions row. */
  coachModeEnabled: boolean;
  voiceGender: 'male' | 'female';
  language: 'en' | 'es' | 'zh';
  /**
   * 2026-05-26 — Fix BE: Cecily Mode.
   *
   * Tim's granddaughter Cecily Rose (also Ceci / Cecily) likes to
   * talk to the caddy and has been helping test ES/EN switching.
   * When ON, the caddie:
   *   - Lets her ask about ANY topic (not just golf — favorite color,
   *     animals, why is the sky blue, etc.)
   *   - Responds warmly + briefly in age-appropriate language
   *   - Encourages her questions ("Great question, Cecily — ...")
   *   - Honors the active language setting (she's bilingual)
   *
   * Opt-in toggle, default false. Family adults (Bea / Lily /
   * Daniella) use the app normally — Cecily Mode is gated on the
   * explicit toggle so name-detection can't accidentally apply
   * kid-mode to anyone else.
   */
  cecilyMode: boolean;
  /**
   * 2026-05-26 — Fix AP Phase 2: Continuous Conversation Mode.
   *
   * Default OFF. When ON, the follow-up listen loop keeps the mic
   * open for additional turns even when the caddie's reply doesn't
   * end with a question mark. Lets the user have a sustained
   * back-and-forth ("teach me about lag", "how about wrist hinge",
   * "and what about tempo") without re-tapping the mic.
   *
   * Safety rails inside hooks/useVoiceCaddie.runFollowUpListenLoop:
   *   - Max 6 turns per session (cap on any single chain)
   *   - Max 120s wall-clock per session (cap on total open time)
   *   - Close-intent gate (isCloseIntent) ends the chain immediately
   *   - Silence twice in a row also ends the chain
   *
   * These ensure a hot-mic scenario (TV on in background, kid
   * babbling, etc.) can't loop indefinitely. Opt-in toggle so a
   * tester who hasn't asked for it sees zero behavior change.
   */
  continuousConversationMode: boolean;
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
  // 2026-05-24 v1.2.1 — Glasses Mode. Owner-gated toggle that pre-
  // configures the audio session for background Bluetooth (so audio
  // routes to Ray-Ban Meta or similar BT headset glasses while phone
  // is pocketed). Persisted. UI lives in Settings → Owner Tools.
  glassesMode: boolean;
  // 2026-05-24 — Feel-capture dataset (owner/dev tooling). When ON,
  // every captured swing's clip audio is transcribed via Whisper and
  // stored on the shot as feel_narration_transcript. Forms the
  // {clip, transcript, analysis} tuple set for future feel-vs-real
  // calibration. NEVER on by default — transcribing every user's
  // audio is a cost + privacy problem. Gated additionally on
  // isOwnerEmail at the call site so only the owner's testing
  // sessions produce data even if the flag leaks.
  feelCaptureEnabled: boolean;
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
  autoClubDetection: boolean;
  cageAutoClubDetection: boolean;
  hasSeenAutoClubPrompt: boolean;

  // 2026-05-22 — Ghost Rounds as first-class. When true (DEFAULT), startRound
  // auto-activates the most-recent prior round on the same course so the
  // player gets a "vs last time" comparison without needing to touch the
  // picker. The picker still wins when the user explicitly chose a ghost
  // in Round Setup. Voice intent "ghost off" / "ghost on" flips this.
  ghostAutoActivate: boolean;

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
  /** 2026-06-04 — Coach Mode toggle (see field above). */
  setCoachModeEnabled: (v: boolean) => void;
  /** 2026-05-30 — Fix FY: Local Mode toggle. */
  setLocalMode: (v: boolean) => void;
  setCecilyMode: (v: boolean) => void;
  setContinuousConversationMode: (v: boolean) => void;
  setVoiceGender: (g: 'male' | 'female') => void;
  setLanguage: (l: 'en' | 'es' | 'zh') => void;
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
  setGlassesMode: (v: boolean) => void;
  setFeelCaptureEnabled: (v: boolean) => void;
  setVoiceOnPhoneSpeaker: (v: boolean) => void;
  setKevinGreetingEnabled: (v: boolean) => void;
  setSmartVisionImagery: (v: 'curated' | 'gps' | 'auto') => void;
  setYardageMode: (v: 'live' | 'preround') => void;
  setAutoClubDetection: (v: boolean) => void;
  // Phase BL
  setCageAutoClubDetection: (v: boolean) => void;
  setHasSeenAutoClubPrompt: (v: boolean) => void;
  // Phase Cockpit
  setCockpitMode: (v: boolean) => void;
  // 2026-05-22 — Ghost Rounds.
  setGhostAutoActivate: (v: boolean) => void;
}

// ─── STORE ────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      voiceEnabled: true,
      // 2026-05-26 — Fix BE: default OFF. Opt-in only.
      cecilyMode: false,
      // 2026-05-26 — Fix AP Phase 2: default OFF. Opt-in only — safety
      // rails inside the loop handle bounded sessions, but a hot-mic
      // mode shouldn't surprise testers who didn't request it.
      continuousConversationMode: false,
      voiceGender: 'male',
      language: 'en',
      responseMode: 'neutral',
      // 2026-05-28 — Fix FS: hydration flag (see onRehydrateStorage below).
      // Defaults false; flipped true by the persist middleware once
      // AsyncStorage rehydration completes. Audio-kickoff paths (greeting,
      // boot-time persona reads) gate on this before reading caddie
      // settings to avoid the stale-defaults race.
      hasHydrated: false,
      // 2026-05-30 — Fix FY: Local Mode. Defaults false (opt-in).
      // Persisted via partialize so the user's choice survives restarts.
      localMode: false,
      // 2026-06-04 — Coach Mode toggle. Default OFF so the shared-
      // session pill doesn't crowd the brand logo on the Caddie tab
      // for the 95% of users who never coach anyone. Users who do
      // coach turn it on via the people icon in the L4 green-arrow
      // expandable row. Earlier default of `true` was rolled back the
      // same day after Tim caught the pill overlapping the logo.
      coachModeEnabled: false,
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
      personaIntensity: { kevin: 100, serena: 100, harry: 90, tank: 70, custom: 100 },
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
      // 2026-06-04 — Hands-free / BT tap-to-talk default OFF.
      // The native media-key bridge is still a future APK path, so
      // new installs start in the safer state and users opt in from
      // Settings when they want to test it.
      earbudTapToTalk: false,
      glassesMode: false,
      feelCaptureEnabled: false,
      voiceOnPhoneSpeaker: true,
      kevinGreetingEnabled: true,
      smartVisionImagery: 'auto' as const,
      yardageMode: 'live' as const,
      autoClubDetection: true,
      cageAutoClubDetection: true,
      hasSeenAutoClubPrompt: false,
      cockpitMode: false,
      // 2026-05-22 — Ghost Rounds default ON. 95%-case is the player wants
      // to know how they're tracking against their last round at this course.
      ghostAutoActivate: true,

      setVoiceEnabled: (v) => set({ voiceEnabled: v }),
      // 2026-06-04 — Coach Mode toggle setter.
      setCoachModeEnabled: (v) => set({ coachModeEnabled: v }),
      // 2026-05-30 — Fix FY: Local Mode setter.
      setLocalMode: (v) => set({ localMode: v }),
      setCecilyMode: (v) => set({ cecilyMode: v }),
      setContinuousConversationMode: (v) => set({ continuousConversationMode: v }),
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
          // 2026-05-22 — Fix Q follow-up audit. Also clear the course-
          // content cache (About / Caddie Tips / Hole Notes). That blob
          // was generated in the prior persona's voice and would keep
          // surfacing on every course detail view until the weekly TTL
          // refresh — long enough to be a visible bleed.
          try {
            const courseMod = require('../services/courseContentService');
            void courseMod.clearCourseContentCache?.().catch?.(() => {});
          } catch { /* ignore */ }
          console.log(`[persona] switched ${prev} → ${p}; cleared filler + briefing + course-content caches`);
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
      // 2026-05-28 — Fix FD: per-persona intensity floor of 30. Tim's
      // report: Serena set + silent on Android. Investigation showed
      // currentPlaybackVolume floors at 0.3, BUT a 0% dial maps to
      // 30% playback volume which on a phone speaker in a loud room
      // can FEEL silent. Setting a floor of 30 on the dial itself
      // means the slider can't go below "30% intensity" — that's our
      // mid-low "always at least audible" guarantee. Users who want
      // true silence flip voiceEnabled off in Settings → Voice, which
      // is the explicit kill switch.
      setPersonaIntensity: (p, v) => set((s) => ({
        personaIntensity: {
          ...s.personaIntensity,
          [p]: Math.max(30, Math.min(100, Math.round(v))),
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
      setGlassesMode: (v) => set({ glassesMode: v }),
      setFeelCaptureEnabled: (v) => set({ feelCaptureEnabled: v }),
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
      setAutoClubDetection: (v) => set({ autoClubDetection: v, cageAutoClubDetection: v }),
      setCageAutoClubDetection: (v) => set({ cageAutoClubDetection: v, autoClubDetection: v }),
      setHasSeenAutoClubPrompt: (v) => set({ hasSeenAutoClubPrompt: v }),
      setCockpitMode: (v) => set({ cockpitMode: v }),
      setGhostAutoActivate: (v) => set({ ghostAutoActivate: v }),
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
      version: 12,
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
            p.personaIntensity = { kevin: 100, serena: 100, harry: 100, tank: 70, custom: 100 };
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
        // 2026-05-28 — v8 — Fix FD: persona intensity floor repair.
        // Tim's report: Serena selected on Android + silent. If a
        // persisted intensity got dragged near zero in an older
        // build (or arrived from a corrupted state), playback was
        // technically running but inaudible on a phone speaker. New
        // setPersonaIntensity setter enforces a 30 floor going
        // forward; this migration repairs any historical dial that
        // was already below 30 (lift to 70 — a confident mid value
        // that matches Tank's existing default). Hardcoded list of
        // personas so we don't depend on import order at migrate time.
        if (version < 8) {
          const dial = p.personaIntensity as Record<string, number> | undefined;
          if (dial && typeof dial === 'object') {
            const repaired: Record<string, number> = { ...dial };
            (['kevin', 'serena', 'harry', 'tank'] as const).forEach((persona) => {
              const v = repaired[persona];
              if (typeof v !== 'number' || v < 30) {
                repaired[persona] = 70;
              }
            });
            p.personaIntensity = repaired as Record<Persona, number>;
          } else {
            // No personaIntensity persisted at all (very old payload that
            // somehow skipped v4 seeding). Seed to mid defaults.
            p.personaIntensity = { kevin: 100, serena: 100, harry: 90, tank: 70, custom: 100 };
          }
        }
        // v9 — add auto-club prompt persistence and generic auto-club
        // toggle alias. Existing users keep prior cageAutoClubDetection
        // behavior; hasSeenAutoClubPrompt seeds false.
        if (version < 9) {
          if (p.autoClubDetection == null) {
            p.autoClubDetection = p.cageAutoClubDetection ?? true;
          }
          if (p.hasSeenAutoClubPrompt == null) {
            p.hasSeenAutoClubPrompt = false;
          }
        }
        // v10 — hands-free safety pass. Earbud tap-to-talk starts OFF
        // so app boot never enables the native media-key path unless
        // the user explicitly opts in from Settings.
        if (version < 10) {
          p.earbudTapToTalk = false;
        }
        // v11 — 'custom' persona added (user's self-generated caddie).
        // Seed personaIntensity.custom=100 on existing payloads so the
        // Record<Persona, number> shape stays complete after the union
        // widened. Lookup sites also use ?? 100 as a runtime guard, so
        // this is belt-and-suspenders for older payloads.
        if (version < 11) {
          // 2026-06-08 (audit #2) — defensive: if an incomplete prior
          // migration left personaIntensity missing/non-object, seed the
          // full shape rather than spread-merging onto undefined.
          if (!p.personaIntensity || typeof p.personaIntensity !== 'object') {
            p.personaIntensity = { kevin: 100, serena: 100, harry: 90, tank: 70, custom: 100 };
          } else if ((p.personaIntensity as Record<string, number>).custom == null) {
            p.personaIntensity = { ...p.personaIntensity, custom: 100 };
          }
        }
        // v12 — 2026-06-10 — one-time rescue. The circuit breaker used to
        // AUTO-engage Local Mode after a few transient failures and never
        // turn it back off, trapping users (incl. on perfect Wi-Fi) with a
        // quiet caddie + "cell signal weak". Auto-engage is now removed and
        // Local Mode is user-controlled only. Force it OFF once here so anyone
        // already trapped by the old behavior boots clean; if they genuinely
        // want Local Mode they re-enable it in Settings (this won't re-clear).
        if (version < 12) {
          p.localMode = false;
        }
        return p as SettingsState;
      },
      partialize: (s) => ({
        voiceEnabled: s.voiceEnabled,
        // 2026-06-04 — persist Coach Mode toggle.
        coachModeEnabled: s.coachModeEnabled,
        // 2026-05-30 — Fix FY: persist the Local Mode user choice.
        // (hasHydrated is intentionally NOT in partialize — that's
        // transient state by design; see onRehydrateStorage below.)
        localMode: s.localMode,
        cecilyMode: s.cecilyMode,
        continuousConversationMode: s.continuousConversationMode,
        voiceGender: s.voiceGender,
        language: s.language,
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
        glassesMode: s.glassesMode,
        feelCaptureEnabled: s.feelCaptureEnabled,
        voiceOnPhoneSpeaker: s.voiceOnPhoneSpeaker,
        kevinGreetingEnabled: s.kevinGreetingEnabled,
        smartVisionImagery: s.smartVisionImagery,
        yardageMode: s.yardageMode,
        autoClubDetection: s.autoClubDetection,
        cageAutoClubDetection: s.cageAutoClubDetection,
        hasSeenAutoClubPrompt: s.hasSeenAutoClubPrompt,
        cockpitMode: s.cockpitMode,
        ghostAutoActivate: s.ghostAutoActivate,
        // watchConnected / glassesConnected not persisted — rechecked on mount
      }),
      // 2026-05-28 — Fix FS: post-splash audio race fix. settingsStore
      // had no hydration flag, so any module that read
      // useSettingsStore.getState().caddiePersonality (or voiceGender /
      // language / voiceEnabled) at boot got the DEFAULT 'kevin' / 'female'
      // / 'en' before AsyncStorage rehydrated the persisted values. The
      // greeting screen's audio-kickoff effect was the worst hit — it
      // picked the kevin-mp3 vs other-persona-TTS branch based on a
      // stale value, so users with persisted Serena / Tank heard Kevin's
      // greeting (or silence, when the bundled mp3 didn't exist for the
      // intended persona).
      //
      // Mirrors the pattern already in cageStore + roundStore. Consumers
      // that need to read settings at boot now subscribe to hasHydrated
      // and defer until it's true. setHasHydrated() is private to this
      // file — only onRehydrateStorage below calls it.
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.log('[settingsStore] rehydrate error:', error);
        }
        useSettingsStore.setState({ hasHydrated: true });
      },
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
