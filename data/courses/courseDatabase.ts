/**
 * courseDatabase.ts
 *
 * Single source of truth for all local course data.
 * Structure mirrors sampleCourse.json — ready to swap in API data later.
 *
 * GPS coordinates (green.front/middle/back) can be filled in for live GPS.
 * frontYards / backYards default to ±10 from the middle distance when not set.
 */

export interface GreenCoord {
  latitude:  number | null;
  longitude: number | null;
}

export interface HoleYardages {
  front:  number;
  middle: number;
  back:   number;
}

export interface CourseHoleData {
  holeNumber: number;
  par:        number;
  yardages:   HoleYardages;
  note:       string;
  green: {
    front:  GreenCoord;
    middle: GreenCoord;
    back:   GreenCoord;
  };
}

export interface CourseData {
  id:       string;
  name:     string;
  city?:    string;
  state?:   string;
  slope:    number;
  rating:   number;
  holes:    CourseHoleData[];
}

// ─── Course Definitions ───────────────────────────────────────────────────────

const MENIFEE_PALMS: CourseData = {
  id:     'menifee-palms',
  name:   'Menifee Lakes – Palms',
  city:   'Menifee',
  state:  'CA',
  slope:  118,
  rating: 69.8,
  holes: [
    { holeNumber: 1,  par: 4, yardages: { front: 341, middle: 356, back: 371 }, note: 'Wide landing area, open tee shot',    green: { front: { latitude: 33.6892, longitude: -117.1820 }, middle: { latitude: 33.6891, longitude: -117.1820 }, back: { latitude: 33.6890, longitude: -117.1820 } } },
    { holeNumber: 2,  par: 4, yardages: { front: 340, middle: 355, back: 370 }, note: 'Water short-left, aim center',         green: { front: { latitude: 33.6896, longitude: -117.1832 }, middle: { latitude: 33.6895, longitude: -117.1832 }, back: { latitude: 33.6894, longitude: -117.1832 } } },
    { holeNumber: 3,  par: 4, yardages: { front: 341, middle: 356, back: 371 }, note: 'Dogleg right, trees on corner',        green: { front: { latitude: 33.6903, longitude: -117.1845 }, middle: { latitude: 33.6902, longitude: -117.1845 }, back: { latitude: 33.6901, longitude: -117.1845 } } },
    { holeNumber: 4,  par: 5, yardages: { front: 474, middle: 489, back: 504 }, note: 'Reachable par 5, bunkers right',       green: { front: { latitude: 33.6911, longitude: -117.1858 }, middle: { latitude: 33.6910, longitude: -117.1858 }, back: { latitude: 33.6909, longitude: -117.1858 } } },
    { holeNumber: 5,  par: 4, yardages: { front: 356, middle: 371, back: 386 }, note: 'Long par 4, slight dogleg left',       green: { front: { latitude: 33.6919, longitude: -117.1870 }, middle: { latitude: 33.6918, longitude: -117.1870 }, back: { latitude: 33.6917, longitude: -117.1870 } } },
    { holeNumber: 6,  par: 3, yardages: { front: 155, middle: 170, back: 185 }, note: 'Bunker guards green, aim center',      green: { front: { latitude: 33.6926, longitude: -117.1883 }, middle: { latitude: 33.6925, longitude: -117.1883 }, back: { latitude: 33.6924, longitude: -117.1883 } } },
    { holeNumber: 7,  par: 4, yardages: { front: 360, middle: 375, back: 390 }, note: 'Water right of green, lay up left',    green: { front: { latitude: 33.6934, longitude: -117.1896 }, middle: { latitude: 33.6933, longitude: -117.1896 }, back: { latitude: 33.6932, longitude: -117.1896 } } },
    { holeNumber: 8,  par: 4, yardages: { front: 360, middle: 375, back: 390 }, note: 'Tight fairway, bunker short-left',     green: { front: { latitude: 33.6941, longitude: -117.1908 }, middle: { latitude: 33.6940, longitude: -117.1908 }, back: { latitude: 33.6939, longitude: -117.1908 } } },
    { holeNumber: 9,  par: 5, yardages: { front: 476, middle: 491, back: 506 }, note: 'Finishing front nine, birdie chance',  green: { front: { latitude: 33.6949, longitude: -117.1921 }, middle: { latitude: 33.6948, longitude: -117.1921 }, back: { latitude: 33.6947, longitude: -117.1921 } } },
    { holeNumber: 10, par: 4, yardages: { front: 375, middle: 390, back: 405 }, note: 'Slight dogleg right, open approach',   green: { front: { latitude: 33.6957, longitude: -117.1934 }, middle: { latitude: 33.6956, longitude: -117.1934 }, back: { latitude: 33.6955, longitude: -117.1934 } } },
    { holeNumber: 11, par: 4, yardages: { front: 395, middle: 410, back: 425 }, note: 'Long par 4, elevated green',           green: { front: { latitude: 33.6964, longitude: -117.1947 }, middle: { latitude: 33.6963, longitude: -117.1947 }, back: { latitude: 33.6962, longitude: -117.1947 } } },
    { holeNumber: 12, par: 3, yardages: { front: 140, middle: 155, back: 170 }, note: 'Short iron to elevated green',         green: { front: { latitude: 33.6972, longitude: -117.1960 }, middle: { latitude: 33.6971, longitude: -117.1960 }, back: { latitude: 33.6970, longitude: -117.1960 } } },
    { holeNumber: 13, par: 5, yardages: { front: 465, middle: 480, back: 495 }, note: 'Long par 5, bunkers both sides',       green: { front: { latitude: 33.6980, longitude: -117.1972 }, middle: { latitude: 33.6979, longitude: -117.1972 }, back: { latitude: 33.6978, longitude: -117.1972 } } },
    { holeNumber: 14, par: 4, yardages: { front: 350, middle: 365, back: 380 }, note: 'Straight hole, tight landing zone',    green: { front: { latitude: 33.6987, longitude: -117.1985 }, middle: { latitude: 33.6986, longitude: -117.1985 }, back: { latitude: 33.6985, longitude: -117.1985 } } },
    { holeNumber: 15, par: 4, yardages: { front: 365, middle: 380, back: 395 }, note: 'Subtle dogleg left, water short',      green: { front: { latitude: 33.6995, longitude: -117.1998 }, middle: { latitude: 33.6994, longitude: -117.1998 }, back: { latitude: 33.6993, longitude: -117.1998 } } },
    { holeNumber: 16, par: 3, yardages: { front: 145, middle: 160, back: 175 }, note: 'Island green, all carry required',     green: { front: { latitude: 33.7003, longitude: -117.2011 }, middle: { latitude: 33.7002, longitude: -117.2011 }, back: { latitude: 33.7001, longitude: -117.2011 } } },
    { holeNumber: 17, par: 4, yardages: { front: 360, middle: 375, back: 390 }, note: 'Water left off tee, bail right',       green: { front: { latitude: 33.7010, longitude: -117.2024 }, middle: { latitude: 33.7009, longitude: -117.2024 }, back: { latitude: 33.7008, longitude: -117.2024 } } },
    { holeNumber: 18, par: 5, yardages: { front: 486, middle: 501, back: 516 }, note: 'Finishing hole, risk-reward approach', green: { front: { latitude: 33.7018, longitude: -117.2037 }, middle: { latitude: 33.7017, longitude: -117.2037 }, back: { latitude: 33.7016, longitude: -117.2037 } } },
  ],
};

const MENIFEE_LAKES: CourseData = {
  id:     'menifee-lakes',
  name:   'Menifee Lakes – Lakes',
  city:   'Menifee',
  state:  'CA',
  slope:  121,
  rating: 70.4,
  holes: [
    { holeNumber: 1,  par: 4, yardages: { front: 380, middle: 395, back: 410 }, note: 'Lake left, wide tee',          green: { front: { latitude: 33.6900, longitude: -117.1900 }, middle: { latitude: 33.6899, longitude: -117.1900 }, back: { latitude: 33.6898, longitude: -117.1900 } } },
    { holeNumber: 2,  par: 4, yardages: { front: 360, middle: 375, back: 390 }, note: 'Over water hazard',             green: { front: { latitude: 33.6908, longitude: -117.1912 }, middle: { latitude: 33.6907, longitude: -117.1912 }, back: { latitude: 33.6906, longitude: -117.1912 } } },
    { holeNumber: 3,  par: 5, yardages: { front: 530, middle: 545, back: 560 }, note: 'Creek crosses fairway',         green: { front: { latitude: 33.6915, longitude: -117.1925 }, middle: { latitude: 33.6914, longitude: -117.1925 }, back: { latitude: 33.6913, longitude: -117.1925 } } },
    { holeNumber: 4,  par: 3, yardages: { front: 155, middle: 170, back: 185 }, note: 'Carry over water',              green: { front: { latitude: 33.6923, longitude: -117.1937 }, middle: { latitude: 33.6922, longitude: -117.1937 }, back: { latitude: 33.6921, longitude: -117.1937 } } },
    { holeNumber: 5,  par: 4, yardages: { front: 400, middle: 415, back: 430 }, note: 'Dogleg right, bunker',          green: { front: { latitude: 33.6930, longitude: -117.1950 }, middle: { latitude: 33.6929, longitude: -117.1950 }, back: { latitude: 33.6928, longitude: -117.1950 } } },
    { holeNumber: 6,  par: 4, yardages: { front: 370, middle: 385, back: 400 }, note: 'Water right of green',          green: { front: { latitude: 33.6938, longitude: -117.1962 }, middle: { latitude: 33.6937, longitude: -117.1962 }, back: { latitude: 33.6936, longitude: -117.1962 } } },
    { holeNumber: 7,  par: 3, yardages: { front: 170, middle: 185, back: 200 }, note: 'Island green, par 3',           green: { front: { latitude: 33.6945, longitude: -117.1975 }, middle: { latitude: 33.6944, longitude: -117.1975 }, back: { latitude: 33.6943, longitude: -117.1975 } } },
    { holeNumber: 8,  par: 5, yardages: { front: 545, middle: 560, back: 575 }, note: 'Two lakes in play',             green: { front: { latitude: 33.6953, longitude: -117.1988 }, middle: { latitude: 33.6952, longitude: -117.1988 }, back: { latitude: 33.6951, longitude: -117.1988 } } },
    { holeNumber: 9,  par: 4, yardages: { front: 385, middle: 400, back: 415 }, note: 'Finishing nine, uphill',        green: { front: { latitude: 33.6960, longitude: -117.2000 }, middle: { latitude: 33.6959, longitude: -117.2000 }, back: { latitude: 33.6958, longitude: -117.2000 } } },
    { holeNumber: 10, par: 4, yardages: { front: 355, middle: 370, back: 385 }, note: 'Lake along right side',         green: { front: { latitude: 33.6968, longitude: -117.2013 }, middle: { latitude: 33.6967, longitude: -117.2013 }, back: { latitude: 33.6966, longitude: -117.2013 } } },
    { holeNumber: 11, par: 3, yardages: { front: 140, middle: 155, back: 170 }, note: 'Short iron over creek',         green: { front: { latitude: 33.6975, longitude: -117.2025 }, middle: { latitude: 33.6974, longitude: -117.2025 }, back: { latitude: 33.6973, longitude: -117.2025 } } },
    { holeNumber: 12, par: 5, yardages: { front: 510, middle: 525, back: 540 }, note: 'Reachable eagle hole',          green: { front: { latitude: 33.6983, longitude: -117.2038 }, middle: { latitude: 33.6982, longitude: -117.2038 }, back: { latitude: 33.6981, longitude: -117.2038 } } },
    { holeNumber: 13, par: 4, yardages: { front: 405, middle: 420, back: 435 }, note: 'Tight tee, water left',         green: { front: { latitude: 33.6990, longitude: -117.2050 }, middle: { latitude: 33.6989, longitude: -117.2050 }, back: { latitude: 33.6988, longitude: -117.2050 } } },
    { holeNumber: 14, par: 4, yardages: { front: 375, middle: 390, back: 405 }, note: 'Bunkers guard green',           green: { front: { latitude: 33.6998, longitude: -117.2063 }, middle: { latitude: 33.6997, longitude: -117.2063 }, back: { latitude: 33.6996, longitude: -117.2063 } } },
    { holeNumber: 15, par: 3, yardages: { front: 150, middle: 165, back: 180 }, note: 'Wind off the lake',             green: { front: { latitude: 33.7005, longitude: -117.2075 }, middle: { latitude: 33.7004, longitude: -117.2075 }, back: { latitude: 33.7003, longitude: -117.2075 } } },
    { holeNumber: 16, par: 4, yardages: { front: 390, middle: 405, back: 420 }, note: 'Dogleg around lake',            green: { front: { latitude: 33.7013, longitude: -117.2088 }, middle: { latitude: 33.7012, longitude: -117.2088 }, back: { latitude: 33.7011, longitude: -117.2088 } } },
    { holeNumber: 17, par: 5, yardages: { front: 525, middle: 540, back: 555 }, note: 'Eagle opportunity',             green: { front: { latitude: 33.7020, longitude: -117.2100 }, middle: { latitude: 33.7019, longitude: -117.2100 }, back: { latitude: 33.7018, longitude: -117.2100 } } },
    { holeNumber: 18, par: 4, yardages: { front: 415, middle: 430, back: 445 }, note: 'Lake behind green',             green: { front: { latitude: 33.7028, longitude: -117.2113 }, middle: { latitude: 33.7027, longitude: -117.2113 }, back: { latitude: 33.7026, longitude: -117.2113 } } },
  ],
};

const TEMECULA_CREEK: CourseData = {
  id:     'temecula-creek',
  name:   'Temecula Creek',
  city:   'Temecula',
  state:  'CA',
  slope:  125,
  rating: 71.2,
  holes: [
    { holeNumber: 1,  par: 4, yardages: { front: 385, middle: 400, back: 415 }, note: 'Open tee shot',           green: { front: { latitude: 33.5010, longitude: -117.0800 }, middle: { latitude: 33.5009, longitude: -117.0800 }, back: { latitude: 33.5008, longitude: -117.0800 } } },
    { holeNumber: 2,  par: 5, yardages: { front: 515, middle: 530, back: 545 }, note: 'Creek right',             green: { front: { latitude: 33.5017, longitude: -117.0813 }, middle: { latitude: 33.5016, longitude: -117.0813 }, back: { latitude: 33.5015, longitude: -117.0813 } } },
    { holeNumber: 3,  par: 3, yardages: { front: 150, middle: 165, back: 180 }, note: 'Elevated tee',            green: { front: { latitude: 33.5025, longitude: -117.0826 }, middle: { latitude: 33.5024, longitude: -117.0826 }, back: { latitude: 33.5023, longitude: -117.0826 } } },
    { holeNumber: 4,  par: 4, yardages: { front: 370, middle: 385, back: 400 }, note: 'Dogleg right',            green: { front: { latitude: 33.5032, longitude: -117.0838 }, middle: { latitude: 33.5031, longitude: -117.0838 }, back: { latitude: 33.5030, longitude: -117.0838 } } },
    { holeNumber: 5,  par: 4, yardages: { front: 400, middle: 415, back: 430 }, note: 'Bunker at 220',           green: { front: { latitude: 33.5040, longitude: -117.0851 }, middle: { latitude: 33.5039, longitude: -117.0851 }, back: { latitude: 33.5038, longitude: -117.0851 } } },
    { holeNumber: 6,  par: 3, yardages: { front: 175, middle: 190, back: 205 }, note: 'Wind factor',             green: { front: { latitude: 33.5047, longitude: -117.0864 }, middle: { latitude: 33.5046, longitude: -117.0864 }, back: { latitude: 33.5045, longitude: -117.0864 } } },
    { holeNumber: 7,  par: 5, yardages: { front: 530, middle: 545, back: 560 }, note: 'Birdie opportunity',      green: { front: { latitude: 33.5055, longitude: -117.0876 }, middle: { latitude: 33.5054, longitude: -117.0876 }, back: { latitude: 33.5053, longitude: -117.0876 } } },
    { holeNumber: 8,  par: 4, yardages: { front: 360, middle: 375, back: 390 }, note: 'Tight tee shot',          green: { front: { latitude: 33.5062, longitude: -117.0889 }, middle: { latitude: 33.5061, longitude: -117.0889 }, back: { latitude: 33.5060, longitude: -117.0889 } } },
    { holeNumber: 9,  par: 4, yardages: { front: 380, middle: 395, back: 410 }, note: 'Long par 4',              green: { front: { latitude: 33.5070, longitude: -117.0902 }, middle: { latitude: 33.5069, longitude: -117.0902 }, back: { latitude: 33.5068, longitude: -117.0902 } } },
    { holeNumber: 10, par: 4, yardages: { front: 395, middle: 410, back: 425 }, note: 'Slight uphill',           green: { front: { latitude: 33.5077, longitude: -117.0915 }, middle: { latitude: 33.5076, longitude: -117.0915 }, back: { latitude: 33.5075, longitude: -117.0915 } } },
    { holeNumber: 11, par: 3, yardages: { front: 140, middle: 155, back: 170 }, note: 'Club up into the wind',   green: { front: { latitude: 33.5085, longitude: -117.0927 }, middle: { latitude: 33.5084, longitude: -117.0927 }, back: { latitude: 33.5083, longitude: -117.0927 } } },
    { holeNumber: 12, par: 5, yardages: { front: 505, middle: 520, back: 535 }, note: 'Reachable in 2',          green: { front: { latitude: 33.5092, longitude: -117.0940 }, middle: { latitude: 33.5091, longitude: -117.0940 }, back: { latitude: 33.5090, longitude: -117.0940 } } },
    { holeNumber: 13, par: 4, yardages: { front: 350, middle: 365, back: 380 }, note: 'Water left',              green: { front: { latitude: 33.5100, longitude: -117.0953 }, middle: { latitude: 33.5099, longitude: -117.0953 }, back: { latitude: 33.5098, longitude: -117.0953 } } },
    { holeNumber: 14, par: 4, yardages: { front: 415, middle: 430, back: 445 }, note: 'Hardest hole',            green: { front: { latitude: 33.5107, longitude: -117.0965 }, middle: { latitude: 33.5106, longitude: -117.0965 }, back: { latitude: 33.5105, longitude: -117.0965 } } },
    { holeNumber: 15, par: 3, yardages: { front: 155, middle: 170, back: 185 }, note: 'Over the creek',          green: { front: { latitude: 33.5115, longitude: -117.0978 }, middle: { latitude: 33.5114, longitude: -117.0978 }, back: { latitude: 33.5113, longitude: -117.0978 } } },
    { holeNumber: 16, par: 4, yardages: { front: 375, middle: 390, back: 405 }, note: 'Fairway bunkers',         green: { front: { latitude: 33.5122, longitude: -117.0991 }, middle: { latitude: 33.5121, longitude: -117.0991 }, back: { latitude: 33.5120, longitude: -117.0991 } } },
    { holeNumber: 17, par: 5, yardages: { front: 545, middle: 560, back: 575 }, note: 'Big par 5 finish',        green: { front: { latitude: 33.5130, longitude: -117.1004 }, middle: { latitude: 33.5129, longitude: -117.1004 }, back: { latitude: 33.5128, longitude: -117.1004 } } },
    { holeNumber: 18, par: 4, yardages: { front: 390, middle: 405, back: 420 }, note: 'Home hole',               green: { front: { latitude: 33.5137, longitude: -117.1016 }, middle: { latitude: 33.5136, longitude: -117.1016 }, back: { latitude: 33.5135, longitude: -117.1016 } } },
  ],
};

const MORENO_VALLEY_RANCH: CourseData = {
  id:     'moreno-valley-ranch',
  name:   'Moreno Valley Ranch',
  city:   'Moreno Valley',
  state:  'CA',
  slope:  122,
  rating: 70.5,
  holes: [
    { holeNumber: 1,  par: 5, yardages: { front: 505, middle: 520, back: 535 }, note: 'Wide open par 5',           green: { front: { latitude: 33.9250, longitude: -117.2200 }, middle: { latitude: 33.9249, longitude: -117.2200 }, back: { latitude: 33.9248, longitude: -117.2200 } } },
    { holeNumber: 2,  par: 4, yardages: { front: 375, middle: 390, back: 405 }, note: 'Fairway slopes right',      green: { front: { latitude: 33.9257, longitude: -117.2213 }, middle: { latitude: 33.9256, longitude: -117.2213 }, back: { latitude: 33.9255, longitude: -117.2213 } } },
    { holeNumber: 3,  par: 3, yardages: { front: 140, middle: 155, back: 170 }, note: 'Small green',               green: { front: { latitude: 33.9265, longitude: -117.2226 }, middle: { latitude: 33.9264, longitude: -117.2226 }, back: { latitude: 33.9263, longitude: -117.2226 } } },
    { holeNumber: 4,  par: 4, yardages: { front: 390, middle: 405, back: 420 }, note: 'Uphill approach',           green: { front: { latitude: 33.9272, longitude: -117.2238 }, middle: { latitude: 33.9271, longitude: -117.2238 }, back: { latitude: 33.9270, longitude: -117.2238 } } },
    { holeNumber: 5,  par: 4, yardages: { front: 360, middle: 375, back: 390 }, note: 'Dogleg left',               green: { front: { latitude: 33.9280, longitude: -117.2251 }, middle: { latitude: 33.9279, longitude: -117.2251 }, back: { latitude: 33.9278, longitude: -117.2251 } } },
    { holeNumber: 6,  par: 3, yardages: { front: 170, middle: 185, back: 200 }, note: 'Over water',                green: { front: { latitude: 33.9287, longitude: -117.2264 }, middle: { latitude: 33.9286, longitude: -117.2264 }, back: { latitude: 33.9285, longitude: -117.2264 } } },
    { holeNumber: 7,  par: 5, yardages: { front: 520, middle: 535, back: 550 }, note: 'Reachable eagle chance',    green: { front: { latitude: 33.9295, longitude: -117.2277 }, middle: { latitude: 33.9294, longitude: -117.2277 }, back: { latitude: 33.9293, longitude: -117.2277 } } },
    { holeNumber: 8,  par: 4, yardages: { front: 345, middle: 360, back: 375 }, note: 'Short par 4',               green: { front: { latitude: 33.9302, longitude: -117.2289 }, middle: { latitude: 33.9301, longitude: -117.2289 }, back: { latitude: 33.9300, longitude: -117.2289 } } },
    { holeNumber: 9,  par: 4, yardages: { front: 400, middle: 415, back: 430 }, note: 'Long uphill',               green: { front: { latitude: 33.9310, longitude: -117.2302 }, middle: { latitude: 33.9309, longitude: -117.2302 }, back: { latitude: 33.9308, longitude: -117.2302 } } },
    { holeNumber: 10, par: 4, yardages: { front: 365, middle: 380, back: 395 }, note: 'Bunker fronts green',       green: { front: { latitude: 33.9317, longitude: -117.2315 }, middle: { latitude: 33.9316, longitude: -117.2315 }, back: { latitude: 33.9315, longitude: -117.2315 } } },
    { holeNumber: 11, par: 3, yardages: { front: 145, middle: 160, back: 175 }, note: 'Wind exposed',              green: { front: { latitude: 33.9325, longitude: -117.2328 }, middle: { latitude: 33.9324, longitude: -117.2328 }, back: { latitude: 33.9323, longitude: -117.2328 } } },
    { holeNumber: 12, par: 5, yardages: { front: 510, middle: 525, back: 540 }, note: 'Two-shot par 5',            green: { front: { latitude: 33.9332, longitude: -117.2340 }, middle: { latitude: 33.9331, longitude: -117.2340 }, back: { latitude: 33.9330, longitude: -117.2340 } } },
    { holeNumber: 13, par: 4, yardages: { front: 380, middle: 395, back: 410 }, note: 'Tough driving hole',        green: { front: { latitude: 33.9340, longitude: -117.2353 }, middle: { latitude: 33.9339, longitude: -117.2353 }, back: { latitude: 33.9338, longitude: -117.2353 } } },
    { holeNumber: 14, par: 4, yardages: { front: 355, middle: 370, back: 385 }, note: 'Approach over bunker',      green: { front: { latitude: 33.9347, longitude: -117.2366 }, middle: { latitude: 33.9346, longitude: -117.2366 }, back: { latitude: 33.9345, longitude: -117.2366 } } },
    { holeNumber: 15, par: 3, yardages: { front: 125, middle: 140, back: 155 }, note: 'Short iron',                green: { front: { latitude: 33.9355, longitude: -117.2379 }, middle: { latitude: 33.9354, longitude: -117.2379 }, back: { latitude: 33.9353, longitude: -117.2379 } } },
    { holeNumber: 16, par: 5, yardages: { front: 500, middle: 515, back: 530 }, note: 'Scoring opportunity',       green: { front: { latitude: 33.9362, longitude: -117.2391 }, middle: { latitude: 33.9361, longitude: -117.2391 }, back: { latitude: 33.9360, longitude: -117.2391 } } },
    { holeNumber: 17, par: 4, yardages: { front: 385, middle: 400, back: 415 }, note: 'Signature hole',            green: { front: { latitude: 33.9370, longitude: -117.2404 }, middle: { latitude: 33.9369, longitude: -117.2404 }, back: { latitude: 33.9368, longitude: -117.2404 } } },
    { holeNumber: 18, par: 4, yardages: { front: 410, middle: 425, back: 440 }, note: 'Uphill home hole',          green: { front: { latitude: 33.9377, longitude: -117.2417 }, middle: { latitude: 33.9376, longitude: -117.2417 }, back: { latitude: 33.9375, longitude: -117.2417 } } },
  ],
};

/** All available courses — add new courses here. */
export const COURSE_DATABASE: CourseData[] = [
  MENIFEE_PALMS,
  MENIFEE_LAKES,
  TEMECULA_CREEK,
  MORENO_VALLEY_RANCH,
];

export default COURSE_DATABASE;
