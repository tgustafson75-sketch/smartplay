/**
 * utils/contextCache.ts
 *
 * Simple in-memory cache for the last known FocusContext.
 *
 * On-course the context rarely changes between shots. This cache lets every
 * engine call use the most recent valid context even when the caller passes
 * a partially-built or null value (e.g. mid-render or offline).
 *
 * Usage:
 *   import { getSafeContext } from '../utils/contextCache';
 *   const ctx = getSafeContext(buildFocusContext(...));
 *   return handleFocusInput(query, ctx, aiCaller);
 */

import type { FocusContext } from '../engine/contextBuilder';

let _lastContext: FocusContext | null = null;

/**
 * Returns `context` if it is non-null and stores it for future fallback.
 * If `context` is null/undefined, returns the last cached context.
 * Returns null only on the very first call before any context is available.
 */
export function getSafeContext(context: FocusContext | null | undefined): FocusContext | null {
  if (context) {
    _lastContext = context;
    return context;
  }
  return _lastContext;
}

/** Manually clear the cache (e.g. on round reset). */
export function clearContextCache(): void {
  _lastContext = null;
}
