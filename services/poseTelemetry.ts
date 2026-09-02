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

/**
 * 2026-09-01 — THE BUS HAD NO READER, AND THAT WAS THE BUG.
 *
 * recordPoseTelemetry has fired on every pose call since 05-23; getLatestPoseTelemetry was read by
 * nobody. The docstring at the top of this file describes an "On-device • 47ms" badge that does not
 * exist, so every one of those writes went into a variable and stopped there.
 *
 * That is not merely wasted work — it is a diagnostic hole in the exact place the app is hardest to
 * debug. When a pose read fails on Tim's device, the issue-log entry could say how many frames came
 * back and why, but not WHICH ENGINE PRODUCED THEM. "Pose returned nothing" reads identically
 * whether MediaPipe ran on-device in 40ms or the cloud proxy was called and timed out — two failures
 * with nothing in common except the sentence describing them. [[orphans-are-live-bugs-not-dead-code]]
 *
 * So the reader is a LOG DECORATOR rather than a badge: every pose diagnostic now carries the backend
 * that served it and how long inference took. No layout changes, no new surface, and the answer to
 * "was this device even running pose locally?" stops being a guess. [[missing-log-entry-is-the-evidence]]
 *
 * `ageMs` is included deliberately and is the field that keeps this honest: this is the LAST pose
 * call, not necessarily THIS one. A reading from four minutes ago describes a different attempt, and
 * a log line that presented it as current would be worse than no line at all.
 */
export function describePoseTelemetry(): Record<string, unknown> | null {
  // Reads through the accessor rather than the module variable so there is ONE way to get the
  // current value — the alternative is a second reader that drifts the day the accessor grows a rule.
  const t = getLatestPoseTelemetry();
  if (t.at === 0) return null;   // nothing has run — say nothing rather than report 'none'
  return {
    poseBackend: t.backend,
    ...(t.inferenceMs != null ? { poseInferenceMs: Math.round(t.inferenceMs) } : {}),
    poseConfidence: Math.round(t.confidence),
    poseReadingAgeMs: Date.now() - t.at,
  };
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
