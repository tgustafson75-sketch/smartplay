import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Phase C — OpenWeatherMap proxy.
 *
 * Server-side proxy keeps WEATHER_API_KEY out of the client bundle. Returns
 * only the fields the app uses, normalized to imperial units. Failure modes:
 *   - missing lat/lng → 400
 *   - missing key in env → 500
 *   - upstream non-2xx → propagate status
 *   - exception → 500 with message
 */

const TIMEOUT_MS = 8_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const lat = req.query.lat as string | undefined;
  const lng = req.query.lng as string | undefined;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng required' });
  }

  // Defensive: trim whitespace and surrounding quotes that copy-paste sometimes
  // smuggles into Vercel env vars. A leading/trailing space or " is the most
  // common cause of "key set in dashboard but OWM returns 401".
  // 2026-06-23 (audit) — accept either env name (meta-voice reads OPENWEATHER_API_KEY)
  // so a name mismatch in prod doesn't silently kill wind/temp.
  const rawKey = process.env.WEATHER_API_KEY ?? process.env.OPENWEATHER_API_KEY ?? '';
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
  if (!apiKey) {
    return res.status(500).json({ error: 'WEATHER_API_KEY not configured' });
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&appid=${apiKey}&units=imperial`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!upstream.ok) {
      const text = await upstream.text();
      // Log a sanitized fingerprint — never the full key. Helps diagnose stale /
      // wrong-account / activation-pending issues without leaking the secret.
      const fingerprint = `len=${apiKey.length} suffix=…${apiKey.slice(-4)}`;
      console.error('[weather] upstream', upstream.status, fingerprint, text.slice(0, 200));
      return res.status(upstream.status).json({
        error: 'Upstream weather service error',
        status: upstream.status,
      });
    }
    const data = (await upstream.json()) as Record<string, unknown>;
    const main = (data.main ?? {}) as Record<string, number | undefined>;
    const wind = (data.wind ?? {}) as Record<string, number | undefined>;
    const weather0 = (Array.isArray(data.weather) ? data.weather[0] : {}) as Record<string, string | undefined>;

    return res.status(200).json({
      temp_f: main.temp ?? null,
      humidity: main.humidity ?? null,
      pressure_hpa: main.pressure ?? null,
      wind_speed_mph: wind.speed ?? 0,
      wind_direction_deg: wind.deg ?? null,
      wind_gust_mph: wind.gust ?? null,
      conditions: weather0.main ?? null,
      description: weather0.description ?? null,
      timestamp: Date.now(),
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[weather] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
