/**
 * 2026-05-19 — GPS Audit v2: noise / dropout / glitch / drift injector.
 *
 * Wraps the simulator's per-tick position output before it lands in
 * smartFinderService.lastFix. Lets each scenario configure the
 * specific noise profile it wants without rewriting the simulator.
 *
 * Architecture: simulator computes `clean_lat / clean_lng` at every
 * tick (the ground truth), calls applyNoise(clean) → returns the
 * noised coord to publish via setSimulatedFix. The same clean coord
 * is also passed to probes.setGroundTruth so assertions can compare
 * downstream consumer values against the true coord, not the noised
 * one.
 */

import type { EmitterConfig } from './types';

let cfg: EmitterConfig = { noise_sigma_m: 0 };
let dropoutUntilMs: number | null = null;
let glitchOnNextTick: number | null = null; // lateral_m
let driftMpsAccumulated = 0;
let lastTickMs: number | null = null;

const M_PER_DEG_LAT = 111_111;

export function configureNoise(config: EmitterConfig): void {
  cfg = config;
  dropoutUntilMs = null;
  glitchOnNextTick = null;
  driftMpsAccumulated = 0;
  lastTickMs = null;
}

export function triggerDropout(durationMs: number): void {
  dropoutUntilMs = Date.now() + durationMs;
}

export function triggerGlitch(lateralM: number): void {
  glitchOnNextTick = lateralM;
}

export function resetInjector(): void {
  cfg = { noise_sigma_m: 0 };
  dropoutUntilMs = null;
  glitchOnNextTick = null;
  driftMpsAccumulated = 0;
  lastTickMs = null;
}

export interface NoiseResult {
  // null = drop this emission (dropout in effect)
  lat: number | null;
  lng: number | null;
}

// Box-Muller for Gaussian noise.
function gauss(sigma: number): number {
  if (sigma <= 0) return 0;
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2);
  return z * sigma;
}

export function applyNoise(cleanLat: number, cleanLng: number): NoiseResult {
  const now = Date.now();
  if (dropoutUntilMs != null && now < dropoutUntilMs) {
    return { lat: null, lng: null };
  }
  // Glitch overrides everything for one tick.
  if (glitchOnNextTick != null) {
    const lat = cleanLat + (glitchOnNextTick / M_PER_DEG_LAT);
    glitchOnNextTick = null;
    return { lat, lng: cleanLng };
  }
  let lat = cleanLat;
  let lng = cleanLng;
  // Drift: linear meters/sec accumulator on lat axis.
  if ((cfg.drift_mps ?? 0) !== 0) {
    if (lastTickMs != null) {
      const dtSec = (now - lastTickMs) / 1000;
      driftMpsAccumulated += (cfg.drift_mps ?? 0) * dtSec;
    }
    lastTickMs = now;
    lat += driftMpsAccumulated / M_PER_DEG_LAT;
  }
  // Gaussian jitter.
  const sigma = cfg.noise_sigma_m ?? 0;
  if (sigma > 0) {
    lat += gauss(sigma) / M_PER_DEG_LAT;
    const cosLat = Math.cos(cleanLat * Math.PI / 180);
    lng += gauss(sigma) / (M_PER_DEG_LAT * (cosLat || 1));
  }
  return { lat, lng };
}
