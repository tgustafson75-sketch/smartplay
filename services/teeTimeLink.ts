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
 * Open Google search for tee-time booking. Crafted query maximises the
 * chance the official booking page is the top result.
 */
export async function openTeeTimeSearch(courseName: string, locationHint?: string | null): Promise<void> {
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
