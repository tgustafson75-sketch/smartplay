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
};

const LANDSCAPE_THRESHOLD = 1.4;
const NEAR_SQUARE_MIN = 1.0;
const FOLD_OPEN_WIDTH = 540;

export function useDeviceLayout(): DeviceLayout {
  const { width, height } = useWindowDimensions();
  const aspect = width / Math.max(height, 1);

  let orientation: DeviceOrientation;
  if (aspect >= LANDSCAPE_THRESHOLD) orientation = 'landscape';
  else if (aspect >= NEAR_SQUARE_MIN) orientation = 'near-square';
  else orientation = 'portrait';

  const isLandscape = orientation === 'landscape';
  const isFoldOpen = width >= FOLD_OPEN_WIDTH && orientation !== 'portrait';

  return { width, height, aspect, orientation, isLandscape, isFoldOpen };
}
