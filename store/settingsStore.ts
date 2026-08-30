import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

// 2026-06-11 (audit) — dedup the persona-handoff intro so a fast double-switch
// (Kevin→Serena→Kevin) can't stack two overlapping opener clips.
let personaHandoffTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Phase 105 — Team Caddie Architecture ─────────────────────────────────────

// 2026-06-06 — 'custom' is the user's self-generated caddie (selfie
// portrait + recorded clips + chosen name). Keep this union in sync
// with lib/persona.ts. See lib/persona.ts for the canonical maps;
// this duplicate type literal exists for back-compat with the
// existing intent-handler imports that already pull Persona from
// settingsStore.
export type Persona = 'kevin' | 'serena' | 'harry' | 'custom';
export type CaddiePillar = 'round' | 'cage' | 'drills' | 'play';

// Per-pillar default assignments. The user can override any pillar in Settings.
// Defaults reflect each caddie's natural fit.
export const DEFAULT_CADDIE_ASSIGNMENTS: Record<CaddiePillar, Persona> = {
  round: 'kevin',   // steady conversational companion on the course
  cage: 'serena',   // measured professional for cage practice
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
  /**
   * 2026-08-26 (Tim — "make high contrast the default display setting"). It already WAS the default
   * for new installs; the v21 migration only reached testers still on theme_preference 'system',
   * so anyone who had explicitly picked light or dark before 07-29 never got it. v23 turns it on
   * for everyone, once. This flag is what makes that safe to do exactly once: from here on, a
   * player who deliberately switches it OFF is recorded as having chosen, and no future default
   * change may quietly switch it back.
   */
  highContrastUserTouched: boolean;
  // PGA HOPE follow-up (A1) — when true, bumps text scale and forces
  // icon-button labels to render so low-vision users don't operate the
  // app from muscle memory alone.
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
  // can match cadence to the dial.
  personaIntensity: Record<Persona, number>;

  // 2026-05-21 — Consolidation 1 / Merge C: watchConnected moved to
  // the dedicated watchStore (store/watchStore.ts) so the
  // Settings display, Cage Mode result card, and the upcoming
  // native SDK all share one source of truth. Removed from this
  // store. See also the migrate() block below which strips the
  // field on hydration of persisted state from prior versions.
  // (glassesConnected removed 2026-07-04 audit — zero consumers.)
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
  // 2026-08-07 (Tim) — "interactive round": when ON, the caddie speaks a proactive read when you STOP
  // (mid-hole shot strategy). OFF by default — by default the caddie only auto-briefs at the TEE BOX and
  // otherwise waits to be ASKED (pull), so it's never thrown at you.
  interactiveRound: boolean;
  /** 2026-05-22 — Fix T. When true, shotDetectionService runs during a
   *  round and auto-logs swings via GPS displacement signature. When
   *  false (DEFAULT), the player enters scores manually via stepper /
   *  voice ("I made a 5"). STROKE count then reflects the player's
   *  manual score, not derived from auto-detected shots. */
  autoShotDetection: boolean;
  /** 2026-07-23 (Tim — Course Cloud) — share derived course MAPS (coords only, no PII) to the community
   *  DB. Default ON for beta; opt out anytime. Gates ONLY courseCloud upload.
   *  2026-07-27 — the issue-report/diagnostics auto-send was SPLIT OUT to `shareDiagnostics` (below); do
   *  NOT re-bundle PII onto this course-map toggle. */
  shareCommunityData: boolean;
  /** 2026-07-26 (deep audit S3) — SEPARATE consent for auto-sending your issue reports, which include
   *  your EMAIL + app diagnostics — split out of shareCommunityData so PII no longer rides the
   *  "share course maps" toggle silently. Gates issueLogExport's auto-POST only. */
  shareDiagnostics: boolean;
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
  // 2026-06-30 (Tim) — enable the Galaxy Watch swing-IMU bridge (tempo/club-speed → Smart Motion).
  watchSwingEnabled: boolean;
  // 2026-07-29 (Tim — "trail vs lead arm logic; my faults are on my trail arm"). Which wrist the watch
  // is on. LEAD = the steering wrist → cleaner club-speed proxy; TRAIL = the release wrist → the better
  // sensor for casting / early-release faults. Tags every watch swing so lead/trail data never pools
  // and the interpretation branches. Default 'lead' (the classic tempo-trainer placement).
  watchWrist: 'lead' | 'trail';
  distance_unit: 'yards' | 'meters';

  tutorialsSeen: Record<string, boolean>;
  // 2026-05-21 — Fix D: per-screen intro open counter. Used to
  // auto-suppress the SmartMotion / Cage Mode 3-line caddie intro
  // after the user has seen it a few times. Keyed by intro slug
  // (e.g. 'smartmotion', 'cage_mode'). Persisted via the standard
  // settings rehydration path so opens carry across launches.
  introOpens: Record<string, number>;
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
  kevinGreetingEnabled: boolean;
  /** 2026-07-06 — epoch ms of the last cold app-open. Lets Index throttle the
   *  greeting so it doesn't replay its ~4s hello on every rapid reopen (the
   *  range/course open-close-open pattern). Hydrated → readable synchronously. */
  // Phase AW — SmartVision imagery source.
  // 'curated' = bundled hole screenshots (always works, no GPS required).
  // 'gps'     = live Mapbox satellite tile + draggable F/M/B markers
  //             (requires hole geometry with tee+green coords).
  // 'auto'    = use 'gps' when geometry available, fall back to 'curated'.
  /**
   * @deprecated 2026-08-11 — SmartVision no longer reads this. The Static/Satellite toggle was
   * removed: both sides were aerials, so the setting could only choose a staler picture, and
   * pre-round it silently chose the stale one for every course with bundled photos. Imagery is now
   * live tile → bundled photo (only when a hole has no coordinates) → centroid/GPS tile.
   * Kept so persisted user settings still rehydrate cleanly; safe to delete once no store
   * snapshot in the wild carries it.
   */
  smartVisionImagery: 'curated' | 'gps' | 'auto';
  // Phase AY — yardage source. 'live' uses GPS-driven calculations.
  // 'preround' uses static courseHoles values (good for planning before
  // Start Round, or as a manual fallback if GPS gets stale and the user
  // wants to fall back to the scorecard's nominal numbers). Toggling
  // back to 'live' fires a fresh GPS read (synthetic Mark) so the
  // current position re-anchors the live yardages.
  yardageMode: 'live' | 'preround';
  // (Phase BL autoClubDetection / cageAutoClubDetection /
  // hasSeenAutoClubPrompt removed 2026-07-04 audit — zero consumers;
  // stale persisted values are ignored on hydrate.)

  // 2026-06-10 — Practice/sensing environment. ONE switch the capture +
  // analysis paths branch on so sensing matches reality:
  //   cage   — calibrated target distance + acoustic echo ball-speed; GPS off
  //   range  — manual/eyeball distance, looser acoustic thresholds; GPS off
  //   course — GPS distance to green; acoustic mostly off (wind); single-shot
  // Replaces the scattered SpaceType label that was detected but never drove
  // behavior. Smart-defaulted at read time (course when a GPS round is active).
  environmentMode: 'cage' | 'range' | 'course';
  // 2026-06-12 — CAGE geometry the user CONFIRMS (Tim): distance from the ball to the
  // bullseye canvas, and how far the camera sits behind the player. Together they give
  // the true ball→canvas throw distance the cage shot-map (page 3) reasons over, tied
  // to the acoustic strike. User-entered + persisted (no fabricated geometry).
  cageCanvasFeet: number;
  cameraBehindFeet: number;
  // 2026-06-11 — chip/short-game sensitivity. A chip's impact is ~half the energy
  // of a full strike (Tim's cage test: clear sound, but the detector missed it),
  // so when ON we drop the strike threshold so quiet pitch/chip strikes register.
  // Trades a few more false candidates for not missing the shot — fine in the cage.
  chipSensitivity: boolean;

  // 2026-08-01 (Tim — "turn off acoustic detection so you can analyze with no ball strike or foam
  // balls"). When ON, SmartMotion (and drills / shot shapes, which route through it) runs the
  // VIDEO-only swing pipeline: no metered audio track, swings are detected + segmented from the pose
  // locator, and the acoustic-only steps (ball speed / departure) stay honestly off. Makes indoor /
  // foam-ball / air-swing practice detect + break down cleanly with no audible strike. Off by default.
  foamBallMode: boolean;

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

  // 2026-06-21 — AI provider toggle (Owner Tools). Controls which cloud
  // AI provider drives the caddie brain, intent routing, and reasoning.
  // TTS (gpt-4o-mini-tts) and STT (Whisper) are always OpenAI regardless.
  // 'gemini' = Gemini 2.5-Flash (faster vision, cheaper, Google Search grounding)
  // 'openai' = GPT-4o / GPT-4o-mini (strong reasoning, single-vendor simplicity)
  // Default 'gemini' — matches the existing fast-path for vision routes.
  aiProvider: 'openai' | 'gemini';

  // 2026-06-24 — Off-device data layer Phase A. OPT-IN anonymous usage
  // telemetry. Default FALSE — nothing is sent unless the user turns this on
  // in Settings → Data & Privacy. When false, services/usageTelemetry.track()
  // is a no-op. Sends coarse, anonymous events (round_started, swing_analyzed,
  // …) tagged with a random local id (NOT a device fingerprint) to the isolated
  // `smartplay` Supabase schema — never SmartManage's data.
  analyticsOptIn: boolean;

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
  setLargeText: (v: boolean) => void;
  setTtsCaptions: (v: boolean) => void;
  setTtsCaptionsBluetoothPrompt: (v: 'unasked' | 'asked' | 'never') => void;
  setSimpleBriefing: (v: boolean) => void;
  setPersonaIntensity: (p: Persona, v: number) => void;
  // setWatchConnected moved to watchStore.setConnected (Consolidation 1 / Merge C).
  setAutoListenEnabled: (v: boolean) => void;
  setCartMode: (v: boolean) => void;
  // 2026-05-22 — Fix T.
  setAutoHoleAdvance: (v: boolean) => void;
  setInteractiveRound: (v: boolean) => void;
  setAutoShotDetection: (v: boolean) => void;
  setShareCommunityData: (v: boolean) => void;
  setShareDiagnostics: (v: boolean) => void;
  setHasAskedHealthPermission: (v: boolean) => void;
  setHealthDataEnabled: (v: boolean) => void;
  setWatchSwingEnabled: (v: boolean) => void;
  setWatchWrist: (w: 'lead' | 'trail') => void;
  setSkipBriefings: (v: boolean) => void;
  setProactiveKevinEnabled: (v: boolean) => void;
  setDistanceUnit: (u: 'yards' | 'meters') => void;
  markTutorialSeen: (key: string) => void;
  incrementIntroOpen: (key: string) => void;
  resetTutorials: () => void;
  setEarbudTapToTalk: (v: boolean) => void;
  setGlassesMode: (v: boolean) => void;
  setFeelCaptureEnabled: (v: boolean) => void;
  setKevinGreetingEnabled: (v: boolean) => void;
  setSmartVisionImagery: (v: 'curated' | 'gps' | 'auto') => void;
  setYardageMode: (v: 'live' | 'preround') => void;
  // Phase Cockpit
  setCockpitMode: (v: boolean) => void;
  setEnvironmentMode: (mode: 'cage' | 'range' | 'course') => void;
  setCageCanvasFeet: (feet: number) => void;
  setCameraBehindFeet: (feet: number) => void;
  setChipSensitivity: (on: boolean) => void;
  setFoamBallMode: (on: boolean) => void;
  // 2026-05-22 — Ghost Rounds.
  setGhostAutoActivate: (v: boolean) => void;
  // 2026-06-21 — AI provider toggle.
  setAiProvider: (v: 'openai' | 'gemini') => void;
  // 2026-06-24 — Off-device data layer Phase A: usage telemetry opt-in.
  setAnalyticsOptIn: (v: boolean) => void;

  // ─── PIPECAT VOICE ORCHESTRATOR ─────────────────────────────────
  // 2026-08-29 (OPEN-ITEMS §22) — `voiceOrchestrator` is DELETED. It read as a user choice
  // ('legacy' | 'pipecat') and was a constant: no screen ever called setVoiceOrchestrator, the
  // store defaulted to 'pipecat' and the v15 migration force-set it for every existing install.
  // Three modules branched on it and each kept a legacy half that could not run. A setting nothing
  // can set is a constant, and every branch on it is half-dead code that reads as a live choice.
  // The persisted key is simply dropped: nothing reads it, and it leaves storage on the next write
  // because it is no longer in partialize.
  // URL of the deployed Pipecat server (e.g. https://kevin.up.railway.app)
  pipecatServerUrl: string;
  setPipecatServerUrl: (v: string) => void;
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
      // 2026-07-29 (Tim — "make default display theme dark, high contrast"). The app's signature look
      // is the dark, high-contrast theme; that's the default for a fresh install. Existing testers are
      // migrated to it in v21 below (only if they never picked a different appearance).
      theme_preference: 'dark' as const,
      highContrast: true,
      highContrastUserTouched: false,
      largeText: false,
      ttsCaptions: true,
      ttsCaptionsBluetoothPrompt: 'unasked' as const,
      // Re-sim P0 #1 — default true; auto-clears via the getEffectiveSimpleBriefing
      // helper after the player has 5+ completed rounds, unless they've
      // explicitly toggled it.
      simpleBriefing: true,
      simpleBriefingUserTouched: false,
      // Re-sim P2 — Harry default 100 → 90 (was a touch loud in carts for
      // multiple players).
      // Note: Harry is soft-removed from active UI (see lib/persona.ts
      // ACTIVE_PERSONAS) but the intensity entry stays so flipping him
      // back active is a single-line edit.
      personaIntensity: { kevin: 100, serena: 100, harry: 90, custom: 100 },
      // 2026-07-06 — hands-free is the #1 priority. Active Listening on by default so
      // "start a round → just talk" works without digging into Settings. The
      // ActiveListeningPill shows it's live; the Settings toggle mutes it. Still scoped
      // to in-round + Caddie tab + idle by the vadEnabled gate.
      // 2026-07-21 (Tim) — auto-listen is OFF by default and the user turns it on each session
      // (see the boot reset in _layout.tsx). Hands-free is opt-in, not always-on — this also keeps
      // testers off the auto-listen VAD path unless they deliberately enable it.
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
      autoHoleAdvance: true, // FIX M5 — default true; GPS auto-advance is the expected behavior for new installs
      interactiveRound: false, // 2026-08-07 (Tim) — speak-when-you-stop is OFF by default; auto-brief is tee-box only
      autoShotDetection: false,
      shareCommunityData: true, // default ON for beta — helps build the shared course DB (coords only)
      shareDiagnostics: true, // beta issue triage (includes your email) — now a SEPARATE, honestly-labeled toggle
      hasAskedHealthPermission: false,
      healthDataEnabled: true,
      watchSwingEnabled: false,
      watchWrist: 'lead' as const,
      skip_briefings: false,
      proactive_kevin_enabled: true,
      distance_unit: 'yards' as const,
      tutorialsSeen: {},
      introOpens: {},
      // 2026-06-04 — Hands-free / BT tap-to-talk default OFF.
      // The native media-key bridge is still a future APK path, so
      // new installs start in the safer state and users opt in from
      // Settings when they want to test it.
      earbudTapToTalk: true,
      glassesMode: false,
      feelCaptureEnabled: false,
      kevinGreetingEnabled: true,
      smartVisionImagery: 'auto' as const,
      yardageMode: 'live' as const,
      environmentMode: 'cage' as const,
      cageCanvasFeet: 14,
      cameraBehindFeet: 7,
      chipSensitivity: false,
      foamBallMode: false,
      cockpitMode: false,
      // 2026-05-22 — Ghost Rounds default ON. 95%-case is the player wants
      // to know how they're tracking against their last round at this course.
      ghostAutoActivate: true,
      // 2026-07-09 (Tim — "single provider") — default 'openai' so ALL analysis routes
      // match the OpenAI brain. Was 'gemini'; the split (brain=openai, analysis=gemini)
      // was a source of inconsistency and single-key breakage.
      aiProvider: 'openai' as const,
      // 2026-06-24 — Usage telemetry OPT-IN, default OFF.
      analyticsOptIn: false,
      pipecatServerUrl: '',

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
        // 2026-08-25 — the removed persona's setter guard is gone with it. It is no longer a type,
        // so no surface can name it; a persisted value is migrated to Kevin by v22.
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
            // 2026-07-27 (24h audit) — re-render the offline ack/"didn't catch that" clips in the NEW
            // persona's voice. Cache is keyed by persona, so without this the acks fall back to the
            // robotic OS voice until the next startup warmup. Best-effort, fire-and-forget.
            voiceMod.prewarmOfflineVoiceClips?.()?.catch?.(() => {});
          } catch { /* ignore */ }
        }
        set({
          caddiePersonality: p,
          voiceGender: gender,
          caddieAssignments: { round: p, cage: p, drills: p, play: p },
        });
        // 2026-05-19 — Persona handoff welcome. When the active caddie
        // changes (manual or via team handoff), the new persona briefly
        // introduces themselves so the user knows who's on the bag now.
        // 2026-06-11 (audit) — was a network /api/voice TTS call, which on a
        // cold Lambda left the switch SILENT (this was the ONE persona moment
        // that didn't use the bundled clips, while greetings/openers do). Now
        // play the per-persona BUNDLED opener: zero-network, instant, never
        // silent. flashCaption keeps the on-screen line (speak() used to set
        // the caption; the bundled clip doesn't, so we set it explicitly).
        // 500ms delay lets the prior caddie's stopSpeaking settle first.
        // 2026-06-11 (audit) — skip the handoff intro for 'custom': there is no custom opener
        // clip (the accessor fell back to Kevin) and no intro line, so it would announce the
        // user's custom caddie in
        // KEVIN's voice and flash a literal "custom stepping in." The custom
        // caddie has its own recorded clips; don't override with Kevin's.
        // 2026-07-30 (Tim — "the old 'here when you're ready, just tap to chat' needs to go for all
        // caddies"). A persona switch IS the handoff moment, so claim the one-per-process opener slot:
        // a not-yet-spoken app-open proactive opener (caddie.tsx) stands down instead of stacking after
        // this handoff and reading as two greetings racing. Applies to EVERY persona (incl. custom).
        if (prev !== p) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            (require('../services/openerGuard') as typeof import('../services/openerGuard')).claimOpenerSlot();
          } catch { /* best-effort */ }
        }
        /**
         * 2026-08-20 (Tim: "the text will say 'Kevin back on the bag', but what he SAYS is like
         * 'Kevin here, I'm here to help when you need'… there's still canned speech clashing. I'm
         * almost certain of it.") — he was right, and it was worse than a clash.
         *
         * This flashed an intro line as the caption and then played the bundled per-persona
         * APP-OPEN opener asset, whose actual recorded words are:
         *     kevin  "Tap the mic when you're ready to talk."
         *     serena "I'm here when you're ready. Just tap to chat."
         *     harry  "Take your time. Tap when you'd like to chat."
         * Two entirely different scripts for one moment: the screen said one thing, the caddie said
         * another. It dates to 2026-06-11, when a network TTS call was swapped for the bundled clip
         * to stop cold-Lambda silence — the caption was kept and the AUDIO changed underneath it,
         * and nothing checked they still matched.
         *
         * And Serena's clip is the exact line Tim retired on 2026-07-30 — "the old 'here when you're
         * ready, just tap to chat' needs to go for all caddies". That fix removed it from the
         * app-open path and never touched this one, so a killed line kept playing on every switch.
         *
         * Now the handoff SPEAKS the line it shows. The text is owned by offlineVoiceCache alongside
         * the other fixed lines, so the words and the recording cannot drift apart again, and it is
         * pre-rendered in the persona's real voice during warmup — instant, no cold-Lambda risk,
         * which is the problem the bundled clip existed to solve.
         */
        if (prev !== p && p !== 'custom') {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const introSrc = (require('../services/offlineVoiceCache') as typeof import('../services/offlineVoiceCache')).PERSONA_HANDOFF_INTROS;
          const text = introSrc[p] ?? `${p} stepping in.`;
          if (personaHandoffTimer) clearTimeout(personaHandoffTimer);
          personaHandoffTimer = setTimeout(() => {
            personaHandoffTimer = null;
            try {
              const voiceMod = require('../services/voiceService');
              const cacheMod = require('../services/offlineVoiceCache');
              const gender = get().voiceGender === 'female' ? 'female' : 'male';
              // FAST PATH — the same line, pre-rendered in this persona's voice during warmup.
              const cached = cacheMod.resolveCachedOfflineClipUri?.(text, gender, p);
              if (cached) {
                voiceMod.flashCaption?.(text);
                voiceMod.playLocalFile?.(cached, undefined, { userInitiated: true })
                  ?.catch?.((e: unknown) => console.log('[persona-handoff] cached clip failed', e));
              } else {
                // Not cached yet (first switch to this persona). speak() renders it AND sets the
                // caption itself, so the two still cannot disagree; its own device-TTS fallback
                // keeps the switch from going silent. The retired opener clip is never played here.
                voiceMod.speak?.(text, gender, get().language ?? 'en', undefined, { userInitiated: true })
                  ?.catch?.((e: unknown) => {
                    console.log('[persona-handoff] speak failed — caption only', e);
                    voiceMod.flashCaption?.(text);
                  });
              }
            } catch (e) {
              console.log('[persona-handoff] setup failed', e);
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
      setHighContrast: (v) => set({ highContrast: v, highContrastUserTouched: true }),
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
      setAutoListenEnabled: (v) => set({ autoListenEnabled: v }),
      setCartMode: (v) => set({ cartMode: v }),
      // 2026-05-22 — Fix T setters.
      setAutoHoleAdvance: (v) => set({ autoHoleAdvance: v }),
      setInteractiveRound: (v) => set({ interactiveRound: v }),
      setAutoShotDetection: (v) => set({ autoShotDetection: v }),
      setShareCommunityData: (v) => set({ shareCommunityData: v }),
      setShareDiagnostics: (v) => set({ shareDiagnostics: v }),
      setHasAskedHealthPermission: (v) => set({ hasAskedHealthPermission: v }),
      setHealthDataEnabled: (v) => set({ healthDataEnabled: v }),
      setWatchSwingEnabled: (v) => set({ watchSwingEnabled: v }),
      setWatchWrist: (w) => set({ watchWrist: w }),
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
      setEarbudTapToTalk: (v) => set({ earbudTapToTalk: v }),
      setGlassesMode: (v) => set({ glassesMode: v }),
      setFeelCaptureEnabled: (v) => set({ feelCaptureEnabled: v }),
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
      setCockpitMode: (v) => set({ cockpitMode: v }),
      setEnvironmentMode: (mode) => set({ environmentMode: mode }),
      setCageCanvasFeet: (feet) => set({ cageCanvasFeet: Math.max(1, Math.round(feet)) }),
      setCameraBehindFeet: (feet) => set({ cameraBehindFeet: Math.max(0, Math.round(feet)) }),
      setChipSensitivity: (on) => set({ chipSensitivity: on }),
      setFoamBallMode: (on) => set({ foamBallMode: on }),
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
      setAiProvider: (v) => set({ aiProvider: v }),
      // 2026-06-24 — Usage telemetry opt-in setter. On flip-off, also drop any
      // buffered events so opting out is immediate. Dynamic require avoids a
      // module-load cycle (usageTelemetry imports this store).
      setAnalyticsOptIn: (v) => {
        set({ analyticsOptIn: v });
        if (!v) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require('../services/usageTelemetry');
            void mod.flushUsage?.();
          } catch { /* ignore */ }
        }
      },
      setPipecatServerUrl: (v) => set({ pipecatServerUrl: v }),
    }),
    {
      name: 'settings-store-v2',
      storage: createJSONStorage(() => getPersistStorage()),
      // Phase 105 — bumped to v3 to add caddieAssignments. v2 (and earlier)
      // payloads only carry caddiePersonality; the migrate fn seeds all
      // four pillars to that prior single value so the user's preference
      // is preserved across the restructure. After migration the user
      // can customize per pillar in Settings.
      version: 23,
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
          if (p.personaIntensity == null) {
            p.personaIntensity = { kevin: 100, serena: 100, harry: 100, custom: 100 };
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
        // v22 (2026-08-25, Tim) — Tank removed from the shipping app. Same treatment Harry got in
        // v6: migrate any persisted Tank assignment to Kevin so a user who had selected Tank is not
        // stranded on a persona the UI no longer lists. The persona was built around a real person,
        // so this is a removal rather than a dormancy.
        // v23 — 2026-08-26 (Tim) — high contrast is THE default display setting. v21 only reached
        // testers whose theme_preference was still 'system'; a tester who had explicitly chosen
        // light or dark kept whatever high-contrast value they had, which for most of them was
        // false. One unconditional flip for anyone who has not deliberately set it themselves —
        // and from now on highContrastUserTouched records that choice, so this cannot recur.
        if (version < 23) {
          if (p.highContrastUserTouched !== true) p.highContrast = true;
          if (p.highContrastUserTouched == null) p.highContrastUserTouched = false;
        }
        if (version < 22) {
          // Compared as a string on purpose: 'tank' is no longer a Persona in the type system, but
          // it absolutely exists in data persisted by earlier builds — which is the entire reason this
          // migration is here. A migration that could not name the old value could not migrate it.
          if ((p.caddiePersonality as string) === 'tank') p.caddiePersonality = 'kevin';
          if (p.caddieAssignments) {
            const reassigned: CaddieAssignments = { ...p.caddieAssignments };
            (Object.keys(reassigned) as CaddiePillar[]).forEach((pillar) => {
              if ((reassigned[pillar] as string) === 'tank') reassigned[pillar] = 'kevin';
            });
            p.caddieAssignments = reassigned;
          }
        }
        // v7 — 2026-05 — force-set voiceOnPhoneSpeaker TRUE for existing users, because the old
        // default (false) silently blocked the caddie's voice whenever the player wasn't paired to
        // earbuds — "avatar acknowledges but doesn't speak". That decision STANDS; the setting it
        // wrote was retired 2026-08-29 and the migration with it. The gate had been dead since.
        // 2026-05-28 — v8 — Fix FD: persona intensity floor repair.
        // Tim's report: Serena selected on Android + silent. If a
        // persisted intensity got dragged near zero in an older
        // build (or arrived from a corrupted state), playback was
        // technically running but inaudible on a phone speaker. New
        // setPersonaIntensity setter enforces a 30 floor going
        // forward; this migration repairs any historical dial that
        // was already below 30 (lift to 70 — a confident mid value
        // that matches the existing default). Hardcoded list of
        // personas so we don't depend on import order at migrate time.
        if (version < 8) {
          const dial = p.personaIntensity as Record<string, number> | undefined;
          if (dial && typeof dial === 'object') {
            const repaired: Record<string, number> = { ...dial };
            (['kevin', 'serena', 'harry'] as const).forEach((persona) => {
              const v = repaired[persona];
              if (typeof v !== 'number' || v < 30) {
                repaired[persona] = 70;
              }
            });
            p.personaIntensity = repaired as Record<Persona, number>;
          } else {
            // No personaIntensity persisted at all (very old payload that
            // somehow skipped v4 seeding). Seed to mid defaults.
            p.personaIntensity = { kevin: 100, serena: 100, harry: 90, custom: 100 };
          }
        }
        // v9 — added auto-club prompt persistence + generic auto-club
        // toggle alias. Those keys were removed in the 2026-07-04 audit
        // (zero consumers), so the v9 seeding block is gone too; stale
        // persisted values are simply ignored on hydrate.
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
            p.personaIntensity = { kevin: 100, serena: 100, harry: 90, custom: 100 };
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
        // v13 — 2026-06-21 — AI provider toggle added. Seed 'gemini' for
        // existing installs so they get the faster vision path by default.
        if (version < 13) {
          if (p.aiProvider == null) p.aiProvider = 'gemini';
        }
        if (version < 14) {
          if (p.pipecatServerUrl == null) p.pipecatServerUrl = '';
        }
        // v15 — 2026-06-22 — Pipecat became the default brain. The key it seeded
        // (`voiceOrchestrator`) was deleted 2026-08-29; see the type declaration above.
        // v16 — 2026-06-24 — usage telemetry opt-in added. Seed FALSE for
        // existing installs so telemetry stays off until the user opts in.
        if (version < 16) {
          if (p.analyticsOptIn == null) p.analyticsOptIn = false;
        }
        // v17 — 2026-07-06 — earbud button tap-to-talk turned ON. The native
        // media-button listener (BluetoothMediaButtonModule, withBluetoothMediaButton
        // plugin) has been in the build all along; the v10 "safety off" was written
        // when the DEAD react-native-track-player path was mistaken for the only one.
        // Hands-free from launch is the #1 priority — default it on for everyone.
        if (version < 17) {
          p.earbudTapToTalk = true;
        }
        // v18 — 2026-07-06 — Active Listening on by default (hands-free #1 priority).
        // Flip existing installs on so in-round "just talk" works out of the box.
        if (version < 18) {
          p.autoListenEnabled = true;
        }
        // v19 — 2026-07-09 (Tim — "single provider") — move existing installs off the
        // 'gemini' default onto 'openai' so ALL analysis matches the OpenAI brain. The old
        // split (brain=openai, analysis=gemini) caused inconsistency; consolidate.
        if (version < 19) {
          if (p.aiProvider !== 'openai') p.aiProvider = 'openai';
        }
        // v20 — 2026-07-27 (24h audit — PRIVACY) — the consent split added `shareDiagnostics`
        // (default ON). Without this, an existing tester who turned the OLD combined toggle OFF
        // (shareCommunityData=false, which then also stopped the email+diagnostics auto-send) would
        // have shareDiagnostics resolve to the new default TRUE on upgrade → their PII silently starts
        // sending again. Carry their prior opt-out forward: if they had community sharing off, keep
        // diagnostics off too. (Someone who left it ON keeps ON, unchanged.)
        if (version < 20) {
          if (p.shareCommunityData === false && p.shareDiagnostics == null) p.shareDiagnostics = false;
        }
        // v21 — 2026-07-29 (Tim — "make default display theme dark, high contrast"). The signature look
        // is now dark + high contrast. Migrate existing testers who never picked a different appearance:
        // 'system' was the old default, so 'system' → 'dark'. Anyone who EXPLICITLY chose 'light' or
        // 'dark' is left alone. High contrast switches on for anyone who was still on the system default
        // (proxy for "never customized appearance") and hadn't already enabled it.
        if (version < 21) {
          const wasSystemDefault = p.theme_preference === 'system' || p.theme_preference == null;
          if (wasSystemDefault) {
            p.theme_preference = 'dark';
            if (p.highContrast !== true) p.highContrast = true;
          }
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
        highContrastUserTouched: s.highContrastUserTouched,
        largeText: s.largeText,
        ttsCaptions: s.ttsCaptions,
        ttsCaptionsBluetoothPrompt: s.ttsCaptionsBluetoothPrompt,
        simpleBriefing: s.simpleBriefing,
        simpleBriefingUserTouched: s.simpleBriefingUserTouched,
        personaIntensity: s.personaIntensity,
        autoListenEnabled: s.autoListenEnabled,
        cartMode: s.cartMode,
        autoHoleAdvance: s.autoHoleAdvance,
        interactiveRound: s.interactiveRound,
        autoShotDetection: s.autoShotDetection,
        shareCommunityData: s.shareCommunityData,
        shareDiagnostics: s.shareDiagnostics,
        // 2026-05-17 — audit B P0: both health-permission flags were
        // missing from partialize, so every cold launch re-asked for
        // Health Connect access on the first round-start. Persisted
        // now so the JIT ask happens once per device install.
        hasAskedHealthPermission: s.hasAskedHealthPermission,
        healthDataEnabled: s.healthDataEnabled,
        watchSwingEnabled: s.watchSwingEnabled,
        watchWrist: s.watchWrist,
        skip_briefings: s.skip_briefings,
        proactive_kevin_enabled: s.proactive_kevin_enabled,
        distance_unit: s.distance_unit,
        tutorialsSeen: s.tutorialsSeen,
        introOpens: s.introOpens,
        earbudTapToTalk: s.earbudTapToTalk,
        glassesMode: s.glassesMode,
        feelCaptureEnabled: s.feelCaptureEnabled,
        kevinGreetingEnabled: s.kevinGreetingEnabled,
        smartVisionImagery: s.smartVisionImagery,
        yardageMode: s.yardageMode,
        environmentMode: s.environmentMode,
        cageCanvasFeet: s.cageCanvasFeet,
        cameraBehindFeet: s.cameraBehindFeet,
        chipSensitivity: s.chipSensitivity,
        foamBallMode: s.foamBallMode,
        cockpitMode: s.cockpitMode,
        ghostAutoActivate: s.ghostAutoActivate,
        aiProvider: s.aiProvider,
        analyticsOptIn: s.analyticsOptIn,
        pipecatServerUrl: s.pipecatServerUrl,
        // watchConnected lives in watchStore; not persisted here
      }),
      // 2026-05-28 — Fix FS: post-splash audio race fix. settingsStore
      // had no hydration flag, so any module that read
      // useSettingsStore.getState().caddiePersonality (or voiceGender /
      // language / voiceEnabled) at boot got the DEFAULT 'kevin' / 'female'
      // / 'en' before AsyncStorage rehydrated the persisted values. The
      // greeting screen's audio-kickoff effect was the worst hit — it
      // picked the kevin-mp3 vs other-persona-TTS branch based on a
      // stale value, so users with a persisted non-default persona heard Kevin's
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
        // 2026-07-21 (Tim — "auto listen off by default, user turns on each time") — force
        // auto-listen OFF on EVERY launch, overriding any persisted value, so hands-free is a
        // deliberate per-session opt-in (and reverses the old v18 force-on for existing installs).
        // Also keeps testers off the auto-listen VAD path unless they explicitly enable it.
        useSettingsStore.setState({ hasHydrated: true, autoListenEnabled: false });
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
