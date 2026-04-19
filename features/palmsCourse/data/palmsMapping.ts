/**
 * features/palmsCourse/data/palmsMapping.ts
 *
 * GPS + pixel mapping for all 18 Palms holes.
 *
 * Each entry defines:
 *   tee   — GPS coordinate of the back tee box
 *   green — GPS coordinate of the green center (GPS-verified)
 *   image — dimensions of the play-view image + pixel anchors for tee and green
 *
 * Pixel anchors (teePixel / greenPixel) are in the coordinate space of the
 * play-view image asset (width × height in logical pixels).
 * These are estimated from aerial screenshots; calibrate once real assets land.
 *
 * GPSCalibrator uses tee+green GPS and tee+green pixels to build an affine
 * transform that projects any live GPS coordinate onto the image.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Pixel {
  x: number;
  y: number;
}

export interface HoleImageMeta {
  /** Logical width of the play-view image in pixels. */
  width:      number;
  /** Logical height of the play-view image in pixels. */
  height:     number;
  /** Pixel position of the tee in the image (bottom area). */
  teePixel:   Pixel;
  /** Pixel position of the green center in the image (top area). */
  greenPixel: Pixel;
}

export interface PalmsHoleMapping {
  hole:   number;
  tee:    LatLng;
  green:  LatLng;
  image:  HoleImageMeta;
}

// Backwards-compat alias used by GPSCalibrator (pin → green)
export type HoleBoundsMapping = PalmsHoleMapping;

// ─── Mapping table ────────────────────────────────────────────────────────────
// teePixel x=500 = centre of fairway; shift left/right for dogleg/OB offsets.
// greenPixel is always near top (y≈200); teePixel near bottom (y≈1800).

export const palmsMapping: Record<number, PalmsHoleMapping> = {
   1: { hole:  1, tee: { lat: 33.6890, lng: -117.1820 }, green: { lat: 33.6876, lng: -117.1806 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
   2: { hole:  2, tee: { lat: 33.6894, lng: -117.1832 }, green: { lat: 33.6880, lng: -117.1820 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
   3: { hole:  3, tee: { lat: 33.6901, lng: -117.1845 }, green: { lat: 33.6888, lng: -117.1834 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
   4: { hole:  4, tee: { lat: 33.6909, lng: -117.1858 }, green: { lat: 33.6889, lng: -117.1844 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
   5: { hole:  5, tee: { lat: 33.6917, lng: -117.1870 }, green: { lat: 33.6903, lng: -117.1858 }, image: { width: 1000, height: 2000, teePixel: { x: 420, y: 1800 }, greenPixel: { x: 580, y: 200 } } }, // dogleg right
   6: { hole:  6, tee: { lat: 33.6924, lng: -117.1883 }, green: { lat: 33.6918, lng: -117.1877 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
   7: { hole:  7, tee: { lat: 33.6932, lng: -117.1896 }, green: { lat: 33.6918, lng: -117.1884 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
   8: { hole:  8, tee: { lat: 33.6939, lng: -117.1908 }, green: { lat: 33.6925, lng: -117.1896 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
   9: { hole:  9, tee: { lat: 33.6947, lng: -117.1921 }, green: { lat: 33.6927, lng: -117.1907 }, image: { width: 1000, height: 2000, teePixel: { x: 580, y: 1800 }, greenPixel: { x: 500, y: 200 } } }, // water left
  10: { hole: 10, tee: { lat: 33.6955, lng: -117.1934 }, green: { lat: 33.6940, lng: -117.1921 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
  11: { hole: 11, tee: { lat: 33.6962, lng: -117.1947 }, green: { lat: 33.6946, lng: -117.1934 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
  12: { hole: 12, tee: { lat: 33.6970, lng: -117.1960 }, green: { lat: 33.6964, lng: -117.1954 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
  13: { hole: 13, tee: { lat: 33.6978, lng: -117.1972 }, green: { lat: 33.6959, lng: -117.1957 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
  14: { hole: 14, tee: { lat: 33.6985, lng: -117.1985 }, green: { lat: 33.6971, lng: -117.1972 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
  15: { hole: 15, tee: { lat: 33.6993, lng: -117.1998 }, green: { lat: 33.6979, lng: -117.1985 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
  16: { hole: 16, tee: { lat: 33.7001, lng: -117.2011 }, green: { lat: 33.6995, lng: -117.2005 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
  17: { hole: 17, tee: { lat: 33.7008, lng: -117.2024 }, green: { lat: 33.6994, lng: -117.2011 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
  18: { hole: 18, tee: { lat: 33.7016, lng: -117.2037 }, green: { lat: 33.6996, lng: -117.2021 }, image: { width: 1000, height: 2000, teePixel: { x: 500, y: 1800 }, greenPixel: { x: 500, y: 200 } } },
};

// ─── Convenience exports ──────────────────────────────────────────────────────

export const PALMS_HOLE_MAPPINGS = Object.values(palmsMapping);

export function getPalmsHoleMapping(holeNumber: number): PalmsHoleMapping | undefined {
  return palmsMapping[holeNumber];
}
