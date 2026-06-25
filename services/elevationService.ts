/**
 * Client elevation lookups for plays-like (uphill/downhill).
 *
 * Calls the /api/elevation server proxy and caches per ~11m grid cell.
 * Elevation is STATIC per point, so the cache makes this effectively free after
 * the first lookup of a tee/green/pin. EVERY failure path returns null/0, so a
 * missing or slow elevation NEVER blocks or corrupts a yardage — playsLike just
 * falls back to flat (elevationDeltaFeet = 0). Same fail-safe spirit as the
 * pose/cloud fallbacks.
 */

import { getApiBaseUrl } from './apiBase';

// Successful feet only (elevation is static → safe to keep for the session).
// Transient failures are NOT cached, so a flaky upstream retries next shot.
const cache = new Map<string, number>();

function key(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`; // 4 dp ≈ 11m grid
}

/** Elevation in FEET for a point, or null when unavailable. Cached on success. */
export async function getElevationFeet(lat: number, lng: number): Promise<number | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const k = key(lat, lng);
  const cached = cache.get(k);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/elevation?lat=${lat}&lng=${lng}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { elevation_ft?: number | null };
    const ft = typeof data.elevation_ft === 'number' ? data.elevation_ft : null;
    if (ft != null) cache.set(k, ft);
    return ft;
  } catch {
    return null;
  }
}

/**
 * Plays-like elevation delta (target − player) in FEET, matching playsLike's
 * convention (uphill = positive = plays longer). Returns 0 (flat) whenever
 * either lookup is unavailable, so the result is always safe to pass straight
 * into playsLikeDistance(..., elevationDeltaFeet).
 */
export async function getPlaysLikeElevationDeltaFeet(
  player: { lat: number; lng: number },
  target: { lat: number; lng: number },
): Promise<number> {
  const [p, t] = await Promise.all([
    getElevationFeet(player.lat, player.lng),
    getElevationFeet(target.lat, target.lng),
  ]);
  if (p == null || t == null) return 0;
  return Math.round((t - p) * 10) / 10;
}
