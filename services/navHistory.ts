/**
 * 2026-07-24 (Tim — the bottom caddie bar's ‹ › chevrons handle page navigation everywhere). Expo Router
 * gives us BACK (router.back / safeBack) but no forward. This is a tiny browser-style forward stack:
 *   - pressing ‹ back records the current route so ›  can return to it,
 *   - pressing › forward re-navigates to the most recently backed-out-of route,
 *   - any NORMAL navigation (not via a chevron) clears the forward stack, exactly like a browser.
 * Pure module state; no deps. The bar marks chevron-driven navigations so the route watcher can tell a
 * chevron move from a fresh one.
 */
let forwardStack: string[] = [];
let chevronNav = false;

/** Call right before a chevron-driven navigation so the route watcher won't clear the forward stack. */
export function markChevronNav(): void { chevronNav = true; }

/** Route watcher: true if the last navigation was chevron-driven (consumes the flag). */
export function consumeChevronNav(): boolean { const v = chevronNav; chevronNav = false; return v; }

export function pushForward(route: string | null | undefined): void {
  if (route) forwardStack.push(route);
}
export function popForward(): string | null {
  return forwardStack.length ? forwardStack.pop()! : null;
}
export function clearForward(): void { forwardStack = []; }
export function hasForward(): boolean { return forwardStack.length > 0; }
