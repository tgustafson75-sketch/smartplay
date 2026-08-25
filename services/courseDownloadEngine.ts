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

/** Why discovery came back empty. `null` = it genuinely succeeded and there are no courses nearby. */
export type LocateFailure = 'bad_input' | 'timeout' | 'http' | 'network' | null;

export interface LocateResult {
  courses: NearbyCourse[];
  /** null when the call SUCCEEDED. Non-null means we do not know what is nearby. */
  failure: LocateFailure;
}

/**
 * GPS → the golf courses at/near this location (nearest first).
 *
 * 2026-08-19 (Tim, from a round: "when I went for the local course engine — course discovery, it
 * didn't load, and that's bullshit… no more superficial fixes, root cause only").
 *
 * ROOT CAUSE: this returned a bare `NearbyCourse[]` and `[]` on EVERY failure — bad input, non-2xx,
 * timeout, and any thrown error, all silently. So "the network dropped for nine seconds on a course
 * with one bar" produced exactly the same value as "there are genuinely no golf courses near you",
 * and the caller could not tell them apart: it does `if (!near.length) return;` and the section
 * simply never appears. Nothing was logged either, so the failure left no trace anywhere. That is why
 * it read as "it didn't load" with nothing to point at.
 *
 * The endpoint itself is healthy (verified live against the Berlin coordinates — it returns real
 * courses). The defect was entirely in how this function reports not getting an answer.
 *
 * THREE THINGS, none of them cosmetic:
 *   1. The result now DISTINGUISHES failure from empty, so a caller can say the true thing instead of
 *      rendering silence that means two opposite things.
 *   2. ONE retry on a transient failure (timeout / network). This is the same cold-start class as the
 *      voice first turn: the first request pays the cold Lambda and the second lands on a warm one.
 *      Not retried for `http` (the server answered — retrying an answer is just noise) or bad input.
 *   3. Every failure is LOGGED with its reason, so the next round says which of these fires in the
 *      field rather than leaving it to be reasoned about.
 */
export async function locateNearbyCourses(
  lat: number,
  lng: number,
  opts?: { radiusM?: number; limit?: number },
): Promise<LocateResult> {
  const base = getApiBaseUrl();
  if (!base || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    logLocate('course_locate_bad_input', { hasBase: !!base, lat, lng });
    return { courses: [], failure: 'bad_input' };
  }

  /**
   * 2026-08-25 (Tim, mid-round at Berlin, 11:52) — course_locate_failed · timeout, twice, at coords
   * where the server answers in 0.9s. The server was fine; his PHONE could not reach it. That is
   * the normal condition on a golf course, which is the one place this call has to work.
   *
   * REMEMBER WHAT WE ALREADY FOUND. There was no cache and no offline fallback, so a course the app
   * had located successfully yesterday was unreachable today the moment the signal dropped — it
   * asked the network the same question again and waited 9 seconds, twice, to be told nothing.
   *
   * Keyed by coarse position (~1km), because "which courses are near me" does not change between
   * two points on the same property. Served ONLY when the live call fails, so a working network
   * always wins and a stale list can never mask a real answer.
   */
  const cacheKey = `course_locate_v1:${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const readCache = async (): Promise<NearbyCourse[] | null> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AS = (require('@react-native-async-storage/async-storage') as { default: typeof import('@react-native-async-storage/async-storage').default }).default;
      const raw = await AS.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { courses?: NearbyCourse[] };
      return Array.isArray(parsed.courses) && parsed.courses.length > 0 ? parsed.courses : null;
    } catch { return null; }
  };
  const writeCache = async (courses: NearbyCourse[]): Promise<void> => {
    try {
      if (courses.length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AS = (require('@react-native-async-storage/async-storage') as { default: typeof import('@react-native-async-storage/async-storage').default }).default;
      await AS.setItem(cacheKey, JSON.stringify({ courses, at: Date.now() }));
    } catch { /* caching never breaks a working lookup */ }
  };

  const attempt = async (): Promise<LocateResult> => {
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/api/course-locate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, radius_m: opts?.radiusM, limit: opts?.limit }),
        signal: AbortSignal.timeout(9_000),
      });
      if (!res.ok) return { courses: [], failure: 'http' };
      const data = (await res.json()) as { courses?: NearbyCourse[] };
      return { courses: Array.isArray(data.courses) ? data.courses : [], failure: null };
    } catch (e) {
      // AbortSignal.timeout throws a TimeoutError; everything else is a transport failure.
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return { courses: [], failure: timedOut ? 'timeout' : 'network' };
    }
  };

  let out = await attempt();
  if (out.failure === 'timeout' || out.failure === 'network') {
    logLocate('course_locate_retry', { first_failure: out.failure });
    out = await attempt();
  }
  if (!out.failure) {
    void writeCache(out.courses);
    return out;
  }

  // The network could not answer. Fall back to what this spot returned last time rather than
  // handing the player nothing on the first tee.
  const cached = await readCache();
  if (cached) {
    logLocate('course_locate_served_from_cache', { reason: out.failure, count: cached.length });
    return { courses: cached, failure: null };
  }

  logLocate('course_locate_failed', { reason: out.failure, lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 });
  return out;
}

/** Best-effort issue-log breadcrumb — discovery failures were previously invisible. Never throws. */
function logLocate(stage: string, details: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../store/issueLogStore').useIssueLogStore.getState()
      .addAppEvent(stage, details, stage === 'course_locate_retry' ? 'diag' : 'analysis_error');
  } catch { /* best-effort */ }
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
      // 2026-08-06 (audit cycle 5, #3b) — a loose substring match false-positived: bundled "Lakes"/"Mines"
      // is a substring of located "Twin Lakes"/"Mines Road GC" → wrong course. Require the names be a
      // SIMILAR LENGTH (short-name ÷ long-name ≥ 0.7) on top of the ≥5 gates, so a genuinely different,
      // longer located name can't be claimed by a short bundled fragment. A real near-match (norm strips
      // golf/club/course/cc, so "Menifee Lakes CC" → "menifeelakes") still resolves via the exact check.
      if (!(key.length >= 5 && cn.length >= 5)) return false;
      if (!(cn.includes(key) || key.includes(cn))) return false;
      const ratio = Math.min(cn.length, key.length) / Math.max(cn.length, key.length);
      return ratio >= 0.7;
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
}): Promise<{ ok: boolean; courseId?: string; reason?: string; fresh?: boolean }> {
  // 2026-08-09 (stores audit P2) — `fresh` distinguishes an ACTUAL new download from an already-owned
  // course, so callers only toast "downloaded" when it truly happened (the arrival toast was claiming
  // a fresh download for courses owned for weeks).
  const store = useDownloadedCoursesStore.getState();
  if (input.courseId && store.isDownloaded(input.courseId)) return { ok: true, courseId: input.courseId, fresh: false };

  const resolved = await resolveCourse(input.name, input.courseId ?? null);
  if (!resolved) return { ok: false, reason: 'unresolved' };
  const { courseId, courseName, holes, rating, slope } = resolved;
  if (store.isDownloaded(courseId)) return { ok: true, courseId, fresh: false };

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
    return { ok: true, courseId, fresh: true };
  } catch (e) {
    store.clearDownloading(courseId);
    return { ok: false, courseId, reason: e instanceof Error ? e.message : 'prefetch_failed' };
  }
}

export function isCourseDownloaded(courseId: string | null | undefined): boolean {
  return useDownloadedCoursesStore.getState().isDownloaded(courseId);
}
