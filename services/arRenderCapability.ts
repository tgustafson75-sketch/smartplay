/**
 * 2026-05-22 — AR Render Capability probe (Pass 2).
 *
 * Detects which AR rendering backend the device can actually run, so
 * ArShotTraceOverlay can pick the best available without forcing the
 * caller to know what's installed.
 *
 * Backends, best→worst:
 *   1. 'three_gl'  — expo-gl + three + @react-three/fiber-native
 *                    True 3D scene with shaders. Best fidelity. Heavy.
 *                    Requires explicit npm install + native rebuild.
 *   2. 'skia'      — @shopify/react-native-skia
 *                    GPU-accelerated 2D. Smooth glow + animated paths.
 *                    Smaller install than three.js.
 *   3. 'svg'       — react-native-svg (already installed). Pass 1 default.
 *                    Pure-JS pinhole projection, 30-45 fps target on
 *                    mid-tier devices.
 *
 * Detection runs once at app start (memoized result) and is purely a
 * static `require` probe — no native side effects, no permission
 * prompts. If a module isn't installed, require() throws synchronously
 * and the probe records that backend as unavailable.
 *
 * Manual override: callers can call setBackendOverride(...) to force a
 * specific tier (useful for dev / debugging the SVG fallback even when
 * three.js is installed).
 */

import { devLog } from './devLog';

export type ArBackend = 'three_gl' | 'skia' | 'svg' | 'none';

export interface ArCapability {
  best_backend: ArBackend;
  /** Every backend that the device can actually run. Sorted best-first. */
  available: ArBackend[];
  /** Honest one-liner for the Settings panel ("Using SVG fallback. Install
   *  @react-three/fiber-native for 3D AR."). */
  rationale: string;
}

let memo: ArCapability | null = null;
let override: ArBackend | null = null;

// ─── Public API ──────────────────────────────────────────────────────────

export function detectArCapability(): ArCapability {
  if (memo) return applyOverride(memo);

  const available: ArBackend[] = [];
  if (probeThreeGL()) available.push('three_gl');
  if (probeSkia())    available.push('skia');
  if (probeSvg())     available.push('svg');

  const best_backend: ArBackend = available[0] ?? 'none';
  const rationale = buildRationale(best_backend, available);
  memo = { best_backend, available, rationale };
  devLog(`[arCapability] best=${best_backend} available=[${available.join(', ')}]`);
  return applyOverride(memo);
}

/** Force a specific backend for the rest of the session. Pass null to
 *  clear. Useful for QA + debugging the lower-tier fallbacks. */
export function setBackendOverride(backend: ArBackend | null): void {
  override = backend;
  if (backend) devLog(`[arCapability] override → ${backend}`);
  else devLog('[arCapability] override cleared');
}

export function getBackendOverride(): ArBackend | null {
  return override;
}

// ─── Probes ──────────────────────────────────────────────────────────────

function probeThreeGL(): boolean {
  // Three.js + @react-three/fiber-native + expo-gl together unlock the
  // 3D backend. Probing all three is intentional — fiber needs all of
  // them present to function.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-gl');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('three');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@react-three/fiber-native');
    return true;
  } catch {
    return false;
  }
}

function probeSkia(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@shopify/react-native-skia');
    return true;
  } catch {
    return false;
  }
}

function probeSvg(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-svg');
    return true;
  } catch {
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function applyOverride(cap: ArCapability): ArCapability {
  if (!override) return cap;
  if (!cap.available.includes(override)) {
    devLog(`[arCapability] override ${override} not available; falling back to ${cap.best_backend}`);
    return cap;
  }
  return { ...cap, best_backend: override, rationale: `Override active: ${override}. ${cap.rationale}` };
}

function buildRationale(best: ArBackend, available: ArBackend[]): string {
  if (best === 'three_gl') {
    return '3D AR active (expo-gl + three + @react-three/fiber-native).';
  }
  if (best === 'skia') {
    return 'GPU 2D AR active (Skia). Install @react-three/fiber-native for 3D.';
  }
  if (best === 'svg') {
    return 'SVG fallback active. Install @shopify/react-native-skia (or @react-three/fiber-native for 3D) for richer rendering.';
  }
  void available;
  return 'No AR backend available — render disabled.';
}
