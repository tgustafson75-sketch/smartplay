import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Elevation proxy — feeds utils/playsLike.ts's (previously dormant) uphill/
 * downhill model with real elevation data.
 *
 * Source: Open-Topo-Data public API, `mapzen` (Terrarium) global dataset —
 * free, no key, aggregates the best DEM per region (incl. USGS 3DEP in the US).
 * Returns elevation in FEET. Swappable for precision later (Google Elevation /
 * a Mapbox Terrain-RGB decode) without touching the client.
 *
 * Failure is non-fatal BY DESIGN: any error returns 200 + { elevation_ft: null }
 * so the client falls back to flat (elevationDeltaFeet = 0) and a yardage is
 * never blocked or corrupted by a missing/slow elevation lookup.
 */

const TIMEOUT_MS = 8_000;
const DATASET = 'mapzen';
const METERS_TO_FEET = 3.28084;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const lat = req.query.lat as string | undefined;
  const lng = req.query.lng as string | undefined;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  const latN = Number(lat);
  const lngN = Number(lng);
  // WGS84 sanity — never forward garbage upstream.
  if (!Number.isFinite(latN) || !Number.isFinite(lngN) || Math.abs(latN) > 90 || Math.abs(lngN) > 180) {
    return res.status(400).json({ error: 'invalid coordinates' });
  }

  const url = `https://api.opentopodata.org/v1/${DATASET}?locations=${latN},${lngN}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!upstream.ok) {
      console.warn('[elevation] upstream', upstream.status);
      return res.status(200).json({ elevation_ft: null, reason: `upstream_${upstream.status}` });
    }
    const data = (await upstream.json()) as { results?: { elevation?: number | null }[] };
    const meters = data.results?.[0]?.elevation;
    if (typeof meters !== 'number') {
      return res.status(200).json({ elevation_ft: null, reason: 'no_data' });
    }
    return res.status(200).json({ elevation_ft: Math.round(meters * METERS_TO_FEET * 10) / 10 });
  } catch (e) {
    clearTimeout(timer);
    console.warn('[elevation] exception', e instanceof Error ? e.message : String(e));
    return res.status(200).json({ elevation_ft: null, reason: 'exception' });
  }
}
