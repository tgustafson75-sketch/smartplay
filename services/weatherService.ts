import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShotLocation } from '../store/roundStore';

/**
 * Phase C — Weather snapshot fetch + cache.
 *
 * Mirrors the api/weather.ts proxy response shape. Fields are imperial units
 * (temp_f, mph) since that's what Mike thinks in.
 *
 * 2026-06-07 — Added AsyncStorage persistence layer. Previously the cache
 * was Map-only (in-memory) — lost on every cold start. Consumers like
 * lieAnalysisContext, conversationalLoggingOrchestrator, arShotTracer,
 * and metaCourseIntelligence silently degraded to no-wind context when
 * the app cold-launched without cell. Now: each fetch writes to
 * AsyncStorage under smartplay.weatherCache.v1.<bucket>. On boot, the
 * first getCachedWeather miss falls through to a synchronous mirror
 * that's hydrated lazily from AsyncStorage in the background. Stale
 * cached weather (>30 min) is still preferable to nothing — surfaces
 * via getCachedWeather with an explicit `maxAgeMinutes` override.
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
const STALE_BUT_USABLE_MS = 30 * 60 * 1000; // 30 minutes — stale weather > no weather
const LOCATION_BUCKET_DEG = 0.001;   // ~100m at most latitudes
const STORAGE_PREFIX = 'smartplay.weatherCache.v1.';

type CacheEntry = { snapshot: WeatherSnapshot; cached_at: number };
const cache: Map<string, CacheEntry> = new Map();

function bucketKey(loc: ShotLocation): string {
  const round = (n: number) => Math.round(n / LOCATION_BUCKET_DEG) * LOCATION_BUCKET_DEG;
  return `${round(loc.lat).toFixed(3)},${round(loc.lng).toFixed(3)}`;
}

async function readPersisted(key: string): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed.cached_at !== 'number') return null;
    return parsed;
  } catch { return null; }
}

async function writePersisted(key: string, entry: CacheEntry): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    console.log('[weather] persist write failed (non-fatal):', e);
  }
}

/**
 * 2026-06-07 — Lazy hydrate from AsyncStorage. Fire-and-forget on the
 * first sync read miss for a given bucket key. Populates the in-memory
 * mirror so the NEXT sync read hits it. Eliminates the cold-start gap
 * where rendering paths got no-weather while cache was actually warm
 * on disk.
 */
const hydratingBuckets = new Set<string>();
function lazyHydrate(key: string): void {
  if (hydratingBuckets.has(key)) return;
  hydratingBuckets.add(key);
  void readPersisted(key).then((entry) => {
    if (entry && !cache.has(key)) {
      cache.set(key, entry);
    }
    hydratingBuckets.delete(key);
  });
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
  const key = bucketKey(location);
  const entry = cache.get(key);
  if (!entry) {
    // Lazy-hydrate from AsyncStorage so the NEXT call may hit. Returns
    // null this call — caller still falls back to "no weather" which
    // is honest for the cold-start moment.
    lazyHydrate(key);
    return null;
  }
  if (Date.now() - entry.cached_at > maxAgeMinutes * 60 * 1000) return null;
  return entry.snapshot;
}

/**
 * 2026-06-07 — Stale-acceptable variant. Same as getCachedWeather but
 * returns entries up to STALE_BUT_USABLE_MS old (30 min). Used by
 * brain/prompt builders + plays-like that prefer ANY weather over
 * none on offline cold-start.
 */
export function getCachedWeatherEvenIfStale(
  location: ShotLocation,
): WeatherSnapshot | null {
  const key = bucketKey(location);
  const entry = cache.get(key);
  if (!entry) {
    lazyHydrate(key);
    return null;
  }
  if (Date.now() - entry.cached_at > STALE_BUT_USABLE_MS) return null;
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
    const entry: CacheEntry = { snapshot, cached_at: Date.now() };
    cache.set(key, entry);
    // 2026-06-07 — Persist to AsyncStorage so subsequent cold starts
    // can pre-warm the in-memory mirror via lazyHydrate.
    void writePersisted(key, entry);
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
