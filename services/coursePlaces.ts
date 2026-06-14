/**
 * 2026-06-14 (Tim — course book, step 3) — course METADATA lookup.
 *
 * The Golf Course API gives us a course's name + lat/lng but NO website,
 * phone, or booking link. This bridges that gap with Google Places: name +
 * coords → the course's official website + phone, which we anchor into the
 * CNS course book ([[course-book-cns]]).
 *
 * Why client-side (direct to Google, not via our Vercel API): it's one fewer
 * hop (Tim's "go straight through" instinct), it's OTA-shippable with no
 * deploy, and the Google Maps key is already in the bundle for Static Maps.
 * Third-party host, so it does NOT go through getApiBaseUrl() — same pattern
 * as mapboxImagery hitting api.mapbox.com directly.
 *
 * Honest + graceful: if Places isn't enabled on the key's project (status
 * REQUEST_DENIED) or returns nothing, we return null and the caller falls
 * back to the existing Google-search tee-time flow — no regression. Once
 * anchored, the website/phone live in the persisted book, so "Book Tee Time"
 * deep-links the real site and the phone is available to call OFFLINE.
 *
 * ACTIVATION (one console toggle, no code): enable "Places API" on the
 * Google Cloud project that owns EXPO_PUBLIC_GOOGLE_MAPS_KEY. Until then this
 * no-ops cleanly.
 */

import { useCaddieMemoryStore } from '../store/caddieMemoryStore';
import { isValidGolfCoord } from '../utils/coordGuard';

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';
const PLACES_TIMEOUT_MS = 8_000;

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
  if (!KEY || !input.courseId || !input.name?.trim()) return null;

  // Already known → don't re-query (the book is the cache).
  const existing = useCaddieMemoryStore.getState().getCourseBook(input.courseId);
  if (existing && (existing.website || existing.phone)) {
    return { website: existing.website, phone: existing.phone };
  }

  try {
    const bias = isValidGolfCoord(input.lat, input.lng)
      ? `&locationbias=point:${input.lat},${input.lng}`
      : '';
    const findUrl =
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
      `?input=${encodeURIComponent(input.name.trim())}&inputtype=textquery&fields=place_id${bias}&key=${KEY}`;
    const findRes = await fetch(findUrl, { signal: AbortSignal.timeout(PLACES_TIMEOUT_MS) });
    if (!findRes.ok) return null;
    const findData = (await findRes.json()) as { status?: string; candidates?: { place_id?: string }[] };
    if (findData.status === 'REQUEST_DENIED') {
      console.log('[coursePlaces] Places API not enabled on this key — skipping (booking falls back to search).');
      return null;
    }
    const placeId = findData.candidates?.[0]?.place_id;
    if (!placeId) return null;

    const detUrl =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${encodeURIComponent(placeId)}&fields=website,formatted_phone_number&key=${KEY}`;
    const detRes = await fetch(detUrl, { signal: AbortSignal.timeout(PLACES_TIMEOUT_MS) });
    if (!detRes.ok) return null;
    const detData = (await detRes.json()) as {
      status?: string;
      result?: { website?: string; formatted_phone_number?: string };
    };
    const website = detData.result?.website?.trim() || null;
    const phone = detData.result?.formatted_phone_number?.trim() || null;
    if (!website && !phone) return null;

    // Anchor into the course book — persisted, offline-available.
    useCaddieMemoryStore.getState().saveCourseBook({
      course_id: input.courseId,
      name: input.name.trim(),
      website,
      phone,
      // The official site is where the course's own booking widget lives; use it
      // as the booking target until/unless a course-specific deep link is known.
      bookingUrl: website,
      nowMs: Date.now(),
    });
    return { website, phone };
  } catch (e) {
    console.log('[coursePlaces] lookup failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return null;
  }
}
