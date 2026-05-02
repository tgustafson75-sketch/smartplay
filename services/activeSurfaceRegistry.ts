/**
 * Phase R — Active surface registry.
 *
 * Tiny module-level state that surfaces register themselves into on mount
 * (and clear on unmount). Read by listeningSession.pickOpener() to choose
 * the correct role register (Caddie / Coach / Psychologist) for the
 * earbud-tap opener.
 *
 * Cleaner than threading expo-router state into a non-React function and
 * cheaper than reading the navigation stack from outside React.
 */

export type ActiveSurface = 'caddie' | 'cage' | 'arena' | 'swing_library' | 'swing_detail' | 'recap' | null;

let activeSurface: ActiveSurface = null;

export function setActiveSurface(s: ActiveSurface): void {
  activeSurface = s;
}

export function getActiveSurface(): ActiveSurface {
  return activeSurface;
}
