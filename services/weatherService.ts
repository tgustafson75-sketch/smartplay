import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShotLocation } from '../store/roundStore';
import { getApiBaseUrl } from './apiBase';

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
  /** Station (ground-level) pressure — carries the course's ALTITUDE (pressure_hpa is sea-level adjusted).
   *  Optional: older cached snapshots and other providers lack it; plays-like then adds no altitude term. */
  station_pressure_hpa?: number | null;
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
  if (entry && Date.now() - entry.cached_at <= STALE_BUT_USABLE_MS) return entry.snapshot;
  if (!entry) lazyHydrate(key);
  /**
   * 2026-10-15 (offline audit gap #2) — the bucket is ~100m, keyed by the player's CURRENT fix, so
   * walking to the next tee missed a reading taken five minutes earlier on the same course, and every
   * offline reader (plays-like, the club call, the brain's context) lost the wind. Weather does not
   * change across a golf course; a reading within SAME_AREA_M and the same 30 minutes is the same
   * weather. The age limit is unchanged — this widens WHERE, never WHEN.
   */
  hydrateAllOnce();
  return nearestEntry(location, STALE_BUT_USABLE_MS)?.snapshot ?? null;
}

/** ~1.5 km: one golf course. The weather API's own resolution is coarser than this. */
const SAME_AREA_M = 1500;
/** The oldest reading the offline wind answer will give, and only with its age said out loud. */
const OFFLINE_WIND_MAX_MS = 3 * 60 * 60 * 1000;

function metresBetween(a: ShotLocation, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestEntry(location: ShotLocation, maxAgeMs: number): CacheEntry | null {
  let best: { entry: CacheEntry; m: number } | null = null;
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (now - entry.cached_at > maxAgeMs) continue;
    const [lat, lng] = k.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const m = metresBetween(location, { lat, lng });
    if (m <= SAME_AREA_M && (!best || m < best.m || (m === best.m && entry.cached_at > best.entry.cached_at))) best = { entry, m };
  }
  return best?.entry ?? null;
}

/**
 * 2026-10-15 — every persisted reading, loaded once. lazyHydrate only loads the EXACT bucket asked
 * for, so after a cold start with no signal a reading from the next tee box was on disk and invisible.
 */
let hydratedAll = false;
function hydrateAllOnce(): void {
  if (hydratedAll) return;
  hydratedAll = true;
  void (async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(STORAGE_PREFIX));
      for (const full of keys) {
        const key = full.slice(STORAGE_PREFIX.length);
        if (cache.has(key)) continue;
        const entry = await readPersisted(key);
        if (entry && !cache.has(key)) cache.set(key, entry);
      }
    } catch { /* best-effort: a miss just means no wind reading */ }
  })();
}

/**
 * 2026-10-15 — the last wind reading on this course, up to 3 hours old, for the offline WIND ANSWER
 * ONLY — and only when the phone is PROVEN offline (the connectivity banner is raised only on proof,
 * services/reachability). Returned with its age so the reply says how old it is. Deliberately NOT used
 * for plays-like or the club call: an hour-old wind folded silently into a yardage would be a number
 * presented as current that is not.
 */
export function lastKnownWindOffline(location: ShotLocation): { snapshot: WeatherSnapshot; ageMinutes: number } | null {
  const fresh = getCachedWeatherEvenIfStale(location);
  if (fresh) return { snapshot: fresh, ageMinutes: 0 };
  let offline = false;
  try { offline = require('../store/connectivityStore').useConnectivityStore.getState().isOnline === false; } catch { /* treat as online */ }
  if (!offline) return null;
  const entry = nearestEntry(location, OFFLINE_WIND_MAX_MS);
  if (!entry) return null;
  return { snapshot: entry.snapshot, ageMinutes: Math.round((Date.now() - entry.cached_at) / 60_000) };
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

  const apiUrl = getApiBaseUrl();
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
  hydratedAll = false;
}
