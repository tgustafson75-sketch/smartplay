/**
 * features/playView/data/holeMapping.ts
 *
 * Multi-point fairway path data for each hole.
 *
 * Each hole defines an ordered array of GPS + pixel anchor points running
 * from tee (index 0) to green (last index). PathProjection.mapToFairwayPath()
 * uses these to project the player GPS position onto the hole photograph.
 *
 * HOW TO CALIBRATE PER HOLE:
 *   1. Identify 3-5 points along the fairway (tee, doglegs, green).
 *   2. Use Google Maps to get lat/lng for each point.
 *   3. Open the hole image and note pixel coordinates for each GPS point.
 *   4. Replace placeholder values below with your measurements.
 *
 * Keep path arrays to 3-5 points for performance (<16ms frame budget).
 */

export interface PathPoint {
  lat:   number;
  lng:   number;
  pixel: { x: number; y: number };
}

export interface HoleMapping {
  path: PathPoint[];
}

/** Fairway path for all 18 holes. GPS values are placeholders. */
export const holeMapping: Record<number, HoleMapping> = {
   1: { path: [{ lat: 33.6890, lng: -117.1820, pixel: { x: 500, y: 1800 } }, { lat: 33.6883, lng: -117.1813, pixel: { x: 500, y: 1000 } }, { lat: 33.6876, lng: -117.1806, pixel: { x: 500, y: 200 } }] },
   2: { path: [{ lat: 33.6894, lng: -117.1832, pixel: { x: 500, y: 1800 } }, { lat: 33.6887, lng: -117.1826, pixel: { x: 500, y: 1000 } }, { lat: 33.6880, lng: -117.1820, pixel: { x: 500, y: 200 } }] },
   3: { path: [{ lat: 33.6901, lng: -117.1845, pixel: { x: 500, y: 1800 } }, { lat: 33.6895, lng: -117.1840, pixel: { x: 500, y: 1000 } }, { lat: 33.6888, lng: -117.1834, pixel: { x: 500, y: 200 } }] },
   4: { path: [{ lat: 33.6909, lng: -117.1858, pixel: { x: 500, y: 1800 } }, { lat: 33.6899, lng: -117.1851, pixel: { x: 500, y: 1000 } }, { lat: 33.6889, lng: -117.1844, pixel: { x: 500, y: 200 } }] },
   5: { path: [{ lat: 33.6917, lng: -117.1870, pixel: { x: 420, y: 1800 } }, { lat: 33.6912, lng: -117.1862, pixel: { x: 480, y: 1100 } }, { lat: 33.6908, lng: -117.1858, pixel: { x: 560, y: 600 } }, { lat: 33.6903, lng: -117.1858, pixel: { x: 580, y: 200 } }] },
   6: { path: [{ lat: 33.6924, lng: -117.1883, pixel: { x: 500, y: 1800 } }, { lat: 33.6921, lng: -117.1880, pixel: { x: 500, y: 1000 } }, { lat: 33.6918, lng: -117.1877, pixel: { x: 500, y: 200 } }] },
   7: { path: [{ lat: 33.6932, lng: -117.1896, pixel: { x: 500, y: 1800 } }, { lat: 33.6925, lng: -117.1890, pixel: { x: 500, y: 1000 } }, { lat: 33.6918, lng: -117.1884, pixel: { x: 500, y: 200 } }] },
   8: { path: [{ lat: 33.6939, lng: -117.1908, pixel: { x: 500, y: 1800 } }, { lat: 33.6932, lng: -117.1902, pixel: { x: 500, y: 1000 } }, { lat: 33.6925, lng: -117.1896, pixel: { x: 500, y: 200 } }] },
   9: { path: [{ lat: 33.6947, lng: -117.1921, pixel: { x: 580, y: 1800 } }, { lat: 33.6940, lng: -117.1915, pixel: { x: 550, y: 1100 } }, { lat: 33.6933, lng: -117.1911, pixel: { x: 520, y: 600 } }, { lat: 33.6927, lng: -117.1907, pixel: { x: 500, y: 200 } }] },
  10: { path: [{ lat: 33.6955, lng: -117.1934, pixel: { x: 500, y: 1800 } }, { lat: 33.6950, lng: -117.1926, pixel: { x: 520, y: 1100 } }, { lat: 33.6943, lng: -117.1921, pixel: { x: 500, y: 200 } }] },
  11: { path: [{ lat: 33.6962, lng: -117.1947, pixel: { x: 500, y: 1800 } }, { lat: 33.6956, lng: -117.1940, pixel: { x: 500, y: 1100 } }, { lat: 33.6950, lng: -117.1934, pixel: { x: 500, y: 600 } }, { lat: 33.6946, lng: -117.1934, pixel: { x: 500, y: 200 } }] },
  12: { path: [{ lat: 33.6970, lng: -117.1960, pixel: { x: 500, y: 1800 } }, { lat: 33.6967, lng: -117.1957, pixel: { x: 500, y: 1000 } }, { lat: 33.6964, lng: -117.1954, pixel: { x: 500, y: 200 } }] },
  13: { path: [{ lat: 33.6978, lng: -117.1972, pixel: { x: 500, y: 1800 } }, { lat: 33.6969, lng: -117.1965, pixel: { x: 500, y: 1000 } }, { lat: 33.6959, lng: -117.1957, pixel: { x: 500, y: 200 } }] },
  14: { path: [{ lat: 33.6985, lng: -117.1985, pixel: { x: 500, y: 1800 } }, { lat: 33.6978, lng: -117.1979, pixel: { x: 500, y: 1000 } }, { lat: 33.6971, lng: -117.1972, pixel: { x: 500, y: 200 } }] },
  15: { path: [{ lat: 33.6993, lng: -117.1998, pixel: { x: 500, y: 1800 } }, { lat: 33.6986, lng: -117.1992, pixel: { x: 500, y: 1000 } }, { lat: 33.6979, lng: -117.1985, pixel: { x: 500, y: 200 } }] },
  16: { path: [{ lat: 33.7001, lng: -117.2011, pixel: { x: 500, y: 1800 } }, { lat: 33.6998, lng: -117.2008, pixel: { x: 500, y: 1000 } }, { lat: 33.6995, lng: -117.2005, pixel: { x: 500, y: 200 } }] },
  17: { path: [{ lat: 33.7008, lng: -117.2024, pixel: { x: 500, y: 1800 } }, { lat: 33.7001, lng: -117.2018, pixel: { x: 500, y: 1000 } }, { lat: 33.6994, lng: -117.2011, pixel: { x: 500, y: 200 } }] },
  18: { path: [{ lat: 33.7016, lng: -117.2037, pixel: { x: 500, y: 1800 } }, { lat: 33.7006, lng: -117.2029, pixel: { x: 500, y: 1000 } }, { lat: 33.6996, lng: -117.2021, pixel: { x: 500, y: 200 } }] },
};