/**
 * Phase 105 — Team caddie resolver.
 *
 * The app routes per-pillar caddie assignments through this module so
 * voice paths, system-prompt builders, avatar rendering, and any other
 * caller can ask "who is the active caddie right now?" without re-deriving
 * the lookup.
 *
 * Pillars correspond to the four product surfaces a caddie owns:
 *   - round   : on-course play (Caddie home, mid-round voice, recap)
 *   - cage    : Cage Mode / SwingLab Cage (per-swing review, drill plate)
 *   - drills  : SwingLab drill detail / drill execution
 *   - play    : Arena / Play / gamification surfaces
 *
 * Surface → pillar mapping is small and explicit (mapSurfaceToPillar).
 * Anything not mapped falls back to 'round' — a safe default for
 * miscellaneous surfaces (Settings, About, etc.) where the user is most
 * likely thinking about the caddie they have on the course.
 */

import { useSettingsStore, DEFAULT_CADDIE_ASSIGNMENTS } from '../store/settingsStore';
import type { Persona, CaddiePillar } from '../store/settingsStore';
import { getActiveSurface, type ActiveSurface } from './activeSurfaceRegistry';

export type { Persona, CaddiePillar };

// Map an ActiveSurface name to the pillar it belongs to.
// 'caddie' / 'recap' / 'arena' (when round-flavored) → round
// 'cage' / 'swing_library' / 'swing_detail' → cage
// (drill detail surfaces will map to 'drills' once they self-register)
// 'arena' (when treating as Play) → play
// Default: 'round'.
export function mapSurfaceToPillar(surface: ActiveSurface): CaddiePillar {
  switch (surface) {
    case 'cage':
    case 'swing_library':
    case 'swing_detail':
      return 'cage';
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
  // 2026-08-06 (Tim — Tank is opt-in via Owner Tools; default Serena/Kevin). When Tank is disabled, a
  // 'tank' assignment (persisted from before, or from the single caddiePersonality mirror) resolves to the
  // pillar's non-tank default so the app never actually runs Tank unless the owner enabled him.
  if (assigned === 'tank' && !state.tankEnabled) {
    const fallback = DEFAULT_CADDIE_ASSIGNMENTS[pillar];
    return fallback === 'tank' ? 'kevin' : fallback;
  }
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
