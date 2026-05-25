/**
 * Phase 406 — Shared device-layout hook.
 *
 * One source of truth for aspect-ratio + orientation classification.
 * Every landscape-capable surface reads the same breakpoints from
 * here so a future retune happens in one place instead of per-screen.
 *
 * Breakpoints (per Phase 406 brief):
 *   aspect < 1.0   → 'portrait'      (phone upright; Fold closed)
 *   1.0–1.4        → 'near-square'   (Fold partial-open; portrait tablet)
 *   aspect > 1.4   → 'landscape'     (Fold inner-open; phone rotated; landscape tablet)
 *
 * `isFoldOpen` is a legacy convenience-flag many existing surfaces
 * (CageSessionOverlay, swing-detail, smartvision) already use. Kept
 * in sync with the new aspect classification: true whenever width is
 * >540 dp AND aspect is near-square or landscape.
 */

import { useWindowDimensions } from 'react-native';

export type DeviceOrientation = 'portrait' | 'near-square' | 'landscape';

export type DeviceLayout = {
  width: number;
  height: number;
  /** width / height. */
  aspect: number;
  orientation: DeviceOrientation;
  isLandscape: boolean;
  isFoldOpen: boolean;
  /** 2026-05-24 — beta-minimal responsive flag. True on fold-open,
   *  tablet portrait, tablet landscape, and phone landscape. False on
   *  phone portrait and fold-closed (the "narrow" cases). Tabs branch
   *  on this to constrain content to WIDE_CONTENT_MAX_WIDTH so cards /
   *  lists don't stretch grotesquely on wide surfaces. */
  isWide: boolean;
};

const LANDSCAPE_THRESHOLD = 1.4;
const NEAR_SQUARE_MIN = 1.0;
const FOLD_OPEN_WIDTH = 540;
/** Aspect threshold for the beta-minimal isWide flag. Empirically:
 *   phone portrait ≈ 0.46, fold closed ≈ 0.43 → narrow (false).
 *   fold open ≈ 0.76, tablet portrait ≈ 0.75 → wide (true).
 *   tablet landscape ≈ 1.33+, phone landscape ≈ 1.78 → wide (true). */
const WIDE_ASPECT_THRESHOLD = 0.6;
/** Centered max-width for tab content on wide surfaces. ~700pt reads
 *  comfortably without stretching cards edge-to-edge on tablet. */
export const WIDE_CONTENT_MAX_WIDTH = 700;

export function useDeviceLayout(): DeviceLayout {
  const { width, height } = useWindowDimensions();
  const aspect = width / Math.max(height, 1);

  let orientation: DeviceOrientation;
  if (aspect >= LANDSCAPE_THRESHOLD) orientation = 'landscape';
  else if (aspect >= NEAR_SQUARE_MIN) orientation = 'near-square';
  else orientation = 'portrait';

  const isLandscape = orientation === 'landscape';
  const isFoldOpen = width >= FOLD_OPEN_WIDTH && orientation !== 'portrait';
  const isWide = aspect >= WIDE_ASPECT_THRESHOLD;

  return { width, height, aspect, orientation, isLandscape, isFoldOpen, isWide };
}
