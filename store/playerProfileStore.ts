import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import { FEET_PER_YARD, PUTT_MAX_FEET } from '../services/puttUnits';

// ─── STATE ────────────────────────────────

// 'lifetime' = owner / founder grant; never expires, never asks for payment.
// Treated identically to 'active' by featureAccess but distinguished so the
// paywall + trial-init paths can short-circuit cleanly.
export type SubscriptionStatus = 'trial' | 'expired' | 'active' | 'free' | 'lifetime';

/**
 * WHO EACH ADDRESS IS — the authoritative mapping (Tim, 2026-09-13).
 *
 * Corrected after a session described `support@smartplaycaddie.com` as "the product support address,
 * not Tim" and treated the two personal addresses as different people. Both were wrong, and the wrong
 * version was about to be handed to a future session as a change prompt. It lives here now because this
 * is the file that decides what the address MEANS, so there is one place to read it from.
 *
 *   t.gustafson75@gmail.com   ┐ BOTH Tim, ONE account/identity — not two owners and not a "test
 *   t.gustafson@hotmail.com   ┘ device" address. The gmail one is his primary; the hotmail one is the
 *                               same person signed in elsewhere: it is the `appleId` on both eas.json
 *                               submit profiles and the Meta glasses developer-app account
 *                               (i18n `the_app_registration_check_out`). Treat any change to one as a
 *                               change to both.
 *   support@smartplaycaddie.com  Tim's MAIN account email. NOT merely an App Review credential, which
 *                               is what the previous comment claimed. It is also the user-facing
 *                               support address printed in the privacy policy and 31 other places —
 *                               see the note below, which is a recorded decision rather than an
 *                               oversight.
 *   tim@smartplaycaddie.com      Google Play / App Review access. Declared in Play Console → App
 *                               content → Sign in details; do not remove without updating that
 *                               declaration, because review uses it to reach paid features.
 *
 * KNOWN AND ACCEPTED (Tim's call, 2026-09-13): `support@smartplaycaddie.com` is on this list AND is
 * published in the app's own privacy policy, so owner privilege — Owner Tools plus the lifetime grant
 * below — is attached to a publicly-known address. It is not reachable without the mailbox, and it stays
 * because it is his main account. Flagged here so nobody re-discovers it as a vulnerability.
 *
 * Owner allow-list: any user whose email matches one of these gets a lifetime grant on first boot,
 * bypassing the trial. Also unlocks the owner-gated debug surfaces (Issue Log, Voice Misses, GPS Test
 * Bench, Kevin Learning) per useDebugRouteGate + Settings → Owner Tools. Add to this list (or set
 * EXPO_PUBLIC_OWNER_EMAIL) when granting comp access. Matching is case-insensitive on the trimmed
 * profile email.
 *
 * NEVER let this list reach exactly ONE entry — see
 * __tests__/regression/a-single-owner-email-would-make-every-install-an-owner.test.ts for why that used
 * to hand every fresh install owner mode, and why the runtime fallback that did so is gone.
 */
export const OWNER_EMAILS: readonly string[] = [
  // Tim — one account, two addresses (see the mapping above).
  't.gustafson75@gmail.com',
  't.gustafson@hotmail.com',
  // Tim's main account email, and the published support address.
  'support@smartplaycaddie.com',
  // Google Play / App Review sign-in.
  'tim@smartplaycaddie.com',
];

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (OWNER_EMAILS.includes(normalized)) return true;
  const fromEnv = (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? '').trim().toLowerCase();
  return fromEnv.length > 0 && fromEnv === normalized;
}

/**
 * Three: a home club, a second you play often, and the one you are travelling to. A fourth is a
 * course list, not a home set, and every one of them queues a geometry build on the Play tab.
 */
export const MAX_HOME_COURSES = 3;

export interface HomeCourse { id: string; name: string }

/** Identity for de-duplication: the id when we have one, otherwise the name folded for case. */
export function homeCourseKey(c: HomeCourse): string {
  return (c.id || '').trim() || (c.name || '').trim().toLowerCase();
}

/** Drop blanks, de-duplicate, and cap at MAX_HOME_COURSES. Enforced in the STORE so a future
 *  surface (or a voice path) cannot write four. */
export function normalizeHomeCourses(courses: HomeCourse[] | null | undefined): HomeCourse[] {
  const seen = new Set<string>();
  const out: HomeCourse[] = [];
  for (const c of courses ?? []) {
    const name = (c?.name ?? '').trim();
    const id = (c?.id ?? '').trim();
    if (!name && !id) continue;
    const key = homeCourseKey({ id, name });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name });
    if (out.length >= MAX_HOME_COURSES) break;
  }
  return out;
}

/** The one a single-course reader should use — his primary. Empty string when none is set. */
export function primaryHomeCourseName(courses: HomeCourse[] | null | undefined): string {
  return (courses ?? [])[0]?.name ?? '';
}

interface PlayerProfileState {
  name: string;
  firstName: string;
  /** Chosen at onboarding (editable in Settings). Frames the app: an
   *  instructor gets coach tools + the coach-report export; a student is
   *  on the receiving end; golfer = standard player. Default 'golfer'. */
  role: 'golfer' | 'instructor' | 'student';
  handicap: number;
  /** Player's swinging hand. Mirrors SmartMotion guides/overlays and L/R
   *  coaching for lefties. Defaults to 'right'. */
  handedness: 'right' | 'left';
  /** Instructor credentials shown on exported coach reports (e.g.
   *  "LPGA Class A · 25 yrs"). The account holder IS the coach in the
   *  coach-report flow; their `name` is the instructor name. null = none. */
  coachCredentials: string | null;
  dominantMiss: 'left' | 'right' | 'straight' | null;
  /**
   * 2026-09-11 (Tim) — HOW THIS PLAYER COVERS AN IN-BETWEEN YARDAGE.
   *
   * "All I do right now is full swing and not good with dialing down yardages so I play according to
   * my yardages and feel."
   *
   * Every yardage app assumes the number is the answer: 134 to the pin, here is the club closest to
   * 134. That silently assumes you can hit any club any distance. For a player who only makes full
   * swings, 134 is not a club — it is a CHOICE between two full swings, and which one is right
   * depends on what the green and the trouble forgive.
   *
   *   'full_swings'   — picks a club and swings. An in-between number is a decision, not a dial.
   *   'some_partials' — can take a little off. THE DEFAULT, so no existing player's reads move
   *                     until they answer the question themselves.
   *   'dial_down'     — comfortable flighting to a number; the nearest club really is the answer.
   */
  distanceControl: 'full_swings' | 'some_partials' | 'dial_down';
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
  /**
   * 2026-09-14 (Tim) — "When user selects up to 3 home courses, logic should spool those to the play
   * tab for the engine to build… I mean so they cue up as three builds in the users play tab courses."
   *
   * UP TO THREE, PICKED NOT TYPED. This was one free-text string matched by SUBSTRING against the
   * bundled catalog in play.tsx — so "Menifee" and "menifee lakes" and a typo all behaved differently,
   * and a player with a summer club and a winter club could only name one of them.
   *
   * The pair is stored rather than an id alone because the bundled catalog (`LOCAL_COURSES`) is
   * declared inside `app/(tabs)/play.tsx`, a screen: a store cannot resolve an id back to a name
   * without dragging a screen into every consumer. The picker knows both at the moment of choosing,
   * so it records both, and nothing downstream needs a lookup. An entry migrated from the old
   * free-text field has a name and an EMPTY id — every name reader still works, and the geometry
   * prefetch skips it, which is honest: we never knew which course it meant.
   */
  homeCourses: { id: string; name: string }[];
  /** 2026-07-23 (Tim — Bag Vision 2b) — the ball the player currently games, free text
   *  (e.g. "Titleist Pro V1"). Compared against the data-driven ball recommendation. */
  currentBall: string | null;
  preferredTee: 'front' | 'middle' | 'back';
  isSetupComplete: boolean;
  has_completed_onboarding: boolean;
  default_mode: 'break_100' | 'break_90' | 'break_80' | 'free_play' | null;
  first_opened_at: number | null;
  trial_started_at: number | null;
  /**
   * 2026-08-30 — an owner COMP with a real end date, distinct from the trial and from lifetime.
   *
   * Tim wanted to live with the paid experience and watch it run down, rather than sit on the
   * permanent lifetime grant his email gets. Deliberately NOT the trial: the trial length is owned
   * by lib/pricing (14 days, matching the App Store Connect introductory offer) and a guard forbids
   * a second copy of that number, so a 30-day comp had to be its own concept rather than a trial of
   * a different length. Persisted automatically — partialize keeps everything it does not name.
   */
  promo_expires_at: number | null;
  /**
   * 2026-09-03 — when the light-use trial extension was given, or null if it never was.
   *
   * Its ONLY job is to make the offer one-time. A standing "here's another week" is a discount
   * rather than a gesture, and a player who took the week and still did not play has answered the
   * question. Stamped by grantTrialExtension, which also lays down the comp — the two cannot come
   * apart, or the offer would re-fire on every launch and the trial would never end.
   */
  trial_extension_granted_at: number | null;
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
  // 2026-06-11 (audit 4c) — LEGACY: these blobs moved to customCaddieMediaStore.
  // Kept only as a read fallback + migration source; nulled after migration.
  selfieB64: string | null;
  customCaddiePortraitB64: string | null;
  useCustomCaddie: boolean;
  // 2026-06-12 (Tim) — the custom caddie keeps its generated FACE but uses a real voice:
  // 2026-08-31 (§22c) — `customCaddieGender` DELETED. It picked the custom caddie's fallback
  // voice (male → Kevin's onyx, female → Serena's nova) — which is exactly what
  // customCaddieBasePersona has done since 2026-07-30, with Harry as a third option. Two controls
  // owned one question, and they were free to disagree: the boot reconcile derived the caddie's
  // gender from THIS field while the voice derived it from the base persona, so the caddie could
  // speak in one voice and be called "he"/"she" from the other. Migration v3 below folds any
  // female value into base persona 'serena' so nobody's caddie changes voice.
  // [[two-owners-is-the-root-cause]]
  // 2026-06-13 — saved pre-round routine (the stretches the caddie gave, captured
  // from the conversation log). Recalled by voice pre-round; null until saved.
  preRoundRoutine: string | null;

  // 2026-06-06 — User-chosen NAME for the custom caddie. Drives the
  // display label everywhere the cycler shows 'Custom' as the 5th
  // persona ("Caddie: <customCaddieName>" toast, the avatar caption
  // chip on the caddie tab, the Settings persona row). Null → UI
  // falls back to "My Caddie" so the user can ship the custom
  // persona without naming it. Set via the custom-caddie screen
  // name input.
  customCaddieName: string | null;

  // 2026-07-30 (Tim — "analyze the caddie photo and assign a fitting OpenAI voice"). The OpenAI TTS
  // voice used when the custom caddie SPEAKS text it has no recorded clip for (previously fell back to
  // a generic gender voice). Auto-suggested by matching the caddie's portrait (services/caddieVoiceMatch)
  // or picked manually. Null → the gender default. One of the OpenAI gpt-4o-mini-tts voices.
  customCaddieVoice: string | null;

  // 2026-07-30 (Tim — "tie my persona and tendencies to Tank or Kevin or Serena"). The custom caddie
  // keeps its own NAME + FACE + (optional) recorded clips, but INHERITS an existing persona's brain
  // personality AND default voice. This gives the custom caddie a real, working persona under the hood
  // instead of a name-only shell (which behaved oddly / "stuck in logic" — no personality spec to run,
  // no mapped voice). customCaddieVoice (photo-matched) still overrides the inherited voice when set.
  // Default 'kevin'. One of the four real personas.
  customCaddieBasePersona: 'kevin' | 'serena' | 'harry';

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
  // beats the current high; `longestPuttFeet` is user-entered in Settings
  // (no automatic detection today — putts are captured as COUNTS per hole,
  // never as distances, so there is nothing to derive it from). null = never set.
  longestDrive: number | null;
  /**
   * 2026-09-13 (Tim) — "putts should be always in Feet." It was `longestPutt` in YARDS, the Settings
   * field said "(yards)", the card read "22y", and the setter clamped at 1000 — three times the
   * longest putt ever holed in a tournament, in the wrong unit. Nobody describes a putt in yards.
   * The unit is in the NAME now, so no surface has to guess and no reviewer has to check.
   */
  longestPuttFeet: number | null;

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
  setRole: (r: 'golfer' | 'instructor' | 'student') => void;
  setCoachCredentials: (c: string | null) => void;
  setDominantMiss: (miss: 'left' | 'right' | 'straight' | null) => void;
  setDistanceControl: (v: 'full_swings' | 'some_partials' | 'dial_down') => void;
  setMissType: (m: 'slice' | 'hook' | 'thin' | 'fat' | 'pull' | 'push' | 'varies' | null) => void;
  setExperienceContext: (e: 'starting' | 'improving' | 'returning' | 'competitive' | null) => void;
  setPhysicalLimitation: (limitation: string | null) => void;
  setGoal: (goal: string | null) => void;
  setPersonalBest: (score: number | null) => void;
  /** Replace the whole set. Trimmed to MAX_HOME_COURSES, de-duplicated by id-or-name. */
  setHomeCourses: (courses: { id: string; name: string }[]) => void;
  /** Toggle one course in or out of the set. Returns false when the set is already full. */
  toggleHomeCourse: (course: { id: string; name: string }) => boolean;
  setCurrentBall: (ball: string | null) => void;
  setPreferredTee: (tee: 'front' | 'middle' | 'back') => void;
  completeSetup: () => void;
  completeOnboarding: () => void;
  setDefaultMode: (m: 'break_100' | 'break_90' | 'break_80' | 'free_play') => void;
  initTrial: () => void;
  setSubscriptionStatus: (s: SubscriptionStatus) => void;
  /** Start a comp for N days. Stamps the end date and sets status 'active'. */
  grantPromo: (days: number) => void;
  /** End a comp early, or clear one that has run out. */
  clearPromo: () => void;
  /**
   * 2026-09-03 — the light-use extension: TRIAL_EXTENSION_DAYS of comp, stamped so it happens once.
   * One action rather than grantPromo + a separate stamp, because a grant that forgets to stamp
   * re-offers itself forever. services/billing/trialUsage decides WHETHER; this only carries it out.
   */
  grantTrialExtension: (days: number) => void;
  /**
   * 2026-09-03 — ADD days to a comp instead of replacing it.
   *
   * grantPromo sets promo_expires_at to `now + days`, which is right for a one-off grant and wrong
   * for referrals: a player who earns a second 30 days while 20 remain would be reset to 30 and
   * silently LOSE 20 they had already been given. Rewards that can arrive more than once have to
   * accumulate. Extends from whichever is later — the existing expiry or now — so an expired comp
   * restarts cleanly rather than back-dating.
   */
  extendPromo: (days: number) => void;
  /**
   * 2026-08-29 — set the trial start from the STORE's clock rather than from first app open.
   * initTrial() stamps the moment the app was first opened, which was correct while the trial was
   * ours to run; under IAP the trial begins when the player buys. See services/billing/purchases.ts
   * `trialStartFromCustomerInfo`.
   */
  setTrialStartedAt: (ms: number | null) => void;
  setEmail: (email: string | null) => void;
  /** Owner override — sets subscription_status='lifetime' and stamps
   *  first_opened_at if missing. Idempotent. */
  grantLifetime: () => void;
  // Phase T
  setHandicapIndex: (idx: number | null) => void;
  setHandicapGender: (g: 'm' | 'f' | 'x') => void;
  pushDifferential: (diff: number) => void;
  resetDifferentials: (diffs: number[]) => void;
  // Phase AQ
  setKevinContext: (c: string | null) => void;
  setPersistentPatterns: (p: string | null) => void;
  // Phase BI
  // 2026-06-11 (audit 4c) — selfieB64/customCaddiePortraitB64 setters removed:
  // those base64 blobs now live in customCaddieMediaStore (off this hot-write
  // store). The READ fields above are kept as a legacy fallback + migration
  // source and are nulled once migrateFromProfile() runs. Write via the media
  // store's setSelfieB64 / setCustomCaddiePortraitB64.
  setUseCustomCaddie: (on: boolean) => void;
  setPreRoundRoutine: (r: string | null) => void;
  setCustomCaddieName: (name: string | null) => void;
  setCustomCaddieVoice: (voice: string | null) => void;
  setCustomCaddieBasePersona: (p: 'kevin' | 'serena' | 'harry') => void;
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
  setLongestPuttFeet: (feet: number | null) => void;
  // 2026-06-04 — Kevin's Read cache setter.
  setKevinRead: (read: { text: string; generatedAt: number } | null) => void;
}

// ─── STORE ────────────────────────────────

export const usePlayerProfileStore = create<PlayerProfileState>()(
  persist(
    (set, get) => ({
      name: '',
      firstName: '',
      role: 'golfer',
      handicap: 18,
      handedness: 'right',
      coachCredentials: null,
      dominantMiss: null,
      distanceControl: 'some_partials' as const,
      missType: null,
      experienceContext: null,
      physicalLimitation: null,
      goal: null,
      personalBest: null,
      homeCourses: [],
      currentBall: null,
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
      promo_expires_at: null,
      trial_extension_granted_at: null,
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
      preRoundRoutine: null,
      // 2026-05-26 — Fix DY default: empty map (no clips recorded yet).
      customCaddieClips: {},
      // 2026-06-06 — Custom caddie name default null → UI falls back to
      // "My Caddie" until the user names theirs.
      customCaddieName: null,
      customCaddieVoice: null,
      customCaddieBasePersona: 'kevin',
      // 2026-05-22 — Launch-prep T&C acceptance default.
      termsAcceptedAt: null,
      // 2026-05-26 — Fix AB Phase 1: GHIN # default null until captured.
      ghin_number: null,
      // 2026-06-04 — personal-best + Kevin's Read defaults.
      longestDrive: null,
      longestPuttFeet: null,
      kevinRead: null,

      setName: (name) =>
        set({ name, firstName: name.split(' ')[0] ?? name }),
      /**
       * 2026-09-13 — WRITES BOTH, because it is the MIRROR that is being set.
       *
       * `handicap` mirrors `handicap_index` (setHandicapIndex has kept them in lockstep since
       * 2026-05-16) — but only in that direction. This setter wrote the integer alone, so every
       * caller of it silently desynced the pair: Settings had a "Handicap" box wired here next to
       * an "Index" box wired to the other, and onboarding wrote a first-run handicap that left the
       * Index null. Both UI paths now write the index; this keeps the pair honest for anything that
       * reaches for the mirror later. [[two-owners-is-the-root-cause]]
       */
      setHandicap: (hcp) => set({ handicap: hcp, handicap_index: hcp }),
      setHandedness: (h) => set({ handedness: h }),
      setRole: (r) => set({ role: r }),
      setCoachCredentials: (c) => set({ coachCredentials: c && c.trim().length > 0 ? c.trim() : null }),
      setDominantMiss: (miss) => set({ dominantMiss: miss }),
      setDistanceControl: (v) => set({ distanceControl: v }),
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
      setHomeCourses: (courses) => set({ homeCourses: normalizeHomeCourses(courses) }),
      toggleHomeCourse: (course) => {
        const key = homeCourseKey(course);
        const cur = get().homeCourses ?? [];
        const existing = cur.filter((c: HomeCourse) => homeCourseKey(c) !== key);
        if (existing.length !== cur.length) {           // it was there — this tap removes it
          set({ homeCourses: existing });
          return true;
        }
        // A fourth pick is refused rather than silently evicting one of his three.
        if (cur.length >= MAX_HOME_COURSES) return false;
        set({ homeCourses: normalizeHomeCourses([...cur, course]) });
        return true;
      },
      setCurrentBall: (ball) => set({ currentBall: ball }),
      setPreferredTee: (tee) => set({ preferredTee: tee }),
      completeSetup: () => set({ isSetupComplete: true }),
      completeOnboarding: () => set({ has_completed_onboarding: true }),
      setDefaultMode: (m) => set({ default_mode: m }),
      initTrial: () => {
        const now = Date.now();
        // first_opened_at is PRESERVED when it already exists. This is called on a fresh install,
        // where it is null and becomes now — but also when billing turns on for a player who has
        // been using the app for weeks (app/_layout.tsx step 3). Clobbering it there would reset
        // "when did this person start with us" to the day we started charging.
        set(s => ({
          first_opened_at: s.first_opened_at ?? now,
          trial_started_at: now,
          subscription_status: 'trial',
        }));
      },
      setSubscriptionStatus: (s) => set({ subscription_status: s }),
      grantPromo: (days) =>
        set({
          promo_expires_at: Date.now() + Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000,
          subscription_status: 'active',
        }),
      clearPromo: () => set({ promo_expires_at: null }),
      extendPromo: (days) =>
        set((st) => {
          const now = Date.now();
          const from = st.promo_expires_at != null && st.promo_expires_at > now ? st.promo_expires_at : now;
          return {
            promo_expires_at: from + Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000,
            subscription_status: 'active',
          };
        }),
      grantTrialExtension: (days) => {
        const now = Date.now();
        set({
          promo_expires_at: now + Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000,
          subscription_status: 'active',
          // Stamped in the SAME set() as the grant. Two writes could interleave with a boot-time
          // lifecycle pass and leave a comp with no stamp behind it, which re-offers on next launch.
          trial_extension_granted_at: now,
        });
      },
      setTrialStartedAt: (ms) => set({ trial_started_at: ms }),
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
      resetDifferentials: (diffs) => set({ recent_differentials: diffs }),
      setKevinContext: (c) => set({ kevinContext: c }),
      setPersistentPatterns: (p) =>
        set({ persistentPatterns: p, patternsSynthesizedAt: p ? Date.now() : null }),
      setUseCustomCaddie: (on) => set({ useCustomCaddie: on }),
      setPreRoundRoutine: (r) => set({ preRoundRoutine: r && r.trim() ? r.trim() : null }),
      setCustomCaddieVoice: (voice) => set({ customCaddieVoice: voice }),
      setCustomCaddieBasePersona: (p) => set({ customCaddieBasePersona: (['kevin', 'serena', 'harry'] as const).includes(p) ? p : 'kevin' }),
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
        // 2026-06-30 (Tim) — a drive never exceeds ~500y. A larger value is a corrupt capture
        // (e.g. the whole-course total leaked in), so REJECT it — keep the current best rather
        // than record a fake number. (Was clamped to 1000, still absurd for a drive.)
        if (yards > 500) return;
        set({ longestDrive: Math.round(yards) });
      },
      setLongestPuttFeet: (feet) => {
        if (feet == null || !Number.isFinite(feet) || feet <= 0) return set({ longestPuttFeet: null });
        // PUTT_MAX_FEET rejects rather than clamps, the same call setLongestDrive makes: a number
        // past the longest putt ever holed is a mis-key, and silently recording 400 as a personal
        // best is worse than ignoring the keystroke.
        if (feet > PUTT_MAX_FEET) return;
        set({ longestPuttFeet: Math.round(feet) });
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
      // 2026-08-26 (v2) — a removed persona could be PERSISTED here as a custom caddie's base
      // personality from an earlier build. The union no longer admits it, so a stale blob would
      // otherwise keep feeding that name + voice to the brain. Map it to Kevin, matching the
      // settings v22 migration. Everything else passes through untouched.
      // 2026-08-31 (v3) — `customCaddieGender` is gone (§22c). Anyone who had chosen FEMALE picked
      // Serena's voice by that control's own label, so fold it into the base persona that now owns
      // the choice — but only when the base persona is still the untouched default, since an
      // explicit base persona is the newer and more specific statement of intent. Without this a
      // female custom caddie would silently become male on the update.
      // 2026-09-13 (v4) — `longestPutt` held YARDS under a Settings field labelled "(yards)", and
      // Tim's read 22. A putt is always in feet (services/puttUnits), so the field is now
      // `longestPuttFeet`. The stored number is converted at the rate the LABEL promised — 22 yards
      // is 66 feet — rather than reinterpreted as feet, because reinterpreting would mean deciding
      // the old label was lying to him, which is a guess. 66 feet is a real lag putt; if it is not
      // the number he meant, the field now says FEET and he can correct it in one keystroke. The
      // alternative — dropping the value — loses a personal best to a unit change, and inventing a
      // number is the only thing worse than losing one.
      version: 5,
      migrate: (s) => {
        const p = s as Record<string, unknown> | null;
        /**
         * v4 → v5: the single free-text `homeCourse` becomes a set of up to three PICKED courses.
         *
         * The old value is a name he typed, and there is no catalog in reach of a store to resolve it
         * to an id — so it is carried across as a name-only entry. Every reader that wanted a NAME
         * keeps working unchanged; the geometry prefetch skips an entry with no id rather than
         * guessing which course "menifee" meant, and the first tap in the new picker replaces it with
         * a real one. Losing the value outright would strand the only thing he had told us.
         */
        /**
         * `typeof p === 'object'`, not just `p` — and that check is here because the hostile-blob
         * guard caught this line throwing. A persisted value can rehydrate as a STRING (a truncated
         * or corrupt write), which is truthy, and assigning a property to a primitive throws in
         * strict mode. A migration that throws takes rehydration down, and a store that cannot
         * rehydrate is the white-screen class of bug. The lines above me only ever READ from `p`,
         * which is why they were safe and this one was not.
         */
        if (p && typeof p === 'object' && !Array.isArray(p.homeCourses)) {
          const legacy = typeof p.homeCourse === 'string' ? p.homeCourse.trim() : '';
          p.homeCourses = legacy ? [{ id: '', name: legacy }] : [];
          delete p.homeCourse;
        }
        if (p && (p.customCaddieBasePersona as string) === 'tank') p.customCaddieBasePersona = 'kevin';
        if (p && p.longestPuttFeet == null && typeof p.longestPutt === 'number' && p.longestPutt > 0) {
          p.longestPuttFeet = Math.min(PUTT_MAX_FEET, Math.round(p.longestPutt * FEET_PER_YARD));
        }
        if (p) delete p.longestPutt;
        if (p && p.customCaddieGender === 'female'
            && (p.customCaddieBasePersona == null || p.customCaddieBasePersona === 'kevin')) {
          p.customCaddieBasePersona = 'serena';
        }
        if (p) delete p.customCaddieGender;
        return p as never;
      },
      // 2026-06-08 (audit #2, privacy) — keep the GHIN # OUT of the on-disk
      // blob so there's no plaintext at rest. It stays in memory for the
      // session (re-enter after a cold start until the encrypted-at-rest
      // path lands — requires the expo-secure-store native module). Spread-
      // omit persists every OTHER field unchanged (no enumeration / data
      // loss). Old blobs purge their stored GHIN on the next persist write.
      partialize: (s) => {
        // 2026-06-11 (audit 4c) — also drop the custom-caddie base64 blobs from
        // this store's persisted payload; they live in customCaddieMediaStore
        // now, so this hot-write store stops re-serializing ~hundreds of KB on
        // every profile/handicap change. (ghin_number stays omitted for privacy.)
        const { ghin_number, selfieB64, customCaddiePortraitB64, ...rest } = s;
        void ghin_number; void selfieB64; void customCaddiePortraitB64;
        return rest as Omit<PlayerProfileState, 'ghin_number' | 'selfieB64' | 'customCaddiePortraitB64'>;
      },
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
