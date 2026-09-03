/**
 * 2026-09-03 — THE FIRST-RUN ORDER, AS A FUNCTION INSTEAD OF A CHAIN OF REDIRECTS.
 *
 * app/index.tsx decides what a launching player sees by falling through a series of early
 * `<Redirect>` returns. That is fine to read and impossible to verify: the order is the whole
 * behaviour, every new install depends on it, and nothing could assert it.
 *
 * It mattered today. The order was intro → PERMISSIONS → welcome, so a brand-new install got
 * camera, microphone and location dialogs before the player had been told what the app does or
 * agreed to anything — welcome is the only place the Terms/Privacy consent lives. Reordering it was
 * a one-line move whose only verification was reading the file and believing myself, on the single
 * flow that every user of the release build walks through exactly once and can never re-walk.
 *
 * So the gate order is a pure function and the screen asks it. Same decisions, same order, now
 * with the branches a test can enumerate — including the two that are easy to get wrong:
 * accepting terms must NOT skip the permission pre-flight, and a half-finished first run must
 * resume where it stopped rather than starting over or falling through to the app.
 * [[arithmetic-belongs-in-code-not-the-model]]
 */

export type FirstRunState = {
  /** tutorialsSeen['intro_video'] */
  introVideoSeen: boolean;
  /** tutorialsSeen['core_permissions_requested'] — set on Allow AND on Skip. */
  corePermissionsAsked: boolean;
  /** playerProfile.termsAcceptedAt != null — set only by welcome.tsx. */
  termsAccepted: boolean;
  /** A non-empty profile name. A returning player has one even without fresh consent. */
  hasName: boolean;
};

/** Where to send the player, or null when first run is complete and the app should proceed. */
export type FirstRunRoute = '/intro-video' | '/welcome' | '/permissions' | null;

export function decideFirstRunRoute(s: FirstRunState): FirstRunRoute {
  // 1. The intro plays once per install, before anything asks the player for something.
  if (!s.introVideoSeen) return '/intro-video';

  /**
   * 2. CONSENT, BEFORE ANY SENSITIVE PERMISSION IS REQUESTED.
   *
   * Both stores expect disclosure and consent to precede access to sensitive data, and a reviewer
   * meets this ordering on the very first launch. It is also simply the right way round as product:
   * three system dialogs before a word of explanation is the worst possible moment to ask, and it
   * costs grant rates on the permissions the whole app runs on.
   *
   * Narrow on purpose — BOTH must be missing. A returning player who has a name skips this even if
   * the consent timestamp predates the field, rather than being re-prompted for something they
   * already did.
   */
  if (!s.termsAccepted && !s.hasName) return '/welcome';

  // 3. One batch of core permissions, so individual tools never prompt mid-round. Reached only
  //    after consent. The screen sets its flag on Skip as well as Allow, so declining still
  //    advances rather than trapping the player on it.
  if (!s.corePermissionsAsked) return '/permissions';

  return null;
}
