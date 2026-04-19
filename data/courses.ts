/**
 * data/courses.ts
 *
 * Single source of truth for course data.
 * Imported by:
 *   • app/PlayScreenClean.tsx     (gameplay GPS + hole data)
 *   • app/(tabs)/play.tsx         (round setup course selector)
 *   • app/(tabs)/history.tsx      (handicap slope/rating lookup)
 *   • app/(tabs)/dashboard.tsx    (same)
 */

import { ImageSourcePropType } from 'react-native';

/** A hazard defined in normalized (0–1) image coordinates */
export type Hazard = {
  /** 'water' | 'bunker' | 'ob' — informational only */
  type: 'water' | 'bunker' | 'ob';
  /** Normalized center of the hazard on the hole image */
  x: number;
  y: number;
  /** Radius of influence in normalized units (default 0.06) */
  r?: number;
  /** Which direction to nudge the target away from this hazard */
  avoidDir: 'left' | 'right' | 'short' | 'long';
};

export type CourseHole = {
  hole:     number;
  par:      number;
  distance: number;   // yards, white tees
  note:     string;
  /** GPS coordinates of the tee box (used for pixelToGPS mapping on the hole map) */
  tee?:     { lat: number; lng: number };
  front:    { lat: number; lng: number };
  middle:   { lat: number; lng: number };
  back:     { lat: number; lng: number };
  /** Optional per-hole thumbnail — use local require() assets or remote URL */
  thumbnail?: ImageSourcePropType;
  /** Optional full-size hole map image */
  fullImage?: ImageSourcePropType;
  /** Lightweight hazard zones used for silent target adjustment */
  hazards?: Hazard[];
};

export type Course = {
  id:        string;
  name:      string;
  location:  string;
  slope:     number;
  rating:    number;
  /** require()'d image for course thumbnail in UI */
  thumbnail: ImageSourcePropType;
  /** Optional link to tee time booking */
  teeTimeUrl?: string;
  holes:     CourseHole[];
};

// ---------------------------------------------------------------------------
// COURSE DATABASE
// ---------------------------------------------------------------------------

export const COURSE_DB: Course[] = [
  // ── 1. Menifee Lakes – Palms ────────────────────────────────────────────
  {
    id:        'menifee_lakes_palms',
    name:      'Menifee Lakes – Palms',
    location:  'Menifee, CA',
    slope:     118,
    rating:    69.8,
    teeTimeUrl: 'https://foreupsoftware.com/index.php/booking/index/19103#/teetimes',
    thumbnail: require('../assets/images/hole1.jpg'),
    holes: [
      { hole: 1,  par: 4, distance: 368, note: 'Wide landing area, open tee shot',    tee: { lat: 33.6861, lng: -117.1820 }, front: { lat: 33.6892, lng: -117.1820 }, middle: { lat: 33.6891, lng: -117.1820 }, back: { lat: 33.6890, lng: -117.1820 }, thumbnail: require('../assets/images/hole1.jpg'),  fullImage: require('../assets/images/hole1.jpg') },
      { hole: 2,  par: 4, distance: 353, note: 'Water short-left, aim center',         tee: { lat: 33.6866, lng: -117.1845 }, front: { lat: 33.6896, lng: -117.1832 }, middle: { lat: 33.6895, lng: -117.1832 }, back: { lat: 33.6894, lng: -117.1832 }, thumbnail: require('../assets/images/hole2.jpg'),  fullImage: require('../assets/images/hole2.jpg'),  hazards: [{ type: 'water',  x: 0.25, y: 0.75, r: 0.08, avoidDir: 'right' }] },
      { hole: 3,  par: 4, distance: 356, note: 'Dogleg right, trees on corner',        tee: { lat: 33.6873, lng: -117.1852 }, front: { lat: 33.6903, lng: -117.1845 }, middle: { lat: 33.6902, lng: -117.1845 }, back: { lat: 33.6901, lng: -117.1845 }, thumbnail: require('../assets/images/hole3.jpg'),  fullImage: require('../assets/images/hole3.jpg'),  hazards: [{ type: 'ob',     x: 0.78, y: 0.55, r: 0.07, avoidDir: 'left'  }] },
      { hole: 4,  par: 5, distance: 489, note: 'Reachable par 5, bunkers right',       tee: { lat: 33.6870, lng: -117.1858 }, front: { lat: 33.6911, lng: -117.1858 }, middle: { lat: 33.6910, lng: -117.1858 }, back: { lat: 33.6909, lng: -117.1858 }, thumbnail: require('../assets/images/hole4.jpg'),  fullImage: require('../assets/images/hole4.jpg'),  hazards: [{ type: 'bunker', x: 0.72, y: 0.45, r: 0.06, avoidDir: 'left'  }] },
      { hole: 5,  par: 4, distance: 367, note: 'Long par 4, slight dogleg left',       tee: { lat: 33.6888, lng: -117.1877 }, front: { lat: 33.6919, lng: -117.1870 }, middle: { lat: 33.6918, lng: -117.1870 }, back: { lat: 33.6917, lng: -117.1870 }, thumbnail: require('../assets/images/hole5.jpg'),  fullImage: require('../assets/images/hole5.jpg'),  hazards: [{ type: 'bunker', x: 0.22, y: 0.50, r: 0.06, avoidDir: 'right' }] },
      { hole: 6,  par: 4, distance: 379, note: 'Long straight hole, bunker guards',    tee: { lat: 33.6894, lng: -117.1883 }, front: { lat: 33.6926, lng: -117.1883 }, middle: { lat: 33.6925, lng: -117.1883 }, back: { lat: 33.6924, lng: -117.1883 }, thumbnail: require('../assets/images/hole6.jpg'),  fullImage: require('../assets/images/hole6.jpg') },
      { hole: 7,  par: 4, distance: 353, note: 'Water right of green, lay up left',    tee: { lat: 33.6904, lng: -117.1896 }, front: { lat: 33.6934, lng: -117.1896 }, middle: { lat: 33.6933, lng: -117.1896 }, back: { lat: 33.6932, lng: -117.1896 }, thumbnail: require('../assets/images/hole7.jpg'),  fullImage: require('../assets/images/hole7.jpg'),  hazards: [{ type: 'water',  x: 0.75, y: 0.20, r: 0.09, avoidDir: 'left'  }] },
      { hole: 8,  par: 4, distance: 332, note: 'Tight fairway, bunker short-left',     tee: { lat: 33.6913, lng: -117.1908 }, front: { lat: 33.6941, lng: -117.1908 }, middle: { lat: 33.6940, lng: -117.1908 }, back: { lat: 33.6939, lng: -117.1908 }, thumbnail: require('../assets/images/hole8.jpg'),  fullImage: require('../assets/images/hole8.jpg'),  hazards: [{ type: 'bunker', x: 0.28, y: 0.65, r: 0.06, avoidDir: 'right' }] },
      { hole: 9,  par: 5, distance: 469, note: 'Finishing front nine, birdie chance',  tee: { lat: 33.6910, lng: -117.1921 }, front: { lat: 33.6949, lng: -117.1921 }, middle: { lat: 33.6948, lng: -117.1921 }, back: { lat: 33.6947, lng: -117.1921 }, thumbnail: require('../assets/images/hole9.jpg'),  fullImage: require('../assets/images/hole9.jpg') },
      { hole: 10, par: 4, distance: 364, note: 'Slight dogleg right, open approach',   tee: { lat: 33.6926, lng: -117.1934 }, front: { lat: 33.6957, lng: -117.1934 }, middle: { lat: 33.6956, lng: -117.1934 }, back: { lat: 33.6955, lng: -117.1934 }, thumbnail: require('../assets/images/hole10.jpg'), fullImage: require('../assets/images/hole10.jpg') },
      { hole: 11, par: 5, distance: 470, note: 'Long par 5, elevated green',           tee: { lat: 33.6924, lng: -117.1947 }, front: { lat: 33.6964, lng: -117.1947 }, middle: { lat: 33.6963, lng: -117.1947 }, back: { lat: 33.6962, lng: -117.1947 } },
      { hole: 12, par: 3, distance: 170, note: 'Short iron to well-guarded green',     tee: { lat: 33.6957, lng: -117.1960 }, front: { lat: 33.6972, lng: -117.1960 }, middle: { lat: 33.6971, lng: -117.1960 }, back: { lat: 33.6970, lng: -117.1960 } },
      { hole: 13, par: 4, distance: 380, note: 'Tight fairway, slight dogleg',         tee: { lat: 33.6948, lng: -117.1980 }, front: { lat: 33.6980, lng: -117.1972 }, middle: { lat: 33.6979, lng: -117.1972 }, back: { lat: 33.6978, lng: -117.1972 } },
      { hole: 14, par: 5, distance: 455, note: 'Reachable par 5, open landing',        tee: { lat: 33.6949, lng: -117.1985 }, front: { lat: 33.6987, lng: -117.1985 }, middle: { lat: 33.6986, lng: -117.1985 }, back: { lat: 33.6985, lng: -117.1985 } },
      { hole: 15, par: 3, distance: 152, note: 'Short par 3, well-guarded green',      tee: { lat: 33.6982, lng: -117.1998 }, front: { lat: 33.6995, lng: -117.1998 }, middle: { lat: 33.6994, lng: -117.1998 }, back: { lat: 33.6993, lng: -117.1998 } },
      { hole: 16, par: 4, distance: 375, note: 'Straight hole, bunker both sides',     tee: { lat: 33.6971, lng: -117.2011 }, front: { lat: 33.7003, lng: -117.2011 }, middle: { lat: 33.7002, lng: -117.2011 }, back: { lat: 33.7001, lng: -117.2011 } },
      { hole: 17, par: 4, distance: 330, note: 'Water left off tee, bail right',       tee: { lat: 33.6982, lng: -117.2024 }, front: { lat: 33.7010, lng: -117.2024 }, middle: { lat: 33.7009, lng: -117.2024 }, back: { lat: 33.7008, lng: -117.2024 } },
      { hole: 18, par: 4, distance: 365, note: 'Finishing hole, risk-reward approach', tee: { lat: 33.6987, lng: -117.2037 }, front: { lat: 33.7018, lng: -117.2037 }, middle: { lat: 33.7017, lng: -117.2037 }, back: { lat: 33.7016, lng: -117.2037 } },
    ],
  },

  // ── 2. Menifee Lakes – Lakes ────────────────────────────────────────────
  {
    id:        'menifee_lakes_lakes',
    name:      'Menifee Lakes – Lakes',
    location:  'Menifee, CA',
    slope:     121,
    rating:    70.4,
    thumbnail: require('../assets/images/hole4.jpg'),
    holes: [
      { hole: 1,  par: 4, distance: 395, note: 'Lake left, wide tee',                   front: { lat: 33.6900, lng: -117.1900 }, middle: { lat: 33.6899, lng: -117.1900 }, back: { lat: 33.6898, lng: -117.1900 } },
      { hole: 2,  par: 4, distance: 375, note: 'Over water hazard',                      front: { lat: 33.6908, lng: -117.1912 }, middle: { lat: 33.6907, lng: -117.1912 }, back: { lat: 33.6906, lng: -117.1912 } },
      { hole: 3,  par: 5, distance: 545, note: 'Creek crosses fairway',                  front: { lat: 33.6915, lng: -117.1925 }, middle: { lat: 33.6914, lng: -117.1925 }, back: { lat: 33.6913, lng: -117.1925 } },
      { hole: 4,  par: 3, distance: 170, note: 'Carry over water',                       front: { lat: 33.6923, lng: -117.1937 }, middle: { lat: 33.6922, lng: -117.1937 }, back: { lat: 33.6921, lng: -117.1937 } },
      { hole: 5,  par: 4, distance: 415, note: 'Dogleg right, bunker',                   front: { lat: 33.6930, lng: -117.1950 }, middle: { lat: 33.6929, lng: -117.1950 }, back: { lat: 33.6928, lng: -117.1950 } },
      { hole: 6,  par: 4, distance: 385, note: 'Water right of green',                   front: { lat: 33.6938, lng: -117.1962 }, middle: { lat: 33.6937, lng: -117.1962 }, back: { lat: 33.6936, lng: -117.1962 } },
      { hole: 7,  par: 3, distance: 185, note: 'Island green, par 3',                    front: { lat: 33.6945, lng: -117.1975 }, middle: { lat: 33.6944, lng: -117.1975 }, back: { lat: 33.6943, lng: -117.1975 } },
      { hole: 8,  par: 5, distance: 560, note: 'Two lakes in play',                      front: { lat: 33.6953, lng: -117.1988 }, middle: { lat: 33.6952, lng: -117.1988 }, back: { lat: 33.6951, lng: -117.1988 } },
      { hole: 9,  par: 4, distance: 400, note: 'Finishing nine, uphill',                 front: { lat: 33.6960, lng: -117.2000 }, middle: { lat: 33.6959, lng: -117.2000 }, back: { lat: 33.6958, lng: -117.2000 } },
      { hole: 10, par: 4, distance: 370, note: 'Lake along right side',                  front: { lat: 33.6968, lng: -117.2013 }, middle: { lat: 33.6967, lng: -117.2013 }, back: { lat: 33.6966, lng: -117.2013 } },
      { hole: 11, par: 3, distance: 155, note: 'Short iron over creek',                  front: { lat: 33.6975, lng: -117.2025 }, middle: { lat: 33.6974, lng: -117.2025 }, back: { lat: 33.6973, lng: -117.2025 } },
      { hole: 12, par: 5, distance: 525, note: 'Reachable eagle hole',                   front: { lat: 33.6983, lng: -117.2038 }, middle: { lat: 33.6982, lng: -117.2038 }, back: { lat: 33.6981, lng: -117.2038 } },
      { hole: 13, par: 4, distance: 420, note: 'Tight tee, water left',                  front: { lat: 33.6990, lng: -117.2050 }, middle: { lat: 33.6989, lng: -117.2050 }, back: { lat: 33.6988, lng: -117.2050 } },
      { hole: 14, par: 4, distance: 390, note: 'Bunkers guard green',                    front: { lat: 33.6998, lng: -117.2063 }, middle: { lat: 33.6997, lng: -117.2063 }, back: { lat: 33.6996, lng: -117.2063 } },
      { hole: 15, par: 3, distance: 165, note: 'Wind off the lake',                      front: { lat: 33.7005, lng: -117.2075 }, middle: { lat: 33.7004, lng: -117.2075 }, back: { lat: 33.7003, lng: -117.2075 } },
      { hole: 16, par: 4, distance: 405, note: 'Dogleg around lake',                     front: { lat: 33.7013, lng: -117.2088 }, middle: { lat: 33.7012, lng: -117.2088 }, back: { lat: 33.7011, lng: -117.2088 } },
      { hole: 17, par: 5, distance: 540, note: 'Eagle opportunity',                      front: { lat: 33.7020, lng: -117.2100 }, middle: { lat: 33.7019, lng: -117.2100 }, back: { lat: 33.7018, lng: -117.2100 } },
      { hole: 18, par: 4, distance: 430, note: 'Lake behind green',                      front: { lat: 33.7028, lng: -117.2113 }, middle: { lat: 33.7027, lng: -117.2113 }, back: { lat: 33.7026, lng: -117.2113 } },
    ],
  },

  // ── 3. Rancho California Golf Club ─────────────────────────────────────
  {
    id:        'rancho_california_gc',
    name:      'Rancho California Golf Club',
    location:  'Murrieta, CA',
    slope:     123,
    rating:    70.9,
    thumbnail: require('../assets/images/hole7.jpg'),
    holes: [
      { hole: 1,  par: 4, distance: 398, note: 'Wide open tee, bunker right at 240',    front: { lat: 33.5450, lng: -117.1420 }, middle: { lat: 33.5449, lng: -117.1420 }, back: { lat: 33.5448, lng: -117.1420 } },
      { hole: 2,  par: 5, distance: 535, note: 'Reachable par 5, creek left',           front: { lat: 33.5457, lng: -117.1433 }, middle: { lat: 33.5456, lng: -117.1433 }, back: { lat: 33.5455, lng: -117.1433 } },
      { hole: 3,  par: 3, distance: 162, note: 'Elevated tee, bail short-right',        front: { lat: 33.5465, lng: -117.1446 }, middle: { lat: 33.5464, lng: -117.1446 }, back: { lat: 33.5463, lng: -117.1446 } },
      { hole: 4,  par: 4, distance: 382, note: 'Dogleg right, tree on corner at 210',   front: { lat: 33.5472, lng: -117.1459 }, middle: { lat: 33.5471, lng: -117.1459 }, back: { lat: 33.5470, lng: -117.1459 } },
      { hole: 5,  par: 4, distance: 415, note: 'Long par 4, bunkers front and right',   front: { lat: 33.5480, lng: -117.1471 }, middle: { lat: 33.5479, lng: -117.1471 }, back: { lat: 33.5478, lng: -117.1471 } },
      { hole: 6,  par: 3, distance: 188, note: 'Carry over ravine, play to center',     front: { lat: 33.5487, lng: -117.1484 }, middle: { lat: 33.5486, lng: -117.1484 }, back: { lat: 33.5485, lng: -117.1484 } },
      { hole: 7,  par: 5, distance: 541, note: 'Three-shot par 5, water at 280',        front: { lat: 33.5495, lng: -117.1497 }, middle: { lat: 33.5494, lng: -117.1497 }, back: { lat: 33.5493, lng: -117.1497 } },
      { hole: 8,  par: 4, distance: 372, note: 'Short par 4, driver or 3W',             front: { lat: 33.5502, lng: -117.1510 }, middle: { lat: 33.5501, lng: -117.1510 }, back: { lat: 33.5500, lng: -117.1510 } },
      { hole: 9,  par: 4, distance: 402, note: 'Signature hole, panoramic views',       front: { lat: 33.5510, lng: -117.1522 }, middle: { lat: 33.5509, lng: -117.1522 }, back: { lat: 33.5508, lng: -117.1522 } },
      { hole: 10, par: 4, distance: 388, note: 'Back nine opener, slight uphill',       front: { lat: 33.5517, lng: -117.1535 }, middle: { lat: 33.5516, lng: -117.1535 }, back: { lat: 33.5515, lng: -117.1535 } },
      { hole: 11, par: 3, distance: 158, note: 'Short iron, well-guarded green',        front: { lat: 33.5525, lng: -117.1548 }, middle: { lat: 33.5524, lng: -117.1548 }, back: { lat: 33.5523, lng: -117.1548 } },
      { hole: 12, par: 5, distance: 528, note: 'Scoring hole, reachable in 2',          front: { lat: 33.5532, lng: -117.1561 }, middle: { lat: 33.5531, lng: -117.1561 }, back: { lat: 33.5530, lng: -117.1561 } },
      { hole: 13, par: 4, distance: 421, note: 'Hardest driving hole, canyon right',    front: { lat: 33.5540, lng: -117.1574 }, middle: { lat: 33.5539, lng: -117.1574 }, back: { lat: 33.5538, lng: -117.1574 } },
      { hole: 14, par: 4, distance: 367, note: 'Tricky downhill approach',              front: { lat: 33.5547, lng: -117.1587 }, middle: { lat: 33.5546, lng: -117.1587 }, back: { lat: 33.5545, lng: -117.1587 } },
      { hole: 15, par: 3, distance: 171, note: 'Wind exposure from the west',           front: { lat: 33.5555, lng: -117.1599 }, middle: { lat: 33.5554, lng: -117.1599 }, back: { lat: 33.5553, lng: -117.1599 } },
      { hole: 16, par: 4, distance: 393, note: 'Dogleg left, lay up to 100',            front: { lat: 33.5562, lng: -117.1612 }, middle: { lat: 33.5561, lng: -117.1612 }, back: { lat: 33.5560, lng: -117.1612 } },
      { hole: 17, par: 5, distance: 555, note: 'Risk-reward, water short of green',     front: { lat: 33.5570, lng: -117.1625 }, middle: { lat: 33.5569, lng: -117.1625 }, back: { lat: 33.5568, lng: -117.1625 } },
      { hole: 18, par: 4, distance: 408, note: 'Uphill home hole, crowds the clubhouse',front: { lat: 33.5577, lng: -117.1638 }, middle: { lat: 33.5576, lng: -117.1638 }, back: { lat: 33.5575, lng: -117.1638 } },
    ],
  },
];

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/** Flat slope/rating lookup by course name — used by history.tsx, dashboard.tsx */
export const COURSE_RATINGS: Record<string, { slope: number; rating: number }> = Object.fromEntries(
  COURSE_DB.map((c) => [c.name, { slope: c.slope, rating: c.rating }])
);
