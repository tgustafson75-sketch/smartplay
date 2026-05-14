import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

// ─── STATE ────────────────────────────────

// 'lifetime' = owner / founder grant; never expires, never asks for payment.
// Treated identically to 'active' by featureAccess but distinguished so the
// paywall + trial-init paths can short-circuit cleanly.
export type SubscriptionStatus = 'trial' | 'expired' | 'active' | 'free' | 'lifetime';

// Owner allow-list: any user whose email matches one of these gets a
// lifetime grant on first boot, bypassing the trial. Add to this list
// (or set EXPO_PUBLIC_OWNER_EMAIL) when granting comp access.
export const OWNER_EMAILS: readonly string[] = [
  't.gustafson75@gmail.com',
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

  // ─── ACTIONS ────────────────────────────

  setName: (name: string) => void;
  setHandicap: (hcp: number) => void;
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
}

// ─── STORE ────────────────────────────────

export const usePlayerProfileStore = create<PlayerProfileState>()(
  persist(
    (set) => ({
      name: '',
      firstName: '',
      handicap: 18,
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

      setName: (name) =>
        set({ name, firstName: name.split(' ')[0] ?? name }),
      setHandicap: (hcp) => set({ handicap: hcp }),
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
      setHandicapIndex: (idx) => set({ handicap_index: idx }),
      setHandicapGender: (g) => set({ handicap_gender: g }),
      pushDifferential: (diff) =>
        set(s => ({ recent_differentials: [...s.recent_differentials, diff].slice(-20) })),
      setKevinContext: (c) => set({ kevinContext: c }),
      setPersistentPatterns: (p) =>
        set({ persistentPatterns: p, patternsSynthesizedAt: p ? Date.now() : null }),
      setSelfieB64: (b) => set({ selfieB64: b }),
      setCustomCaddiePortraitB64: (b) => set({ customCaddiePortraitB64: b }),
      setUseCustomCaddie: (on) => set({ useCustomCaddie: on }),
    }),
    {
      name: 'player-profile-v2',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
