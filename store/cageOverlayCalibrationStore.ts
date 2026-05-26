/**
 * Cage overlay calibration — persisted positions for the draggable
 * bullseye crosshair + ball-address strike-box on the swing capture
 * overlay.
 *
 * Why this exists:
 *   Static reticles assume the camera, the player, and the ball are
 *   always in the same relative position. They never are. Tim 2026-05-14
 *   asked for "the center crosshairs moveable for user to move to center
 *   of the bullseye or target and fix that location." This store
 *   persists the user's last-set positions so they don't have to
 *   re-align every session.
 *
 * Coordinate system:
 *   `x` and `y` are fractions (0–1) of the camera viewport's width
 *   and height. Storing fractions means the same calibration works
 *   regardless of phone size, fold-open vs closed, or orientation.
 *
 * Persistence:
 *   AsyncStorage so calibration survives app restarts. NOT per-round
 *   (this is gear/setup config, not round state).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface OverlayPosition {
  x: number; // 0..1 of viewport width
  y: number; // 0..1 of viewport height
}

interface CageOverlayCalibrationState {
  /** Bullseye crosshair center — defaults to viewport center (0.5/0.5). */
  bullseye: OverlayPosition | null;
  /** Ball-address strike-box center — defaults to slightly below center. */
  ballBox: OverlayPosition | null;
  /** When the user last touched the calibration (informational). */
  calibrated_at: number | null;

  setBullseye: (pos: OverlayPosition) => void;
  setBallBox: (pos: OverlayPosition) => void;
  /** Reset both positions to defaults. */
  reset: () => void;
}

export const useCageOverlayCalibrationStore = create<CageOverlayCalibrationState>()(
  persist(
    (set) => ({
      bullseye: null,
      ballBox: null,
      calibrated_at: null,

      setBullseye: (pos) => set({ bullseye: pos, calibrated_at: Date.now() }),
      setBallBox: (pos) => set({ ballBox: pos, calibrated_at: Date.now() }),
      reset: () => set({ bullseye: null, ballBox: null, calibrated_at: null }),
    }),
    {
      name: 'cage-overlay-calibration-v1',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      version: 1,
      migrate: (s) => s as never,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
