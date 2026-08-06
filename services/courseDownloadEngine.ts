/**
 * services/courseDownloadEngine.ts — the COURSE DOWNLOAD ENGINE (2026-08-06, Tim — "build the course
 * download engine / future API; it may be my in with Arccos and Meta").
 *
 * Arccos-style flow: GPS-locate the player → identify the course they're at/near → DOWNLOAD that course's
 * full data on demand (geometry, content, intelligence, imagery) so it's instant + offline, without them
 * hunting a search box. Orchestrates the existing per-service fetchers (roundPrefetch) behind one call and
 * records availability in downloadedCoursesStore.
 *
 *   locateNearbyCourses(lat, lng)  → nearby courses (via /api/course-locate, Google Places golf_course)
 *   downloadCourse({...})          → resolve to real course data + run the prefetch chain + mark downloaded
 *   isCourseDownloaded(courseId)    → offline-availability check
 *
 * The locator is also the "future API": a partner (Arccos / Meta glasses) can POST a location to
 * /api/course-locate and get the courses there, using the same engine edge the app uses.
 */
import { getApiBaseUrl } from './apiBase';
import { prefetchRoundData } from './roundPrefetch';
import { searchCourses, getCourse, courseToHoles } from './golfCourseApi';
import { COURSES } from '../data/courses';
import { useDownloadedCoursesStore } from '../store/downloadedCoursesStore';
import type { CourseHole } from '../store/roundStore';

export interface NearbyCourse {
  name: string;
  place_id: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  vicinity: string | null;
  rating: number | null;
  open_now: boolean | null;
}

/** GPS → the golf courses at/near this location (nearest first). Best-effort; [] on any failure. */
export async function locateNearbyCourses(
  lat: number,
  lng: number,
  opts?: { radiusM?: number; limit?: number },
): Promise<NearbyCourse[]> {
  const base = getApiBaseUrl();
  if (!base || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/course-locate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, radius_m: opts?.radiusM, limit: opts?.limit }),
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { courses?: NearbyCourse[] };
    return Array.isArray(data.courses) ? data.courses : [];
  } catch {
    return [];
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\b(golf|course|club|country|the|and|&|cc|gc|g\.c\.)\b/g, '').replace(/[^a-z0-9]/g, '').trim();

/** Resolve a course NAME to real course data (id + holes): bundled catalog first (instant, offline), then
 *  golfcourseapi. Returns null when neither can resolve it. */
async function resolveCourse(name: string, explicitCourseId?: string | null): Promise<{ courseId: string; courseName: string; holes: CourseHole[]; rating?: string | number | null; slope?: string | number | null } | null> {
  // 1) Explicit id → bundled match.
  if (explicitCourseId) {
    const b = COURSES.find((c) => c.id === explicitCourseId);
    if (b && b.holes.length) return { courseId: b.id, courseName: b.name, holes: b.holes, rating: b.rating, slope: b.slope };
  }
  // 2) Bundled catalog by name (offline-first — a course we already ship is instant). 2026-08-06 (audit):
  // exact normalized match first; a substring match ONLY when BOTH names are reasonably long (>=5), so a
  // short bundled name (e.g. "Mines") can't claim every located course, and an empty-normalized name can
  // never match everything.
  const key = norm(name);
  if (key.length >= 3) {
    const b = COURSES.find((c) => {
      const cn = norm(c.name), cf = norm(c.fullName);
      if (!cn && !cf) return false;
      if (cn === key || cf === key) return true;
      return key.length >= 5 && cn.length >= 5 && (cn.includes(key) || key.includes(cn));
    });
    if (b && b.holes.length) return { courseId: b.id, courseName: b.name, holes: b.holes, rating: b.rating, slope: b.slope };
  }
  // 3) golfcourseapi search → getCourse → holes.
  try {
    const hits = await searchCourses(name);
    const first = hits?.[0];
    if (first?.id) {
      const full = await getCourse(String(first.id));
      if (full) {
        const holes = courseToHoles(full);
        if (holes.length) {
          const fullC = full as { club_name?: string; course_name?: string; rating?: string | number; slope?: string | number };
          return {
            courseId: String(first.id),
            courseName: fullC.club_name ?? fullC.course_name ?? name,
            holes,
            rating: fullC.rating ?? null,
            slope: fullC.slope ?? null,
          };
        }
      }
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Download a course on demand: resolve its data, run the full prefetch chain (geometry/content/
 * intelligence/imagery), and mark it downloaded. Idempotent — a already-downloaded course returns ok fast.
 */
export async function downloadCourse(input: {
  name: string;
  courseId?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ ok: boolean; courseId?: string; reason?: string }> {
  const store = useDownloadedCoursesStore.getState();
  if (input.courseId && store.isDownloaded(input.courseId)) return { ok: true, courseId: input.courseId };

  const resolved = await resolveCourse(input.name, input.courseId ?? null);
  if (!resolved) return { ok: false, reason: 'unresolved' };
  const { courseId, courseName, holes, rating, slope } = resolved;
  if (store.isDownloaded(courseId)) return { ok: true, courseId };

  store.markDownloading(courseId, courseName, 0.1);
  try {
    // prefetchRoundData fans out geometry + content + intelligence + imagery and caches each. It's
    // fire-and-forget by design (doesn't reject), so we await it and then record the course as available.
    await prefetchRoundData({
      courseId,
      courseName,
      courseLocation: (Number.isFinite(input.lat) && Number.isFinite(input.lng)) ? { lat: input.lat as number, lng: input.lng as number } : null,
      holes,
      rating: rating ?? null,
      slope: slope ?? null,
    });
    store.markDownloaded({ courseId, name: courseName, holeCount: holes.length, at: Date.now() });
    return { ok: true, courseId };
  } catch (e) {
    store.clearDownloading(courseId);
    return { ok: false, courseId, reason: e instanceof Error ? e.message : 'prefetch_failed' };
  }
}

export function isCourseDownloaded(courseId: string | null | undefined): boolean {
  return useDownloadedCoursesStore.getState().isDownloaded(courseId);
}
