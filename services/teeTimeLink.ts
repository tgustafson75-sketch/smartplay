/**
 * Tee Time link helper.
 *
 * Replaces the v1.0 hard-coded GolfNow URL with a Google search query
 * that surfaces the course's actual booking options — official course
 * website, GolfNow, EZLinks, Chronogolf, GolfPass, or whatever aggregator
 * the course actually uses. Works globally for any course without any
 * API key or per-course configuration.
 *
 * Strategy: a well-formed Google search query like
 *   "Pebble Beach Golf Links Pebble Beach CA book tee time"
 * reliably surfaces the course's official booking page in the first 1-2
 * results, with the course's Google Maps card on the right showing
 * phone + website. The user picks the best option from there.
 *
 * Falls back to Google Maps when the user prefers a map-first view.
 */

import { Linking } from 'react-native';

/**
 * Hand-curated direct-booking URLs for courses we know operate on a
 * specific tee-time platform (foreUP, Chronogolf, GolfNow per-course
 * deep links, etc). Match is case-insensitive substring on club_name.
 *
 * Sourced from each course's own website. When a course isn't in this
 * map, we fall back to a Google search that reliably surfaces the
 * official booking page in the top result.
 *
 * To add a course: drop a new entry — match string is checked against
 * the lower-cased club_name.includes(matchKey).
 */
const DIRECT_BOOKING_URLS: { matchKey: string; url: string; label?: string }[] = [
  // Tim's home rotation
  { matchKey: 'menifee lakes', url: 'https://foreupsoftware.com/index.php/booking/index/19103#/teetimes', label: 'Menifee Lakes (foreUP)' },
  { matchKey: 'rancho california', url: 'https://www.ranchocaliforniagolfclub.com/tee-times', label: 'Rancho California GC' },
];

function findDirectBookingUrl(courseName: string): string | null {
  const lc = courseName.trim().toLowerCase();
  for (const entry of DIRECT_BOOKING_URLS) {
    if (lc.includes(entry.matchKey)) return entry.url;
  }
  return null;
}

/**
 * Open the course's tee-time booking flow. Strategy:
 *   1. The course book's anchored website/booking URL (from Google Places,
 *      step 3) — the course's OWN site where its booking widget lives.
 *   2. A curated direct-booking URL for this course.
 *   3. Google search crafted to put the official booking page at the top.
 */
export async function openTeeTimeSearch(courseName: string, locationHint?: string | null, courseId?: string | null): Promise<void> {
  // 1. Course book (Places-anchored) — the real site, if we've looked it up.
  if (courseId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mem = require('../store/caddieMemoryStore') as typeof import('../store/caddieMemoryStore');
      const book = mem.useCaddieMemoryStore.getState().getCourseBook(courseId);
      const url = book?.bookingUrl ?? book?.website ?? null;
      if (url) {
        console.log('[teeTimeLink] course-book site →', url);
        await Linking.openURL(url);
        return;
      }
    } catch (e) {
      console.log('[teeTimeLink] course-book lookup failed, continuing:', e);
    }
  }
  const direct = findDirectBookingUrl(courseName);
  if (direct) {
    try {
      console.log('[teeTimeLink] direct →', direct);
      await Linking.openURL(direct);
      return;
    } catch (e) {
      console.log('[teeTimeLink] direct openURL failed, falling back to search:', e);
    }
  }
  const parts = [courseName.trim()];
  if (locationHint && locationHint.trim()) parts.push(locationHint.trim());
  parts.push('book tee time online');
  const q = encodeURIComponent(parts.join(' '));
  const url = `https://www.google.com/search?q=${q}`;
  try {
    await Linking.openURL(url);
  } catch (e) {
    console.log('[teeTimeLink] openURL failed:', e);
  }
}

/** Open the course's Google Maps listing — surfaces website + phone + reviews. */
export async function openCourseInMaps(courseName: string, locationHint?: string | null): Promise<void> {
  const parts = [courseName.trim()];
  if (locationHint && locationHint.trim()) parts.push(locationHint.trim());
  const q = encodeURIComponent(parts.join(' '));
  const url = `https://www.google.com/maps/search/?api=1&query=${q}`;
  try {
    await Linking.openURL(url);
  } catch (e) {
    console.log('[teeTimeLink] maps openURL failed:', e);
  }
}
