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
  '/swinglab/coach-lesson', // Coach Caddie — explicitly 2.0 (its planById service export is already orphaned)
  '/swinglab/coach-mode',   // coach-facing tool inside a consumer app, and carries v2 TODOs
]);

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
 * The glasses are the clearest case for holding: they depend on Meta's developer mode, a paired
 * account, and an SDK that still does not expose temple-tap events. A reviewer who toggles it
 * without any of that sees a failure that looks like our bug. The WATCH is the opposite call and
 * ships in 1.0 — it runs on-device today.
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
