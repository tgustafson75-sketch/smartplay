/**
 * 2026-08-25 (Tim, App Store submission build) — WHAT THE PLAYER CAN SEE IN 1.0.
 *
 * "I only want things going forward that are elite and ready for prime time... I don't mean deleting
 * the functions behind the curtain. I'm saying as a separate identifiable drill that users can see,
 * then we pull it out as a refined function."
 *
 * So this is NOT a delete list. Every screen below still exists, still compiles, and its engine still
 * runs wherever a shipping surface uses it — SmartMotion remains the primary writer of the tempo
 * model, so shelving Hotel Mode and SwingSim costs no learning. What changes is that they stop being
 * separately identifiable cards a first-time user has to understand, and stop being things an App
 * Store reviewer can find half-finished (Coach Mode still carries "Coach Mode v2" TODOs in source).
 *
 * ONE OWNER, THREE CONSUMERS. A card hidden from the hub is not hidden: `appCatalog` tells the caddie
 * which features exist, and `openToolHandler` gives it deterministic routes to open them. Hiding the
 * card while leaving those two wired would mean the caddie still offers a shelved screen and
 * navigates straight to it — the exact "connected but not used" trap, inverted. All three read this
 * file, and a sim guard asserts none of them can name a shelved route.
 *
 * To bring one back for 2.0: delete its line here. Nothing else needs to change.
 */

/** Routes shelved for 2.0 — present in the codebase, absent from the 1.0 player surface. */
export const SHELVED_ROUTES: ReadonlySet<string> = new Set<string>([
  /**
   * Open Range — NOT a quality cut. It is honest and working today (every number comes from
   * summarizeOpenRange over real analyzed swings, no fabricated dispersion), and it overlaps Focus
   * Session, so nothing is lost by holding it.
   *
   * Tim 2026-08-25 — it is WAITING ON A SENSOR, not on code: "Open Range is gonna be a really cool
   * tool when we increase the vision. It's something I wanna check when I get the iPhone 17 Pro Max
   * that has up to 120 FPS and see if that has better response in terms of ball tracing, ball
   * tracking." Mashing balls is the one surface whose value scales directly with capture rate.
   *
   * BRING IT BACK when 120fps capture is tested and ball tracing measurably improves — not before,
   * and not for any other reason. Related: the parked 240fps face/smash work.
   */
  '/practice/open-range',
  '/swinglab/indoor',       // Hotel Mode — small-space practice; folds back in as a refined mode later
  '/swinglab/simround',     // SwingSim

  /**
   * 2026-09-20 — COACH MODE IS OUT OF HERE, on Tim's instruction: he is showing it to golf coaches
   * this week and it is the coach-facing card in SwingLab ("Analyze other players and build your
   * coaching roster").
   *
   * Reviewed for completeness before surfacing rather than after:
   *   - Every destination is live — /swinglab/smartmotion, /swinglab/player-library/[player_id],
   *     /swinglab/swing/[swing_id]. None shelved, none missing.
   *   - The load-bearing claim is TRUE: setting familyStore.active_member_id really does route the
   *     analysis to the student. mediaCapture, videoUpload, swingLibrary, swingerHandedness and
   *     glassesVisionInput all read it at ingest. Verified in those files, not taken from the
   *     header. [[a-stale-header-is-a-source-someone-trusts]]
   *   - The student-swing list matches on `player_id` FIRST with a legacy name fallback, so the v2
   *     TODO's "robust against renames" worry was already closed by the 2026-07-10 audit.
   *
   * What is genuinely deferred and is NOT a hole: multi-swing voice walkthrough, and voice-to-text
   * for the coach note (text entry works today). Both are additive next layers.
   */
]);

/**
 * 2026-09-20 (Tim) — "Take a look at Coach Caddie and see if we can release a strong beta version."
 *
 * A THIRD state, between shelved and shipped: it reaches players, and it says what it is.
 *
 * Coach Caddie was shelved on 2026-08-25 as "explicitly 2.0". Reviewed again today, that call has
 * been overtaken by the work done since:
 *
 *   - The coaching brain (coachKnowledge + coachSession + coachLesson) is pure and carries 47 tests.
 *   - The flow degrades honestly at every step: an unreadable window re-prompts softly instead of
 *     nagging, a camera that cannot start falls back to the picker, a cancelled picker re-arms
 *     rather than silently killing the loop, and DTL-invalid metrics are nulled so the coach never
 *     speaks a number it did not measure.
 *   - The one thing that WAS dishonest is fixed: before 2026-09-01 the pose sampler placed P1/P4/P6
 *     at fixed fractions of a ten-second window, so every number the coach spoke was measured at
 *     whatever the body happened to be doing at 0.65 of the clip. It now locates the real swing on
 *     device and the positions are strike-anchored measurements.
 *
 * What is left is the reason this is BETA and not GA, and it is the kind of thing only real use
 * settles: the ten-second window and the re-arm rhythm have not been tuned across many swings on
 * many devices, and the diagnostic mode does not yet share the auto-loop. Tim's bar for surfacing
 * it unlabelled is "totally ready", and that bar has not been met — so it ships wearing the word.
 *
 * A beta route is NOT shelved: the hub shows it, the caddie can open it, and every consumer treats
 * it as real. The only difference is the badge. [[teach-before-you-grade]]
 */
export const BETA_ROUTES: ReadonlySet<string> = new Set<string>([
  '/swinglab/coach-lesson',
]);

/** True when a route ships to everyone but is still finding its edges on real devices. */
export function isBeta(route: string | null | undefined): boolean {
  return !!route && BETA_ROUTES.has(route);
}

/** What a beta card says instead of its role tag. */
export const BETA_BADGE = 'BETA';

/**
 * 2026-08-25 (Tim, same day) — "you weren't supposed to remove swing lab from my owners build, just
 * label them as owner only."
 *
 * My error: I hid these from EVERY build, including his. He tests on the shipped app, so hiding a
 * screen from himself removes the only way he exercises it. Shelved means **hidden from players and
 * visible-but-labelled for the owner** — the same pattern already used for watch extras
 * (watchRoundSync), feel capture and the boot trace, all gated on isOwnerEmail.
 *
 * Deliberately checked at CALL TIME rather than captured once: the owner email arrives with the
 * profile, which hydrates after first paint, so a value read at module load would be wrong on the
 * very first render — the same hydration trap that has bitten this project before.
 */
export function isOwnerBuild(): boolean {
  try {
    const prof = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    return prof.isOwnerEmail(prof.usePlayerProfileStore.getState().email);
  } catch {
    return false;   // never let an owner check crash a screen — a player build is the safe answer
  }
}

/**
 * True when a route must not be offered to THIS user in this release.
 * Players: hidden. Owner: shown, and the caller marks it (see SHELVED_BADGE).
 */
export function isShelved(route: string | null | undefined): boolean {
  if (!route) return false;
  const clean = route.split('?')[0]!.replace(/\/+$/, '');
  if (!SHELVED_ROUTES.has(clean)) return false;
  return !isOwnerBuild();
}

/** True when this route ships to nobody but the owner — used to badge it in the UI. */
export function isOwnerOnly(route: string | null | undefined): boolean {
  if (!route) return false;
  const clean = route.split('?')[0]!.replace(/\/+$/, '');
  return SHELVED_ROUTES.has(clean) && isOwnerBuild();
}

/** Badge text for an owner-only surface. One owner for the wording. */
export const SHELVED_BADGE = 'OWNER · 2.0';

/**
 * 2026-08-25 (Tim) — "Meta glasses don't have to go in 1.0, but the watch functionality does."
 *
 * Not everything shelved is a ROUTE. The glasses are three settings rows (live point-of-view
 * stream, voice-log import, media-ingest setup), so the route list above cannot express them.
 * Same rule, different key: the code stays, the player-facing control goes.
 *
 * WHY THE GLASSES HOLD — corrected 2026-09-01 (Tim: "yes they do have an SDK and we have it
 * already"). The old reason given here was "an SDK that still does not expose temple-tap events".
 * That was wrong twice over and it was the justification for shelving, so it is worth being exact:
 *
 *   • Meta ships the Device Access Toolkit and it IS integrated (MetaWearablesFrameModule +
 *     metaWearablesBridge, POV frames into the caddie brain). Nothing is waiting on Meta.
 *   • The temple tap never needed that SDK. The glasses pair as a Bluetooth audio device, so a tap
 *     arrives as a media-key press the earbud bridge already handles — it works TODAY, on the
 *     shipped build, and is NOT shelved. It rides the earbud tap-to-talk switch.
 *
 * The REAL reason to hold is the build, not the capability: the DAT paths need the `glasses` EAS
 * profile (and a GITHUB_TOKEN for the Android package), and build 21 is not that profile. A player
 * on a standard build who toggles POV streaming gets a failure that reads as our bug.
 *
 * So what is shelved is the three DAT-dependent SETTINGS ROWS, not glasses support as a concept.
 * The WATCH is the opposite call and ships in 1.0 — it runs on-device today.
 * [[a-stale-header-is-a-source-someone-trusts]]
 */
export type ShelvedFeature = 'meta_glasses';

const SHELVED_FEATURES: ReadonlySet<ShelvedFeature> = new Set<ShelvedFeature>([
  'meta_glasses',
]);

/**
 * True when a named (non-route) feature must not be offered to THIS user in this release.
 * Same rule as routes: hidden from players, still reachable for the owner so it can be tested.
 */
export function isFeatureShelved(feature: ShelvedFeature): boolean {
  return SHELVED_FEATURES.has(feature) && !isOwnerBuild();
}
