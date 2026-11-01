/**
 * 2026-11-01 — Golf workout store (ported from SmartPump's Golf Performance block + Swing Rx history).
 *
 * Holds two things, both persisted:
 *   - prescriptions: imported Swing Rx analyses, newest first. The newest is the ACTIVE one.
 *   - loggedSets: every working set logged in the golf workout. Rx progress is computed from these,
 *     and only sets logged at or after an Rx's import count toward it.
 *
 * SmartPump kept the sets in its event log and the Rx history in MMKV with a file backup. SmartPlay
 * has one persistence path (AsyncStorage via getPersistStorage), so both live here.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { SwingPrescription } from '../services/golf/swingRx';
import type { LoggedSetEvent } from '../services/golf/sessionTypes';
import { useWorkoutStore } from './workoutStore';

const MAX_PRESCRIPTIONS = 20;

interface GolfWorkoutState {
  prescriptions: SwingPrescription[];
  loggedSets: LoggedSetEvent[];
  /** The newest import, which is what the card builds and tracks. */
  activePrescription: () => SwingPrescription | null;
  addPrescription: (rx: SwingPrescription) => SwingPrescription;
  removePrescription: (id: string) => void;
  logSet: (input: { exerciseId: string; weight?: number; reps?: number }, now?: number) => LoggedSetEvent;
  /**
   * Record a finished golf session in the shared workout history (useWorkoutStore), the same ledger
   * the dashboard, Kevin and the correlation engines read. Per-set data stays here.
   */
  completeSession: (input: { title: string; exercises: string[]; startedAt?: number; now?: number }) => boolean;
}

export const useGolfWorkoutStore = create<GolfWorkoutState>()(
  persist(
    (set, get) => ({
      prescriptions: [],
      loggedSets: [],
      activePrescription: () => get().prescriptions[0] ?? null,
      addPrescription: (rx) => {
        set((s) => ({ prescriptions: [rx, ...s.prescriptions.filter((p) => p.id !== rx.id)].slice(0, MAX_PRESCRIPTIONS) }));
        return rx;
      },
      removePrescription: (id) => set((s) => ({ prescriptions: s.prescriptions.filter((p) => p.id !== id) })),
      logSet: (input, now = Date.now()) => {
        const event: LoggedSetEvent = {
          type: 'set.complete',
          timestamp: new Date(now).toISOString(),
          payload: { exerciseId: input.exerciseId, weight: input.weight, reps: input.reps },
        };
        set((s) => ({ loggedSets: [...s.loggedSets, event] }));
        return event;
      },
      completeSession: ({ title, exercises, startedAt, now = Date.now() }) => {
        const durationMin = startedAt ? Math.max(1, Math.round((now - startedAt) / 60_000)) : null;
        return useWorkoutStore.getState().logCompleted({
          kind: 'golf_workout',
          title,
          exercises,
          durationMin,
          at: now,
        });
      },
    }),
    {
      name: 'golf-workout-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);

/**
 * Paywall seam. The golf workout becomes a paid feature in 2.0; that gate belongs here and nowhere
 * else, so the screen and the store never need to know about billing. Free until 2.0 ships.
 */
export function golfWorkoutUnlocked(): boolean {
  return true;
}
