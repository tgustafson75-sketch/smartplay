/**
 * 2026-07-07 (Tim — SmartPump third rail).
 *
 * SmartPump (the player's separate workout-tracking app) added GOLF workouts and
 * can export a date-stamped document of them. We ingest that export into this store
 * so the dashboard can show a THIRD correlation rail: training volume vs. practice
 * vs. on-course scoring — "is the gym work showing up in my golf?".
 *
 * These are IMPORTED historical records with REAL dates, so — unlike the live points
 * baseline — the whole history counts. Deduped by (date + title) so re-importing an
 * overlapping export never double-counts. Persisted + included in the cloud/file
 * backup allowlist (services/cloudSync/snapshot.ts) so it survives a phone swap like
 * every other crown-jewel store. [[points-practice-correlation]]
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export type WorkoutIntensity = 'light' | 'moderate' | 'hard';

export interface WorkoutRecord {
  id: string;
  /** Epoch ms of the workout DATE (midnight-local of the exported day). */
  date: number;
  /** e.g. "Golf Strength — Lower Body". */
  title: string;
  /** Minutes, or null when the export didn't state a duration. */
  durationMin: number | null;
  /** e.g. "power", "mobility", "core" — null when not stated. */
  focus: string | null;
  /** Named exercises, best-effort from the export. */
  exercises: string[];
  intensity: WorkoutIntensity | null;
  source: 'smartpump' | 'manual';
}

/** A stable key so the same workout isn't ingested twice across overlapping exports. */
function dedupeKey(dateMs: number, title: string): string {
  const d = new Date(dateMs);
  const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  return `${day}::${title.trim().toLowerCase()}`;
}

interface WorkoutState {
  history: WorkoutRecord[];
  /** Merge new records; returns how many were actually NEW (deduped by date+title). */
  addWorkouts: (records: Omit<WorkoutRecord, 'id'>[]) => number;
  /** Wipe all imported workouts (e.g. a clean re-import). */
  clear: () => void;
}

let _seq = 0;
function nextId(dateMs: number): string {
  _seq = (_seq + 1) % 1_000_000;
  return `wk_${dateMs}_${_seq}`;
}

export const useWorkoutStore = create<WorkoutState>()(
  persist(
    (set, get) => ({
      history: [],
      addWorkouts: (records) => {
        const existing = get().history;
        const seen = new Set(existing.map((r) => dedupeKey(r.date, r.title)));
        const fresh: WorkoutRecord[] = [];
        for (const r of records) {
          if (typeof r.date !== 'number' || !Number.isFinite(r.date)) continue;
          const title = (r.title ?? '').trim();
          if (!title) continue;
          const key = dedupeKey(r.date, title);
          if (seen.has(key)) continue;
          seen.add(key);
          fresh.push({
            id: nextId(r.date),
            date: r.date,
            title,
            durationMin: typeof r.durationMin === 'number' && r.durationMin > 0 ? Math.round(r.durationMin) : null,
            focus: r.focus?.trim() || null,
            exercises: Array.isArray(r.exercises) ? r.exercises.map((e) => String(e).trim()).filter(Boolean).slice(0, 20) : [],
            intensity: r.intensity === 'light' || r.intensity === 'moderate' || r.intensity === 'hard' ? r.intensity : null,
            source: r.source === 'manual' ? 'manual' : 'smartpump',
          });
        }
        if (fresh.length === 0) return 0;
        // Keep newest-first, capped so an enormous export can't bloat storage.
        const merged = [...fresh, ...existing].sort((a, b) => b.date - a.date).slice(0, 500);
        set({ history: merged });
        return fresh.length;
      },
      clear: () => set({ history: [] }),
    }),
    { name: 'workout-store-v1', storage: createJSONStorage(() => getPersistStorage()), version: 1 },
  ),
);
