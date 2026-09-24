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
    const card = await loadDatabaseCard(apiId, network);
    return card ? { ...card, courseId } : null;
  }

  return loadDatabaseCard(courseId, network);
}

async function loadDatabaseCard(apiId: string, network: boolean): Promise<CourseCard | null> {
  const api = require('./golfCourseApi') as typeof import('./golfCourseApi');
  const course = network ? await api.getCourse(apiId) : await api.peekCachedCourse(apiId);
  if (!course || !course.tees?.length) return null;
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
