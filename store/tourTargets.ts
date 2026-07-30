/**
 * 2026-08-01 (tester — "spotlight highlights on tools and icons cleanly"). A tiny registry of the
 * on-screen bounds of highlightable elements so the first-run TourOverlay can cut a precise spotlight
 * over the ACTUAL icon (mic, tools button, nav), not just a screen-region box.
 *
 * Elements register their measured window rect via hooks/useTourTarget (measureInWindow → absolute
 * screen coords). The overlay reads them by id and falls back to geometry if a target hasn't measured
 * yet. Plain module (no React) so any component can register with zero prop-drilling.
 */
export interface TourRect { x: number; y: number; w: number; h: number }

const targets = new Map<string, TourRect>();
const listeners = new Set<() => void>();
let version = 0;

/** Monotonic version — a stable snapshot for useSyncExternalStore (changes when any target changes). */
export function getTourTargetsVersion(): number {
  return version;
}

export function setTourTarget(id: string, rect: TourRect): void {
  const prev = targets.get(id);
  if (prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
  targets.set(id, rect);
  version++;
  listeners.forEach((l) => l());
}

export function clearTourTarget(id: string): void {
  if (targets.delete(id)) { version++; listeners.forEach((l) => l()); }
}

export function getTourTarget(id: string): TourRect | null {
  return targets.get(id) ?? null;
}

/** Subscribe to any target change (the overlay re-renders when a measurement lands). */
export function subscribeTourTargets(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
