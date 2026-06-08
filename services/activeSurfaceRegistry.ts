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
 *
 * Phase 105 — added `drill_detail` and `drill_session` surface names so
 * services/caddieResolver can route them to the 'drills' pillar. The
 * pillar mapping itself lives in caddieResolver.mapSurfaceToPillar so
 * the registry stays a pure list of surface names.
 *
 * Phase 105 — added a transition listener so the voice handoff layer can
 * react to surface changes (e.g. announce "Tank here" when the user
 * crosses from a Round-pillar surface into a Cage-pillar surface).
 */

export type ActiveSurface =
  | 'caddie'
  | 'cage'
  | 'arena'
  | 'swing_library'
  | 'swing_detail'
  | 'recap'
  | 'drill_detail'
  | 'drill_session'
  | null;

type SurfaceListener = (next: ActiveSurface, prev: ActiveSurface) => void;

let activeSurface: ActiveSurface = null;
const listeners = new Set<SurfaceListener>();

export function setActiveSurface(s: ActiveSurface): void {
  const prev = activeSurface;
  if (prev === s) return;
  activeSurface = s;
  // Fire listeners outside the assignment so any throw doesn't corrupt state.
  for (const cb of listeners) {
    try { cb(s, prev); } catch (e) { console.warn('[activeSurface] listener threw:', e); }
  }
}

export function getActiveSurface(): ActiveSurface {
  return activeSurface;
}

/**
 * 2026-06-08 (audit M2) — clear the active surface ONLY if `surface` is
 * still the registered one. A screen's blur cleanup must use this (not
 * setActiveSurface(null)): during a transition, screen B's focus can run
 * before screen A's blur cleanup, so an unconditional null would wipe B's
 * just-registered surface and make pickOpener() choose the wrong persona.
 */
export function clearActiveSurface(surface: ActiveSurface): void {
  if (activeSurface === surface) setActiveSurface(null);
}

// Phase 105 — subscribe to surface changes. Returns an unsub fn.
export function subscribeActiveSurface(cb: SurfaceListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
