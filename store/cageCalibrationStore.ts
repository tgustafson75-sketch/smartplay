/**
 * Cage distance calibration store.
 *
 * Holds the user's cage front-to-back distance (yards). Source can be
 * either auto-detected by the server-side acoustic detector or
 * manually entered. Auto-detection writes here on every successful
 * detection; manual override takes precedence for display.
 *
 * Used by:
 *   - app/swinglab/camera-setup.tsx — surfaces the calibration to the
 *     user with an Override field.
 *   - app/swinglab/cage-drill.tsx — shows the effective distance in
 *     the result card.
 *   - (Future) — sent as a hint to /api/acoustic-detect for refined
 *     ball-speed heuristics.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

interface CageCalibrationState {
  /** Most-recent auto-detected cage distance from the server. */
  lastDetectedYards: number | null;
  /** User's manual override. Wins over lastDetected for display. */
  userOverrideYards: number | null;
  /** When the most recent calibration happened (informational). */
  updated_at: number | null;

  setAutoDetected: (yards: number) => void;
  setManualOverride: (yards: number | null) => void;
  /** The effective distance: manual override wins, else last auto-detected. */
  getEffectiveYards: () => number | null;
}

export const useCageCalibrationStore = create<CageCalibrationState>()(
  persist(
    (set, get) => ({
      lastDetectedYards: null,
      userOverrideYards: null,
      updated_at: null,

      setAutoDetected: (yards) =>
        set({ lastDetectedYards: yards, updated_at: Date.now() }),

      setManualOverride: (yards) =>
        set({ userOverrideYards: yards, updated_at: Date.now() }),

      getEffectiveYards: () => {
        const s = get();
        return s.userOverrideYards ?? s.lastDetectedYards ?? null;
      },
    }),
    {
      name: 'cage-calibration-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
