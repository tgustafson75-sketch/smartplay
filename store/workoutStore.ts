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
  /**
   * 2026-08-12 (Tim — "I asked multiple times to tie in exercise tracking and warm ups pre round to
   * performance metrics"). Until now this ledger could only be filled by IMPORTING a SmartPump
   * export document, so nothing the player did inside the app could ever land here — the dashboard
   * charted training volume against scoring while having no way to learn that the exercises we
   * ourselves prescribed had been done. Two in-app sources close that loop:
   *
   *   in_app_exercise  — the fault-targeted exercises on the dashboard, marked done
   *   preround_warmup  — a pre-round warm-up completed before teeing off
   *
   * Warm-ups are tagged separately from training because they answer a different question: not "does
   * training volume track scoring over weeks" but "did I score better on the rounds I warmed up for".
   */
  source: 'smartpump' | 'manual' | 'in_app_exercise' | 'preround_warmup';
}

/**
 * A stable key so the same workout isn't ingested twice across overlapping exports.
 *
 * Day-granular for IMPORTS, which is the duplicate that actually happens (two exports covering the
 * same week). In-app entries key on the exact timestamp instead: two warm-ups on one day is a
 * 36-hole day, not a double-count, and collapsing them would silently lose the second round's
 * warm-up — the very thing we're trying to measure.
 */
function dedupeKey(dateMs: number, title: string, source: WorkoutRecord['source']): string {
  const t = title.trim().toLowerCase();
  if (source === 'smartpump' || source === 'manual') {
    const d = new Date(dateMs);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}::${t}`;
  }
  return `${dateMs}::${t}`;
}

interface WorkoutState {
  history: WorkoutRecord[];
  /** Merge new records; returns how many were actually NEW (deduped by date+title). */
  addWorkouts: (records: Omit<WorkoutRecord, 'id'>[]) => number;
  /** Wipe all imported workouts (e.g. a clean re-import). */
  clear: () => void;
  /** Record something the player completed IN THE APP. True when stored (false = deduped). */
  logCompleted: (entry: {
    kind: 'in_app_exercise' | 'preround_warmup';
    title: string;
    exercises?: string[];
    durationMin?: number | null;
    /** Completion time; defaults to now. */
    at?: number;
  }) => boolean;
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
        const seen = new Set(existing.map((r) => dedupeKey(r.date, r.title, r.source)));
        const fresh: WorkoutRecord[] = [];
        for (const r of records) {
          if (typeof r.date !== 'number' || !Number.isFinite(r.date)) continue;
          const title = (r.title ?? '').trim();
          if (!title) continue;
          const src: WorkoutRecord['source'] =
            r.source === 'manual' || r.source === 'in_app_exercise' || r.source === 'preround_warmup'
              ? r.source : 'smartpump';
          const key = dedupeKey(r.date, title, src);
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
            source: src,
          });
        }
        if (fresh.length === 0) return 0;
        // Keep newest-first, capped so an enormous export can't bloat storage.
        const merged = [...fresh, ...existing].sort((a, b) => b.date - a.date).slice(0, 500);
        set({ history: merged });
        return fresh.length;
      },
      clear: () => set({ history: [] }),
      logCompleted: ({ kind, title, exercises, durationMin, at }) => {
        /**
         * 2026-08-12 — the in-app write the ledger never had. One funnel for both surfaces (the
         * dashboard's fault exercises and the pre-round warm-up) so a completion always looks the
         * same to the correlation rails downstream, whichever screen recorded it.
         *
         * Returns whether it was actually stored — the caller shows "Logged" only on a true, so a
         * dedupe (double-tap) can never claim something happened twice.
         */
        const stamp = typeof at === 'number' && Number.isFinite(at) ? at : Date.now();
        const added = get().addWorkouts([{
          date: stamp,
          title: title.trim(),
          durationMin: typeof durationMin === 'number' && durationMin > 0 ? durationMin : null,
          focus: kind === 'preround_warmup' ? 'warmup' : 'swing-fault',
          exercises: exercises ?? [],
          intensity: null,
          source: kind,
        }]);
        return added > 0;
      },
    }),
    // 2026-08-07 (persistence audit) — passthrough migrate matching every sibling store. Without it, a
    // future `version` bump would make zustand DISCARD the whole persisted blob → wipe imported SmartPump
    // workout history (a backup-allowlisted crown-jewel store). The migrate makes a bump preserve data.
    { name: 'workout-store-v1', storage: createJSONStorage(() => getPersistStorage()), version: 1, migrate: (s) => s as never },
  ),
);
