/**
 * App feature flags.
 *
 * A flag that is OFF must hide the feature's entry points AND guard its route, so the feature
 * is neither visible nor deep-linkable in that build (belt + suspenders).
 */

/**
 * In-app messaging (Tim ↔ Tank thread today; future social layer).
 *
 * 2026-07-21 (Tim) — this is a RELEASE feature, NOT a beta feature. Kept OFF in the beta so
 * testers don't see an unfinished social surface. Flip `MESSAGING_RELEASED` to true at general
 * release to turn on the Settings + Dashboard entry points, the voice-nav target, and the route.
 * `__DEV__` keeps it reachable in local development so it can keep being built.
 */
const MESSAGING_RELEASED = false;
export const MESSAGING_ENABLED = MESSAGING_RELEASED || __DEV__;
