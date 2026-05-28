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

// 2026-05-27 — Fix ER: body alignment box is now USER-RESIZABLE so
// the box can match the actual cage edges on the user's particular
// setup (cage size, distance from camera, phone position). Position
// + size both persist as fractions of viewport for cross-device /
// cross-orientation consistency. Once this matches the real cage,
// the bounded region becomes the input for future actual-cage
// detection (Phase 2 of this feature: CV identifies the bullseye
// within the user-defined box). Null = use the centered default.
export interface OverlayRect {
  cx: number; // center x, 0..1
  cy: number; // center y, 0..1
  w: number;  // width as fraction of viewport width
  h: number;  // height as fraction of viewport height
}

interface CageOverlayCalibrationState {
  /** Bullseye crosshair center — defaults to viewport center (0.5/0.5). */
  bullseye: OverlayPosition | null;
  /** Ball-address strike-box center — defaults to slightly below center. */
  ballBox: OverlayPosition | null;
  /** 2026-05-27 — Fix ER: user-adjusted body alignment box (move + resize). */
  bodyBox: OverlayRect | null;
  /** When the user last touched the calibration (informational). */
  calibrated_at: number | null;

  setBullseye: (pos: OverlayPosition) => void;
  setBallBox: (pos: OverlayPosition) => void;
  setBodyBox: (rect: OverlayRect | null) => void;
  /** Reset all positions to defaults. */
  reset: () => void;
}

export const useCageOverlayCalibrationStore = create<CageOverlayCalibrationState>()(
  persist(
    (set) => ({
      bullseye: null,
      ballBox: null,
      bodyBox: null,
      calibrated_at: null,

      setBullseye: (pos) => set({ bullseye: pos, calibrated_at: Date.now() }),
      setBallBox: (pos) => set({ ballBox: pos, calibrated_at: Date.now() }),
      // 2026-05-27 — Fix ER: setter clamps coords + size to sensible
      // ranges so a runaway gesture can't shrink the box to invisible
      // or balloon it past the viewport. cx/cy 0..1, w/h 0.15..0.95.
      setBodyBox: (rect) => set(() => {
        if (rect == null) return { bodyBox: null, calibrated_at: Date.now() };
        const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
        const clampSize = (v: number) => Math.max(0.15, Math.min(0.95, v));
        return {
          bodyBox: {
            cx: clamp01(rect.cx),
            cy: clamp01(rect.cy),
            w: clampSize(rect.w),
            h: clampSize(rect.h),
          },
          calibrated_at: Date.now(),
        };
      }),
      reset: () => set({ bullseye: null, ballBox: null, bodyBox: null, calibrated_at: null }),
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
