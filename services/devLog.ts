/**
 * 2026-05-21 — Consolidation 4: dev-only logger.
 *
 * Routine flow-trace logs ("X happened", "loaded N items", value dumps)
 * route through devLog so they're silent in production. Tagged
 * diagnostic breadcrumbs (`[V6-DIAG]`, `[path2:round]`,
 * `[audit:round-active]`, `[ttfa]`, etc.) and catch-block error
 * surfaces stay on `console.log` / `console.warn` / `console.error`
 * directly — those are deliberate instrumentation, not noise.
 *
 * Bundler dead-code elimination: in production builds `__DEV__` is the
 * literal `false`, so Metro / Hermes drops the entire function body.
 * Arguments are still constructed at the call site (template literal
 * evaluation, object spread, etc.) but the cost is negligible for the
 * routine-status log lines that route through this helper.
 *
 * Owner-only diagnostic surfaces (gps-test, *-debug.tsx, scripts/),
 * the harness (services/simulatedGPS.ts), and server-side API routes
 * (api/*.ts where __DEV__ is undefined) intentionally do NOT use this
 * helper — they keep their `console.log` calls directly.
 */

declare const __DEV__: boolean;

export function devLog(...args: unknown[]): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}
