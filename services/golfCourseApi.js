/**
 * services/golfCourseApi.js
 *
 * Client-side helper that calls the local Expo API route proxy
 * (app/api/golfcourse+api.ts) which in turn calls api.golfcourseapi.com.
 *
 * Falls back to direct API call if the local proxy is unreachable.
 */

import { getApiBaseUrl } from '../utils/apiUrl';

const DIRECT_BASE = 'https://api.golfcourseapi.com';
const DIRECT_KEY  = process.env.EXPO_PUBLIC_GOLF_COURSE_API_KEY ?? '';
const TIMEOUT_MS  = 10_000;

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

/**
 * Search for courses by name or city.
 * Returns an array of GolfCourse objects.
 *
 * Throws a tagged Error when the GolfCourseAPI key is missing on both the
 * proxy and the client, so callers can surface a clear "configure API key"
 * message instead of an ambiguous "no results".
 */
export async function searchCourse(query) {
  if (!query || !query.trim()) return [];

  let proxyKeyMissing = false;

  // ── Try local proxy first ────────────────────────────────────────────────
  try {
    const base = getApiBaseUrl();
    const url  = `${base}/api/golfcourse?action=search&q=${encodeURIComponent(query.trim())}`;
    const res  = await fetchWithTimeout(url);
    if (res.ok) {
      const data = await res.json();
      const courses = data?.courses ?? (Array.isArray(data) ? data : []);
      // Trust the proxy when it returned 200 — even an empty list is real.
      return courses;
    }
    // 503 means the proxy is missing EXPO_PUBLIC_GOLF_COURSE_API_KEY.
    if (res.status === 503) proxyKeyMissing = true;
  } catch {
    // proxy unreachable — fall through to direct call
  }

  // ── Direct call fallback (requires API key on client) ────────────────────
  if (!DIRECT_KEY) {
    if (proxyKeyMissing) {
      const err = new Error('GolfCourseAPI key not configured');
      err.code = 'NO_API_KEY';
      throw err;
    }
    return [];
  }
  try {
    const url = `${DIRECT_BASE}/v1/search?search_query=${encodeURIComponent(query.trim())}`;
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Key ${DIRECT_KEY}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.courses ?? (Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}

/**
 * Get full course details by numeric ID.
 * Returns a single course object or null.
 */
export async function getCourse(id) {
  if (!id) return null;

  // ── Try local proxy first ────────────────────────────────────────────────
  try {
    const base = getApiBaseUrl();
    const url  = `${base}/api/golfcourse?action=course&id=${encodeURIComponent(id)}`;
    const res  = await fetchWithTimeout(url);
    if (res.ok) {
      const data = await res.json();
      if (!data?.error) return data;
    }
  } catch {
    // fall through
  }

  // ── Direct call fallback ─────────────────────────────────────────────────
  if (!DIRECT_KEY) return null;
  try {
    const url = `${DIRECT_BASE}/v1/courses/${encodeURIComponent(id)}`;
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Key ${DIRECT_KEY}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
