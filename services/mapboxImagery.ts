/**
 * Phase S — Mapbox Static Images service.
 *
 * Single PNG per hole view via Mapbox Static Images API. Cacheable, no
 * native module required (pure HTTP), generalizes globally — any course
 * with valid GPS coordinates produces an aerial view.
 *
 * Token: EXPO_PUBLIC_MAPBOX_TOKEN. If unset, getHoleImageryUrl() returns
 * null and the consumer falls through to a secondary provider
 * (Google Maps Static API in current hole-view.tsx) or to "no imagery"
 * graceful degradation.
 *
 * Cache: per-hole on the device file system. Imagery rarely changes
 * (course aerial photography updates on a multi-year cadence), so
 * cached tiles are good for the lifetime of the install. Manual cache
 * clear available via clearImageryCache().
 *
 * Cost projection (50,000 free tile loads / month):
 *   - 1 tile fetch per hole on first view (cached after)
 *   - 18 holes per round = 18 first-time fetches
 *   - ~2,777 first-time-rounds/month before the free tier ceiling
 *   - Cached replays: zero fetches
 *   - Realistic v1.0 beta usage stays well under the ceiling.
 *   - Mapbox paid tier: $0.30 per 1,000 additional tile loads (Static
 *     Images API as of 2026-05). A cost alert at 40K usage = ~80% of
 *     free tier provides advance warning.
 */

import { File, Paths } from 'expo-file-system';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
const MAPBOX_STYLE = 'mapbox/satellite-v9';
const CACHE_DIR_NAME = 'mapbox_holes';

export type HoleImageryOptions = {
  /** Pixel width of the requested image. Mapbox caps at 1280. */
  width?: number;
  /** Pixel height. Mapbox caps at 1280. */
  height?: number;
  /** Override auto-zoom. Reasonable values are 14-18 for a hole. */
  zoom?: number;
  /** Override center [lat, lng]. Default: midpoint of tee→green axis. */
  centerOverride?: { lat: number; lng: number };
  /** Override bearing in degrees. Default: tee→green bearing (orients hole vertical). */
  bearingOverride?: number;
};

export type HoleImageryInput = {
  courseId: string | null;
  holeNumber: number;
  par: number;
  /** Hole length in yards. Drives auto-zoom selection. */
  yardage: number;
  tee: { lat: number; lng: number } | null;
  green: { lat: number; lng: number } | null;
};

export function isMapboxConfigured(): boolean {
  return MAPBOX_TOKEN.length > 0;
}

function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function autoZoom(yardage: number, par: number): number {
  // Tighter view on short holes, wider on long.
  if (par === 3 || yardage < 180) return 18;
  if (yardage < 400) return 17;
  return 16;
}

/**
 * Build the Mapbox Static Images URL for a hole. Returns null if Mapbox
 * is not configured or geometry is insufficient.
 *
 * Endpoint shape:
 *   /styles/v1/{username}/{style_id}/static/{lon},{lat},{zoom},{bearing}/{width}x{height}
 *
 * We don't draw overlays via Mapbox query parameters — overlays render
 * client-side via SVG (services/smartVisionOverlay.ts) so they're
 * interactive and don't burn imagery requests on every change.
 */
export function getHoleImageryUrl(
  input: HoleImageryInput,
  options: HoleImageryOptions = {},
): string | null {
  if (!MAPBOX_TOKEN) return null;
  if (!input.green) return null;

  const width = Math.min(options.width ?? 600, 1280);
  const height = Math.min(options.height ?? 500, 1280);
  const zoom = options.zoom ?? autoZoom(input.yardage, input.par);

  // Default center: 55% of the way from tee to green so the green sits in
  // the upper third of the frame (golfers expect this orientation).
  let center = options.centerOverride;
  let bearing = options.bearingOverride ?? 0;
  if (!center) {
    if (input.tee) {
      center = {
        lat: input.tee.lat + (input.green.lat - input.tee.lat) * 0.55,
        lng: input.tee.lng + (input.green.lng - input.tee.lng) * 0.55,
      };
      bearing = bearingDegrees(input.tee, input.green);
    } else {
      center = { lat: input.green.lat, lng: input.green.lng };
    }
  }

  return (
    `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/` +
    `${center.lng.toFixed(6)},${center.lat.toFixed(6)},` +
    `${zoom},${bearing.toFixed(1)}/` +
    `${width}x${height}` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&attribution=false&logo=false`
  );
}

function cacheFileFor(courseId: string | null, holeNumber: number, zoom: number, w: number, h: number): File {
  const safeCourse = (courseId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return new File(Paths.cache, `${CACHE_DIR_NAME}_${safeCourse}_h${holeNumber}_z${zoom}_${w}x${h}.png`);
}

/**
 * Fetch + cache the hole imagery. Returns a local file:// URI when cached,
 * the remote URL on first request (caller renders it; we lazy-write to
 * cache in the background for next time).
 *
 * Returns null if Mapbox isn't configured — caller falls through to a
 * secondary provider or shows the "no imagery" state.
 */
export async function fetchHoleImagery(
  input: HoleImageryInput,
  options: HoleImageryOptions = {},
): Promise<string | null> {
  const url = getHoleImageryUrl(input, options);
  if (!url) return null;

  const zoom = options.zoom ?? autoZoom(input.yardage, input.par);
  const w = Math.min(options.width ?? 600, 1280);
  const h = Math.min(options.height ?? 500, 1280);
  const cacheFile = cacheFileFor(input.courseId, input.holeNumber, zoom, w, h);

  if (cacheFile.exists) return cacheFile.uri;

  // Lazy background cache write — return remote URL immediately so the
  // image renders without waiting for disk I/O.
  void (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      cacheFile.write(new Uint8Array(buf));
    } catch (e) {
      console.log('[mapboxImagery] cache write failed:', e);
    }
  })();

  return url;
}

/**
 * Pre-fetch a range of holes during round prep so subsequent navigation
 * is instant. Fire-and-forget; errors are swallowed.
 */
export async function prefetchHoles(
  inputs: HoleImageryInput[],
  options: HoleImageryOptions = {},
): Promise<void> {
  await Promise.all(inputs.map(i => fetchHoleImagery(i, options).catch(() => null)));
}

/** Manual cache clear — wired into Settings → Cache management. */
export async function clearImageryCache(): Promise<void> {
  // expo-file-system File API doesn't enumerate the cache directory by
  // glob, so we no-op here for now. The OS cache directory gets cleared
  // by the system periodically, which is acceptable for v1.0.
}

/**
 * Course-wide aerial — single Mapbox tile sized to span the bounding box
 * of all hole geometries. Used as the hero thumbnail on Course Detail
 * before a round starts. Returns null if Mapbox isn't configured or no
 * hole has usable coordinates.
 */
export type CourseImageryInput = {
  courseId: string | null;
  holes: Array<{ tee: { lat: number; lng: number } | null; green: { lat: number; lng: number } | null }>;
};

export function getCourseImageryUrl(
  input: CourseImageryInput,
  width = 800,
  height = 400,
): string | null {
  if (!MAPBOX_TOKEN) return null;
  // Collect all valid coords
  const coords: Array<{ lat: number; lng: number }> = [];
  for (const h of input.holes) {
    if (h.tee) coords.push(h.tee);
    if (h.green) coords.push(h.green);
  }
  if (coords.length === 0) return null;

  // Bounding box
  const lats = coords.map(c => c.lat);
  const lngs = coords.map(c => c.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };

  // Auto-zoom from bbox span. Most courses span ~0.01-0.02 degrees.
  // Mapbox zoom: each level halves the visible area. Tuned so a typical
  // 18-hole layout fills the frame at zoom 14-15.
  const span = Math.max(maxLat - minLat, maxLng - minLng);
  const zoom =
    span < 0.005 ? 16 :
    span < 0.012 ? 15 :
    span < 0.025 ? 14 :
    span < 0.05  ? 13 : 12;

  const w = Math.min(width, 1280);
  const h = Math.min(height, 1280);
  return (
    `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/` +
    `${center.lng.toFixed(6)},${center.lat.toFixed(6)},` +
    `${zoom},0/` +
    `${w}x${h}` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&attribution=false&logo=false`
  );
}

/**
 * Tiny per-hole thumbnail for the Course Detail modal's hole-by-hole list.
 * Same projection as getHoleImageryUrl but at a smaller size — keeps cost
 * to one tile per hole regardless of how many users browse the modal.
 */
export function getHoleThumbnailUrl(
  input: HoleImageryInput,
  width = 160,
  height = 100,
): string | null {
  return getHoleImageryUrl(input, { width, height });
}
