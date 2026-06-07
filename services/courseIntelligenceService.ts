/**
 * 2026-06-06 — Phase 2.5: client wrapper for /api/course-intelligence.
 *
 * Fetches a 2-3 sentence web-search-grounded brief about a course at
 * round start. Caches per-course in AsyncStorage with a 30-day TTL.
 * Returns null on any failure so callers never have to handle errors
 * — null means "no extra context, fall through to baseline behavior."
 *
 * Wired by services/roundPrefetch.ts alongside fetchCourseGeometry +
 * fetchCourseContent so all three caches warm at the same moment the
 * user starts a round.
 *
 * Consumed by hooks/useVoiceCaddie.ts — the courseIntelligenceRef
 * mirrors courseContextRef and gets included in /api/kevin request
 * bodies as `courseIntelligence`. Brain (api/kevin.ts) renders the
 * field into the system prompt when present.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY_PREFIX = 'smartplay.courseIntel.v1.';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type CourseIntelCache = {
  intelligence: string | null;
  cached_at: number;
};

export type CourseIntelligenceInput = {
  courseId: string;
  courseName: string;
  location?: string;
  apiUrl?: string;
};

export type CourseIntelligenceResult = {
  intelligence: string | null;
  source: 'cache_fresh' | 'cache_stale_returned' | 'fresh' | 'error';
  cached_at: number;
};

function cacheKey(courseId: string): string {
  return CACHE_KEY_PREFIX + courseId;
}

async function readCache(courseId: string): Promise<CourseIntelCache | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(courseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CourseIntelCache;
    if (typeof parsed.cached_at !== 'number') return null;
    return parsed;
  } catch (e) {
    console.log('[courseIntel] cache read failed (non-fatal):', e);
    return null;
  }
}

async function writeCache(courseId: string, entry: CourseIntelCache): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(courseId), JSON.stringify(entry));
  } catch (e) {
    console.log('[courseIntel] cache write failed (non-fatal):', e);
  }
}

/**
 * Synchronous read of the cached intelligence for a given course. Used by
 * the brain-call context builder to attach intelligence to every /api/kevin
 * request without paying the AsyncStorage round-trip per turn. Returns null
 * when no cache exists OR when the cache is older than CACHE_TTL_MS — stale
 * cache is treated as missing for the SYNC consumer to keep the brain from
 * referencing month-old web-search results as live truth.
 *
 * Backed by an in-memory mirror populated by fetchCourseIntelligence on the
 * round-prefetch path. Direct AsyncStorage callers should use the async
 * fetchCourseIntelligence below.
 */
const memoryMirror = new Map<string, CourseIntelCache>();

export function getCachedCourseIntelligenceSync(courseId: string): string | null {
  if (!courseId) return null;
  const m = memoryMirror.get(courseId);
  if (!m) return null;
  if (Date.now() - m.cached_at > CACHE_TTL_MS) return null;
  return m.intelligence;
}

/**
 * Fetch (or return cached) course intelligence for a course. Fire-and-
 * forget safe — never throws. Updates the in-memory mirror so the sync
 * accessor sees the value on subsequent calls.
 */
export async function fetchCourseIntelligence(
  input: CourseIntelligenceInput,
): Promise<CourseIntelligenceResult> {
  const { courseId, courseName, location } = input;
  const apiUrl = input.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!courseId || !courseName) {
    return { intelligence: null, source: 'error', cached_at: Date.now() };
  }
  // 2026-06-06 — apiUrl safety: empty string would build a relative
  // URL that throws "Network request failed" in RN. Skip the fetch
  // entirely (returning cache if present) instead of failing silently.
  if (!apiUrl) {
    console.log('[courseIntel] no apiUrl — skipping fetch, returning cache only');
    const cached = await readCache(courseId);
    if (cached) {
      memoryMirror.set(courseId, cached);
      return { intelligence: cached.intelligence, source: 'cache_stale_returned', cached_at: cached.cached_at };
    }
    return { intelligence: null, source: 'error', cached_at: Date.now() };
  }
  // Prefer fresh cache
  const cached = await readCache(courseId);
  if (cached && Date.now() - cached.cached_at < CACHE_TTL_MS) {
    memoryMirror.set(courseId, cached);
    return { intelligence: cached.intelligence, source: 'cache_fresh', cached_at: cached.cached_at };
  }

  // Cache miss or stale — fetch fresh
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    const res = await fetch(apiUrl + '/api/course-intelligence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, courseName, location: location ?? '' }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.log('[courseIntel] fetch HTTP', res.status);
      // Stale cache is better than nothing — return it if we have it.
      if (cached) {
        memoryMirror.set(courseId, cached);
        return { intelligence: cached.intelligence, source: 'cache_stale_returned', cached_at: cached.cached_at };
      }
      return { intelligence: null, source: 'error', cached_at: Date.now() };
    }
    const data = (await res.json()) as { intelligence?: string | null; source?: string };
    // 2026-06-06 — Don't poison cache when the server returned its
    // 200-with-error fallback (Anthropic failure / quota etc.). Also
    // belt-and-suspenders catch literal 'UNKNOWN' from an older
    // deployed instance that didn't normalize server-side.
    const rawIntel = typeof data.intelligence === 'string' ? data.intelligence.trim() : '';
    const isServerError = data.source === 'error';
    const isUnknownSentinel = /^unknown$/i.test(rawIntel);
    if (isServerError || isUnknownSentinel) {
      console.log('[courseIntel] skip cache write — server error or UNKNOWN sentinel');
      if (cached) {
        memoryMirror.set(courseId, cached);
        return { intelligence: cached.intelligence, source: 'cache_stale_returned', cached_at: cached.cached_at };
      }
      return { intelligence: null, source: 'error', cached_at: Date.now() };
    }
    const entry: CourseIntelCache = {
      intelligence: rawIntel.length > 0 ? rawIntel : null,
      cached_at: Date.now(),
    };
    await writeCache(courseId, entry);
    memoryMirror.set(courseId, entry);
    return { intelligence: entry.intelligence, source: 'fresh', cached_at: entry.cached_at };
  } catch (e) {
    console.log('[courseIntel] fetch failed (non-fatal):', e instanceof Error ? e.message : String(e));
    if (cached) {
      memoryMirror.set(courseId, cached);
      return { intelligence: cached.intelligence, source: 'cache_stale_returned', cached_at: cached.cached_at };
    }
    return { intelligence: null, source: 'error', cached_at: Date.now() };
  }
}

/**
 * 2026-06-06 — Cold-start seeder. Reads any persisted cache for
 * courseId into the in-memory mirror so getCachedCourseIntelligenceSync
 * works on app cold-launch mid-round (process killed + relaunched)
 * without waiting for the next prefetch. Called by roundStore on
 * persist-rehydrate for the active courseId.
 */
export async function warmCourseIntelligenceMirror(courseId: string | null | undefined): Promise<void> {
  if (!courseId) return;
  const cached = await readCache(courseId);
  if (cached && Date.now() - cached.cached_at < CACHE_TTL_MS) {
    memoryMirror.set(courseId, cached);
  }
}
