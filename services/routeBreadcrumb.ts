/**
 * 2026-07-29 (Tim — "create something in the issue log that shows the crash log ROUTE"). The Issue Log
 * captured crashes (crashCapture.ts) but the context.route was ALWAYS null, so a white-screen entry
 * never said WHICH screen or what the user was doing — which is exactly why the render-loop was hard to
 * pin. This module keeps the live route + a short breadcrumb trail (route changes + key actions) so any
 * crash/issue entry can report where it happened and the last steps into it.
 *
 * Pure module state — no React, no store, no imports of app stores (so crashCapture/issueLog can read it
 * without a cycle). Populated by a pathname listener in app/_layout.tsx + breadcrumb() calls at key
 * steps (analyze start, Motion toggle, video load, swing-locate, pose extraction).
 */

interface Crumb { t: number; label: string }

let currentRoute: string | null = null;
const trail: Crumb[] = [];
const MAX = 24;

function push(label: string): void {
  try {
    trail.push({ t: Date.now(), label });
    if (trail.length > MAX) trail.shift();
  } catch { /* never throw from a breadcrumb */ }
}

/** Called by the root pathname listener on every navigation. Dedupes repeats. */
export function setRoute(path: string | null | undefined): void {
  if (!path || path === currentRoute) return;
  currentRoute = path;
  push(`route ${path}`);
}

/** Record a key action ("analyze:start", "motion:on", "video:load"). Best-effort, never throws. */
export function breadcrumb(label: string, extra?: Record<string, unknown>): void {
  if (extra) {
    try { push(`${label} ${JSON.stringify(extra).slice(0, 140)}`); return; } catch { /* fall through */ }
  }
  push(label);
}

/** The active route (or null before the first navigation). */
export function getRoute(): string | null {
  return currentRoute;
}

/** Compact recent trail, oldest→newest, with relative age, for a crash/issue-log entry. */
export function getTrail(limit = 14): string[] {
  const now = Date.now();
  return trail.slice(-limit).map((c) => `-${Math.round((now - c.t) / 1000)}s ${c.label}`);
}
