import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowInference } from './_inferLimit';
import { applyCors } from './_cors';
import { googleKeys, withGoogleKeys, isCapabilityMiss, keyFailure } from './_googleKeys';
import type { KeyAttempt } from './_googleKeys';

/**
 * api/course-locate.ts — the COURSE-DOWNLOAD ENGINE's locator (2026-08-06, Tim — "build the course
 * download engine / future API; it may be my in with Arccos and Meta").
 *
 * Arccos-style "you drive up, it knows where you are": POST a GPS fix → the golf courses AT/NEAR that
 * location, so the client can offer a one-tap on-demand download of THAT course's data. This is the clean,
 * self-describing edge of the engine — a partner (Arccos / Meta glasses) can call the SAME endpoint to ask
 * "given this location, what course is the player on?" without shipping our whole app.
 *
 * Source: Google Places, server-side only (never in the client bundle) with the same GOOGLE_API_KEY
 * course-places.ts uses. Best-effort: no key / Places-not-enabled → { courses: [] }.
 *
 * 2026-08-10 (Tim — "it's showing hospitals and hotels") — ROOT CAUSE, confirmed live against his real
 * coords in Putnam CT: this route asked LEGACY Nearby Search for `type=golf_course`, but `golf_course`
 * is NOT in the legacy Place-Types table — it exists only in Places API (NEW). Google does not error on
 * an unrecognized `type`; it silently DROPS the filter and returns every business in the radius. So the
 * response was schools, banks, a Walmart, a Subway and a car dealer, ranked by distance. The filter had
 * never once been applied. (This is also why the symptom looked like "bad ranking" rather than a bug.)
 *
 * The fix is layered so a golf course is the only thing that can ever come out:
 *   1. PRIMARY — Places API (New) `places:searchNearby` with `includedTypes: ['golf_course']`, which
 *      genuinely supports the type. Field-masked to exactly what we return.
 *   2. FALLBACK — if the New API isn't enabled on the key (or errors), legacy Nearby Search with
 *      `keyword=golf` (keyword IS honored) instead of the phantom type filter.
 *   3. GUARD — both paths run through isGolfPlace(), which requires golf evidence in the returned
 *      `types` or the name. A Walmart cannot reach the client even if Google hands us one.
 *
 *   POST /api/course-locate  { lat: number, lng: number, radius_m?: number, limit?: number }
 *   → { courses: [{ name, place_id, lat, lng, distance_m, vicinity, rating, open_now }], source }
 */
// 2026-08-10 (Tim — two SmartPlay projects in Google Cloud, only one with everything enabled).
// Keys are no longer pinned here; _googleKeys walks EVERY configured project and lands on whichever
// one has the API in question enabled. That's what lets Places (New) start working the moment the
// second project's key is present, with no code change and nobody having to work out which is which.
/**
 * 2026-08-24 (Tim's device log, Berlin MA, 4:40 PM — three `course_locate_failed reason:timeout` in
 * a row on arrival at a course) — ONE BUDGET, NOT THREE INCOMPATIBLE CEILINGS.
 *
 * The arithmetic could not be satisfied by any request that needed the fallback:
 *
 *   client  services/courseDownloadEngine  AbortSignal.timeout(9_000)   gives up at  9s
 *   Vercel  no maxDuration in vercel.json  @vercel/node default         kills at    10s
 *   server  8_000 primary + 8_000 fallback, run SEQUENTIALLY            needs up to 16s
 *
 * So whenever the Places (New) call was slow or errored — exactly the case the legacy fallback
 * exists for — the function was killed, or the client had already abandoned it, before an answer
 * could exist. The player stood on the first tee while it failed twice (the client retries), then
 * got nothing. The fallback path could never complete even with no client attached.
 *
 * A per-call timeout cannot fix this, because the failure is in the SUM. So the request now carries
 * a single deadline and each Places call gets whatever is left of it, and the fallback is skipped
 * outright when there is not enough time to be worth starting. Budget sits under the client's 9s so
 * the server always answers — with an honest empty result if it must — rather than being cut off.
 */
const BUDGET_MS = 7_000;
/** Never spend the whole budget on the primary: the fallback exists for when the primary misbehaves. */
const PRIMARY_CAP_MS = 4_500;
/** Below this there is no point starting a second network call — return what we have. */
const MIN_FALLBACK_MS = 1_200;

/** Milliseconds left of this request's budget. */
function remainingMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}
const DEFAULT_RADIUS_M = 8_000; // ~5 miles — a course you could be at / driving to
const MAX_RADIUS_M = 40_000;
const DEFAULT_LIMIT = 8;

function isNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

// Haversine metres — so results are sorted nearest-first and carry an honest distance.
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

type PlaceResult = {
  name?: string;
  place_id?: string;
  vicinity?: string;
  rating?: number;
  business_status?: string;
  types?: string[];
  opening_hours?: { open_now?: boolean };
  geometry?: { location?: { lat?: number; lng?: number } };
};

/** The normalized shape both Google paths project into before the golf guard + sort. */
export type Located = {
  name: string;
  place_id: string | null;
  lat: number;
  lng: number;
  vicinity: string | null;
  rating: number | null;
  open_now: boolean | null;
  types: string[];
  closed_permanently: boolean;
};

// A place is a golf course when Google TYPED it as one, or when its name says so. The name check
// carries the legacy path (whose types are coarse) and rescues courses Google mis-types; the
// exclusions keep the adjacent-but-not-a-course businesses out — a driving range or a golf shop is
// not somewhere you play 18, and matching them would re-introduce the bug in a subtler form.
const GOLF_NAME_RE = /\b(golf|golf ?club|country club|links|c\.?c\.?|g\.?c\.?\b)/i;
const NOT_A_COURSE_RE = /\b(mini[- ]?golf|miniature golf|top ?golf|driving range|golf shop|golf store|golf galaxy|simulator|indoor golf|putt[- ]?putt|disc golf)\b/i;

/**
 * 2026-08-31 — THE ACTUAL TPC SAWGRASS ROOT CAUSE, found by echoing what the guard discarded.
 *
 * The course was never missing from Google. `TPC Sawgrass` AND `TPC Sawgrass - Dye's Valley Course`
 * were both in the rows, and THIS FUNCTION threw them away — because Google types the Stadium Course
 * as `restaurant,food,lodging,point_of_interest,establishment` (the clubhouse restaurant is the
 * business record) and the name contains no word GOLF_NAME_RE knows. Six days of this were blamed on
 * Google's coverage and on a Google Cloud Console setting. It was our own filter.
 *
 * The lesson is the one that keeps recurring: the missing thing was evidence of a DECISION we made,
 * not of data we lacked. [[missing-log-entry-is-the-evidence]]
 *
 * A championship course is very often branded rather than described — TPC, PGA, "The Ocean Course",
 * "Whistling Straits". So brand and course-noun evidence counts alongside the word "golf".
 */
const GOLF_BRAND_RE = /(\bTPC\b|\bPGA\b|\bLPGA\b|\bgolf\b)/i;
const COURSE_NOUN_RE = /\b(course|links|country club|golf club)\b/i;

/**
 * Types that mean "this record is a hospitality business". They do NOT disqualify a course — the
 * clubhouse restaurant IS how Google files TPC Sawgrass — but on their own, with only a weak name,
 * they describe the hotel next door. `Sawgrass Marriott Golf Resort & Spa` is the case that matters:
 * it is `lodging`, it contains the word "golf", and it was being offered as the nearest COURSE at
 * 1.1km. Handing a player a hotel to play is the same defect class as handing them the wrong club.
 */
const HOSPITALITY_TYPES = new Set(['lodging', 'restaurant', 'food', 'bar', 'spa', 'cafe']);

export /**
 * 2026-08-31 (adversarial audit) — TYPES THAT DISQUALIFY, WHATEVER ELSE GOOGLE ALSO CALLS THE PLACE.
 *
 * Seeding Manhattan returned NINETEEN "courses", every one of them an indoor simulator bay or a
 * mini-golf bar: Five Iron Golf (×5), Puttery, GOLFZON Social, "Fitness Factory Health Club".
 * Google tags all of them `indoor_golf_course` AND `golf_course`, so the type check accepted them
 * outright — and the NAME exclusions could never catch them, because "Five Iron Golf" and "Puttery"
 * contain none of the words a name list can reasonably guess at.
 *
 * This is a worse bug than the one that started this file. TPC Sawgrass affected players standing on
 * one famous property; this hands EVERY city player a simulator bay as somewhere to play eighteen.
 *
 * Excluding on TYPE is the fix because the type is Google's own classification rather than our guess
 * at a brand name, and it is checked BEFORE the `golf_course` acceptance — these places genuinely
 * carry both tags, so order is the whole point.
 */
const NOT_A_COURSE_TYPES = new Set(['indoor_golf_course', 'miniature_golf_course', 'golf_shop', 'sporting_goods_store']);

/**
 * 2026-08-31 (adversarial audit A) — THE PLACES-API-(NEW) PATH WENT LIVE AND HAD NEVER BEEN JUDGED.
 *
 * Every previous rule here was written against the LEGACY fallback, because New had been 403 on the
 * key for as long as anyone had measured — `source` was `places_legacy` on every query. The key
 * restriction was fixed, `source` flipped to `places_new`, and the primary path started serving
 * traffic for the first time with a classifier that had never seen its output.
 *
 * What it returns, all tagged `golf_course` by Google and all previously accepted outright:
 *   TPC Sawgrass No. 10 Green · 17th Green (Island) · TPC Sawgrass 17th hole tee box  → SUB-FEATURES
 *   Agronomic Operation Center · Pebble Beach Pro Shop                                → FACILITIES
 *   THE PLAYERS Championship                                                          → an EVENT
 *   The Lodge at Pebble Beach · The Inn at Spanish Bay · Ponte Vedra Inn & Club        → HOTELS
 *
 * Offering a player "TPC Sawgrass No. 10 Green" as somewhere to play a round is the same defect as
 * offering them a hotel: a confidently wrong answer that looks like a real one.
 */
/** One green, one tee, one hole — a piece OF a course, never a course. */
const SUB_FEATURE_RE = /\b(no\.?\s*\d+|#\d+|\d+\s*(st|nd|rd|th))\b|\b(tee box|hole)\b|\bgreen\b\s*(\(|$)/i;
/** Somewhere on the property that is not somewhere you play. */
const FACILITY_RE = /\b(agronom\w*|maintenance|operations?\s+cent(er|re)|pro\s*shop|clubhouse|academy|learning cent(er|re))\b/i;
/** Types that mean "you sleep here". A course on a resort keeps them — its NAME has to say course. */
const LODGING_TYPES = new Set(['hotel', 'resort_hotel', 'lodging', 'motel', 'guest_house', 'bed_and_breakfast']);

export function isGolfPlace(p: Located): boolean {
  if (NOT_A_COURSE_RE.test(p.name)) return false;
  if (SUB_FEATURE_RE.test(p.name)) return false;
  if (FACILITY_RE.test(p.name)) return false;
  // An EVENT played at a course is not the course. "Championship Course" survives on its course noun.
  if (/\bchampionship\b/i.test(p.name) && !COURSE_NOUN_RE.test(p.name)) return false;
  // Disqualifying TYPE beats every other signal, including golf_course sitting right beside it.
  if (p.types.some((t) => NOT_A_COURSE_TYPES.has(t))) return false;

  /**
   * A lodging record must NAME itself a course. Google tags the hotel on a golf property
   * `golf_course`, so "The Lodge at Pebble Beach" and "Pebble Beach Golf Links" arrive with the same
   * type set and only the name separates them. Checked BEFORE the golf_course acceptance for exactly
   * that reason — the brand tokens let "TPC Sawgrass" through on its own name.
   */
  if (p.types.some((t) => LODGING_TYPES.has(t)) && !COURSE_NOUN_RE.test(p.name) && !/\bTPC\b|\bPGA\b/i.test(p.name)) return false;

  // Google TYPED it a course — the Places-API-(New) path, and the only unambiguous signal there is.
  if (p.types.some((t) => t === 'golf_course')) return true;

  const branded = GOLF_BRAND_RE.test(p.name);
  const courseNoun = COURSE_NOUN_RE.test(p.name);
  if (!branded && !courseNoun && !GOLF_NAME_RE.test(p.name)) return false;

  // Hospitality-only record: require it to name itself a COURSE (or a club/links), not merely to sit
  // on a golf property. "TPC Sawgrass" passes on the brand; "... Golf Resort & Spa" does not.
  const hospitalityOnly =
    p.types.length > 0 && p.types.every((t) => HOSPITALITY_TYPES.has(t) || t === 'point_of_interest' || t === 'establishment');
  if (hospitalityOnly && !courseNoun && !/\bTPC\b|\bPGA\b/i.test(p.name)) return false;

  return true;
}

/**
 * Places API (NEW) — the only Google surface where `golf_course` is a supported type filter.
 * Returns null (not []) when the API is unavailable, so the caller can distinguish "not enabled →
 * try legacy" from "enabled, genuinely no courses here".
 */
/** Why the Places API (New) call last failed. Echoed on the response so the fallback stops being invisible. */
let lastPrimaryFailure: string | null = null;

async function searchNearbyNew(lat: number, lng: number, radius: number, timeoutMs: number): Promise<Located[] | null> {
  return withGoogleKeys<Located[]>('places-new:searchNearby', async (KEY, ref) => {
    const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY,
        // Field mask is REQUIRED by the New API and is also the billing lever — ask for exactly
        // what this endpoint's response contract exposes, nothing more.
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.location',
          'places.shortFormattedAddress',
          'places.rating',
          'places.businessStatus',
          'places.types',
          'places.currentOpeningHours.openNow',
        ].join(','),
      },
      body: JSON.stringify({
        includedTypes: ['golf_course'],
        maxResultCount: 20,
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      // A 403/PERMISSION_DENIED here means THIS project doesn't have Places (New) enabled — a
      // capability miss, so the walker tries the other project before we give up on the New API.
      let message: string | null = null;
      try {
        const err = (await r.json()) as { error?: { message?: string; status?: string } };
        message = err.error?.message ?? null;
      } catch { /* body not JSON — status code alone decides */ }
      /**
       * 2026-08-25 — REMEMBER WHY THE PRIMARY PATH FAILED.
       *
       * Every live query is currently answered by the LEGACY fallback (`source: places_legacy`),
       * which means the New API has been failing continuously and silently. That is not cosmetic:
       * legacy filters by the keyword "golf course", so a course whose NAME lacks the word is
       * invisible to discovery — TPC Sawgrass returns "Sawgrass Country Club", a different club
       * 2.4km away. A player is handed the wrong course's card, which is worse than finding none.
       *
       * The reason is logged server-side but nowhere a caller can see it, so nobody knew. Recorded
       * here and echoed on the response; the fix (enable Places API New, or correct the key) is a
       * console change, and this is how we tell which.
       */
      /**
       * 2026-08-25 — NAME THE KEY. Tim: "places is enabled" — and he is right, which is exactly why
       * this needs to be specific. Google returns two DIFFERENT 403s: a disabled API says "has not
       * been used in project X before or it is disabled", while "Requests to this API ... are
       * blocked" is the API-KEY RESTRICTION message. Corroborated by the fact that LEGACY Places
       * works on the same key — that is places-backend.googleapis.com, a different API from
       * places.googleapis.com (New). So the key is authorised for one and not the other.
       *
       * Reporting which key (name + short fingerprint, never the secret) turns "something is
       * blocked" into "this env var's key is missing Places API (New) in its API restrictions".
       */
      lastPrimaryFailure = `http_${r.status} on key ${ref.name}(${ref.fp})${message ? `: ${message.slice(0, 140)}` : ''}`;
      return keyFailure({ httpStatus: r.status, message });
    }
    type NewPlace = {
      id?: string;
      displayName?: { text?: string };
      location?: { latitude?: number; longitude?: number };
      shortFormattedAddress?: string;
      rating?: number;
      businessStatus?: string;
      types?: string[];
      currentOpeningHours?: { openNow?: boolean };
    };
    const data = (await r.json()) as { places?: NewPlace[] };
    const value = (data.places ?? [])
      .map((p): Located | null => {
        const plat = p.location?.latitude;
        const plng = p.location?.longitude;
        if (!isNum(plat) || !isNum(plng)) return null;
        return {
          name: (p.displayName?.text ?? '').trim(),
          place_id: p.id ?? null,
          lat: plat,
          lng: plng,
          vicinity: (p.shortFormattedAddress ?? '').trim() || null,
          rating: isNum(p.rating) ? p.rating : null,
          open_now: p.currentOpeningHours?.openNow ?? null,
          types: Array.isArray(p.types) ? p.types : [],
          closed_permanently: p.businessStatus === 'CLOSED_PERMANENTLY',
        };
      })
      .filter((p): p is Located => p != null);
    return { ok: true, value };
  });
}

/** Legacy Nearby Search, keyword-filtered (`keyword` IS honored by legacy; `type=golf_course` never was). */
/**
 * One legacy Nearby Search request. Split out so the two FILTERS below can run against the same key
 * in parallel and be judged independently — a failure of one must not discard the other's rows.
 */
async function legacyQuery(url: string, timeoutMs: number): Promise<KeyAttempt<Located[]>> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) return keyFailure({ httpStatus: r.status });
  const data = (await r.json()) as { status?: string; error_message?: string; results?: PlaceResult[] };
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    // Legacy reports "API not enabled for this project" as HTTP 200 + REQUEST_DENIED, so the
    // capability check has to read the BODY here, not the status code.
    console.log(`[course-locate] Places nearbysearch status=${data.status} — ${data.error_message || ''}`);
    return keyFailure({ status: data.status, message: data.error_message });
  }
  const value = (data.results ?? [])
    .map((p): Located | null => {
      const plat = p.geometry?.location?.lat;
      const plng = p.geometry?.location?.lng;
      if (!isNum(plat) || !isNum(plng)) return null;
      return {
        name: (p.name ?? '').trim(),
        place_id: p.place_id ?? null,
        lat: plat,
        lng: plng,
        vicinity: (p.vicinity ?? '').trim() || null,
        rating: isNum(p.rating) ? p.rating : null,
        open_now: p.opening_hours?.open_now ?? null,
        types: Array.isArray(p.types) ? p.types : [],
        closed_permanently: p.business_status === 'CLOSED_PERMANENTLY',
      };
    })
    .filter((p): p is Located => p != null);
  return { ok: true, value };
}

/**
 * LEGACY fallback — TWO filters, merged.
 *
 * 2026-08-31 — this path used to send `keyword=golf course` and nothing else, and that single word
 * was the whole TPC Sawgrass defect. A legacy KEYWORD match is a NAME match, so every course whose
 * name does not contain "golf" was invisible to discovery: a player standing on the Stadium Course
 * was offered Sawgrass Country Club, a different club 2.6km away, and handed its card and yardages.
 * Nothing looked broken — that is what made it expensive.
 *
 * `golf_course` is NOT a legacy place type — the ORIGINAL guard's "phantom type" wording was right,
 * and an earlier version of this fix asserted the opposite. Legacy silently IGNORES an unknown
 * `type`, so sending it does not filter; it returns the unfiltered nearby sweep. That accident is
 * what finally exposed the real bug: the sweep contained TPC Sawgrass all along, and isGolfPlace was
 * discarding it. See isGolfPlace.
 *
 * So the two queries are deliberately different in KIND, not two spellings of one filter:
 *   - KEYWORD `golf course` — precise, but a legacy keyword match is a NAME match, so it can only
 *     ever find courses that describe themselves. This is what shipped alone, and why a player on
 *     the Stadium Course was handed a different club's card.
 *   - BROAD prominence sweep — no name filter at all, so a course branded rather than described is
 *     reachable. Everything it returns is then judged by isGolfPlace, which is where the golf
 *     evidence is actually required.
 *
 * Run in PARALLEL because wall-clock budget is what kills this function, and MERGED de-duped so the
 * result is a superset of the keyword-only behaviour — a discovery path may not trade one blind spot
 * for another. Either query succeeding is enough; only a double failure walks to the next key.
 */
async function searchNearbyLegacy(lat: number, lng: number, radius: number, timeoutMs: number): Promise<Located[] | null> {
  return withGoogleKeys<Located[]>('places-legacy:nearbysearch', async (KEY) => {
    const base = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&key=${KEY}`;
    const [byType, byKeyword] = await Promise.all([
      legacyQuery(`${base}&rankby=prominence`, timeoutMs).catch(() => keyFailure({ status: 'THREW' })),
      legacyQuery(`${base}&keyword=${encodeURIComponent('golf course')}`, timeoutMs).catch(() => keyFailure({ status: 'THREW' })),
    ]);

    // Both dead → hand the walker a real failure so it can try the next key.
    if (!byType.ok && !byKeyword.ok) return byKeyword;

    // De-dupe by place_id, falling back to name+position for the rare row Google returns without one.
    const seen = new Set<string>();
    const merged: Located[] = [];
    for (const part of [byType, byKeyword]) {
      if (!part.ok) continue;
      for (const p of part.value) {
        const id = p.place_id ?? `${p.name}|${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(p);
      }
    }
    if (!byType.ok || !byKeyword.ok) {
      console.log(`[course-locate] legacy served on ONE filter only (type=${byType.ok} keyword=${byKeyword.ok})`);
    }
    return { ok: true, value: merged };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 2026-08-08 (server audit #4) — paid Google Places behind zero throttle; IP-limit it (partner-shaped
  // endpoint stays keyless by design, but a curl loop can't burn quota anymore).
  // 2026-08-08 (verification wave) — CORS first: preflight OPTIONS must not burn rate-limit quota,
  // and a 429 without CORS headers is unreadable to the browser callers this endpoint advertises.
  if (applyCors(req, res)) return;
  if (!allowInference(req, res, 'course-locate', 30)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (googleKeys().length === 0) return res.status(200).json({ courses: [], source: 'places', error: 'not_configured' });

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as {
      lat?: unknown; lng?: unknown; radius_m?: unknown; limit?: unknown; debug?: unknown;
    };
    /**
     * 2026-08-31 — `debug: true` echoes what the golf guard DROPPED, with the place types Google
     * actually returned. Added because the TPC Sawgrass hunt stalled at exactly the point where the
     * only remaining question — "was the course never returned, or returned and then filtered out by
     * us?" — was answerable solely from a server log line nobody could reach. Names and types only;
     * no key material, no counts that are not already implied by the course list.
     */
    const debug = body.debug === true;
    const lat = body.lat, lng = body.lng;
    if (!isNum(lat) || !isNum(lng)) return res.status(400).json({ error: 'lat and lng required' });
    const radius = isNum(body.radius_m) ? Math.min(MAX_RADIUS_M, Math.max(200, Math.round(body.radius_m))) : DEFAULT_RADIUS_M;
    const limit = isNum(body.limit) ? Math.min(20, Math.max(1, Math.round(body.limit))) : DEFAULT_LIMIT;

    // One deadline for the whole request. See BUDGET_MS — three independent timeouts is what made
    // arrival at a course fail three times in a row on Tim's device.
    const deadlineAt = Date.now() + BUDGET_MS;

    // 1) PRIMARY — Places API (New). `golf_course` is a real type here, so the filter actually binds.
    let located: Located[] | null =
      await searchNearbyNew(lat, lng, radius, Math.min(PRIMARY_CAP_MS, remainingMs(deadlineAt)));
    let source = 'places_new';

    // 2) FALLBACK — New API not enabled on this key (or a transient error). Legacy Nearby Search,
    // which honors BOTH `type=golf_course` and `keyword=` — see searchNearbyLegacy for why it now
    // sends both. (This comment used to say `keyword=golf`; the code sent `keyword=golf course`.)
    // Only if there is genuinely time left: starting an 8-second call with 400ms of budget is how the
    // function got killed mid-flight and the player got nothing at all.
    if (located == null) {
      const left = remainingMs(deadlineAt);
      if (left >= MIN_FALLBACK_MS) {
        located = await searchNearbyLegacy(lat, lng, radius, left);
        source = 'places_legacy';
      } else {
        console.log(`[course-locate] skipping legacy fallback — only ${left}ms of budget left`);
      }
    }
    if (located == null) return res.status(200).json({ courses: [], source: 'places', error: 'places_error' });

    // 3) GUARD — golf-only, always, whichever path produced the rows.
    const droppedRows = located.filter((p) => !isGolfPlace(p));
    const rejected = droppedRows.length;
    if (rejected > 0) console.log(`[course-locate] golf guard dropped ${rejected} non-course place(s) from ${source}`);

    const courses = located
      .filter((p) => p.name.length > 0 && !p.closed_permanently && isGolfPlace(p))
      .map((p) => ({
        name: p.name,
        place_id: p.place_id,
        lat: p.lat,
        lng: p.lng,
        distance_m: distanceM(lat, lng, p.lat, p.lng),
        vicinity: p.vicinity,
        rating: p.rating,
        open_now: p.open_now,
      }))
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);

    // 2026-08-25 — when we served from the fallback, say WHY the primary failed. Silent permanent
    // degradation is how discovery ended up keyword-matching and hiding TPC Sawgrass.
    return res.status(200).json({
      ...(debug
        ? {
            debug_raw: located.map((p) => ({ name: p.name, types: p.types, kept: isGolfPlace(p) })),
            debug_dropped: droppedRows.map((p) => ({ name: p.name, types: p.types })),
          }
        : {}),
      courses,
      source,
      ...(source === 'places_legacy' && lastPrimaryFailure ? { primary_failure: lastPrimaryFailure } : {}),
    });
  } catch (e) {
    console.error('[course-locate] failed:', e instanceof Error ? e.message : e);
    return res.status(200).json({ courses: [], source: 'places', error: 'exception' });
  }
}
