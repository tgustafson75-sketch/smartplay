/**
 * 2026-06-14 (Tim — course book, step 3) — course METADATA lookup.
 *
 * The Golf Course API gives us a course's name + lat/lng but NO website,
 * phone, or booking link. This bridges that gap with Google Places: name +
 * coords → the course's official website + phone, which we anchor into the
 * CNS course book ([[course-book-cns]]).
 *
 * 2026-07-10 (audit S2) — now goes through OUR server (api/course-places) instead of
 * calling Google Places directly with a key shipped in the app bundle. The Google Maps key
 * lives ONLY server-side (GOOGLE_MAPS_KEY env var) and is never extractable from the client.
 * Same graceful behavior: any miss / Places-not-enabled → null, caller falls back to the
 * existing Google-search tee-time flow. Once anchored, website/phone live in the persisted
 * book (offline-available).
 */

import { useCaddieMemoryStore } from '../store/caddieMemoryStore';
import { isValidGolfCoord } from '../utils/coordGuard';
import { getApiBaseUrl } from './apiBase';

const PLACES_TIMEOUT_MS = 9_000;

export interface CoursePlaces {
  website: string | null;
  phone: string | null;
}

/**
 * Look up + anchor a course's website/phone into the course book. Best-effort,
 * never throws. Returns the metadata (or null when unavailable). Skips the
 * network entirely when the book already has the metadata (one lookup per course).
 */
export async function lookupCoursePlaces(input: {
  courseId: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<CoursePlaces | null> {
  if (!input.courseId || !input.name?.trim()) return null;

  // Already known → don't re-query (the book is the cache).
  const existing = useCaddieMemoryStore.getState().getCourseBook(input.courseId);
  // Only a book that already has the COORDINATES is complete enough to skip the lookup — an entry
  // saved before 2026-08-22 has a website and no location, and that is the case we are here for.
  if (existing && (existing.website || existing.phone) && existing.lat != null) {
    return { website: existing.website, phone: existing.phone };
  }

  const base = getApiBaseUrl();
  if (!base) return null;

  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/course-places`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name.trim(),
        lat: isValidGolfCoord(input.lat, input.lng) ? input.lat : undefined,
        lng: isValidGolfCoord(input.lat, input.lng) ? input.lng : undefined,
      }),
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { website?: string | null; phone?: string | null; lat?: number | null; lng?: number | null };
    const website = data.website?.trim() || null;
    const phone = data.phone?.trim() || null;
    const lat = typeof data.lat === 'number' ? data.lat : null;
    const lng = typeof data.lng === 'number' ? data.lng : null;
    // 2026-08-22 — coordinates alone are worth saving. The course API has none for ANY course, so
    // this is often the only anchor the geometry build will get before the player arrives, and
    // bailing here because a course has no website threw it away.
    if (!website && !phone && lat == null) return null;

    // Anchor into the course book — persisted, offline-available.
    useCaddieMemoryStore.getState().saveCourseBook({
      course_id: input.courseId,
      name: input.name.trim(),
      website,
      phone,
      // The official site is where the course's own booking widget lives; use it
      // as the booking target until/unless a course-specific deep link is known.
      bookingUrl: website,
      lat,
      lng,
      nowMs: Date.now(),
    });
    return { website, phone };
  } catch (e) {
    console.log('[coursePlaces] lookup failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return null;
  }
}
