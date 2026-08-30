import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { googleKeys, withGoogleKeys, isCapabilityMiss, keyFailure } from './_googleKeys';

/**
 * 2026-07-10 (audit S2) — SERVER proxy for the course website/phone lookup that used to run
 * client-side against Google Places with a key SHIPPED IN THE APP BUNDLE (extractable → billable
 * abuse). The key now lives ONLY here as a server env var, so it's never in the client. Same
 * contract the old services/coursePlaces.ts had: name + coords → { website, phone }.
 * Best-effort: any failure / Places-not-enabled → { website: null, phone: null }.
 *
 * KEY RESOLUTION: Tim's Google key in Vercel is `GOOGLE_API_KEY` (one key, all APIs enabled) —
 * the same key the AI provider uses. Prefer a dedicated GOOGLE_MAPS_KEY if one is ever set, but
 * fall back to GOOGLE_API_KEY so this works with the key that's actually in the env today.
 */
// 2026-08-10 — multi-project key walk (see api/_googleKeys.ts). Was pinned to one key, which meant
// a website/phone lookup failed whenever THAT Cloud project lacked Places, even with a second
// project configured that had it. Now each lookup lands on whichever project has the API enabled.
const TIMEOUT_MS = 8_000;

function isNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (googleKeys().length === 0) return res.status(200).json({ website: null, phone: null, error: 'not_configured' });

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as {
      name?: unknown; lat?: unknown; lng?: unknown; debug?: unknown;
    };
    const debug = body.debug === true; // when true, surface Google's status/error_message for diagnosis
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    const bias = isNum(body.lat) && isNum(body.lng) ? `&locationbias=point:${body.lat},${body.lng}` : '';

    // find + details run under ONE key: if a project lacks Places, the whole lookup moves to the
    // next project rather than half-completing against two different Cloud projects.
    /**
     * 2026-08-22 — `lat`/`lng` ride along because the course API has NO coordinates for any course:
     * Sharp Park's record carries "1 Sharp Park Rd, Pacifica, CA 94044" and nothing numeric. Without
     * an anchor the geometry build has no bounding box to query, so a course added from home on
     * Wi-Fi got no greens and no aim lines until the player physically stood on it and the live GPS
     * fix filled in. Places already knows where the course is; we were asking and discarding it.
     * `geometry` is Basic Data on the legacy Details call -- same request, same tier.
     */
    type Found = { website: string | null; phone: string | null; lat: number | null; lng: number | null; diag: unknown };
    const found = await withGoogleKeys<Found>('places-legacy:findplace+details', async (KEY) => {
      const findUrl =
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
        `?input=${encodeURIComponent(name)}&inputtype=textquery&fields=place_id${bias}&key=${KEY}`;
      const findRes = await fetch(findUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!findRes.ok) return keyFailure({ httpStatus: findRes.status });
      const findData = (await findRes.json()) as { status?: string; error_message?: string; candidates?: { place_id?: string }[] };
      if (findData.status !== 'OK') {
        console.log(`[course-places] Places findplace status=${findData.status} — ${findData.error_message || 'no candidates'}`);
        // ZERO_RESULTS is a real answer (this project works, the course just isn't found) — only a
        // permission/not-enabled status should send us to the other project.
        if (isCapabilityMiss({ status: findData.status, message: findData.error_message })) {
          return keyFailure({ status: findData.status, message: findData.error_message });
        }
        return { ok: true, value: { website: null, phone: null, lat: null, lng: null, diag: { status: findData.status, error_message: findData.error_message || null } } };
      }
      const placeId = findData.candidates?.[0]?.place_id;
      if (!placeId) return { ok: true, value: { website: null, phone: null, lat: null, lng: null, diag: 'OK but no candidates' } };

      const detUrl =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(placeId)}&fields=website,formatted_phone_number,geometry&key=${KEY}`;
      const detRes = await fetch(detUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!detRes.ok) return keyFailure({ httpStatus: detRes.status });
      const detData = (await detRes.json()) as {
        result?: {
          website?: string;
          formatted_phone_number?: string;
          geometry?: { location?: { lat?: number; lng?: number } };
        };
      };
      const loc = detData.result?.geometry?.location;
      // Null Island and out-of-range readings are treated as absent, never passed on as a location.
      const okCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
      const hasLoc = loc && okCoord(loc.lat) && okCoord(loc.lng)
        && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180
        && !(Math.abs(loc.lat) < 0.001 && Math.abs(loc.lng) < 0.001);
      return {
        ok: true,
        value: {
          website: detData.result?.website?.trim() || null,
          phone: detData.result?.formatted_phone_number?.trim() || null,
          lat: hasLoc ? (loc.lat as number) : null,
          lng: hasLoc ? (loc.lng as number) : null,
          diag: null,
        },
      };
    });

    if (!found) return res.status(200).json({ website: null, phone: null, lat: null, lng: null, ...(debug ? { _diag: 'no configured project has Places enabled' } : {}) });
    return res.status(200).json({
      website: found.website,
      phone: found.phone,
      lat: found.lat,
      lng: found.lng,
      ...(debug && found.diag ? { _diag: found.diag } : {}),
    });
  } catch (e) {
    console.log('[course-places] lookup failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return res.status(200).json({ website: null, phone: null });
  }
}
