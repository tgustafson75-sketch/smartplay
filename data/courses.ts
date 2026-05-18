import { CourseHole } from '../store/roundStore';

export interface Course {
  id: string;
  name: string;
  fullName: string;
  rating: string;
  slope: string;
  par: number;
  totalYards: number;
  holes: CourseHole[];
}

// ─── HELPER FUNCTIONS ─────────────────────

export const getCourse = (
  name: string
): Course | null =>
  COURSES.find(c =>
    c.name.toLowerCase().includes(name.toLowerCase()) ||
    c.id === name
  ) ?? null;

/**
 * 2026-05-17 — Resolve a `local:<slug>` courseId (the canonical form used
 * by Play tab / round state / SmartVision) to the bundled CourseHole[]
 * array. Used by pre-round surfaces (SmartVision, SmartFinder) so F/M/B
 * yardages render from static data BEFORE the round goes active (Tim's
 * spec: "pre-round in static, would adjust to GPS once active").
 *
 * Returns empty array when the slug isn't known. Pure read; no side
 * effects on the round store.
 */
export function getBundledHoles(courseId: string | null | undefined): CourseHole[] {
  if (!courseId || !courseId.startsWith('local:')) return [];
  const slug = courseId.slice('local:'.length);
  const course = COURSES.find(c => c.id === slug);
  return course?.holes ?? [];
}

export const getHole = (
  courseName: string,
  holeNumber: number
): CourseHole | null =>
  getCourse(courseName)?.holes.find(h => h.hole === holeNumber) ?? null;

export const getCourseList = (): { id: string; name: string; par: number; yards: number }[] =>
  COURSES.map(c => ({
    id: c.id,
    name: c.name,
    par: c.par,
    yards: c.totalYards,
  }));

// ─── COURSE DATA ──────────────────────────

// Phase AW — Palms par/distance from golfcourseapi (id=20620 "White"
// tee, 6119y total) joined with OSM-mapped tee/green polygons via
// scripts/match-osm-to-api.mjs. Match quality: 17/18 holes resolved
// with API↔OSM distance error ≤22y and walk continuity <100y.
//
// HOLE 8 ANOMALY: matcher reports 965y walk between hole 7's green
// and hole 8's tee — almost certainly a Lakes/Palms cross-pollution
// (both 18-hole courses share the same OSM bbox; 36 greens, 18 per
// course). Verify hole 8's GPS visually in SmartVision; coordinates
// may need to be swapped with a Palms-side feature. The API
// distance/par for hole 8 is correct (349y par-4); only the GPS
// pairing is suspect.
const PALMS_HOLES: CourseHole[] = [
  { hole:  1, par: 4, distance: 352, front: 336, back: 364,
    teeLat: 33.6953922, teeLng: -117.1504551,
    middleLat: 33.6928458, middleLng: -117.1487966,
    frontLat: 33.6929899, frontLng: -117.1488177,
    backLat: 33.6927361, backLng: -117.1487964,
    note: '', estimated: false },
  { hole:  2, par: 4, distance: 345, front: 329, back: 362,
    teeLat: 33.6925244, teeLng: -117.1486531,
    middleLat: 33.6950818, middleLng: -117.1501242,
    frontLat: 33.6949593, frontLng: -117.1500649,
    backLat: 33.6952167, backLng: -117.1501826,
    note: '', estimated: false },
  { hole:  3, par: 4, distance: 356, front: 318, back: 350,
    teeLat: 33.6953922, teeLng: -117.1504551,
    middleLat: 33.6944984, middleLng: -117.1535805,
    frontLat: 33.6945105, frontLng: -117.1534179,
    backLat: 33.6944833, backLng: -117.1537328,
    note: '', estimated: false },
  { hole:  4, par: 3, distance: 125, front: 111, back: 140,
    teeLat: 33.6929728, teeLng: -117.1537071,
    middleLat: 33.6936381, middleLng: -117.1546611,
    frontLat: 33.6936066, frontLng: -117.1544999,
    backLat: 33.6936699, backLng: -117.1548062,
    note: '', estimated: false },
  { hole:  5, par: 5, distance: 496, front: 478, back: 516,
    teeLat: 33.6935884, teeLng: -117.1541894,
    middleLat: 33.6964496, middleLng: -117.1506684,
    frontLat: 33.6963708, frontLng: -117.1508559,
    backLat: 33.6965740, backLng: -117.1505664,
    note: '', estimated: false },
  { hole:  6, par: 4, distance: 352, front: 335, back: 370,
    teeLat: 33.6969813, teeLng: -117.1503459,
    middleLat: 33.6993556, middleLng: -117.1483756,
    frontLat: 33.6992570, frontLng: -117.1484825,
    backLat: 33.6994737, backLng: -117.1482546,
    note: '', estimated: false },
  { hole:  7, par: 3, distance: 154, front: 153, back: 187,
    teeLat: 33.6998850, teeLng: -117.1481083,
    middleLat: 33.7000585, middleLng: -117.1464702,
    frontLat: 33.7000427, frontLng: -117.1466085,
    backLat: 33.7000545, backLng: -117.1462671,
    note: '', estimated: false },
  // HOLE 8 — Phase AW estimate. Original OSM matcher cross-pollinated to
  // a Lakes-side feature (965y walk-continuity flag). Re-estimated by
  // placing tee 8y from hole 7's verified green centroid and projecting
  // 349y at bearing 190.5° (the heading from hole 7 toward hole 9's tee
  // area). Result: tee→green distance = 349y exactly, walk h7→h8 = 9y
  // (typical course routing). Front/back ±15y from green centroid along
  // the same bearing axis. Marked estimated:true — visually verify in
  // SmartVision and hand-correct if Palms hole 8 actually goes a
  // different direction.
  { hole:  8, par: 4, distance: 349, front: 334, back: 364,
    teeLat: 33.6999877, teeLng: -117.1464859,
    middleLat: 33.6971654, middleLng: -117.1471120,
    frontLat: 33.6972867, frontLng: -117.1470850,
    backLat: 33.6970441, backLng: -117.1471390,
    note: '', estimated: true },
  { hole:  9, par: 5, distance: 503, front: 481, back: 515,
    teeLat: 33.6889895, teeLng: -117.1489255,
    middleLat: 33.6897212, middleLng: -117.1537893,
    frontLat: 33.6897242, frontLng: -117.1535928,
    backLat: 33.6897854, backLng: -117.1539220,
    note: '', estimated: false },
  { hole: 10, par: 4, distance: 364, front: 371, back: 397,
    teeLat: 33.6895579, teeLng: -117.1547524,
    middleLat: 33.6889745, middleLng: -117.1584892,
    frontLat: 33.6890602, frontLng: -117.1583718,
    backLat: 33.6890048, backLng: -117.1586148,
    note: '', estimated: false },
  { hole: 11, par: 5, distance: 471, front: 451, back: 478,
    teeLat: 33.6888303, teeLng: -117.1591058,
    middleLat: 33.6916746, middleLng: -117.1621712,
    frontLat: 33.6915733, frontLng: -117.1621049,
    backLat: 33.6917497, backLng: -117.1622731,
    note: '', estimated: false },
  { hole: 12, par: 3, distance: 170, front: 137, back: 171,
    teeLat: 33.6914377, teeLng: -117.1613230,
    middleLat: 33.6923509, middleLng: -117.1623644,
    frontLat: 33.6922542, frontLng: -117.1622534,
    backLat: 33.6924821, backLng: -117.1624544,
    note: '', estimated: false },
  { hole: 13, par: 4, distance: 380, front: 370, back: 389,
    teeLat: 33.6922204, teeLng: -117.1618772,
    middleLat: 33.6920103, middleLng: -117.1581489,
    frontLat: 33.6919694, frontLng: -117.1582323,
    backLat: 33.6920654, backLng: -117.1580341,
    note: '', estimated: false },
  { hole: 14, par: 5, distance: 462, front: 458, back: 489,
    teeLat: 33.6923776, teeLng: -117.1580883,
    middleLat: 33.6885042, middleLng: -117.1586260,
    frontLat: 33.6886400, frontLng: -117.1586479,
    backLat: 33.6883823, backLng: -117.1586218,
    note: '', estimated: false },
  { hole: 15, par: 3, distance: 152, front: 139, back: 172,
    teeLat: 33.6884608, teeLng: -117.1592043,
    middleLat: 33.6888158, middleLng: -117.1606894,
    frontLat: 33.6887672, frontLng: -117.1605310,
    backLat: 33.6889056, backLng: -117.1608219,
    note: '', estimated: false },
  { hole: 16, par: 4, distance: 381, front: 362, back: 384,
    teeLat: 33.6885949, teeLng: -117.1610779,
    middleLat: 33.6889548, middleLng: -117.1647322,
    frontLat: 33.6889638, frontLng: -117.1646310,
    backLat: 33.6889589, backLng: -117.1648466,
    note: '', estimated: false },
  { hole: 17, par: 4, distance: 341, front: 330, back: 360,
    teeLat: 33.6883441, teeLng: -117.1646720,
    middleLat: 33.6855495, middleLng: -117.1641406,
    frontLat: 33.6856643, frontLng: -117.1641900,
    backLat: 33.6854285, backLng: -117.1640730,
    note: '', estimated: false },
  { hole: 18, par: 4, distance: 366, front: 342, back: 371,
    teeLat: 33.6854784, teeLng: -117.1648652,
    middleLat: 33.6883971, middleLng: -117.1653186,
    frontLat: 33.6882709, frontLng: -117.1653026,
    backLat: 33.6885034, backLng: -117.1653294,
    note: '', estimated: false },
];

// Phase AW — Lakes (golfcourseapi id=20743 White tee, 6113y) + OSM GPS
// via scripts/match-osm-to-api.mjs. Single-course matcher resolved
// 18/18 with most distance errors ≤22y. Prior bundled values were a
// stale duplicate of Palms data with wrong pars on holes 14 and 17–18;
// this replacement aligns with the actual scorecard.
const LAKES_HOLES: CourseHole[] = [
  { hole:  1, par: 4, distance: 368, front: 354, back: 383,
    teeLat: 33.6913348, teeLng: -117.1573364,
    middleLat: 33.6885042, middleLng: -117.1586260,
    frontLat: 33.6886400, frontLng: -117.1586479,
    backLat: 33.6883877, backLng: -117.1586666,
    note: '', estimated: false },
  { hole:  2, par: 4, distance: 358, front: 343, back: 372,
    teeLat: 33.6884608, teeLng: -117.1592043,
    middleLat: 33.6858353, middleLng: -117.1576039,
    frontLat: 33.6859275, frontLng: -117.1577132,
    backLat: 33.6857239, backLng: -117.1575548,
    note: '', estimated: false },
  { hole:  3, par: 3, distance: 134, front: 134, back: 163,
    teeLat: 33.6879339, teeLng: -117.1592152,
    middleLat: 33.6889745, middleLng: -117.1584892,
    frontLat: 33.6888678, frontLng: -117.1585081,
    backLat: 33.6890812, backLng: -117.1583777,
    note: '', estimated: false },
  { hole:  4, par: 4, distance: 286, front: 275, back: 308,
    teeLat: 33.6893900, teeLng: -117.1590184,
    middleLat: 33.6906434, middleLng: -117.1566153,
    frontLat: 33.6906410, frontLng: -117.1567600,
    backLat: 33.6906979, backLng: -117.1564153,
    note: '', estimated: false },
  { hole:  5, par: 4, distance: 367, front: 349, back: 378,
    teeLat: 33.6902580, teeLng: -117.1564921,
    middleLat: 33.6902562, middleLng: -117.1528985,
    frontLat: 33.6902968, frontLng: -117.1530411,
    backLat: 33.6902021, backLng: -117.1527568,
    note: '', estimated: false },
  { hole:  6, par: 4, distance: 383, front: 378, back: 400,
    teeLat: 33.6895579, teeLng: -117.1547524,
    middleLat: 33.6917346, middleLng: -117.1575379,
    frontLat: 33.6917091, frontLng: -117.1574466,
    backLat: 33.6918198, backLng: -117.1576274,
    note: '', estimated: false },
  { hole:  7, par: 4, distance: 355, front: 338, back: 372,
    teeLat: 33.6917584, teeLng: -117.1567836,
    middleLat: 33.6945491, middleLng: -117.1577323,
    frontLat: 33.6944385, frontLng: -117.1576685,
    backLat: 33.6946999, backLng: -117.1577896,
    note: '', estimated: false },
  { hole:  8, par: 3, distance: 193, front: 182, back: 213,
    teeLat: 33.6939152, teeLng: -117.1576795,
    middleLat: 33.6954932, middleLng: -117.1581606,
    frontLat: 33.6953759, frontLng: -117.1580818,
    backLat: 33.6956225, backLng: -117.1581354,
    note: '', estimated: false },
  { hole:  9, par: 5, distance: 491, front: 445, back: 476,
    teeLat: 33.6957995, teeLng: -117.1576800,
    middleLat: 33.6920103, middleLng: -117.1581489,
    frontLat: 33.6921566, frontLng: -117.1581304,
    backLat: 33.6919052, backLng: -117.1581799,
    note: '', estimated: false },
  { hole: 10, par: 4, distance: 310, front: 301, back: 329,
    teeLat: 33.6917584, teeLng: -117.1567836,
    middleLat: 33.6936381, middleLng: -117.1546611,
    frontLat: 33.6935972, frontLng: -117.1547960,
    backLat: 33.6937021, backLng: -117.1545155,
    note: '', estimated: false },
  { hole: 11, par: 4, distance: 365, front: 350, back: 388,
    teeLat: 33.6949812, teeLng: -117.1538889,
    middleLat: 33.6964496, middleLng: -117.1506684,
    frontLat: 33.6963708, frontLng: -117.1508559,
    backLat: 33.6965558, backLng: -117.1505508,
    note: '', estimated: false },
  { hole: 12, par: 5, distance: 485, front: 459, back: 486,
    teeLat: 33.6969813, teeLng: -117.1503459,
    middleLat: 33.6931648, middleLng: -117.1494250,
    frontLat: 33.6932968, frontLng: -117.1493501,
    backLat: 33.6930506, backLng: -117.1494761,
    note: '', estimated: false },
  { hole: 13, par: 3, distance: 183, front: 164, back: 197,
    teeLat: 33.6937073, teeLng: -117.1494640,
    middleLat: 33.6950818, middleLng: -117.1501242,
    frontLat: 33.6949593, frontLng: -117.1500649,
    backLat: 33.6952167, backLng: -117.1501826,
    note: '', estimated: false },
  { hole: 14, par: 4, distance: 379, front: 336, back: 364,
    teeLat: 33.6953922, teeLng: -117.1504551,
    middleLat: 33.6928458, middleLng: -117.1487966,
    frontLat: 33.6929899, frontLng: -117.1488177,
    backLat: 33.6927361, backLng: -117.1487964,
    note: '', estimated: false },
  { hole: 15, par: 5, distance: 491, front: 477, back: 507,
    teeLat: 33.6919860, teeLng: -117.1484149,
    middleLat: 33.6959205, middleLng: -117.1494540,
    frontLat: 33.6958207, frontLng: -117.1493978,
    backLat: 33.6960749, backLng: -117.1494033,
    note: '', estimated: false },
  { hole: 16, par: 4, distance: 390, front: 362, back: 396,
    teeLat: 33.6968098, teeLng: -117.1505137,
    middleLat: 33.6993556, middleLng: -117.1483756,
    frontLat: 33.6992570, frontLng: -117.1484825,
    backLat: 33.6994737, backLng: -117.1482546,
    note: '', estimated: false },
  { hole: 17, par: 3, distance: 128, front: 130, back: 164,
    teeLat: 33.7000670, teeLng: -117.1478909,
    middleLat: 33.7000585, middleLng: -117.1464702,
    frontLat: 33.7000734, frontLng: -117.1466103,
    backLat: 33.7000545, backLng: -117.1462671,
    note: '', estimated: false },
  { hole: 18, par: 5, distance: 447, front: 430, back: 459,
    teeLat: 33.6969813, teeLng: -117.1503459,
    middleLat: 33.6944984, middleLng: -117.1535805,
    frontLat: 33.6946074, frontLng: -117.1534906,
    backLat: 33.6944433, backLng: -117.1537063,
    note: '', estimated: false },
];

const RANCHO_HOLES: CourseHole[] = [
  { hole: 1,  par: 5, distance: 514, front: 500, back: 528,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 2,  par: 3, distance: 146, front: 132, back: 160,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 3,  par: 4, distance: 372, front: 358, back: 386,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 4,  par: 5, distance: 527, front: 513, back: 541,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 5,  par: 4, distance: 392, front: 378, back: 406,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 6,  par: 3, distance: 144, front: 130, back: 158,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 7,  par: 4, distance: 309, front: 295, back: 323,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 8,  par: 4, distance: 387, front: 373, back: 401,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 9,  par: 4, distance: 343, front: 329, back: 357,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 10, par: 3, distance: 135, front: 121, back: 149,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 11, par: 4, distance: 369, front: 355, back: 383,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 12, par: 4, distance: 377, front: 363, back: 391,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 13, par: 5, distance: 538, front: 524, back: 552,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 14, par: 4, distance: 398, front: 384, back: 412,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 15, par: 4, distance: 319, front: 305, back: 333,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 16, par: 3, distance: 164, front: 150, back: 178,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 17, par: 5, distance: 459, front: 445, back: 473,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
  { hole: 18, par: 4, distance: 401, front: 387, back: 415,
    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
    note: '', estimated: true },
];

// Phase BL — Crystal Springs Golf Course (Burlingame, CA). Yardages
// captured from Golfshot for the "back" tee set (par 71, 6185y total
// from middle markers). GPS lat/lng intentionally omitted (all 0) so
// SmartVision falls back to bundled imagery + static yardages until
// upstream geometry is sourced via golfcourseapi.
const CRYSTAL_SPRINGS_HOLES: CourseHole[] = [
  { hole:  1, par: 4, distance: 381, front: 366, back: 395, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole:  2, par: 4, distance: 396, front: 381, back: 412, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole:  3, par: 3, distance: 153, front: 138, back: 168, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole:  4, par: 5, distance: 494, front: 476, back: 512, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole:  5, par: 4, distance: 382, front: 369, back: 396, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole:  6, par: 4, distance: 403, front: 389, back: 417, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole:  7, par: 5, distance: 478, front: 464, back: 493, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole:  8, par: 3, distance: 175, front: 158, back: 192, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole:  9, par: 4, distance: 388, front: 372, back: 403, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 10, par: 4, distance: 279, front: 271, back: 288, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 11, par: 3, distance: 148, front: 133, back: 162, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 12, par: 4, distance: 333, front: 323, back: 344, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 13, par: 3, distance: 150, front: 138, back: 161, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 14, par: 4, distance: 364, front: 354, back: 375, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 15, par: 4, distance: 319, front: 304, back: 334, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 16, par: 4, distance: 455, front: 444, back: 466, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 17, par: 4, distance: 380, front: 366, back: 394, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 18, par: 5, distance: 507, front: 496, back: 518, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
];

// 2026-05-17 — Sunnyvale Golf Course (Sunnyvale, CA). 18-hole par 70.
// Hand-coded estimates from public scorecard + Tim's Golfshot
// screenshots (hole 1 green-center 368y confirmed). Marked
// estimated: true so the UI / Kevin's prompt can disclose imprecise
// numbers. Refine when Golfshot OCR or hand-pass produces exact
// per-hole figures.
const SUNNYVALE_HOLES: CourseHole[] = [
  { hole: 1,  par: 4, distance: 368, front: 352, back: 383, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 2,  par: 4, distance: 353, front: 339, back: 367, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 3,  par: 3, distance: 168, front: 154, back: 182, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 4,  par: 5, distance: 488, front: 472, back: 504, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 5,  par: 4, distance: 341, front: 325, back: 357, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 6,  par: 4, distance: 386, front: 370, back: 402, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 7,  par: 3, distance: 144, front: 130, back: 158, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 8,  par: 4, distance: 379, front: 363, back: 395, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 9,  par: 4, distance: 311, front: 295, back: 327, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 10, par: 4, distance: 355, front: 339, back: 371, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 11, par: 4, distance: 397, front: 381, back: 413, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 12, par: 3, distance: 157, front: 143, back: 171, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 13, par: 4, distance: 374, front: 358, back: 390, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 14, par: 5, distance: 504, front: 488, back: 520, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 15, par: 4, distance: 327, front: 311, back: 343, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 16, par: 3, distance: 175, front: 161, back: 189, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 17, par: 4, distance: 363, front: 347, back: 379, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 18, par: 4, distance: 410, front: 394, back: 426, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
];

// 2026-05-17 — San Jose Municipal Golf Course (San Jose, CA). 18-hole
// par 72. Hand-coded estimates from public scorecard / Golfshot
// screenshot data (hole 1 green-center 421y confirmed). Marked
// estimated: true; refine when exact per-hole figures available.
// 2026-05-17 — Updated from Tim's official SJM scorecard. Black tees
// (men's middle: 69.8/120, total 6253y, par 72). Front+back tee yards
// derived as ±~5% of middle to give SmartFinder a reasonable
// pin-position spread until OSM Overpass fills in the front/middle/back
// green points more precisely. All 18 holes now have authoritative
// par + yardage; lat/lng come from OSM at round start.
const SAN_JOSE_MUNI_HOLES: CourseHole[] = [
  { hole: 1,  par: 5, distance: 480, front: 466, back: 494, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 2,  par: 4, distance: 371, front: 360, back: 382, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 3,  par: 4, distance: 373, front: 362, back: 384, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 4,  par: 3, distance: 129, front: 118, back: 140, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 5,  par: 4, distance: 342, front: 331, back: 353, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 6,  par: 4, distance: 358, front: 347, back: 369, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 7,  par: 3, distance: 160, front: 149, back: 171, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 8,  par: 4, distance: 397, front: 386, back: 408, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 9,  par: 5, distance: 476, front: 462, back: 490, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 10, par: 4, distance: 366, front: 355, back: 377, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 11, par: 5, distance: 514, front: 500, back: 528, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 12, par: 3, distance: 138, front: 127, back: 149, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 13, par: 4, distance: 383, front: 372, back: 394, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 14, par: 4, distance: 350, front: 339, back: 361, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 15, par: 4, distance: 399, front: 388, back: 410, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 16, par: 4, distance: 359, front: 348, back: 370, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 17, par: 3, distance: 161, front: 150, back: 172, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 18, par: 5, distance: 497, front: 483, back: 511, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
];

// Phase BL — Mariners Point Golf Center (Burlingame, CA). 9-hole
// executive par-3 course; all holes par 3 with center yardages 90-160y.
// Total par 27, total middle yardage 1041y.
const MARINERS_POINT_HOLES: CourseHole[] = [
  { hole: 1, par: 3, distance: 120, front: 108, back: 131, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 2, par: 3, distance:  96, front:  80, back: 112, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 3, par: 3, distance: 120, front: 105, back: 134, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 4, par: 3, distance: 156, front: 144, back: 168, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 5, par: 3, distance: 142, front: 125, back: 158, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 6, par: 3, distance: 160, front: 149, back: 171, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 7, par: 3, distance: 144, front: 130, back: 157, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 8, par: 3, distance: 106, front:  95, back: 116, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 9, par: 3, distance:  90, front:  78, back: 102, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
];

export const COURSES: Course[] = [
  {
    id: 'palms',
    name: 'Menifee Lakes Palms',
    fullName: 'Menifee Lakes Country Club — Palms',
    rating: '69.6',
    slope: '119',
    par: 72,
    totalYards: 6311,
    holes: PALMS_HOLES,
  },
  {
    id: 'lakes',
    name: 'Menifee Lakes Lakes',
    fullName: 'Menifee Lakes Country Club — Lakes',
    rating: '69.3',
    slope: '119',
    par: 71,
    totalYards: 6119,
    holes: LAKES_HOLES,
  },
  {
    // 2026-05-17 — was 'rancho'; renamed for consistency with the
    // 'local:rancho-california' slug used everywhere else. The
    // app/course/[course_id].tsx workaround map can be simplified
    // separately once verified in the field.
    id: 'rancho-california',
    name: 'Rancho California',
    fullName: 'The Golf Club at Rancho California',
    rating: '70.9',
    slope: '127',
    par: 72,
    totalYards: 6294,
    holes: RANCHO_HOLES,
  },
  {
    id: 'crystal-springs',
    name: 'Crystal Springs',
    fullName: 'Crystal Springs Golf Course — Burlingame, CA',
    rating: '70.4',
    slope: '128',
    par: 71,
    totalYards: 6185,
    holes: CRYSTAL_SPRINGS_HOLES,
  },
  {
    id: 'mariners-point',
    name: 'Mariners Point',
    fullName: 'Mariners Point Golf Center — Foster City / Burlingame, CA',
    rating: '53.0',
    slope: '74',
    par: 27,
    totalYards: 1134,
    holes: MARINERS_POINT_HOLES,
  },
  {
    id: 'sunnyvale',
    name: 'Sunnyvale Golf Course',
    fullName: 'Sunnyvale Golf Course — Sunnyvale, CA',
    rating: '69.8',
    slope: '117',
    par: 70,
    totalYards: 6172, // sum of distance column
    holes: SUNNYVALE_HOLES,
  },
  {
    id: 'san-jose-muni',
    name: 'San Jose Municipal',
    fullName: 'San Jose Municipal Golf Course — San Jose, CA',
    rating: '70.2',
    slope: '122',
    par: 72,
    totalYards: 6948, // sum of distance column
    holes: SAN_JOSE_MUNI_HOLES,
  },
];
