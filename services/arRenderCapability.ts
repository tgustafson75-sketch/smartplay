/**
 * 2026-05-22 — AR Render Capability — bare entry (web-safe).
 *
 * This file is the TYPE SOURCE that TypeScript reads + the bundle Metro
 * picks on web (where the .native.ts variant is invisible). It contains
 * NO three.js / expo-gl / fiber requires, so the web bundle stays clean
 * (Vercel `expo export --platform web` doesn't have to resolve any of
 * those native-only packages).
 *
 * On iOS/Android, Metro picks `arRenderCapability.native.ts` over this
 * file. That variant does the real probe for expo-gl + three +
 * @react-three/fiber + expo-three; web stays on the SVG tier always.
 *
 * Both variants share the same exported surface so callers don't have
 * to branch on Platform.OS.
 */

export type ArBackend = 'three_gl' | 'skia' | 'svg' | 'none';

export interface ArCapability {
  best_backend: ArBackend;
  available: ArBackend[];
  rationale: string;
}

const WEB_RESULT: ArCapability = {
  best_backend: 'svg',
  available: ['svg'],
  rationale: 'SVG backend (web build — 3D/Skia are mobile-only).',
};

/** Web-safe default — always returns the SVG tier. Native override in
 *  arRenderCapability.native.ts runs the real probe. */
export function detectArCapability(): ArCapability {
  return WEB_RESULT;
}

export function setBackendOverride(_backend: ArBackend | null): void {
  void _backend;
}

export function getBackendOverride(): ArBackend | null {
  return null;
}
