/**
 * Per-course-per-hole tee coordinate overrides.
 *
 * 2026-05-23 — Mirror of services/courseGreenOverrides for the TEE end
 * of each hole. When the course's bundled data ships with zero coords
 * for teeLat/teeLng AND golfcourseapi doesn't return geometry, this
 * store lets the user "Mark Tee" by walking to the tee box and tapping
 * a button. The captured fix persists per (courseId, hole) and takes
 * priority over the roundStore courseHoles record and the cached
 * geometry — same precedence philosophy as Mark Green (player-marked
 * data wins over GPS-derived data).
 *
 * Why mark the tee at all? Mark Green anchors the TARGET; Mark Tee
 * anchors the ORIGIN. With both marked, the hole length is verifiable
 * (haversine between the two marks) and disagreements with the
 * scorecard "distance" field are surfaced — player-marked = source of
 * truth, same as Mark the Green.
 *
 * Storage shape: Record<courseId, Record<holeNumber, TeeOverride>>.
 * AsyncStorage-backed singleton, mirrors the green-overrides store so
 * the read path stays lightweight (no Zustand for a tiny key-value
 * structure).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'smartplay.courseTeeOverrides.v1';

export interface TeeOverride {
  lat: number;
  lng: number;
  markedAt: number;
}

type OverrideMap = Record<string, Record<number, TeeOverride>>;

let cached: OverrideMap | null = null;
let hydrated = false;
const listeners = new Set<(map: OverrideMap) => void>();

async function rehydrate(): Promise<void> {
  if (hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) cached = JSON.parse(raw) as OverrideMap;
  } catch { /* noop */ }
  if (!cached) cached = {};
  hydrated = true;
}

async function persist(): Promise<void> {
  try {
    if (cached) await AsyncStorage.setItem(KEY, JSON.stringify(cached));
  } catch { /* noop */ }
}

function notifyAll() {
  if (!cached) return;
  for (const l of listeners) {
    try { l(cached); } catch { /* noop */ }
  }
}

/** Synchronous read — returns null if no override set OR before hydration. */
export function getTeeOverride(courseId: string, hole: number): TeeOverride | null {
  if (!hydrated) void rehydrate().then(() => notifyAll());
  if (!cached) return null;
  return cached[courseId]?.[hole] ?? null;
}

export async function setTeeOverride(courseId: string, hole: number, loc: { lat: number; lng: number }): Promise<void> {
  if (!hydrated) await rehydrate();
  if (!cached) cached = {};
  if (!cached[courseId]) cached[courseId] = {};
  cached[courseId][hole] = {
    lat: loc.lat,
    lng: loc.lng,
    markedAt: Date.now(),
  };
  await persist();
  notifyAll();
}

export async function clearTeeOverride(courseId: string, hole: number): Promise<void> {
  if (!hydrated) await rehydrate();
  if (!cached) return;
  if (cached[courseId]) {
    delete cached[courseId][hole];
    if (Object.keys(cached[courseId]).length === 0) delete cached[courseId];
    await persist();
    notifyAll();
  }
}

export async function clearAllForCourse(courseId: string): Promise<void> {
  if (!hydrated) await rehydrate();
  if (!cached) return;
  delete cached[courseId];
  await persist();
  notifyAll();
}

export function listOverridesForCourse(courseId: string): Array<{ hole: number; override: TeeOverride }> {
  if (!hydrated) void rehydrate().then(() => notifyAll());
  if (!cached) return [];
  const byHole = cached[courseId];
  if (!byHole) return [];
  return Object.entries(byHole)
    .map(([h, override]) => ({ hole: parseInt(h, 10), override }))
    .filter(e => Number.isFinite(e.hole))
    .sort((a, b) => a.hole - b.hole);
}

/** React hook — returns the override for the given (course, hole) and
 *  re-renders when ANY override changes. */
export function useTeeOverride(courseId: string | null, hole: number | null): TeeOverride | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hydrated) void rehydrate().then(() => tick((n) => n + 1));
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  if (!courseId || !hole) return null;
  return getTeeOverride(courseId, hole);
}
