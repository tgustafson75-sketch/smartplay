import type { ShotLocation } from '../store/roundStore';

/**
 * Phase C — Weather snapshot fetch + cache.
 *
 * Mirrors the api/weather.ts proxy response shape. Fields are imperial units
 * (temp_f, mph) since that's what Mike thinks in.
 */
export type WeatherSnapshot = {
  temp_f: number | null;
  humidity: number | null;
  pressure_hpa: number | null;
  wind_speed_mph: number;          // 0 when calm
  wind_direction_deg: number | null; // meteorological convention: degrees the wind comes FROM
  wind_gust_mph: number | null;
  conditions: string | null;       // "Clear" | "Rain" | "Clouds" | ...
  description: string | null;      // "scattered clouds" | ...
  timestamp: number;
};

const FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes
const LOCATION_BUCKET_DEG = 0.001;   // ~100m at most latitudes

type CacheEntry = { snapshot: WeatherSnapshot; cached_at: number };
const cache: Map<string, CacheEntry> = new Map();

function bucketKey(loc: ShotLocation): string {
  const round = (n: number) => Math.round(n / LOCATION_BUCKET_DEG) * LOCATION_BUCKET_DEG;
  return `${round(loc.lat).toFixed(3)},${round(loc.lng).toFixed(3)}`;
}

/**
 * Returns a cached snapshot if one exists for the bucketed location and is
 * within `maxAgeMinutes` (defaults to 10 minutes). Synchronous read; safe in
 * render paths.
 */
export function getCachedWeather(
  location: ShotLocation,
  maxAgeMinutes = 10,
): WeatherSnapshot | null {
  const entry = cache.get(bucketKey(location));
  if (!entry) return null;
  if (Date.now() - entry.cached_at > maxAgeMinutes * 60 * 1000) return null;
  return entry.snapshot;
}

/**
 * Fetches a fresh weather snapshot for the given location. Returns the cached
 * value when fresh (< 10 min, same ~100m bucket). Returns null on fetch
 * failure rather than throwing — callers should treat null as "weather
 * unavailable" and proceed.
 */
export async function fetchWeatherAt(location: ShotLocation): Promise<WeatherSnapshot | null> {
  const key = bucketKey(location);
  const existing = cache.get(key);
  if (existing && Date.now() - existing.cached_at < FRESHNESS_MS) {
    return existing.snapshot;
  }

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const url = `${apiUrl}/api/weather?lat=${location.lat}&lng=${location.lng}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) {
      console.warn('[weather] fetch failed:', res.status);
      return existing?.snapshot ?? null;
    }
    const snapshot = (await res.json()) as WeatherSnapshot;
    cache.set(key, { snapshot, cached_at: Date.now() });
    return snapshot;
  } catch (e) {
    console.warn('[weather] fetch exception:', e);
    return existing?.snapshot ?? null;
  }
}

/**
 * For tests / cache reset between rounds.
 */
export function _clearWeatherCache(): void {
  cache.clear();
}
