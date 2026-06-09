import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

// ─── STATE ────────────────────────────────

// 'lifetime' = owner / founder grant; never expires, never asks for payment.
// Treated identically to 'active' by featureAccess but distinguished so the
// paywall + trial-init paths can short-circuit cleanly.
export type SubscriptionStatus = 'trial' | 'expired' | 'active' | 'free' | 'lifetime';

// Owner allow-list: any user whose email matches one of these gets a
// lifetime grant on first boot, bypassing the trial. Also unlocks the
// owner-gated debug surfaces (Issue Log, Voice Misses, GPS Test Bench,
// Kevin Learning, etc.) per useDebugRouteGate + Settings → Owner Tools.
// Add to this list (or set EXPO_PUBLIC_OWNER_EMAIL) when granting comp
// access. Matching is case-insensitive on the trimmed profile email.
export const OWNER_EMAILS: readonly string[] = [
  't.gustafson75@gmail.com',
  // 2026-05-23 — Tank (Marc Ward), real golf instructor testing the
  // app on his own device. Owner tools access for the testing surfaces.
  'marc.ward3533@gmail.com',
];

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (OWNER_EMAILS.includes(normalized)) return true;
  const fromEnv = (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? '').trim().toLowerCase();
  return fromEnv.length > 0 && fromEnv === normalized;
}

interface PlayerProfileState {
  name: string;
  firstName: string;
  handicap: number;
  /** Player's swinging hand. Mirrors SmartMotion guides/overlays and L/R
   *  coaching for lefties. Defaults to 'right'. */
  handedness: 'right' | 'left';
  dominantMiss: 'left' | 'right' | 'straight' | null;
  // Phase BB — broader miss-type taxonomy for richer Kevin grounding.
  // Coexists with dominantMiss (which is direction-only). missType
  // captures the swing fault flavor too. Both stay populated; Kevin
  // can use whichever fits the moment.
  missType: 'slice' | 'hook' | 'thin' | 'fat' | 'pull' | 'push' | 'varies' | null;
  // Phase BB — where the user is in their golf journey. Drives Kevin's
  // tone calibration on day-1 (returning golfer needs more support;
  // competitive needs precision; just-starting needs encouragement).
  experienceContext: 'starting' | 'improving' | 'returning' | 'competitive' | null;
  physicalLimitation: string | null;
  goal: string | null;
  personalBest: number | null;
  homeCourse: string | null;
  preferredTee: 'front' | 'middle' | 'back';
  isSetupComplete: boolean;
  has_completed_onboarding: boolean;
  default_mode: 'break_100' | 'break_90' | 'break_80' | 'free_play' | null;
  first_opened_at: number | null;
  trial_started_at: number | null;
  subscription_status: SubscriptionStatus;
  /** Optional player email. Used by isOwnerEmail() to grant lifetime
   *  access on first boot. Currently no auth surface populates this; set
   *  manually via setEmail or via the EXPO_PUBLIC_OWNER_EMAIL env-var
   *  fallback in isOwnerEmail. */
  email: string | null;

  // Phase T — WHS handicap fields
  /** USGA Handicap Index (one decimal, e.g. 18.0). null until user sets it. */
  handicap_index: number | null;
  /** Player gender — drives tee + rating selection. 'x' = unspecified / mixed. */
  handicap_gender: 'm' | 'f' | 'x';
  /** Recent score differentials (last 20 retained). Drives Index estimate. */
  recent_differentials: number[];

  // Phase AQ — persistent context fields. Synthesized once per event by
  // /api/context-synthesis (single Sonnet call) and persisted; injected
  // into Kevin's runtime system prompts so every reply has user-specific
  // grounding without per-call latency.
  /** "About this golfer" — synthesized from onboarding inputs. */
  kevinContext: string | null;
  /** Cross-session pattern summary — produced by periodic analysis pass. */
  persistentPatterns: string | null;
  /** Timestamp of last pattern synthesis; gates the periodic re-run. */
  patternsSynthesizedAt: number | null;

  // Phase BI — user-personalized caddie. selfieB64 is the original capture,
  // customCaddiePortraitB64 is the AI-edited result. Both stored as raw
  // base64 (no data: prefix). useCustomCaddie toggles the override on Caddie
  // home + voice service. When on, voice playback runs slightly faster +
  // slightly quieter so the personal caddie sounds different from default
  // Kevin even though the underlying TTS voice is the same.
  selfieB64: string | null;
  customCaddiePortraitB64: string | null;
  useCustomCaddie: boolean;

  // 2026-06-06 — User-chosen NAME for the custom caddie. Drives the
  // display label everywhere the cycler shows 'Custom' as the 5th
  // persona ("Caddie: <customCaddieName>" toast, the avatar caption
  // chip on the caddie tab, the Settings persona row). Null → UI
  // falls back to "My Caddie" so the user can ship the custom
  // persona without naming it. Set via the custom-caddie screen
  // name input.
  customCaddieName: string | null;

  // 2026-05-26 — Fix DY: Personal-caddie user-recorded voice clips.
  // Keyed by phrase id from services/customCaddieClips.ts (NOT by the
  // text — text can be re-worded later without orphaning recordings).
  // Value is a FileSystem URI to the local m4a/mp3. When useCustomCaddie
  // is true AND a clip exists for the text being spoken, voiceService
  // plays the local file instead of fetching /api/voice. Missing keys
  // (most phrases for most users) fall through to TTS — no regression.
  customCaddieClips: Record<string, string>;

  // 2026-05-22 — Launch-prep Terms & Conditions acceptance. Captured
  // during onboarding (welcome.tsx) before the user can tap "Get
  // started". Stored as a timestamp so we can prove WHEN the user
  // accepted (for store-submission privacy compliance + audit trail).
  // Null = not yet accepted; presence of any timestamp = accepted.
  // Persisted via the partialize block below so an interrupted
  // onboarding (close mid-form) retains the acceptance state on resume.
  termsAcceptedAt: number | null;

  // 2026-05-26 — Fix AB Phase 1: GHIN number scaffold.
  //
  // We CAPTURE the player's GHIN # now so it's already on file once
  // we obtain GHIN API credentials (USGA business agreement) and can
  // pull their official handicap + posted scores automatically.
  //
  // Until then this field is informational only — it shows up in the
  // brain prompt as "Player's GHIN: <number>" so Kevin can reference
  // it when the user asks "what's my GHIN?" or talks about USGA score
  // posting, AND it surfaces in player-context for tournament-mode
  // hints. No live API call.
  //
  // Stored as a string (GHIN #s are 7-digit but the API treats them
  // as strings to preserve leading zeros and to allow USGA international
  // variants like 'XXXX-XXXX'). null = not captured.
  ghin_number: string | null;

  // 2026-06-04 — Personal-best tracking. `longestDrive` auto-updates
  // from logShot when a Driver shot with carry_distance / distance_yards
  // beats the current high; `longestPutt` is user-entered in Settings
  // (no automatic detection today). null = never set.
  longestDrive: number | null;
  longestPutt: number | null;

  // 2026-06-04 — Cached AI "Kevin's Read" — 2-3 sentence prevailing-
  // tendency assessment generated from the last few rounds by
  // services/kevinReadService. Refreshed on endRound and on explicit
  // user tap (dashboard card). Never refreshed on cold launch or
  // mid-round. null = use the default Kevin-voice fallback line.
  kevinRead: { text: string; generatedAt: number } | null;

  // ─── ACTIONS ────────────────────────────

  setName: (name: string) => void;
  setHandicap: (hcp: number) => void;
  setHandedness: (h: 'right' | 'left') => void;
  setDominantMiss: (miss: 'left' | 'right' | 'straight' | null) => void;
  setMissType: (m: 'slice' | 'hook' | 'thin' | 'fat' | 'pull' | 'push' | 'varies' | null) => void;
  setExperienceContext: (e: 'starting' | 'improving' | 'returning' | 'competitive' | null) => void;
  setPhysicalLimitation: (limitation: string | null) => void;
  setGoal: (goal: string | null) => void;
  setPersonalBest: (score: number | null) => void;
  setHomeCourse: (course: string | null) => void;
  setPreferredTee: (tee: 'front' | 'middle' | 'back') => void;
  completeSetup: () => void;
  completeOnboarding: () => void;
  setDefaultMode: (m: 'break_100' | 'break_90' | 'break_80' | 'free_play') => void;
  initTrial: () => void;
  setSubscriptionStatus: (s: SubscriptionStatus) => void;
  setEmail: (email: string | null) => void;
  /** Owner override — sets subscription_status='lifetime' and stamps
   *  first_opened_at if missing. Idempotent. */
  grantLifetime: () => void;
  // Phase T
  setHandicapIndex: (idx: number | null) => void;
  setHandicapGender: (g: 'm' | 'f' | 'x') => void;
  pushDifferential: (diff: number) => void;
  // Phase AQ
  setKevinContext: (c: string | null) => void;
  setPersistentPatterns: (p: string | null) => void;
  // Phase BI
  setSelfieB64: (b: string | null) => void;
  setCustomCaddiePortraitB64: (b: string | null) => void;
  setUseCustomCaddie: (on: boolean) => void;
  setCustomCaddieName: (name: string | null) => void;
  // 2026-05-26 — Fix DY: clip CRUD. Pass uri=null to clear a phrase.
  setCustomCaddieClip: (phraseId: string, uri: string | null) => void;
  clearAllCustomCaddieClips: () => void;
  // 2026-05-22 — Launch-prep T&C acceptance.
  acceptTerms: () => void;
  clearTermsAcceptance: () => void;
  // 2026-05-26 — Fix AB Phase 1: GHIN # capture.
  setGhinNumber: (ghin: string | null) => void;
  // 2026-06-04 — Personal-best setters.
  setLongestDrive: (yards: number | null) => void;
  setLongestPutt: (yards: number | null) => void;
  // 2026-06-04 — Kevin's Read cache setter.
  setKevinRead: (read: { text: string; generatedAt: number } | null) => void;
}

// ─── STORE ────────────────────────────────

export const usePlayerProfileStore = create<PlayerProfileState>()(
  persist(
    (set) => ({
      name: '',
      firstName: '',
      handicap: 18,
      handedness: 'right',
      dominantMiss: null,
      missType: null,
      experienceContext: null,
      physicalLimitation: null,
      goal: null,
      personalBest: null,
      homeCourse: null,
      preferredTee: 'middle',
      // 2026-05-14 — Tim: "Get rid of that whole stupid onboarding
      // nonsense. User does all that in profile and settings." Default
      // both gates to TRUE so fresh installs skip the onboarding flow
      // entirely and land on the greeting → caddie route. The screens
      // under /onboarding/ are preserved so the user can still revisit
      // any step via Settings if they want — they just never auto-fire.
      isSetupComplete: true,
      has_completed_onboarding: true,
      default_mode: null,
      first_opened_at: null,
      trial_started_at: null,
      subscription_status: 'free',
      email: null,
      handicap_index: null,
      handicap_gender: 'x',
      recent_differentials: [],
      // Phase AQ defaults
      kevinContext: null,
      persistentPatterns: null,
      patternsSynthesizedAt: null,
      // Phase BI defaults
      selfieB64: null,
      customCaddiePortraitB64: null,
      useCustomCaddie: false,
      // 2026-05-26 — Fix DY default: empty map (no clips recorded yet).
      customCaddieClips: {},
      // 2026-06-06 — Custom caddie name default null → UI falls back to
      // "My Caddie" until the user names theirs.
      customCaddieName: null,
      // 2026-05-22 — Launch-prep T&C acceptance default.
      termsAcceptedAt: null,
      // 2026-05-26 — Fix AB Phase 1: GHIN # default null until captured.
      ghin_number: null,
      // 2026-06-04 — personal-best + Kevin's Read defaults.
      longestDrive: null,
      longestPutt: null,
      kevinRead: null,

      setName: (name) =>
        set({ name, firstName: name.split(' ')[0] ?? name }),
      setHandicap: (hcp) => set({ handicap: hcp }),
      setHandedness: (h) => set({ handedness: h }),
      setDominantMiss: (miss) => set({ dominantMiss: miss }),
      setMissType: (m) => {
        // Auto-derive directional dominantMiss from missType so older
        // code paths keying on dominantMiss keep working.
        const dirMap: Record<string, 'left' | 'right' | 'straight' | null> = {
          slice: 'right', push: 'right',
          hook: 'left', pull: 'left',
          thin: null, fat: null, varies: null,
        };
        const derived = m ? dirMap[m] ?? null : null;
        set(s => ({ missType: m, dominantMiss: derived ?? s.dominantMiss }));
      },
      setExperienceContext: (e) => set({ experienceContext: e }),
      setPhysicalLimitation: (l) => set({ physicalLimitation: l }),
      setGoal: (goal) => set({ goal }),
      setPersonalBest: (score) => set({ personalBest: score }),
      setHomeCourse: (course) => set({ homeCourse: course }),
      setPreferredTee: (tee) => set({ preferredTee: tee }),
      completeSetup: () => set({ isSetupComplete: true }),
      completeOnboarding: () => set({ has_completed_onboarding: true }),
      setDefaultMode: (m) => set({ default_mode: m }),
      initTrial: () => {
        const now = Date.now();
        set({ first_opened_at: now, trial_started_at: now, subscription_status: 'trial' });
      },
      setSubscriptionStatus: (s) => set({ subscription_status: s }),
      setEmail: (email) => set({ email }),
      grantLifetime: () =>
        set(s => ({
          first_opened_at: s.first_opened_at ?? Date.now(),
          // Clear trial timestamp so any UI that checks it doesn't show
          // a "trial expires in X" prompt on a lifetime account.
          trial_started_at: null,
          subscription_status: 'lifetime',
        })),
      setHandicapIndex: (idx) => set(s => {
        // 2026-05-16 — Keep the legacy integer `handicap` field in
        // lockstep with handicap_index so consumers that read either
        // (e.g. dashboard, Kevin's prompt) stay current. Rounded to
        // the nearest whole number; null index clears handicap only
        // when the user hasn't manually entered a non-default value.
        const rounded = idx == null ? s.handicap : Math.max(0, Math.min(54, Math.round(idx)));
        return { handicap_index: idx, handicap: rounded };
      }),
      setHandicapGender: (g) => set({ handicap_gender: g }),
      pushDifferential: (diff) =>
        set(s => ({ recent_differentials: [...s.recent_differentials, diff].slice(-20) })),
      setKevinContext: (c) => set({ kevinContext: c }),
      setPersistentPatterns: (p) =>
        set({ persistentPatterns: p, patternsSynthesizedAt: p ? Date.now() : null }),
      setSelfieB64: (b) => set({ selfieB64: b }),
      setCustomCaddiePortraitB64: (b) => set({ customCaddiePortraitB64: b }),
      setUseCustomCaddie: (on) => set({ useCustomCaddie: on }),
      setCustomCaddieName: (name) => {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        set({ customCaddieName: trimmed.length > 0 ? trimmed : null });
      },
      // 2026-05-26 — Fix DY: clip URI CRUD. uri=null deletes the key
      // entirely so a phrase reverts to "un-recorded" instead of
      // pointing at a stale file path. File deletion is the caller's
      // job (UI re-records / clears the file before this fires).
      setCustomCaddieClip: (phraseId, uri) => set(s => {
        const next = { ...s.customCaddieClips };
        if (uri == null) delete next[phraseId];
        else next[phraseId] = uri;
        return { customCaddieClips: next };
      }),
      clearAllCustomCaddieClips: () => set({ customCaddieClips: {} }),
      // 2026-05-22 — Launch-prep T&C acceptance actions.
      // acceptTerms stamps the timestamp; the welcome screen disables
      // its "Get started" CTA until termsAcceptedAt is non-null.
      // clearTermsAcceptance is exposed for testing + a future Settings
      // surface where the user can revoke ("delete my account" flow).
      acceptTerms: () => set({ termsAcceptedAt: Date.now() }),
      clearTermsAcceptance: () => set({ termsAcceptedAt: null }),
      // 2026-05-26 — Fix AB Phase 1: GHIN # capture. Normalizes
      // common typed-in formats — strips spaces / dashes for the
      // 7-digit case, preserves international XXXX-XXXX format
      // intact. Empty / whitespace-only clears.
      setGhinNumber: (ghin) => {
        const cleaned = typeof ghin === 'string' ? ghin.trim() : '';
        if (!cleaned) return set({ ghin_number: null });
        // For pure-digit input, drop separators; otherwise keep as-is.
        const compact = cleaned.replace(/[\s-]/g, '');
        const normalized = /^\d+$/.test(compact) ? compact : cleaned;
        set({ ghin_number: normalized });
      },
      // 2026-06-04 — Personal-best setters. Both clamp to 0-1000 yards
      // as a sanity gate (the highest drive on the PGA Tour is ~480y;
      // putts longer than ~120ft / 40y are vanishingly rare). null
      // clears the value.
      setLongestDrive: (yards) => {
        if (yards == null || !Number.isFinite(yards) || yards <= 0) return set({ longestDrive: null });
        set({ longestDrive: Math.min(1000, Math.round(yards)) });
      },
      setLongestPutt: (yards) => {
        if (yards == null || !Number.isFinite(yards) || yards <= 0) return set({ longestPutt: null });
        set({ longestPutt: Math.min(1000, Math.round(yards)) });
      },
      // 2026-06-04 — Kevin's Read cache. null clears (forces the
      // dashboard to render the default fallback line).
      setKevinRead: (read) => set({ kevinRead: read }),
    }),
    {
      name: 'player-profile-v2',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      version: 1,
      migrate: (s) => s as never,
      storage: createJSONStorage(() => getPersistStorage()),
      // Phase 410 — Sentry breadcrumb on profile hydration so future
      // user-reported "I lost my data" tickets are debuggable. Records
      // whether the rehydrate succeeded + which key fields were present
      // (presence flags only — no values, PII-safe).
      onRehydrateStorage: () => (state, error) => {
        try {
          // Dynamic require to avoid pulling Sentry at module-eval
          // time (the persist config is evaluated before _layout.tsx
          // wires Sentry.init when EXPO_PUBLIC_SENTRY_DSN is unset).
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Sentry = require('@sentry/react-native');
          if (error) {
            Sentry.addBreadcrumb({
              category: 'profile_hydrate',
              level: 'error',
              message: 'profile rehydrate failed',
              data: { error: error instanceof Error ? error.message : String(error) },
            });
          } else if (state) {
            Sentry.addBreadcrumb({
              category: 'profile_hydrate',
              level: 'info',
              message: 'profile rehydrated',
              data: {
                has_name: !!state.name,
                has_first_opened_at: state.first_opened_at != null,
                has_completed_onboarding: !!state.has_completed_onboarding,
                isSetupComplete: !!state.isSetupComplete,
                subscription_status: state.subscription_status ?? null,
              },
            });
          }
        } catch { /* Sentry unavailable — non-fatal */ }
      },
    },
  ),
);
