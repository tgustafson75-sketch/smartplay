/**
 * 2026-05-19 — GPS Audit v2: probe registry.
 *
 * Each probe captures one GPS-derived surface's value on every GPS
 * tick. Samples write into a per-scenario ring buffer keyed by surface
 * name. The audit runner clears buffers between scenarios and writes
 * the captured trace into the per-scenario ScenarioResult.
 */

import type { ProbeSample } from './types';

const RING_CAP = 5000; // per surface, per scenario

let active = false;
let tickCounter = 0;
let currentGroundTruth: { lat: number; lng: number } | null = null;
const buffers = new Map<string, ProbeSample[]>();

export function startProbes(): void {
  active = true;
  tickCounter = 0;
  buffers.clear();
}

export function stopProbes(): void {
  active = false;
}

export function isProbeActive(): boolean { return active; }

/** Set by the noise injector / simulator before every tick. */
export function setGroundTruth(lat: number, lng: number): void {
  currentGroundTruth = { lat, lng };
  tickCounter += 1;
}

export function recordSample(surface: string, value: unknown): void {
  if (!active) return;
  const buf = buffers.get(surface) ?? [];
  if (buf.length >= RING_CAP) buf.shift();
  buf.push({
    surface,
    ts: Date.now(),
    tick: tickCounter,
    ground_truth_lat: currentGroundTruth?.lat ?? null,
    ground_truth_lng: currentGroundTruth?.lng ?? null,
    value,
  });
  buffers.set(surface, buf);
}

export function getTrace(surface: string): ProbeSample[] {
  return buffers.get(surface) ?? [];
}

export function getAllTraces(): Record<string, ProbeSample[]> {
  const out: Record<string, ProbeSample[]> = {};
  for (const [k, v] of buffers.entries()) out[k] = downsample(v);
  return out;
}

/** Keep first 100, every 10th sample mid-run, last 100. */
function downsample(buf: ProbeSample[]): ProbeSample[] {
  if (buf.length <= 250) return [...buf];
  const head = buf.slice(0, 100);
  const tail = buf.slice(-100);
  const middle: ProbeSample[] = [];
  for (let i = 100; i < buf.length - 100; i += 10) middle.push(buf[i]);
  return [...head, ...middle, ...tail];
}

export function clearBuffers(): void {
  buffers.clear();
  tickCounter = 0;
}
