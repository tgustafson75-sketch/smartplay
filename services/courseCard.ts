/**
 * 2026-09-23 (Tim) — "We shouldn't have old bundled courses. Unify the pipeline and make sure it works
 * perfectly." Answer to his follow-up: the surveyed data stays, as VERIFIED data inside the one pipeline.
 *
 * ONE answer to "what is this course" — holes, pars, yardages, rating/slope, location — for every kind
 * of course id the app holds:
 *   - `local:<slug>`  a SURVEYED course: its hand-verified card (tee checks applied by getBundledHoles).
 *                      A slug with no surveyed card (the marquee rows) resolves to its database record.
 *   - `custom:<id>`   a course the player built from a scorecard photo.
 *   - anything else   a golfcourseapi course: its card, on the player's tee.
 *
 * Before this, Play, round start, Course Detail, the download engine and the layout verifier each had
 * their own `local:` branch and their own idea of a course. Ids are unchanged on purpose: saved rounds,
 * home courses, overrides and caches keyed by them keep working with no migration.
 */
import type { CourseHole } from '../store/roundStore';
import { isValidGolfCoord } from '../utils/coordGuard';

export type CourseCard = {
  courseId: string;
  name: string;
  holes: CourseHole[];
  rating: number | null;
  slope: number | null;
  location: { lat: number; lng: number } | null;
  source: 'surveyed' | 'custom' | 'database';
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Mean of the surveyed tee/green points — the course's own centre, never a name guess. */
function centreOf(holes: CourseHole[]): { lat: number; lng: number } | null {
  const pts: { lat: number; lng: number }[] = [];
  for (const h of holes) {
    if (isValidGolfCoord(h.middleLat, h.middleLng)) pts.push({ lat: h.middleLat, lng: h.middleLng });
    if (isValidGolfCoord(h.teeLat, h.teeLng)) pts.push({ lat: h.teeLat, lng: h.teeLng });
  }
  if (!pts.length) return null;
  return { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length };
}

const normName = (s: string) =>
  (s ?? '').toLowerCase().replace(/\b(golf|course|club|country|the|and|&|cc|gc|g\.c\.)\b/g, '').replace(/[^a-z0-9]/g, '').trim();

/**
 * The surveyed course a NAME means: an exact normalised match, or a close one of similar length (a
 * short surveyed name like "Lakes" must not claim "Twin Lakes"). ONE answer — two candidates is null.
 */
export function surveyedByName(name: string): string | null {
  const key = normName(name);
  if (key.length < 3) return null;
  const { COURSES } = require('../data/courses') as typeof import('../data/courses');
  const exact = COURSES.filter((c) => normName(c.name) === key || normName(c.fullName) === key);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;
  const close = COURSES.filter((c) => {
    const cn = normName(c.name);
    if (!(key.length >= 5 && cn.length >= 5)) return false;
    if (!(cn.includes(key) || key.includes(cn))) return false;
    return Math.min(cn.length, key.length) / Math.max(cn.length, key.length) >= 0.7;
  });
  return close.length === 1 ? close[0].id : null;
}

/**
 * Downloads written before 2026-09-23 stored a surveyed course under its BARE slug ('palms'). The
 * one id for a surveyed course is `local:<slug>`; every reader of stored ids goes through this.
 */
export function canonicalCourseId(id: string): string {
  if (!id || id.includes(':')) return id;
  const { COURSES } = require('../data/courses') as typeof import('../data/courses');
  return COURSES.some((c) => c.id === id) ? `local:${id}` : id;
}

/** Further apart than this, a name match is a namesake, not the same course. */
const TWIN_MAX_KM = 8;

/**
 * 2026-09-23 — VERIFIED CORRECTIONS. A database course that IS one of the surveyed courses: its name
 * means exactly one surveyed course AND, when both are placed, they are within TWIN_MAX_KM. Returns
 * the `local:` id whose surveyed card (real tee/green coordinates, checked tees) should be used.
 *
 * Replaces round start's own by-name override, which fuzzy-matched a name with no location check and
 * ran only at round start — so the Play card, SmartVision and the download engine all used the
 * database record while the round used the survey.
 */
export function surveyedTwinOf(course: {
  club_name?: string | null; course_name?: string | null;
  location?: { latitude?: number | null; longitude?: number | null } | null;
}): string | null {
  // Placed or nothing: a name alone is a namesake until the two are shown to be in the same place.
  const lat = course.location?.latitude, lng = course.location?.longitude;
  if (!isValidGolfCoord(lat, lng)) return null;
  const club = (course.club_name ?? '').trim(), layout = (course.course_name ?? '').trim();
  // The LAYOUT decides at a multi-course club: "Hermitage — General's Retreat" must not be claimed
  // by the surveyed President's Reserve because the club name matches. The club name alone counts
  // only when the record names no separate layout.
  const layoutIsClub = !layout || normName(layout) === normName(club) || normName(club).includes(normName(layout));
  const candidates = [`${club} ${layout}`.trim(), layout, ...(layoutIsClub ? [club] : [])].filter(Boolean);
  let slug: string | null = null;
  for (const n of candidates) { slug = surveyedByName(n); if (slug) break; }
  if (!slug) return null;
  const { getBundledHoles, getBundledCourseCentroid } = require('../data/courses') as typeof import('../data/courses');
  if (!getBundledHoles(`local:${slug}`).some((h) => isValidGolfCoord(h.middleLat, h.middleLng))) return null;
  const here = getBundledCourseCentroid(slug);
  if (!here || haversineKm(lat as number, lng as number, here.lat, here.lng) > TWIN_MAX_KM) return null;
  return `local:${slug}`;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * The course card. `network: false` answers only from what is on this device (bundled data, the
 * custom store, the database card cache) — for callers that must not add a request.
 */
export async function loadCourseCard(courseId: string, opts: { network?: boolean; name?: string } = {}): Promise<CourseCard | null> {
  if (!courseId) return null;
  const network = opts.network !== false;

  if (courseId.startsWith('local:') || courseId.startsWith('custom:')) {
    const { COURSES, getBundledHoles, getBundledCourseCentroid } = require('../data/courses') as typeof import('../data/courses');
    const holes = getBundledHoles(courseId);
    if (courseId.startsWith('custom:')) {
      const cc = (require('../store/customCourseStore') as typeof import('../store/customCourseStore'))
        .useCustomCourseStore.getState().getCustomCourse(courseId);
      if (!cc) return null;
      return { courseId, name: cc.name, holes, rating: null, slope: null, location: centreOf(holes), source: 'custom' };
    }
    const slug = courseId.slice('local:'.length);
    const surveyed = COURSES.find((c) => c.id === slug);
    if (surveyed && holes.length) {
      return {
        courseId,
        name: surveyed.name,
        holes,
        rating: num(surveyed.rating),
        slope: num(surveyed.slope),
        location: getBundledCourseCentroid(slug) ?? centreOf(holes),
        source: 'surveyed',
      };
    }
    // A slug with no surveyed card (the marquee rows): its verified database id, when there is one.
    const geo = require('./courseGeometryService') as typeof import('./courseGeometryService');
    const apiId = await geo.resolveLocalCourseId(slug).catch(() => null);
    if (!apiId) return null;
    // ONE id per course: a slug with no survey IS its database course, so the card carries the
    // database id — or the same course is owned, listed and built twice under two ids.
    return loadDatabaseCard(apiId, network);
  }

  return loadDatabaseCard(courseId, network);
}

async function loadDatabaseCard(apiId: string, network: boolean): Promise<CourseCard | null> {
  return (await readDatabaseCard(apiId, network)).card;
}

/**
 * The database card for an id, and whether the record EXISTS with nothing to play (no tees/holes) —
 * which is an answer about that course ("not playable"), unlike a record that did not come back.
 * The download engine needs the difference and must not pay a second request to learn it.
 */
export async function readDatabaseCard(apiId: string, network = true): Promise<{ card: CourseCard | null; emptyRecord: boolean }> {
  const api = require('./golfCourseApi') as typeof import('./golfCourseApi');
  const course = network ? await api.getCourse(apiId) : await api.peekCachedCourse(apiId);
  if (!course) return { card: null, emptyRecord: false };
  // A surveyed course first: its verified card stands even when the database record is empty.
  const twin = surveyedTwinOf(course);
  if (twin) {
    const surveyed = await loadCourseCard(twin, { network: false });
    if (surveyed?.holes.length) return { card: surveyed, emptyRecord: false };
  }
  if (!course.tees?.length || api.courseToHoles(course).length === 0) return { card: null, emptyRecord: true };
  return { card: await cardFromCourse(apiId, course), emptyRecord: false };
}

async function cardFromCourse(apiId: string, course: import('../types/course').Course): Promise<CourseCard | null> {
  const api = require('./golfCourseApi') as typeof import('./golfCourseApi');
  const holes = api.courseToHoles(course);
  if (!holes.length) return null;
  const { playerTee } = require('./teeSelection') as typeof import('./teeSelection');
  const { courseDisplayLabel } = require('../data/courseComplexes') as typeof import('../data/courseComplexes');
  const tee = playerTee(course) ?? course.tees[0];
  const lat = course.location?.latitude, lng = course.location?.longitude;
  return {
    courseId: apiId,
    name: courseDisplayLabel(course.club_name, course.course_name),
    holes,
    rating: num(tee?.course_rating),
    slope: num(tee?.slope_rating),
    location: isValidGolfCoord(lat, lng) ? { lat: lat as number, lng: lng as number } : null,
    source: 'database',
  };
}
