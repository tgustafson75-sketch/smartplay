import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';

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
const KEY =
  process.env.GOOGLE_MAPS_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
  '';
const TIMEOUT_MS = 8_000;

function isNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!KEY) return res.status(200).json({ website: null, phone: null, error: 'not_configured' });

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as {
      name?: unknown; lat?: unknown; lng?: unknown;
    };
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    const bias = isNum(body.lat) && isNum(body.lng) ? `&locationbias=point:${body.lat},${body.lng}` : '';

    const findUrl =
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
      `?input=${encodeURIComponent(name)}&inputtype=textquery&fields=place_id${bias}&key=${KEY}`;
    const findRes = await fetch(findUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!findRes.ok) return res.status(200).json({ website: null, phone: null });
    const findData = (await findRes.json()) as { status?: string; candidates?: { place_id?: string }[] };
    if (findData.status === 'REQUEST_DENIED') {
      console.log('[course-places] Places API not enabled on GOOGLE_MAPS_KEY — returning null.');
      return res.status(200).json({ website: null, phone: null });
    }
    const placeId = findData.candidates?.[0]?.place_id;
    if (!placeId) return res.status(200).json({ website: null, phone: null });

    const detUrl =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${encodeURIComponent(placeId)}&fields=website,formatted_phone_number&key=${KEY}`;
    const detRes = await fetch(detUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!detRes.ok) return res.status(200).json({ website: null, phone: null });
    const detData = (await detRes.json()) as { result?: { website?: string; formatted_phone_number?: string } };
    return res.status(200).json({
      website: detData.result?.website?.trim() || null,
      phone: detData.result?.formatted_phone_number?.trim() || null,
    });
  } catch (e) {
    console.log('[course-places] lookup failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return res.status(200).json({ website: null, phone: null });
  }
}
