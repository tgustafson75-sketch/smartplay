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
  if (!courseId) return [];
  // 2026-07-01 (Tim) — custom courses built from a scorecard photo (customCourseStore). Yardage-
  // only (no GPS/green coords yet), so on-course yardage falls back to the scorecard distance until
  // the player marks tees/greens — the same honest-degrade as other coord-less bundled holes. Single
  // resolution point: every caller (Play chip, runStartRound, hole count) gets these for free.
  if (courseId.startsWith('custom:')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cc = require('../store/customCourseStore').useCustomCourseStore.getState().getCustomCourse(courseId) as
        | { holes: { hole: number; par: number; distance: number | null; handicap?: number | null }[] }
        | null;
      if (!cc) return [];
      return cc.holes.map((h) => ({
        hole: h.hole,
        par: h.par,
        distance: h.distance ?? 0,
        front: 0, back: 0,
        teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
        note: '', estimated: true,
      }));
    } catch { return []; }
  }
  if (!courseId.startsWith('local:')) return [];
  const slug = courseId.slice('local:'.length);
  const course = COURSES.find(c => c.id === slug);
  return course?.holes ?? [];
}

/**
 * 2026-06-04 — Authoritative hole count for any course context.
 * Priority:
 *   1. Bundled length (our 10 local: courses — known-correct, e.g. 9 for
 *      Echo Hills + Mariners Point, 18 for Palms/Lakes/etc).
 *   2. Live courseHoles length from the round store (golfcourseapi-fed;
 *      can be wrong for 9-hole executive courses where the API pads to 18).
 *   3. 18 as last resort only.
 * Never default to 18 when bundled data exists for the course.
 */
export function getCourseHoleCount(
  courseId: string | null | undefined,
  liveLength?: number,
): number {
  const bundled = getBundledHoles(courseId);
  if (bundled.length > 0) return bundled.length;
  if (liveLength && liveLength > 0) return liveLength;
  return 18;
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
  { hole:  1, par: 4, distance: 381, front: 366, back: 395, teeLat: 37.55539089, teeLng: -122.38067869, middleLat: 37.55443828, middleLng: -122.38001265, frontLat: 37.5545342, frontLng: -122.38009732, backLat: 37.55433828, backLng: -122.37993633, note: '', estimated: false },
  { hole:  2, par: 4, distance: 396, front: 381, back: 412, teeLat: 37.55280782, teeLng: -122.37866979, middleLat: 37.55164678, middleLng: -122.37792414, frontLat: 37.55175534, frontLng: -122.37799715, backLat: 37.55153777, backLng: -122.3778505, note: '', estimated: false },
  { hole:  3, par: 3, distance: 153, front: 138, back: 168, teeLat: 37.55152528, teeLng: -122.37828982, middleLat: 37.55288299, middleLng: -122.37949778, frontLat: 37.55279787, frontLng: -122.37941878, backLat: 37.55297, backLng: -122.37958, note: '', estimated: false },
  { hole:  4, par: 5, distance: 494, front: 476, back: 512, teeLat: 37.55093556, teeLng: -122.37876898, middleLat: 37.5491521, middleLng: -122.37753755, frontLat: 37.54927247, frontLng: -122.37761475, backLat: 37.54903934, backLng: -122.37741639, note: '', estimated: false },
  { hole:  5, par: 4, distance: 382, front: 369, back: 396, teeLat: 37.54740836, teeLng: -122.3758829, middleLat: 37.54664998, middleLng: -122.37484012, frontLat: 37.54670777, frontLng: -122.37492517, backLat: 37.54660082, backLng: -122.37476269, note: '', estimated: false },
  { hole:  6, par: 4, distance: 403, front: 389, back: 417, teeLat: 37.54761024, teeLng: -122.37741175, middleLat: 37.54760047, middleLng: -122.37917056, frontLat: 37.54759745, frontLng: -122.37902228, backLat: 37.54759409, backLng: -122.37932164, note: '', estimated: false },
  { hole:  7, par: 5, distance: 478, front: 464, back: 493, teeLat: 37.54999626, teeLng: -122.37956269, middleLat: 37.55168252, middleLng: -122.3808628, frontLat: 37.55160991, frontLng: -122.38080511, backLat: 37.55173725, backLng: -122.38091592, note: '', estimated: false },
  { hole:  8, par: 3, distance: 175, front: 158, back: 192, teeLat: 37.55181699, teeLng: -122.38027897, middleLat: 37.55326013, middleLng: -122.38133078, frontLat: 37.55314275, frontLng: -122.38127178, backLat: 37.553362, backLng: -122.381372, note: '', estimated: false },
  { hole:  9, par: 4, distance: 388, front: 372, back: 403, teeLat: 37.55553702, teeLng: -122.38216197, middleLat: 37.55675975, middleLng: -122.38303373, frontLat: 37.55664512, frontLng: -122.38296378, backLat: 37.55686387, backLng: -122.38309946, note: '', estimated: false },
  { hole: 10, par: 4, distance: 279, front: 271, back: 288, teeLat: 37.55859931, teeLng: -122.38464834, middleLat: 37.55805942, middleLng: -122.38554069, frontLat: 37.55810787, frontLng: -122.38545041, backLat: 37.55800649, backLng: -122.38563387, note: '', estimated: false },
  { hole: 11, par: 3, distance: 148, front: 133, back: 162, teeLat: 37.55830713, teeLng: -122.38596703, middleLat: 37.55914645, middleLng: -122.38485497, frontLat: 37.55907987, frontLng: -122.38494914, backLat: 37.55920975, backLng: -122.38475446, note: '', estimated: false },
  { hole: 12, par: 4, distance: 333, front: 323, back: 344, teeLat: 37.56039773, teeLng: -122.38603237, middleLat: 37.5605016, middleLng: -122.38749613, frontLat: 37.56048911, frontLng: -122.38737966, backLat: 37.56049869, backLng: -122.38761328, note: '', estimated: false },
  { hole: 13, par: 3, distance: 150, front: 138, back: 161, teeLat: 37.56080623, teeLng: -122.38787381, middleLat: 37.56195382, middleLng: -122.38730884, frontLat: 37.56185861, frontLng: -122.38734886, backLat: 37.56202062, backLng: -122.38726464, note: '', estimated: false },
  { hole: 14, par: 4, distance: 364, front: 354, back: 375, teeLat: 37.5633085, teeLng: -122.38855853, middleLat: 37.56379804, middleLng: -122.39017967, frontLat: 37.56376454, frontLng: -122.39008028, backLat: 37.5638261, backLng: -122.39027741, note: '', estimated: false },
  { hole: 15, par: 4, distance: 319, front: 304, back: 334, teeLat: 37.56560238, teeLng: -122.39093257, middleLat: 37.5659251, middleLng: -122.39159589, frontLat: 37.565858, frontLng: -122.39147214, backLat: 37.56600663, backLng: -122.39171828, note: '', estimated: false },
  { hole: 16, par: 4, distance: 455, front: 444, back: 466, teeLat: 37.5648991, teeLng: -122.38903692, middleLat: 37.56339843, middleLng: -122.38758978, frontLat: 37.56346437, frontLng: -122.38765639, backLat: 37.56333262, backLng: -122.38751816, note: '', estimated: false },
  { hole: 17, par: 4, distance: 380, front: 366, back: 394, teeLat: 37.56218444, teeLng: -122.3864237, middleLat: 37.56135284, middleLng: -122.38553916, frontLat: 37.561442, frontLng: -122.385641, backLat: 37.561259, backLng: -122.385444, note: '', estimated: false },
  { hole: 18, par: 5, distance: 507, front: 496, back: 518, teeLat: 37.55993001, teeLng: -122.38424021, middleLat: 37.55811845, middleLng: -122.38274003, frontLat: 37.558183, frontLng: -122.382792, backLat: 37.55804687, backLng: -122.3826786, note: '', estimated: false },
];

// 2026-05-17 — Sunnyvale Golf Course (Sunnyvale, CA). 18-hole par 70.
// Hand-coded estimates from public scorecard + Tim's Golfshot
// screenshots (hole 1 green-center 368y confirmed). Marked
// estimated: true so the UI / Kevin's prompt can disclose imprecise
// numbers. Refine when Golfshot OCR or hand-pass produces exact
// per-hole figures.
const SUNNYVALE_HOLES: CourseHole[] = [
  { hole: 1,  par: 4, distance: 368, front: 352, back: 383, teeLat: 37.394658, teeLng: -122.043756, middleLat: 37.394908, middleLng: -122.045011, frontLat: 37.394895, frontLng: -122.044879, backLat: 37.394925, backLng: -122.045141, note: '', estimated: false },
  { hole: 2,  par: 4, distance: 353, front: 339, back: 367, teeLat: 37.396263, teeLng: -122.042997, middleLat: 37.396834, middleLng: -122.04168, frontLat: 37.396802, frontLng: -122.041814, backLat: 37.396866, backLng: -122.041546, note: '', estimated: false },
  { hole: 3,  par: 3, distance: 168, front: 154, back: 182, teeLat: 37.399986, teeLng: -122.04389, middleLat: 37.401801, middleLng: -122.044421, frontLat: 37.401699, frontLng: -122.044399, backLat: 37.401901, backLng: -122.04443, note: '', estimated: false },
  { hole: 4,  par: 5, distance: 488, front: 472, back: 504, teeLat: 0, teeLng: 0, middleLat: 37.402244, middleLng: -122.046467, frontLat: 37.402231, frontLng: -122.046336, backLat: 37.402253, backLng: -122.046598, note: 'tee needs field calibration', estimated: false },
  { hole: 5,  par: 4, distance: 341, front: 325, back: 357, teeLat: 37.401034, teeLng: -122.045196, middleLat: 37.400305, middleLng: -122.045306, frontLat: 37.400397, frontLng: -122.045293, backLat: 37.400209, backLng: -122.045289, note: '', estimated: false },
  { hole: 6,  par: 4, distance: 386, front: 370, back: 402, teeLat: 37.398507, teeLng: -122.044448, middleLat: 37.397625, middleLng: -122.045185, frontLat: 37.397731, frontLng: -122.045097, backLat: 37.397533, backLng: -122.045248, note: '', estimated: false },
  { hole: 7,  par: 3, distance: 144, front: 130, back: 158, teeLat: 0, teeLng: 0, middleLat: 37.396242, middleLng: -122.045829, frontLat: 37.39634, frontLng: -122.045813, backLat: 37.396142, backLng: -122.04582, note: 'tee needs field calibration', estimated: false },
  { hole: 8,  par: 4, distance: 379, front: 363, back: 395, teeLat: 37.397635, teeLng: -122.044112, middleLat: 37.398223, middleLng: -122.043522, frontLat: 37.398164, frontLng: -122.043603, backLat: 37.398326, backLng: -122.043419, note: '', estimated: false },
  { hole: 9,  par: 4, distance: 311, front: 295, back: 327, teeLat: 37.40006, teeLng: -122.043021, middleLat: 37.401522, middleLng: -122.043557, frontLat: 37.401405, frontLng: -122.043549, backLat: 37.401652, backLng: -122.043526, note: '', estimated: false },
  { hole: 10, par: 4, distance: 355, front: 339, back: 371, teeLat: 37.400891, teeLng: -122.040226, middleLat: 37.400503, middleLng: -122.037659, frontLat: 37.400508, frontLng: -122.037801, backLat: 37.400493, backLng: -122.037502, note: '', estimated: false },
  { hole: 11, par: 4, distance: 397, front: 381, back: 413, teeLat: 37.400469, teeLng: -122.041047, middleLat: 37.401051, middleLng: -122.042184, frontLat: 37.400981, frontLng: -122.042058, backLat: 37.401121, backLng: -122.042295, note: '', estimated: false },
  { hole: 12, par: 3, distance: 157, front: 143, back: 171, teeLat: 37.399677, teeLng: -122.041588, middleLat: 37.399598, middleLng: -122.039979, frontLat: 37.399547, frontLng: -122.04014, backLat: 37.399638, backLng: -122.039801, note: '', estimated: false },
  { hole: 13, par: 4, distance: 374, front: 358, back: 390, teeLat: 0, teeLng: 0, middleLat: 37.398722, middleLng: -122.041465, frontLat: 37.398833, frontLng: -122.041296, backLat: 37.398686, backLng: -122.041654, note: 'tee needs field calibration', estimated: false },
  { hole: 14, par: 5, distance: 504, front: 488, back: 520, teeLat: 37.398279, teeLng: -122.038866, middleLat: 37.398718, middleLng: -122.037986, frontLat: 37.398671, frontLng: -122.038102, backLat: 37.398765, backLng: -122.03787, note: '', estimated: false },
  { hole: 15, par: 4, distance: 327, front: 311, back: 343, teeLat: 0, teeLng: 0, middleLat: 37.397239, middleLng: -122.03881, frontLat: 37.397326, frontLng: -122.038748, backLat: 37.397164, backLng: -122.038854, note: 'tee needs field calibration', estimated: false },
  { hole: 16, par: 3, distance: 175, front: 161, back: 189, teeLat: 37.398345, teeLng: -122.037318, middleLat: 37.398956, middleLng: -122.036817, frontLat: 37.398848, frontLng: -122.036862, backLat: 37.399078, backLng: -122.036778, note: '', estimated: false },
  { hole: 17, par: 4, distance: 363, front: 347, back: 379, teeLat: 37.397642, teeLng: -122.03708, middleLat: 37.3962095, middleLng: -122.037514, frontLat: 37.396269, frontLng: -122.037522, backLat: 37.39615, backLng: -122.037506, note: '', estimated: false },
  { hole: 18, par: 4, distance: 410, front: 394, back: 426, teeLat: 37.396621, teeLng: -122.039196, middleLat: 37.396956, middleLng: -122.040424, frontLat: 37.396865, frontLng: -122.040207, backLat: 37.397047, backLng: -122.040552, note: '', estimated: false },
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
  { hole: 1,  par: 5, distance: 480, front: 466, back: 494, teeLat: 37.37891961, teeLng: -121.88751514, middleLat: 37.38085106, middleLng: -121.88674332, frontLat: 37.38075787, frontLng: -121.88678134, backLat: 37.3809368, backLng: -121.88670543, note: '', estimated: false },
  { hole: 2,  par: 4, distance: 371, front: 360, back: 382, teeLat: 37.37991574, teeLng: -121.88557151, middleLat: 37.37888758, middleLng: -121.88671152, frontLat: 37.37896746, frontLng: -121.88661828, backLat: 37.37882687, backLng: -121.88680252, note: '', estimated: false },
  { hole: 3,  par: 4, distance: 373, front: 362, back: 384, teeLat: 37.37786514, teeLng: -121.88742073, middleLat: 37.37704632, middleLng: -121.8887299, frontLat: 37.37711443, frontLng: -121.88861538, backLat: 37.37699684, backLng: -121.88884967, note: '', estimated: false },
  { hole: 4,  par: 3, distance: 129, front: 118, back: 140, teeLat: 37.37730467, teeLng: -121.89025929, middleLat: 37.37789395, middleLng: -121.89152643, frontLat: 37.37784027, frontLng: -121.89141925, backLat: 37.37792592, backLng: -121.89165106, note: '', estimated: false },
  { hole: 5,  par: 4, distance: 342, front: 331, back: 353, teeLat: 37.37862436, teeLng: -121.89389968, middleLat: 37.37860838, middleLng: -121.89507107, frontLat: 37.378608, frontLng: -121.89498281, backLat: 37.37861077, backLng: -121.89516061, note: '', estimated: false },
  { hole: 6,  par: 4, distance: 358, front: 347, back: 369, teeLat: 37.38060023, teeLng: -121.89258807, middleLat: 37.38051186, middleLng: -121.89130222, frontLat: 37.38051822, frontLng: -121.89144285, backLat: 37.38050788, backLng: -121.89117799, note: '', estimated: false },
  { hole: 7,  par: 3, distance: 160, front: 149, back: 171, teeLat: 37.38019051, teeLng: -121.89147209, middleLat: 37.37947365, middleLng: -121.88980857, frontLat: 37.37952352, frontLng: -121.88992742, backLat: 37.37944082, backLng: -121.88970321, note: '', estimated: false },
  { hole: 8,  par: 4, distance: 397, front: 386, back: 408, teeLat: 37.38076685, teeLng: -121.88845358, middleLat: 37.38183523, middleLng: -121.88735784, frontLat: 37.38174681, frontLng: -121.88744402, backLat: 37.38192686, backLng: -121.88727291, note: '', estimated: false },
  { hole: 9,  par: 5, distance: 476, front: 462, back: 490, teeLat: 37.37986043, teeLng: -121.88797354, middleLat: 37.37818029, middleLng: -121.88960178, frontLat: 37.37826475, frontLng: -121.88951584, backLat: 37.37811281, backLng: -121.88970625, note: '', estimated: false },
  { hole: 10, par: 4, distance: 366, front: 355, back: 377, teeLat: 37.3759076, teeLng: -121.88665128, middleLat: 37.37512274, middleLng: -121.88584062, frontLat: 37.37520073, frontLng: -121.88592363, backLat: 37.37506456, backLng: -121.88574172, note: '', estimated: false },
  { hole: 11, par: 5, distance: 514, front: 500, back: 528, teeLat: 37.37633511, teeLng: -121.88422028, middleLat: 37.3779486, middleLng: -121.88239618, frontLat: 37.37787194, frontLng: -121.88247586, backLat: 37.37800677, backLng: -121.8823279, note: '', estimated: false },
  { hole: 12, par: 3, distance: 138, front: 127, back: 149, teeLat: 37.37788959, teeLng: -121.88318838, middleLat: 37.37878879, middleLng: -121.88188264, frontLat: 37.37873155, frontLng: -121.88196513, backLat: 37.37885312, backLng: -121.88180581, note: '', estimated: false },
  { hole: 13, par: 4, distance: 383, front: 372, back: 394, teeLat: 37.37652457, teeLng: -121.88258941, middleLat: 37.37576256, middleLng: -121.88374341, frontLat: 37.37583478, frontLng: -121.88363056, backLat: 37.37569984, backLng: -121.8838479, note: '', estimated: false },
  { hole: 14, par: 4, distance: 350, front: 339, back: 361, teeLat: 37.37446016, teeLng: -121.88481342, middleLat: 37.37365848, middleLng: -121.88540437, frontLat: 37.37374928, frontLng: -121.88533397, backLat: 37.37356325, backLng: -121.88548478, note: '', estimated: false },
  { hole: 15, par: 4, distance: 399, front: 388, back: 410, teeLat: 37.3747871, teeLng: -121.88648463, middleLat: 37.37578014, middleLng: -121.88778239, frontLat: 37.37570321, frontLng: -121.8876858, backLat: 37.37583054, backLng: -121.88787708, note: '', estimated: false },
  { hole: 16, par: 4, distance: 359, front: 348, back: 370, teeLat: 37.37446192, teeLng: -121.88762629, middleLat: 37.37331557, middleLng: -121.88725248, frontLat: 37.37343555, frontLng: -121.88729237, backLat: 37.3732208, backLng: -121.88720141, note: '', estimated: false },
  { hole: 17, par: 3, distance: 161, front: 150, back: 172, teeLat: 37.37418421, teeLng: -121.88683111, middleLat: 37.37262049, middleLng: -121.88651893, frontLat: 37.37273983, frontLng: -121.88654383, backLat: 37.3725078, backLng: -121.88648675, note: '', estimated: false },
  { hole: 18, par: 5, distance: 497, front: 483, back: 511, teeLat: 37.37432586, teeLng: -121.88844722, middleLat: 37.37643538, middleLng: -121.88939704, frontLat: 37.3763287, frontLng: -121.88934996, backLat: 37.37655604, backLng: -121.88943781, note: '', estimated: false },
];

// Phase BL — Mariners Point Golf Center (Burlingame, CA). 9-hole
// executive par-3 course; all holes par 3 with center yardages 90-160y.
// Total par 27, total middle yardage 1041y.
const MARINERS_POINT_HOLES: CourseHole[] = [
  { hole: 1, par: 3, distance: 120, front: 108, back: 131, teeLat: 0, teeLng: 0, middleLat: 37.57258969, middleLng: -122.28463281, frontLat: 37.57254884, frontLng: -122.28450082, backLat: 37.57260553, backLng: -122.28471471, note: 'tee needs field calibration', estimated: false },
  { hole: 2, par: 3, distance:  96, front:  80, back: 112, teeLat: 0, teeLng: 0, middleLat: 37.57335566, middleLng: -122.28416705, frontLat: 37.57325541, frontLng: -122.28428459, backLat: 37.57344475, backLng: -122.28406661, note: 'tee needs field calibration', estimated: false },
  { hole: 3, par: 3, distance: 120, front: 105, back: 134, teeLat: 0, teeLng: 0, middleLat: 37.57397985, middleLng: -122.28321562, frontLat: 37.57394125, frontLng: -122.28335919, backLat: 37.57401599, backLng: -122.28305024, note: 'tee needs field calibration', estimated: false },
  { hole: 4, par: 3, distance: 156, front: 144, back: 168, teeLat: 0, teeLng: 0, middleLat: 37.57374625, middleLng: -122.28171637, frontLat: 37.57371485, frontLng: -122.28188255, backLat: 37.57377764, backLng: -122.28152755, note: 'tee needs field calibration', estimated: false },
  { hole: 5, par: 3, distance: 142, front: 125, back: 158, teeLat: 0, teeLng: 0, middleLat: 37.57331085, middleLng: -122.27994503, frontLat: 37.57336933, frontLng: -122.28005183, backLat: 37.57325421, backLng: -122.27980112, note: 'tee needs field calibration', estimated: false },
  { hole: 6, par: 3, distance: 160, front: 149, back: 171, teeLat: 0, teeLng: 0, middleLat: 37.57354903, middleLng: -122.28135371, frontLat: 37.57353384, frontLng: -122.28124026, backLat: 37.57355248, backLng: -122.28142237, note: 'tee needs field calibration', estimated: false },
  { hole: 7, par: 3, distance: 144, front: 130, back: 157, teeLat: 0, teeLng: 0, middleLat: 37.57381219, middleLng: -122.28293205, frontLat: 37.57376345, frontLng: -122.28278637, backLat: 37.57384098, backLng: -122.28303389, note: 'tee needs field calibration', estimated: false },
  { hole: 8, par: 3, distance: 106, front:  95, back: 116, teeLat: 0, teeLng: 0, middleLat: 37.57304769, middleLng: -122.28394149, frontLat: 37.57312871, frontLng: -122.28387874, backLat: 37.572982, backLng: -122.28397433, note: 'tee needs field calibration', estimated: false },
  { hole: 9, par: 3, distance:  90, front:  78, back: 102, teeLat: 0, teeLng: 0, middleLat: 37.57259634, middleLng: -122.28355273, frontLat: 37.57262574, frontLng: -122.28366847, backLat: 37.57257379, backLng: -122.2834229, note: 'tee needs field calibration', estimated: false },
];

// 2026-05-28 — Westlake Country Club, Jackson NJ (18 holes, par 71).
// Par/distance transcribed from the Green Maps header on each
// bundled hole screenshot (Mid Green Yds). Front/Back/teeLat/Lng are
// either: read off the explicit F/M/B overlays on par 3s (holes 3, 6,
// 17 — Green Maps shows all three numbers on par 3s); or estimated
// ±12y from mid for par 4/5 (typical green depth ~24y, this is a
// fair pre-round approximation until golfcourseapi geometry caches).
// teeLat/Lng/middleLat/Lng/frontLat/Lng/backLat/Lng all 0 — populated
// at runtime by services/courseGeometryService when the user is
// online; the pixel-interpolation path in SmartVision doesn't need
// real lat/lng to drive the measuring tool's F/M/B numbers (it
// interpolates against `distance` along the tee→pin canvas axis).
//
// Why this matters: without a COURSES entry, getBundledHoles() returns
// empty for local:westlake-cc-nj, SmartVision can't compute F/M/B
// from the yellow target's pixel position, and the measuring tool
// reads as "—" on every cell — making the curated images feel dead.
// Same latent gap exists for Maplewood + Pembroke; address separately.
// 2026-06-04 — Echo Hills Golf Course, Hemet CA (9-hole executive,
// par 35). Yardages from Tim's Golfshot Green Center captures
// (IMG 7635-7643). Coords zero — geometry comes from golfcourseapi
// at runtime + Mapbox satellite for SmartVision.
// Greenhill Golf Course — 18-hole par 71 (5,896y whites).
// Yardages from official GolfNow app screenshots (Downloads/greenhill/ — 8033-8050).
// Green Center distances are exact matches to prior readings. Front/Back corrected to
// official app values. GPS coords zeroed — golfcourseapi resolves runtime geometry.
// estimated: true until par/handicap confirmed from official scorecard.
// GPS: GolfTraxx satellite data 2026-06-21. Yardages: GolfNow official screenshots.
// Holes 8+11 tee = 0,0 (GolfTraxx reports tee=gc for these par 3s — data error, needs field calibration).
export const GREENHILL_HOLES: CourseHole[] = [
  { hole:  1, par: 4, distance: 374, front: 360, back: 388, teeLat: 42.28707404, teeLng: -71.78206086, middleLat: 42.28629224, middleLng: -71.78334564, frontLat: 42.28636169, frontLng: -71.78322226, backLat: 42.28621485, backLng: -71.78346634, note: '', estimated: false },
  { hole:  2, par: 4, distance: 334, front: 321, back: 347, teeLat: 42.28788361, teeLng: -71.78141981, middleLat: 42.28849078, middleLng: -71.77996874, frontLat: 42.28843125, frontLng: -71.78008407, backLat: 42.28854435, backLng: -71.77986145, note: '', estimated: false },
  { hole:  3, par: 4, distance: 395, front: 383, back: 407, teeLat: 42.28830823, teeLng: -71.78266436, middleLat: 42.28710579, middleLng: -71.78372920, frontLat: 42.28720301, frontLng: -71.78367019, backLat: 42.28700856, backLng: -71.78379357, note: '', estimated: false },
  { hole:  4, par: 4, distance: 342, front: 329, back: 355, teeLat: 42.28527033, teeLng: -71.78437024, middleLat: 42.28411942, middleLng: -71.78495497, frontLat: 42.28420077, frontLng: -71.78490132, backLat: 42.28403607, backLng: -71.78502470, note: '', estimated: false },
  { hole:  5, par: 4, distance: 334, front: 319, back: 348, teeLat: 42.28529612, teeLng: -71.78364605, middleLat: 42.28613151, middleLng: -71.78241491, frontLat: 42.28606404, frontLng: -71.78256243, backLat: 42.28620890, backLng: -71.78228080, note: '', estimated: false },
  { hole:  6, par: 3, distance: 185, front: 172, back: 199, teeLat: 42.28675145, teeLng: -71.78169675, middleLat: 42.28761177, middleLng: -71.77973539, frontLat: 42.28756018, frontLng: -71.77986681, backLat: 42.28765740, backLng: -71.77961200, note: '', estimated: false },
  { hole:  7, par: 4, distance: 328, front: 313, back: 343, teeLat: 42.28653829, teeLng: -71.78093433, middleLat: 42.28603626, middleLng: -71.78181678, frontLat: 42.28611960, frontLng: -71.78167731, backLat: 42.28596483, backLng: -71.78196162, note: '', estimated: false },
  { hole:  8, par: 3, distance: 157, front: 140, back: 173, teeLat: 0, teeLng: 0, middleLat: 42.28452819, middleLng: -71.78327858, frontLat: 42.28464328, frontLng: -71.78320080, backLat: 42.28442897, backLng: -71.78335637, note: 'tee needs field calibration', estimated: false },
  { hole:  9, par: 5, distance: 450, front: 436, back: 464, teeLat: 42.28605611, teeLng: -71.77998751, middleLat: 42.28692522, middleLng: -71.77809656, frontLat: 42.28686767, frontLng: -71.77823335, backLat: 42.28697284, backLng: -71.77796245, note: '', estimated: false },
  { hole: 10, par: 4, distance: 273, front: 260, back: 285, teeLat: 42.28660575, teeLng: -71.77385598, middleLat: 42.28608984, middleLng: -71.77299231, frontLat: 42.28617516, frontLng: -71.77308619, backLat: 42.28602237, backLng: -71.77289575, note: '', estimated: false },
  { hole: 11, par: 3, distance: 198, front: 183, back: 214, teeLat: 0, teeLng: 0, middleLat: 42.28788758, middleLng: -71.77076072, frontLat: 42.28776654, frontLng: -71.77078754, backLat: 42.28803044, backLng: -71.77074730, note: 'tee needs field calibration', estimated: false },
  { hole: 12, par: 5, distance: 564, front: 552, back: 575, teeLat: 42.28553225, teeLng: -71.77266777, middleLat: 42.28357967, middleLng: -71.77422076, frontLat: 42.28367492, frontLng: -71.77418321, backLat: 42.28350030, backLng: -71.77425295, note: '', estimated: false },
  { hole: 13, par: 4, distance: 382, front: 369, back: 396, teeLat: 42.28480798, teeLng: -71.77234322, middleLat: 42.28584180, middleLng: -71.77031279, frontLat: 42.28576839, frontLng: -71.77040130, backLat: 42.28590331, backLng: -71.77019745, note: '', estimated: false },
  { hole: 14, par: 3, distance: 140, front: 126, back: 154, teeLat: 42.28557591, teeLng: -71.76948130, middleLat: 42.28657202, middleLng: -71.77031547, frontLat: 42.28645693, frontLng: -71.77021086, backLat: 42.28667719, backLng: -71.77043617, note: '', estimated: false },
  { hole: 15, par: 4, distance: 322, front: 309, back: 336, teeLat: 42.28647479, teeLng: -71.76918626, middleLat: 42.28547868, middleLng: -71.76882684, frontLat: 42.28559575, frontLng: -71.76885903, backLat: 42.28538145, backLng: -71.76879734, note: '', estimated: false },
  { hole: 16, par: 5, distance: 481, front: 465, back: 498, teeLat: 42.28434563, teeLng: -71.77176654, middleLat: 42.28322249, middleLng: -71.77374870, frontLat: 42.28329194, frontLng: -71.77361995, backLat: 42.28314311, backLng: -71.77386135, note: '', estimated: false },
  { hole: 17, par: 4, distance: 253, front: 237, back: 270, teeLat: 42.28255375, teeLng: -71.77358776, middleLat: 42.28274028, middleLng: -71.77445143, frontLat: 42.28266884, frontLng: -71.77431464, backLat: 42.28281767, backLng: -71.77460432, note: '', estimated: false },
  { hole: 18, par: 4, distance: 384, front: 370, back: 398, teeLat: 42.28571084, teeLng: -71.77622169, middleLat: 42.28667719, middleLng: -71.77725703, frontLat: 42.28663155, frontLng: -71.77712560, backLat: 42.28672679, backLng: -71.77740991, note: '', estimated: false },
];

export const ECHO_HILLS_HOLES: CourseHole[] = [
  { hole: 1, par: 4, distance: 322, front: 313, back: 331, teeLat: 33.72553315, teeLng: -116.96456641, middleLat: 33.725522, middleLng: -116.96312606, frontLat: 33.725493, frontLng: -116.96320921, backLat: 33.72554654, backLng: -116.96305096, note: '', estimated: false },
  { hole: 2, par: 3, distance: 135, front: 126, back: 144, teeLat: 0, teeLng: 0, middleLat: 33.72420358, middleLng: -116.96320921, frontLat: 33.72428389, frontLng: -116.96321189, backLat: 33.7241255, backLng: -116.96321189, note: 'tee needs field calibration', estimated: false },
  { hole: 3, par: 4, distance: 221, front: 212, back: 230, teeLat: 33.72393365, teeLng: -116.9637537, middleLat: 33.72321085, middleLng: -116.96498215, frontLat: 33.72326885, frontLng: -116.9649151, backLat: 33.72315508, backLng: -116.96504653, note: '', estimated: false },
  { hole: 4, par: 4, distance: 249, front: 240, back: 258, teeLat: 33.72414558, teeLng: -116.96477026, middleLat: 33.72481483, middleLng: -116.96350962, frontLat: 33.72479475, frontLng: -116.96358472, backLat: 33.72483268, backLng: -116.96344525, note: '', estimated: false },
  { hole: 5, par: 4, distance: 251, front: 242, back: 260, teeLat: 33.72501337, teeLng: -116.96422845, middleLat: 33.72519407, middleLng: -116.9657439, frontLat: 33.7251673, frontLng: -116.96565807, backLat: 33.72523199, backLng: -116.96582437, note: '', estimated: false },
  { hole: 6, par: 4, distance: 237, front: 228, back: 246, teeLat: 33.72437312, teeLng: -116.96565002, middleLat: 33.72311269, middleLng: -116.96562856, frontLat: 33.72318185, frontLng: -116.96560442, backLat: 33.72305915, backLng: -116.96565539, note: '', estimated: false },
  { hole: 7, par: 4, distance: 263, front: 254, back: 272, teeLat: 33.72392695, teeLng: -116.96604162, middleLat: 33.72514722, middleLng: -116.96617842, frontLat: 33.72509591, frontLng: -116.9661811, backLat: 33.7252253, backLng: -116.9661811, note: '', estimated: false },
  { hole: 8, par: 4, distance: 263, front: 254, back: 272, teeLat: 33.72431289, teeLng: -116.96648151, middleLat: 33.72305023, middleLng: -116.96624547, frontLat: 33.72311715, frontLng: -116.96626425, backLat: 33.72301007, backLng: -116.96624547, note: '', estimated: false },
  { hole: 9, par: 4, distance: 255, front: 246, back: 264, teeLat: 33.72374626, teeLng: -116.9668892, middleLat: 33.72499999, middleLng: -116.96695626, frontLat: 33.72493083, frontLng: -116.96696699, backLat: 33.72508699, backLng: -116.96695358, note: '', estimated: false },
];

export const WESTLAKE_NJ_HOLES: CourseHole[] = [
  { hole:  1, par: 4, distance: 416, front: 404, back: 428, teeLat: 40.09997253, teeLng: -74.28793341, middleLat: 40.09881537, middleLng: -74.28790122, frontLat: 40.09892822, frontLng: -74.28787977, backLat: 40.09871279, backLng: -74.28792804, note: '', estimated: false },
  { hole:  2, par: 5, distance: 472, front: 460, back: 484, teeLat: 40.09543612, teeLng: -74.2860505, middleLat: 40.09415782, middleLng: -74.28648233, frontLat: 40.0942399, frontLng: -74.2863965, backLat: 40.09407575, backLng: -74.28654939, note: '', estimated: false },
  { hole:  3, par: 3, distance: 149, front: 135, back: 164, teeLat: 0, teeLng: 0, middleLat: 40.09316266, middleLng: -74.28797364, frontLat: 40.09324064, frontLng: -74.28783417, backLat: 40.0930888, backLng: -74.2881453, note: 'tee needs field calibration', estimated: false },
  { hole:  4, par: 4, distance: 380, front: 368, back: 392, teeLat: 40.09209362, teeLng: -74.2857635, middleLat: 40.09249169, middleLng: -74.28422928, frontLat: 40.0924958, frontLng: -74.28436339, backLat: 40.09247844, backLng: -74.28409816, note: '', estimated: false },
  { hole:  5, par: 4, distance: 432, front: 420, back: 444, teeLat: 40.09585879, teeLng: -74.28325832, middleLat: 40.09690725, middleLng: -74.28243488, frontLat: 40.09678415, frontLng: -74.28253412, backLat: 40.09706524, backLng: -74.28239465, note: '', estimated: false },
  { hole:  6, par: 3, distance: 168, front: 155, back: 182, teeLat: 0, teeLng: 0, middleLat: 40.09775873, middleLng: -74.28438753, frontLat: 40.09773206, frontLng: -74.28425878, backLat: 40.09779156, backLng: -74.28455114, note: 'tee needs field calibration', estimated: false },
  { hole:  7, par: 4, distance: 366, front: 354, back: 378, teeLat: 40.10056341, teeLng: -74.28419977, middleLat: 40.10154205, middleLng: -74.28300887, frontLat: 40.10143947, frontLng: -74.28307056, backLat: 40.10165284, backLng: -74.28295523, note: '', estimated: false },
  { hole:  8, par: 4, distance: 416, front: 404, back: 428, teeLat: 40.10406961, teeLng: -74.28535849, middleLat: 40.10527797, middleLng: -74.28581715, frontLat: 40.10516719, frontLng: -74.28577691, backLat: 40.10539901, backLng: -74.28583056, note: '', estimated: false },
  { hole:  9, par: 4, distance: 333, front: 321, back: 345, teeLat: 40.10461122, teeLng: -74.28694099, middleLat: 40.10375572, middleLng: -74.28802192, frontLat: 40.10383163, frontLng: -74.28793877, backLat: 40.1036634, backLng: -74.28810507, note: '', estimated: false },
  { hole: 10, par: 5, distance: 510, front: 498, back: 522, teeLat: 40.09950269, teeLng: -74.28865761, middleLat: 40.0982532, middleLng: -74.2887193, frontLat: 40.09836194, frontLng: -74.28881586, backLat: 40.09817318, backLng: -74.28863078, note: '', estimated: false },
  { hole: 11, par: 4, distance: 374, front: 362, back: 386, teeLat: 40.0956967, teeLng: -74.28838938, middleLat: 40.09462564, middleLng: -74.28912699, frontLat: 40.09473234, frontLng: -74.28905457, backLat: 40.09450253, backLng: -74.28920209, note: '', estimated: false },
  { hole: 12, par: 4, distance: 351, front: 339, back: 363, teeLat: 40.0969093, teeLng: -74.29134518, middleLat: 40.09798442, middleLng: -74.29229468, frontLat: 40.0978408, frontLng: -74.29231614, backLat: 40.09812599, backLng: -74.29226518, note: '', estimated: false },
  { hole: 13, par: 3, distance: 198, front: 185, back: 211, teeLat: 0, teeLng: 0, middleLat: 40.10081166, middleLng: -74.29247975, frontLat: 40.10070908, frontLng: -74.29242074, backLat: 40.10091219, backLng: -74.2925173, note: 'tee needs field calibration', estimated: false },
  { hole: 14, par: 5, distance: 500, front: 488, back: 512, teeLat: 40.10453121, teeLng: -74.29401129, middleLat: 40.10518155, middleLng: -74.29534972, frontLat: 40.1051836, frontLng: -74.29519147, backLat: 40.10514052, backLng: -74.29547846, note: '', estimated: false },
  { hole: 15, par: 4, distance: 379, front: 367, back: 391, teeLat: 40.10590163, teeLng: -74.29257095, middleLat: 40.10572725, middleLng: -74.29095358, frontLat: 40.10572725, frontLng: -74.29115742, backLat: 40.1057334, backLng: -74.29073095, note: '', estimated: false },
  { hole: 16, par: 4, distance: 378, front: 366, back: 390, teeLat: 40.10848442, teeLng: -74.28859055, middleLat: 40.10964757, middleLng: -74.28821236, frontLat: 40.10952653, frontLng: -74.28822577, backLat: 40.10977475, backLng: -74.28820431, note: '', estimated: false },
  { hole: 17, par: 3, distance: 141, front: 128, back: 154, teeLat: 0, teeLng: 0, middleLat: 40.10688634, middleLng: -74.28689539, frontLat: 40.10701353, frontLng: -74.28677738, backLat: 40.10674069, backLng: -74.28698659, note: 'tee needs field calibration', estimated: false },
  { hole: 18, par: 4, distance: 288, front: 276, back: 300, teeLat: 40.10523078, teeLng: -74.28843498, middleLat: 40.10431375, middleLng: -74.28953201, frontLat: 40.10440401, frontLng: -74.28945959, backLat: 40.10418245, backLng: -74.28963125, note: '', estimated: false },
];

// 2026-07-06 — Spessard Holland at Melbourne Beach, FL ('A Player's Paradise by the
// Sea'). Par 67 (33/34), WHITE tees 4,233y (62.2/113 M). Yardage + par transcribed
// from Tim's scorecard photo; F/B are ±14y green-depth estimates (estimated: true).
// GPS coords 0 — golfcourseapi id 30168 has no hole data; on-course play uses live
// GPS + the tee-estimate path + Mark Green, exactly like other coordless locals.
// Hole imagery: assets/courses/spessard-holland/ (18 cleaned aerials).
export const SPESSARD_HOLLAND_HOLES: CourseHole[] = [
  { hole: 1, par: 4, distance: 287, front: 273, back: 301, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 2, par: 4, distance: 294, front: 280, back: 308, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 3, par: 4, distance: 325, front: 311, back: 339, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 4, par: 3, distance: 110, front: 96, back: 124, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 5, par: 4, distance: 334, front: 320, back: 348, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 6, par: 4, distance: 233, front: 219, back: 247, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 7, par: 3, distance: 125, front: 111, back: 139, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 8, par: 4, distance: 269, front: 255, back: 283, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 9, par: 3, distance: 118, front: 104, back: 132, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 10, par: 4, distance: 277, front: 263, back: 291, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 11, par: 3, distance: 142, front: 128, back: 156, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 12, par: 4, distance: 270, front: 256, back: 284, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 13, par: 5, distance: 442, front: 428, back: 456, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 14, par: 4, distance: 284, front: 270, back: 298, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 15, par: 3, distance: 129, front: 115, back: 143, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 16, par: 4, distance: 250, front: 236, back: 264, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 17, par: 3, distance: 111, front: 97, back: 125, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
  { hole: 18, par: 4, distance: 233, front: 219, back: 247, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: true },
];

// 2026-07-06 — Webster/Dudley (MA), from Tim's Golf Pad hole-view screenshots
// (~/Downloads/websterdudley, 2216-2224 → holes 1-9). front/center/back yardages are
// REAL (read off the shots). 2026-07-07 — PARS are now REAL from the physical
// scorecard (~/Downloads/scorecards): 4,4,3,4,4,3,4,5,5 = 36 (fixes hole 9, a par 5
// the length-derivation called a 4). The card also confirms 18 IS PLAYED AS THE NINE
// TWICE (back-nine yardages repeat the front), so holes 10-18 mirror 1-9 below.
// Hole GPS coords aren't in the shots (0,0) so — like Spessard — static scorecard
// yardage works and Mark Green gives a live counting-down number.
const WEBSTER_DUDLEY_FRONT: CourseHole[] = [
  { hole: 1, par: 4, distance: 352, front: 341, back: 364, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 2, par: 4, distance: 348, front: 336, back: 359, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 3, par: 3, distance: 142, front: 133, back: 151, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 4, par: 4, distance: 360, front: 348, back: 372, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 5, par: 4, distance: 301, front: 288, back: 313, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 6, par: 3, distance: 172, front: 158, back: 185, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 7, par: 4, distance: 391, front: 380, back: 401, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 8, par: 5, distance: 477, front: 466, back: 487, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
  { hole: 9, par: 5, distance: 459, front: 447, back: 472, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false },
];
export const WEBSTER_DUDLEY_HOLES: CourseHole[] = [
  ...WEBSTER_DUDLEY_FRONT,
  // Back nine = the same nine again (holes 10-18 mirror 1-9, per the scorecard).
  ...WEBSTER_DUDLEY_FRONT.map((h) => ({ ...h, hole: h.hole + 9 })),
];

export const COURSES: Course[] = [
  {
    id: 'webster-dudley',
    name: 'Webster Dudley',
    // 18 is played as the nine twice (scorecard-confirmed); front = holes 1-9.
    fullName: 'Webster / Dudley GC (9 twice = 18)',
    rating: '',
    slope: '',
    par: 72,
    totalYards: 6004,
    holes: WEBSTER_DUDLEY_HOLES,
  },
  {
    id: 'spessard-holland',
    name: 'Spessard Holland',
    fullName: 'Spessard Holland Golf Course — Melbourne Beach',
    rating: '62.2',
    slope: '113',
    par: 67,
    totalYards: 4233,
    holes: SPESSARD_HOLLAND_HOLES,
  },
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
  // 2026-05-28 — Westlake Country Club, Jackson NJ. Tim's first East
  // Coast capture. Per-hole par/distance from the Green Maps headers
  // in each bundled screenshot; tee/green coords resolved at runtime
  // from golfcourseapi (offline pre-round uses bundled distances only).
  // Rating/slope blanks until Tim confirms from a scorecard on site.
  {
    id: 'westlake-cc-nj',
    name: 'Westlake Country Club',
    fullName: 'Westlake Country Club — Jackson, NJ',
    rating: '',
    slope: '',
    par: 71,
    totalYards: 6251, // sum of distance column (par 71)
    holes: WESTLAKE_NJ_HOLES,
  },
  // Greenhill Golf Course — 18-hole par 71, 5,896y whites.
  // Yardages from GolfShot aerials bundled in assets/courses/greenhill/.
  // Par estimated from distance (confirm handicap indices on next visit).
  {
    id: 'greenhill',
    name: 'Green Hill',
    fullName: 'Green Hill Golf Course',
    rating: '',
    slope: '',
    par: 71,
    totalYards: 5896,
    holes: GREENHILL_HOLES,
  },
  // 2026-06-04 — Echo Hills Golf Course, Hemet CA. 9-hole executive
  // par 35 in Tim's local rotation. Per-hole par/distance from Golfshot
  // Green Center captures (IMG 7635-7643). Coords zero — golfcourseapi
  // resolves runtime geometry; bundled screenshots drive SmartVision.
  {
    id: 'echo-hills',
    name: 'Echo Hills',
    fullName: 'Echo Hills Golf Course — Hemet, CA',
    rating: '',
    slope: '',
    par: 35,
    totalYards: 2196, // sum of distance column (9 holes)
    holes: ECHO_HILLS_HOLES,
  },
];
