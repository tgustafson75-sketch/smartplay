/**
 * Per-course-per-hole green coordinate overrides.
 *
 * When the course's bundled data ships with zero coords (the Sunnyvale /
 * SJ Muni case) AND golfcourseapi doesn't return geometry for the
 * course, this store lets the user "Mark Green Center" by walking to
 * the center of the green and tapping a button. The captured fix
 * persists per (courseId, hole) and takes priority over both the
 * roundStore courseHoles record and the cached geometry, so subsequent
 * rounds at the same course get real yardages from the marked points.
 *
 * Front + back are approximated as middle ± 12 yards along the green
 * depth axis (a typical green-depth heuristic — better than no F/B).
 * For courses where the user wants exact F/B, the marker UI can be
 * extended to capture three points; v1 captures middle only.
 *
 * AsyncStorage-backed singleton. Lightweight — single integer/coord
 * per hole, no Zustand store needed for the read path.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'smartplay.courseGreenOverrides.v1';

export interface GreenOverride {
  lat: number;
  lng: number;
  markedAt: number;
  /** Optional: when the user marked front + back too. v1 leaves these null. */
  frontLat?: number | null;
  frontLng?: number | null;
  backLat?: number | null;
  backLng?: number | null;
}

type OverrideMap = Record<string, Record<number, GreenOverride>>;

let cached: OverrideMap | null = null;
let hydrated = false;
const listeners = new Set<(map: OverrideMap) => void>();

function key(courseId: string, hole: number): string {
  return `${courseId}::${hole}`;
}

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
export function getGreenOverride(courseId: string, hole: number): GreenOverride | null {
  if (!hydrated) void rehydrate().then(() => notifyAll());
  if (!cached) return null;
  return cached[courseId]?.[hole] ?? null;
}

export async function setGreenOverride(courseId: string, hole: number, loc: { lat: number; lng: number }): Promise<void> {
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

export async function clearGreenOverride(courseId: string, hole: number): Promise<void> {
  if (!hydrated) await rehydrate();
  if (!cached) return;
  if (cached[courseId]) {
    delete cached[courseId][hole];
    if (Object.keys(cached[courseId]).length === 0) delete cached[courseId];
    await persist();
    notifyAll();
  }
  void key;
}

export async function clearAllForCourse(courseId: string): Promise<void> {
  if (!hydrated) await rehydrate();
  if (!cached) return;
  delete cached[courseId];
  await persist();
  notifyAll();
}

export function listOverridesForCourse(courseId: string): Array<{ hole: number; override: GreenOverride }> {
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
export function useGreenOverride(courseId: string | null, hole: number | null): GreenOverride | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hydrated) void rehydrate().then(() => tick((n) => n + 1));
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  if (!courseId || !hole) return null;
  return getGreenOverride(courseId, hole);
}
