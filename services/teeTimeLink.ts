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

import { Alert, Linking } from 'react-native';
import { normalizeRateCategory, rateCategoryPhrase, type RateCategory } from '../lib/rateCategory';

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

/**
 * 2026-09-29 (Tim — "I still use GolfNow only for tee times") — THE PRO SHOP, AND WHAT TO SAY TO IT.
 *
 * There is no consumer tee-time booking API to call, so SmartPlay does not pretend to book. It hands
 * off honestly: the course's own booking page (above), and — the half that was fetched, saved and
 * never shown — the pro-shop phone number Google Places already gave us (api/course-places →
 * services/coursePlaces → caddieMemoryStore.courseBook[id].phone), with a one-line script of what to
 * ask for. The rate is the player's own declaration; the course verifies it.
 */

/** The pro-shop number the course book holds for this course, or null. Never throws. */
export function getProShopPhone(courseId: string | null | undefined): string | null {
  if (!courseId) return null;
  try {
    const mem = require('../store/caddieMemoryStore') as typeof import('../store/caddieMemoryStore');
    const phone = mem.useCaddieMemoryStore.getState().getCourseBook(courseId)?.phone ?? null;
    return phone && phone.trim() ? phone.trim() : null;
  } catch {
    return null;
  }
}

/** A dialable tel: URL — digits and one leading + only — or null when too little is left to dial. */
export function telUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.trim().replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : null;
}

/** Open the dialer on the pro shop. Resolves false when there was nothing to dial or the OS refused. */
export async function callProShop(phone: string | null | undefined): Promise<boolean> {
  const url = telUrl(phone);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch (e) {
    console.log('[teeTimeLink] tel openURL failed:', e);
    return false;
  }
}

export type TeeTimeRequest = {
  date?: string | null;
  timeWindow?: string | null;
  players?: number | null;
  transport?: 'walking' | 'riding' | null;
  rateCategory?: RateCategory | string | null;
};

/**
 * The call script — "Saturday around 8am, 2 players, walking, veteran/military rate". Only what the
 * player actually said, in the order a pro shop asks for it. Empty when there is nothing to say.
 */
export function buildTeeTimeCallScript(req: TeeTimeRequest): string {
  const when = [req.date, req.timeWindow]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .join(' ');
  const n = typeof req.players === 'number' && Number.isFinite(req.players) ? Math.round(req.players) : null;
  const players = n != null && n >= 1 && n <= 8 ? `${n} player${n === 1 ? '' : 's'}` : null;
  const transport = req.transport === 'walking' || req.transport === 'riding' ? req.transport : null;
  return [when || null, players, transport, rateCategoryPhrase(req.rateCategory)].filter(Boolean).join(', ');
}

/** The player's saved rate category, or 'none'. */
function profileRateCategory(): RateCategory {
  try {
    const p = (require('../store/playerProfileStore') as typeof import('../store/playerProfileStore')).usePlayerProfileStore.getState();
    return normalizeRateCategory(p.rateCategory);
  } catch {
    return 'none';
  }
}

const normCourseName = (s: string) =>
  s.toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(?:the|golf|country|club|course|links|gc|cc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Which course the player means, by the name they said. The course book is the only place a pro-shop
 * number lives, so an entry there wins; the round's own course breaks a tie, then the most recently
 * saved entry. A home course supplies an id when the book has nothing. Unmatched → the name alone,
 * which still gets a booking search.
 */
export function resolveTeeTimeCourse(spoken: string): { name: string; courseId: string | null } {
  const name = spoken.trim();
  const want = normCourseName(name);
  if (!want) return { name, courseId: null };
  const matches = (candidate: string | null | undefined) => {
    const have = normCourseName(candidate ?? '');
    return !!have && (have.includes(want) || want.includes(have));
  };
  try {
    const mem = require('../store/caddieMemoryStore') as typeof import('../store/caddieMemoryStore');
    const hits = Object.values(mem.useCaddieMemoryStore.getState().courseBook ?? {}).filter((e) => e && matches(e.name));
    if (hits.length > 0) {
      let activeId: string | null = null;
      try {
        activeId = (require('../store/roundStore') as typeof import('../store/roundStore')).useRoundStore.getState().activeCourseId ?? null;
      } catch { /* no round store — recency decides */ }
      const pick = hits.find((e) => e.course_id === activeId)
        ?? [...hits].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0];
      return { name: pick.name?.trim() || name, courseId: pick.course_id };
    }
  } catch { /* book unavailable — try the home courses */ }
  try {
    const p = (require('../store/playerProfileStore') as typeof import('../store/playerProfileStore')).usePlayerProfileStore.getState();
    const home = (p.homeCourses ?? []).find((h) => !!h.id && matches(h.name));
    if (home) return { name: home.name, courseId: home.id };
  } catch { /* profile unavailable */ }
  return { name, courseId: null };
}

/** The find_tee_time tool's payload, as the brain sends it (api/_brainTools). */
export type FindTeeTimeAction = {
  course?: string;
  date?: string;
  time_window?: string;
  players?: number;
  rate_category?: string;
  transport?: string;
};

/**
 * THE find_tee_time TOOL — one implementation for both client dispatchers (the hands-free
 * conversationalToolDispatch and the Caddie tab's handleToolAction), so the two cannot drift.
 *
 * Opens the course's booking page through openTeeTimeSearch (course-book site → curated link →
 * search) — the brain has already told the player that is what happens — and then, only when a
 * pro-shop number is on file, offers the call with the script to read. A rate the player did not name
 * this turn comes from their profile. Nothing here claims a booking.
 */
export async function runFindTeeTime(a: FindTeeTimeAction): Promise<{ courseId: string | null; phone: string | null; script: string } | null> {
  const spoken = typeof a.course === 'string' ? a.course.trim() : '';
  if (!spoken) return null;
  const { name, courseId } = resolveTeeTimeCourse(spoken);
  // A rate named this turn wins. 'none' from the model is read as "not named" — models fill enums with
  // their first value, and that must not silently drop the veteran rate the profile says to ask for.
  const named = normalizeRateCategory(a.rate_category);
  const rate = named !== 'none' ? named : profileRateCategory();
  const script = buildTeeTimeCallScript({
    date: a.date ?? null,
    timeWindow: a.time_window ?? null,
    players: typeof a.players === 'number' ? a.players : null,
    transport: a.transport === 'walking' || a.transport === 'riding' ? a.transport : null,
    rateCategory: rate,
  });
  await openTeeTimeSearch(name, null, courseId);
  const phone = getProShopPhone(courseId);
  if (telUrl(phone)) {
    Alert.alert(
      name,
      script ? `Rather call? Pro shop: ${phone}\nAsk for: ${script}` : `Rather call? Pro shop: ${phone}`,
      [
        { text: 'Close', style: 'cancel' },
        { text: 'Call pro shop', onPress: () => { void callProShop(phone); } },
      ],
    );
  } else if (script) {
    try {
      (require('../store/toastStore') as typeof import('../store/toastStore')).useToastStore.getState().show(`Ask for: ${script}`);
    } catch { /* toast is best-effort */ }
  }
  return { courseId, phone, script };
}
