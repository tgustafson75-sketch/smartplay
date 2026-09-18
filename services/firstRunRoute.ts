/**
 * 2026-09-03 — THE FIRST-RUN ORDER, AS A FUNCTION INSTEAD OF A CHAIN OF REDIRECTS.
 *
 * app/index.tsx decides what a launching player sees by falling through a series of early
 * `<Redirect>` returns. That is fine to read and impossible to verify: the order is the whole
 * behaviour, every new install depends on it, and nothing could assert it.
 *
 * It mattered the day it was written. The order was intro → PERMISSIONS → welcome, so a brand-new
 * install got camera, microphone and location dialogs before the player had been told what the app
 * does or agreed to anything — welcome is the only place the Terms/Privacy consent lives. (The
 * intro step itself was removed on 2026-09-18; see step 1.) Reordering it was
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
  /** tutorialsSeen['core_permissions_requested'] — set on EVERY exit from the permissions screen,
   *  including one where the player declined every dialog. */
  corePermissionsAsked: boolean;
  /** playerProfile.termsAcceptedAt != null — set only by welcome.tsx. */
  termsAccepted: boolean;
  /** A non-empty profile name. A returning player has one even without fresh consent. */
  hasName: boolean;
  /** tutorialsSeen['bag_setup_offered'] — set by bag-scan ON MOUNT, so it is offered exactly once. */
  bagSetupOffered: boolean;
  /** clubBagStore has no registered clubs yet. */
  bagEmpty: boolean;
};

/** Where to send the player, or null when first run is complete and the app should proceed. */
export type FirstRunRoute = '/welcome' | '/permissions' | '/bag-scan' | null;

export function decideFirstRunRoute(s: FirstRunState): FirstRunRoute {
  /**
   * 1. CONSENT, BEFORE ANY SENSITIVE PERMISSION IS REQUESTED.
   *
   * 2026-09-18 (Tim — "I thought we removed that intro video? its okay but if it causes any issues
   * it needs to go") — IT WAS STILL STEP ONE, AND IT IS GONE FROM HERE.
   *
   * An 11 MB bundled mp4, decoded at the coldest moment there is: a first launch, before the stores
   * have hydrated, on a device that has just finished installing. It is the first thing between a
   * new player and the app, and it is the one step of first run that gives them nothing — no
   * consent, no permission, no club in the bag. It also arrived the same day as a production memory
   * warning (Sentry, iPad8,6 on Mac Catalyst), which is exactly the kind of "any issues" he means.
   *
   * The SCREEN is not deleted and neither is the film: /intro-video still exists and is now in the
   * feature catalog, so "play the intro" opens it. What is gone is the app playing it AT someone
   * who has not agreed to anything yet. [[feels-like-a-real-caddie]]
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

  // 2. One batch of core permissions, so individual tools never prompt mid-round. Reached only
  //    after consent.
  //
  //    2026-09-17 — the screen no longer HAS a skip button; App Review 5.1.1(iv) required that the
  //    primer always proceed to the request (see app/permissions.tsx). The property this step
  //    depends on is unchanged and is now carried differently: every exit from that screen routes
  //    through its single exit() and sets the flag — a full grant, a total denial, and a thrown
  //    request alike. So declining still advances rather than trapping the player on it.
  //    [[a-stale-header-is-a-source-someone-trusts]]
  if (!s.corePermissionsAsked) return '/permissions';

  /**
   * 3. THE BAG, ONCE — 2026-09-13 (Tim: "shouldn't The Bag be populated originally in the Profile?").
   *
   * A fresh install finished setup with an EMPTY registered bag and `bagClubs: []` going to the
   * caddie, while club selection and plays-like read from that bag. The only way to fill it was to
   * find /bag-scan, which nothing pointed at. This is not a new onboarding step in welcome.tsx —
   * that screen is deliberately ONE screen ("get rid of that whole stupid onboarding nonsense") —
   * it is the same re-entrant router sequence that already places the intro, consent and
   * permissions, so it stays skippable and cannot stack.
   *
   * `bagSetupOffered` is set by bag-scan ON MOUNT, on the same principle as the permissions screen
   * setting its flag on every exit. Without that, safeBack() from a first-run arrival has no stack to return to, the
   * router re-evaluates, and the player is put straight back on the screen they just left.
   * [[a-toggle-that-does-nothing-for-the-default-user]]
   */
  if (!s.bagSetupOffered && s.bagEmpty) return '/bag-scan';

  return null;
}
