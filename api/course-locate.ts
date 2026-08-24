import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowInference } from './_inferLimit';
import { applyCors } from './_cors';
import { googleKeys, withGoogleKeys, isCapabilityMiss } from './_googleKeys';

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
type Located = {
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

function isGolfPlace(p: Located): boolean {
  if (NOT_A_COURSE_RE.test(p.name)) return false;
  if (p.types.some((t) => t === 'golf_course')) return true;
  return GOLF_NAME_RE.test(p.name);
}

/**
 * Places API (NEW) — the only Google surface where `golf_course` is a supported type filter.
 * Returns null (not []) when the API is unavailable, so the caller can distinguish "not enabled →
 * try legacy" from "enabled, genuinely no courses here".
 */
async function searchNearbyNew(lat: number, lng: number, radius: number, timeoutMs: number): Promise<Located[] | null> {
  return withGoogleKeys<Located[]>('places-new:searchNearby', async (KEY) => {
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
      return { ok: false, capabilityMiss: isCapabilityMiss({ httpStatus: r.status, message }) };
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
async function searchNearbyLegacy(lat: number, lng: number, radius: number, timeoutMs: number): Promise<Located[] | null> {
  return withGoogleKeys<Located[]>('places-legacy:nearbysearch', async (KEY) => {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent('golf course')}&key=${KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, capabilityMiss: isCapabilityMiss({ httpStatus: r.status }) };
    const data = (await r.json()) as { status?: string; error_message?: string; results?: PlaceResult[] };
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      // Legacy reports "API not enabled for this project" as HTTP 200 + REQUEST_DENIED, so the
      // capability check has to read the BODY here, not the status code.
      console.log(`[course-locate] Places nearbysearch status=${data.status} — ${data.error_message || ''}`);
      return { ok: false, capabilityMiss: isCapabilityMiss({ status: data.status, message: data.error_message }) };
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
      lat?: unknown; lng?: unknown; radius_m?: unknown; limit?: unknown;
    };
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

    // 2) FALLBACK — New API not enabled on this key (or a transient error). Legacy Nearby Search with
    // `keyword=golf`, which legacy DOES honor, rather than the phantom type filter that started this.
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
    const rejected = located.filter((p) => !isGolfPlace(p)).length;
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

    return res.status(200).json({ courses, source });
  } catch (e) {
    console.error('[course-locate] failed:', e instanceof Error ? e.message : e);
    return res.status(200).json({ courses: [], source: 'places', error: 'exception' });
  }
}
