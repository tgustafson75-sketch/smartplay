/**
 * 2026-05-23 — Pose telemetry pub/sub.
 *
 * Tiny shared state that the poseEstimator pushes to on every call,
 * and that UI surfaces subscribe to via useLatestPoseTelemetry() for
 * the "On-device • 47ms" badge.
 *
 * Kept separate from poseEstimator.ts so the estimator stays pure
 * (no module-level state). Telemetry stays cheap and side-effect-only
 * — losing a telemetry update never affects the actual pose result.
 *
 * Why a singleton instead of a Zustand store: the surface needs ONE
 * value, one subscribe entry point, and no devtools. A bespoke
 * subscriber is ~40 lines vs creating a fresh store + selector
 * indirection.
 */

import { useEffect, useState } from 'react';

export interface PoseTelemetry {
  backend: 'mediapipe' | 'cloud_proxy' | 'cloud_vision_llm' | 'none';
  /** 0..100 overall confidence from the most recent PoseEstimate. */
  confidence: number;
  /** Last MediaPipe inference time in ms. Null for cloud paths. */
  inferenceMs: number | null;
  /** ms epoch when this telemetry was recorded. */
  at: number;
}

const EMPTY: PoseTelemetry = {
  backend: 'none',
  confidence: 0,
  inferenceMs: null,
  at: 0,
};

let latest: PoseTelemetry = EMPTY;
const listeners = new Set<(t: PoseTelemetry) => void>();

export function recordPoseTelemetry(t: Partial<PoseTelemetry>): void {
  latest = { ...latest, ...t, at: Date.now() };
  for (const cb of listeners) {
    try { cb(latest); } catch { /* swallow */ }
  }
}

export function getLatestPoseTelemetry(): PoseTelemetry {
  return latest;
}

export function subscribePoseTelemetry(cb: (t: PoseTelemetry) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook — re-renders the consumer whenever a new pose
 *  telemetry record lands. Returns the latest record. Stale records
 *  (older than 90s) are considered "no recent pose" and surface as
 *  `backend === 'none'` so the badge doesn't lie about activity. */
export function useLatestPoseTelemetry(): PoseTelemetry {
  const [value, setValue] = useState<PoseTelemetry>(latest);
  useEffect(() => subscribePoseTelemetry(setValue), []);
  const ageMs = Date.now() - value.at;
  if (value.at > 0 && ageMs > 90_000) {
    return { ...EMPTY, at: value.at };
  }
  return value;
}
