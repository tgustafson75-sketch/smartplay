/**
 * Phase 105 — Team caddie resolver.
 *
 * The app routes per-pillar caddie assignments through this module so
 * voice paths, system-prompt builders, avatar rendering, and any other
 * caller can ask "who is the active caddie right now?" without re-deriving
 * the lookup.
 *
 * Pillars correspond to the four product surfaces a caddie owns:
 *   - round    : on-course play (Caddie home, mid-round voice, recap)
 *   - practice : SwingLab / swing review / per-swing feedback
 *   - drills   : SwingLab drill detail / drill execution
 *   - play     : Arena / Play / gamification surfaces
 *
 * 2026-09-01 — this list said `cage`, and the code has returned 'practice' since the unification
 * that removed that mode entirely. A stale header is a source someone trusts: the pillar names here
 * are what a reader copies into a new call site, and 'cage' has not existed for weeks.
 * [[a-stale-header-is-a-source-someone-trusts]] [[nobody-chose-cage-the-default-did]]
 *
 * Surface → pillar mapping is small and explicit (mapSurfaceToPillar).
 * Anything not mapped falls back to 'round' — a safe default for
 * miscellaneous surfaces (Settings, About, etc.) where the user is most
 * likely thinking about the caddie they have on the course.
 */

import { useSettingsStore, DEFAULT_CADDIE_ASSIGNMENTS } from '../store/settingsStore';
import type { Persona, CaddiePillar } from '../store/settingsStore';
import { getActiveSurface, type ActiveSurface } from './activeSurfaceRegistry';
import { getCaddieName } from '../lib/persona';

export type { Persona, CaddiePillar };

// Map an ActiveSurface name to the pillar it belongs to.
// 'caddie' / 'recap' / 'arena' (when round-flavored) → round
// 'swing_library' / 'swing_detail' → practice
// (drill detail surfaces will map to 'drills' once they self-register)
// 'arena' (when treating as Play) → play
// Default: 'round'.
export function mapSurfaceToPillar(surface: ActiveSurface): CaddiePillar {
  switch (surface) {
    case 'cage':
    case 'swing_library':
    case 'swing_detail':
      return 'practice';
    case 'arena':
      return 'play';
    case 'caddie':
    case 'recap':
    case null:
    default:
      return 'round';
  }
}

// Read the assigned caddie for a specific pillar. Falls back to the
// pillar's default if assignment missing (defensive — shouldn't happen
// after migration, but cheap to handle).
export function getCaddieForPillar(pillar: CaddiePillar): Persona {
  const state = useSettingsStore.getState();
  const assigned = state.caddieAssignments?.[pillar] ?? DEFAULT_CADDIE_ASSIGNMENTS[pillar];
  // 2026-08-25 — the Tank fallback that stood here is gone with the persona. A persisted 'tank'
  // assignment is migrated to Kevin by settings v22, and resolvePersona maps any stray value to
  // Kevin, so there is nothing left to catch here.
  return assigned;
}

// Active caddie for the current surface. Convenience wrapper that
// reads the active-surface registry and routes through mapSurfaceToPillar.
export function getActiveCaddie(): Persona {
  return getCaddieForPillar(mapSurfaceToPillar(getActiveSurface()));
}

// Active caddie scoped to an explicit pillar (use when caller knows the
// pillar and doesn't want to depend on the registry — e.g. a server-side
// payload builder that's already received the pillar from the client).
export function getActiveCaddieForPillar(pillar: CaddiePillar): Persona {
  return getCaddieForPillar(pillar);
}

/**
 * 2026-09-01 (Tim, on Coach Caddie for 1.0 — "whoever is currently selected would be the coach. We
 * might in 2.0 have a completely separate, really more elite, stepped-up, capable entity") — THE NAME
 * TO PUT ON SCREEN.
 *
 * Three surfaces were each spelling `customCaddieName ?? 'My Caddie'` by hand, which is the shape
 * this repo keeps finding as a defect: getCaddieName() returns the STATIC fallback 'My Caddie' for a
 * custom persona, because the name the player actually chose lives in playerProfileStore, not in
 * lib/persona. Any surface that forgets the second half addresses a player's own caddie as "My
 * Caddie" — which is precisely the moment a custom caddie stops feeling like theirs.
 * [[two-owners-is-the-root-cause]] [[feels-like-a-real-caddie]]
 *
 * Defensive because it is a render path: a store that has not hydrated must yield the static name,
 * never an exception into a component tree.
 */
export function displayCaddieName(persona?: Persona | null): string {
  const p = persona ?? getActiveCaddie();
  if (p !== 'custom') return getCaddieName(p);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prof = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    const chosen = prof.usePlayerProfileStore.getState().customCaddieName;
    if (typeof chosen === 'string' && chosen.trim()) return chosen.trim();
  } catch { /* not hydrated — the static name is the honest answer */ }
  return getCaddieName('custom');
}
