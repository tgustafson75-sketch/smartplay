/**
 * Per-course, per-hole tee/green position calibration for curated bundled images.
 *
 * Coordinates are stored as FRACTIONS (0.0–1.0) of the source image width/height
 * so they scale correctly to any canvas size. Origin: top-left; +x right, +y down.
 *
 * Tee is always near the bottom of the image (fy ≈ 0.85–0.97).
 * Green is always near the top (fy ≈ 0.05–0.15).
 *
 * Data generated 2026-06-21 by scanning each bundled image:
 *   - For images with white margins (Crystal Springs, Lakes, etc.): detects the
 *     horizontal center of the non-white content in the top/bottom 25% of each image.
 *   - For full-frame aerials (Palms, Westlake): no white margins, x defaults to
 *     center (0.5). Per-hole calibration improves with on-course Mark T / Mark P.
 *
 * Consumer: app/smartvision.tsx reads these via getHoleLineCalibration().
 * GPS projection is NEVER used on curated photos — only on Mapbox/Golfbert tiles.
 */

import type { LocalCourseSlug } from './localCourseImages';

export interface HoleLineEndpoints {
  tee:   { fx: number; fy: number };
  green: { fx: number; fy: number };
}

export const HOLE_LINE_CALIBRATION: Partial<Record<LocalCourseSlug, Record<number, HoleLineEndpoints>>> = {
  'crystal-springs': {
    1:  { tee: { fx: 0.735, fy: 0.954 }, green: { fx: 0.651, fy: 0.077 } },
    2:  { tee: { fx: 0.738, fy: 0.949 }, green: { fx: 0.647, fy: 0.073 } },
    3:  { tee: { fx: 0.713, fy: 0.938 }, green: { fx: 0.650, fy: 0.084 } },
    4:  { tee: { fx: 0.748, fy: 0.954 }, green: { fx: 0.653, fy: 0.066 } },
    5:  { tee: { fx: 0.735, fy: 0.951 }, green: { fx: 0.646, fy: 0.073 } },
    6:  { tee: { fx: 0.715, fy: 0.947 }, green: { fx: 0.676, fy: 0.069 } },
    7:  { tee: { fx: 0.741, fy: 0.954 }, green: { fx: 0.656, fy: 0.065 } },
    8:  { tee: { fx: 0.713, fy: 0.932 }, green: { fx: 0.651, fy: 0.084 } },
    9:  { tee: { fx: 0.745, fy: 0.951 }, green: { fx: 0.646, fy: 0.070 } },
    10: { tee: { fx: 0.655, fy: 0.920 }, green: { fx: 0.698, fy: 0.082 } },
    11: { tee: { fx: 0.696, fy: 0.922 }, green: { fx: 0.648, fy: 0.094 } },
    12: { tee: { fx: 0.706, fy: 0.942 }, green: { fx: 0.671, fy: 0.071 } },
    13: { tee: { fx: 0.688, fy: 0.925 }, green: { fx: 0.651, fy: 0.098 } },
    14: { tee: { fx: 0.685, fy: 0.941 }, green: { fx: 0.715, fy: 0.070 } },
    15: { tee: { fx: 0.728, fy: 0.947 }, green: { fx: 0.648, fy: 0.074 } },
    16: { tee: { fx: 0.743, fy: 0.953 }, green: { fx: 0.647, fy: 0.068 } },
    17: { tee: { fx: 0.741, fy: 0.951 }, green: { fx: 0.645, fy: 0.073 } },
    18: { tee: { fx: 0.753, fy: 0.958 }, green: { fx: 0.633, fy: 0.068 } },
  },
  'echo-hills': {
    1: { tee: { fx: 0.666, fy: 0.925 }, green: { fx: 0.675, fy: 0.096 } },
    2: { tee: { fx: 0.634, fy: 0.909 }, green: { fx: 0.640, fy: 0.116 } },
    3: { tee: { fx: 0.631, fy: 0.916 }, green: { fx: 0.656, fy: 0.106 } },
    4: { tee: { fx: 0.675, fy: 0.925 }, green: { fx: 0.670, fy: 0.096 } },
    5: { tee: { fx: 0.686, fy: 0.925 }, green: { fx: 0.654, fy: 0.097 } },
    6: { tee: { fx: 0.666, fy: 0.918 }, green: { fx: 0.665, fy: 0.097 } },
    7: { tee: { fx: 0.664, fy: 0.925 }, green: { fx: 0.666, fy: 0.096 } },
    8: { tee: { fx: 0.666, fy: 0.925 }, green: { fx: 0.670, fy: 0.097 } },
    9: { tee: { fx: 0.667, fy: 0.928 }, green: { fx: 0.670, fy: 0.106 } },
  },
  'lakes': {
    1:  { tee: { fx: 0.504, fy: 0.943 }, green: { fx: 0.489, fy: 0.082 } },
    2:  { tee: { fx: 0.532, fy: 0.942 }, green: { fx: 0.475, fy: 0.083 } },
    3:  { tee: { fx: 0.491, fy: 0.914 }, green: { fx: 0.488, fy: 0.110 } },
    4:  { tee: { fx: 0.563, fy: 0.936 }, green: { fx: 0.459, fy: 0.094 } },
    5:  { tee: { fx: 0.501, fy: 0.943 }, green: { fx: 0.488, fy: 0.089 } },
    6:  { tee: { fx: 0.459, fy: 0.947 }, green: { fx: 0.500, fy: 0.083 } },
    7:  { tee: { fx: 0.457, fy: 0.943 }, green: { fx: 0.494, fy: 0.085 } },
    8:  { tee: { fx: 0.492, fy: 0.932 }, green: { fx: 0.498, fy: 0.102 } },
    9:  { tee: { fx: 0.524, fy: 0.949 }, green: { fx: 0.474, fy: 0.077 } },
    10: { tee: { fx: 0.544, fy: 0.940 }, green: { fx: 0.459, fy: 0.087 } },
    11: { tee: { fx: 0.506, fy: 0.945 }, green: { fx: 0.483, fy: 0.085 } },
    12: { tee: { fx: 0.494, fy: 0.948 }, green: { fx: 0.491, fy: 0.077 } },
    13: { tee: { fx: 0.491, fy: 0.929 }, green: { fx: 0.503, fy: 0.102 } },
    14: { tee: { fx: 0.633, fy: 0.923 }, green: { fx: 0.422, fy: 0.107 } },
    15: { tee: { fx: 0.559, fy: 0.933 }, green: { fx: 0.432, fy: 0.081 } },
    16: { tee: { fx: 0.491, fy: 0.943 }, green: { fx: 0.491, fy: 0.083 } },
    17: { tee: { fx: 0.498, fy: 0.912 }, green: { fx: 0.492, fy: 0.110 } },
    18: { tee: { fx: 0.438, fy: 0.943 }, green: { fx: 0.550, fy: 0.081 } },
  },
  'mariners-point': {
    1: { tee: { fx: 0.681, fy: 0.923 }, green: { fx: 0.655, fy: 0.103 } },
    2: { tee: { fx: 0.676, fy: 0.914 }, green: { fx: 0.648, fy: 0.108 } },
    3: { tee: { fx: 0.682, fy: 0.914 }, green: { fx: 0.653, fy: 0.102 } },
    4: { tee: { fx: 0.696, fy: 0.916 }, green: { fx: 0.657, fy: 0.097 } },
    5: { tee: { fx: 0.700, fy: 0.929 }, green: { fx: 0.655, fy: 0.095 } },
    6: { tee: { fx: 0.690, fy: 0.915 }, green: { fx: 0.656, fy: 0.099 } },
    7: { tee: { fx: 0.683, fy: 0.925 }, green: { fx: 0.653, fy: 0.098 } },
    8: { tee: { fx: 0.663, fy: 0.916 }, green: { fx: 0.655, fy: 0.105 } },
    9: { tee: { fx: 0.665, fy: 0.907 }, green: { fx: 0.648, fy: 0.110 } },
  },
  'palms': {
    // Full-frame aerial — x defaults to center; fy positions are accurate.
    // Per-hole x calibration improves with on-course Mark T / Mark P.
    1:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    2:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    3:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    4:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    5:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    6:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    7:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    8:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    9:  { tee: { fx: 0.580, fy: 0.860 }, green: { fx: 0.520, fy: 0.050 } },
    10: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    11: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    12: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    13: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    14: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    15: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    16: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    17: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    18: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
  },
  'rancho-california': {
    1:  { tee: { fx: 0.666, fy: 0.970 }, green: { fx: 0.607, fy: 0.050 } },
    2:  { tee: { fx: 0.627, fy: 0.970 }, green: { fx: 0.629, fy: 0.067 } },
    3:  { tee: { fx: 0.626, fy: 0.970 }, green: { fx: 0.627, fy: 0.050 } },
    4:  { tee: { fx: 0.622, fy: 0.970 }, green: { fx: 0.630, fy: 0.050 } },
    5:  { tee: { fx: 0.622, fy: 0.970 }, green: { fx: 0.648, fy: 0.050 } },
    6:  { tee: { fx: 0.629, fy: 0.970 }, green: { fx: 0.626, fy: 0.067 } },
    7:  { tee: { fx: 0.622, fy: 0.970 }, green: { fx: 0.629, fy: 0.050 } },
    8:  { tee: { fx: 0.597, fy: 0.970 }, green: { fx: 0.633, fy: 0.050 } },
    9:  { tee: { fx: 0.626, fy: 0.970 }, green: { fx: 0.630, fy: 0.050 } },
    10: { tee: { fx: 0.629, fy: 0.970 }, green: { fx: 0.625, fy: 0.067 } },
    11: { tee: { fx: 0.669, fy: 0.970 }, green: { fx: 0.592, fy: 0.050 } },
    12: { tee: { fx: 0.591, fy: 0.970 }, green: { fx: 0.688, fy: 0.050 } },
    13: { tee: { fx: 0.642, fy: 0.970 }, green: { fx: 0.629, fy: 0.050 } },
    14: { tee: { fx: 0.644, fy: 0.970 }, green: { fx: 0.618, fy: 0.050 } },
    15: { tee: { fx: 0.603, fy: 0.970 }, green: { fx: 0.630, fy: 0.050 } },
    16: { tee: { fx: 0.627, fy: 0.970 }, green: { fx: 0.629, fy: 0.062 } },
    17: { tee: { fx: 0.638, fy: 0.970 }, green: { fx: 0.616, fy: 0.050 } },
    18: { tee: { fx: 0.607, fy: 0.970 }, green: { fx: 0.650, fy: 0.050 } },
  },
  'san-jose-muni': {
    1:  { tee: { fx: 0.444, fy: 0.944 }, green: { fx: 0.556, fy: 0.050 } },
    2:  { tee: { fx: 0.544, fy: 0.926 }, green: { fx: 0.480, fy: 0.057 } },
    3:  { tee: { fx: 0.515, fy: 0.944 }, green: { fx: 0.505, fy: 0.052 } },
    4:  { tee: { fx: 0.497, fy: 0.915 }, green: { fx: 0.497, fy: 0.078 } },
    5:  { tee: { fx: 0.464, fy: 0.938 }, green: { fx: 0.499, fy: 0.068 } },
    6:  { tee: { fx: 0.587, fy: 0.936 }, green: { fx: 0.470, fy: 0.054 } },
    7:  { tee: { fx: 0.497, fy: 0.922 }, green: { fx: 0.497, fy: 0.074 } },
    8:  { tee: { fx: 0.544, fy: 0.944 }, green: { fx: 0.503, fy: 0.051 } },
    9:  { tee: { fx: 0.546, fy: 0.947 }, green: { fx: 0.487, fy: 0.050 } },
    10: { tee: { fx: 0.561, fy: 0.936 }, green: { fx: 0.474, fy: 0.053 } },
    11: { tee: { fx: 0.556, fy: 0.947 }, green: { fx: 0.487, fy: 0.050 } },
    12: { tee: { fx: 0.497, fy: 0.921 }, green: { fx: 0.497, fy: 0.075 } },
    13: { tee: { fx: 0.561, fy: 0.940 }, green: { fx: 0.458, fy: 0.052 } },
    14: { tee: { fx: 0.462, fy: 0.940 }, green: { fx: 0.550, fy: 0.054 } },
    15: { tee: { fx: 0.439, fy: 0.940 }, green: { fx: 0.552, fy: 0.050 } },
    16: { tee: { fx: 0.526, fy: 0.942 }, green: { fx: 0.499, fy: 0.054 } },
    17: { tee: { fx: 0.497, fy: 0.927 }, green: { fx: 0.497, fy: 0.069 } },
    18: { tee: { fx: 0.499, fy: 0.951 }, green: { fx: 0.497, fy: 0.050 } },
  },
  'sunnyvale': {
    1:  { tee: { fx: 0.522, fy: 0.940 }, green: { fx: 0.503, fy: 0.051 } },
    2:  { tee: { fx: 0.561, fy: 0.940 }, green: { fx: 0.481, fy: 0.051 } },
    3:  { tee: { fx: 0.497, fy: 0.911 }, green: { fx: 0.497, fy: 0.081 } },
    4:  { tee: { fx: 0.558, fy: 0.934 }, green: { fx: 0.476, fy: 0.066 } },
    5:  { tee: { fx: 0.520, fy: 0.941 }, green: { fx: 0.503, fy: 0.058 } },
    6:  { tee: { fx: 0.468, fy: 0.945 }, green: { fx: 0.522, fy: 0.053 } },
    7:  { tee: { fx: 0.464, fy: 0.941 }, green: { fx: 0.515, fy: 0.053 } },
    8:  { tee: { fx: 0.497, fy: 0.930 }, green: { fx: 0.497, fy: 0.072 } },
    9:  { tee: { fx: 0.546, fy: 0.947 }, green: { fx: 0.481, fy: 0.050 } },
    10: { tee: { fx: 0.567, fy: 0.938 }, green: { fx: 0.462, fy: 0.056 } },
    11: { tee: { fx: 0.526, fy: 0.942 }, green: { fx: 0.499, fy: 0.054 } },
    12: { tee: { fx: 0.511, fy: 0.946 }, green: { fx: 0.505, fy: 0.050 } },
    13: { tee: { fx: 0.497, fy: 0.924 }, green: { fx: 0.497, fy: 0.072 } },
    14: { tee: { fx: 0.604, fy: 0.921 }, green: { fx: 0.480, fy: 0.076 } },
    15: { tee: { fx: 0.540, fy: 0.937 }, green: { fx: 0.439, fy: 0.050 } },
    16: { tee: { fx: 0.505, fy: 0.941 }, green: { fx: 0.505, fy: 0.052 } },
    17: { tee: { fx: 0.497, fy: 0.909 }, green: { fx: 0.497, fy: 0.079 } },
    18: { tee: { fx: 0.439, fy: 0.940 }, green: { fx: 0.558, fy: 0.050 } },
  },
  'westlake-cc-nj': {
    // Full-frame aerial — x defaults to center; fy positions are accurate.
    1:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    2:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    3:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    4:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    5:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    6:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    7:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    8:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    9:  { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    10: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    11: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    12: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    13: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    14: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    15: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    16: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    17: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
    18: { tee: { fx: 0.500, fy: 0.970 }, green: { fx: 0.500, fy: 0.050 } },
  },
  'greenhill': {
    // GolfShot aerial screenshots cropped to 650x1534 (app chrome removed).
    // Tee (blue dot) and green (teal ring center) auto-detected from pixel
    // color in the cropped images. Same format as Crystal Springs / Lakes.
    1:  { tee: { fx: 0.452, fy: 0.887 }, green: { fx: 0.455, fy: 0.183 } },
    2:  { tee: { fx: 0.468, fy: 0.846 }, green: { fx: 0.457, fy: 0.186 } },
    3:  { tee: { fx: 0.352, fy: 0.881 }, green: { fx: 0.454, fy: 0.171 } },
    4:  { tee: { fx: 0.480, fy: 0.839 }, green: { fx: 0.455, fy: 0.182 } },
    5:  { tee: { fx: 0.525, fy: 0.854 }, green: { fx: 0.457, fy: 0.192 } },
    6:  { tee: { fx: 0.469, fy: 0.782 }, green: { fx: 0.457, fy: 0.264 } },
    7:  { tee: { fx: 0.402, fy: 0.873 }, green: { fx: 0.458, fy: 0.199 } },
    8:  { tee: { fx: 0.462, fy: 0.763 }, green: { fx: 0.455, fy: 0.292 } },
    9:  { tee: { fx: 0.495, fy: 0.851 }, green: { fx: 0.455, fy: 0.153 } },
    10: { tee: { fx: 0.446, fy: 0.718 }, green: { fx: 0.457, fy: 0.184 } },
    11: { tee: { fx: 0.454, fy: 0.769 }, green: { fx: 0.458, fy: 0.256 } },
    12: { tee: { fx: 0.358, fy: 0.963 }, green: { fx: 0.455, fy: 0.140 } },
    13: { tee: { fx: 0.511, fy: 0.902 }, green: { fx: 0.460, fy: 0.181 } },
    14: { tee: { fx: 0.432, fy: 0.777 }, green: { fx: 0.460, fy: 0.314 } },
    15: { tee: { fx: 0.526, fy: 0.904 }, green: { fx: 0.458, fy: 0.207 } },
    16: { tee: { fx: 0.443, fy: 0.900 }, green: { fx: 0.457, fy: 0.155 } },
    17: { tee: { fx: 0.572, fy: 0.821 }, green: { fx: 0.458, fy: 0.229 } },
    18: { tee: { fx: 0.458, fy: 0.850 }, green: { fx: 0.457, fy: 0.173 } },
  },
};

export function getHoleLineCalibration(
  slug: LocalCourseSlug | null,
  holeNumber: number,
): HoleLineEndpoints | null {
  if (!slug) return null;
  const courseMap = HOLE_LINE_CALIBRATION[slug];
  if (!courseMap) return null;
  return courseMap[holeNumber] ?? null;
}

/** Convert fraction-based calibration to canvas pixels. */
export function calibrationToCanvas(
  cal: HoleLineEndpoints,
  canvasW: number,
  canvasH: number,
): { tee: { x: number; y: number }; green: { x: number; y: number } } {
  return {
    tee:   { x: cal.tee.fx   * canvasW, y: cal.tee.fy   * canvasH },
    green: { x: cal.green.fx * canvasW, y: cal.green.fy * canvasH },
  };
}
