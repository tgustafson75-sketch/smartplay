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
 * Cache: per-hole via React Native's built-in Image cache (OS-
 * managed). Imagery rarely changes (course aerial photography
 * updates on a multi-year cadence), so cached tiles are good for the
 * lifetime of the install. There is no app-controlled cache clear —
 * the OS evicts the cache periodically. Don't add a "Clear cache"
 * button until a real cache layer (FileSystem or a Mapbox SDK) is
 * wired up.
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
import { haversineMeters, bearingDegrees } from '../utils/geoDistance';
import { isValidGolfCoord } from '../utils/coordGuard';

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


function autoZoom(yardage: number, par: number): number {
  // Tighter view on short holes, wider on long.
  if (par === 3 || yardage < 180) return 18;
  if (yardage < 400) return 17;
  return 16;
}

// Phase 401 — meters-per-pixel at the equator, Mapbox Web Mercator.
const MAPBOX_BASE_MPP = 156543.03392;

function metersPerPixel(lat: number, zoom: number): number {
  return (MAPBOX_BASE_MPP * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

// 2026-05-21 — Consolidation 1: local haversineMeters removed in favor of
// utils/geoDistance.ts canonical (mathematically identical formula).

export type FitView = {
  center: { lat: number; lng: number };
  zoom: number;
  bearing: number;
};

/**
 * Phase 401 — compute the Mapbox center/zoom/bearing that fits the
 * entire tee→green axis plus `marginPct` margin (default 15%) into a
 * container of size `width × height` pixels. Used as the single source
 * of truth for both URL-builder and projectToPixels(), so markers
 * always land on the right pixel of the rendered tile.
 *
 * Behavior:
 *   - center: midpoint of tee→green (50%, NOT the legacy 55%) so
 *     margin is symmetric above and below the hole axis.
 *   - bearing: tee→green compass bearing, so Mapbox rotates the camera
 *     and the hole runs vertically in the rendered tile.
 *   - zoom: largest integer zoom level at which the hole length plus
 *     2×margin still fits in the container height. Clamped to [13, 19]
 *     so we never under- or over-zoom for unusual hole geometries.
 *
 * Returns null if tee or green is missing.
 */
export function computeFitView(input: {
  tee: { lat: number; lng: number } | null;
  green: { lat: number; lng: number };
  width: number;
  height: number;
  marginPct?: number;
}): FitView | null {
  const { tee, green, width, height } = input;
  const marginPct = input.marginPct ?? 0.15;
  if (!tee) {
    // No tee — center on green, default zoom.
    return { center: green, zoom: 17, bearing: 0 };
  }
  const center = {
    lat: tee.lat + (green.lat - tee.lat) * 0.5,
    lng: tee.lng + (green.lng - tee.lng) * 0.5,
  };
  const bearing = bearingDegrees(tee, green);
  const holeMeters = haversineMeters(tee, green);
  // Need at least holeMeters * (1 + 2*marginPct) of meters covered along
  // the container's *height* (since bearing-rotation puts the hole
  // vertical). Solve for zoom: height * mpp(lat, z) >= required meters.
  const requiredMeters = holeMeters * (1 + 2 * marginPct);
  // requiredMeters = height * (BASE_MPP * cos(lat)) / 2^zoom
  // 2^zoom = height * BASE_MPP * cos(lat) / requiredMeters
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const targetTwoPow = (height * MAPBOX_BASE_MPP * cosLat) / requiredMeters;
  const rawZoom = Math.log2(targetTwoPow);
  // Floor to nearest integer so we err on the side of MORE margin, never less.
  let zoom = Math.floor(rawZoom);
  if (!Number.isFinite(zoom)) zoom = 17;
  zoom = Math.max(13, Math.min(19, zoom));
  // Sanity: verify the width also fits (a strongly diagonal hole could
  // demand more horizontal coverage than our container provides after
  // rotation). bearing-rotation aligns the hole vertically, so width
  // only needs to cover fairway breadth (~50–80 yds typical). The
  // height-fit zoom should always be permissive enough for width.
  void width;
  return { center, zoom, bearing };
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
  // 2026-06-14 — coord-guard the inputs. Several bundled courses carry 0,0
  // placeholder hole coords; the old `!input.green` check let those through and
  // built a satellite tile centered on 0°,0° (ocean off West Africa) — the
  // "parking lots / houses" thumbnails. Require a VALID green (rejects 0,0 /
  // near-zero / out-of-range), and degrade an invalid tee to null so we center
  // on the green at default zoom instead of computing a view from a 0,0 tee.
  const green = input.green && isValidGolfCoord(input.green.lat, input.green.lng) ? input.green : null;
  if (!green) return null;
  const tee = input.tee && isValidGolfCoord(input.tee.lat, input.tee.lng) ? input.tee : null;

  const width = Math.min(options.width ?? 600, 1280);
  const height = Math.min(options.height ?? 500, 1280);

  // Phase 401 — single source of truth for center/zoom/bearing.
  // computeFitView() picks the zoom that guarantees the entire hole +
  // 15% margin fits the requested container height, centers at the
  // tee→green midpoint (symmetric margin), and bearing-rotates so the
  // hole renders vertically. Caller can still override any of the three
  // via options.{centerOverride, zoomOverride, bearingOverride}.
  const fit = computeFitView({ tee, green, width, height });
  const center = options.centerOverride ?? fit?.center ?? green;
  const bearing = options.bearingOverride ?? fit?.bearing ?? 0;
  const zoom = options.zoom ?? fit?.zoom ?? autoZoom(input.yardage, input.par);

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

  // Phase 401 — cache key must match the URL's actual zoom. We derive
  // it from computeFitView() the same way getHoleImageryUrl does, so
  // the cache lookup hits the file getHoleImageryUrl will eventually
  // produce. Falling back to autoZoom only when fit cannot be computed.
  const w = Math.min(options.width ?? 600, 1280);
  const h = Math.min(options.height ?? 500, 1280);
  // Mirror getHoleImageryUrl's coord-guard so the cache-key zoom matches the
  // URL's actual zoom (an invalid 0,0 tee degrades to null → green-centered
  // default zoom — otherwise the cache key would never match and we'd re-fetch).
  const green = input.green && isValidGolfCoord(input.green.lat, input.green.lng) ? input.green : null;
  const tee = input.tee && isValidGolfCoord(input.tee.lat, input.tee.lng) ? input.tee : null;
  const fit = green ? computeFitView({ tee, green, width: w, height: h }) : null;
  const zoom = options.zoom ?? fit?.zoom ?? autoZoom(input.yardage, input.par);
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
 * 2026-05-16 — Centered satellite tile from a single lat/lng. Used as the
 * fallback when a course has only a centroid (no per-hole tee/green
 * geometry) — e.g. Sunnyvale + San Jose Muni — so we can stop relying on
 * the Golfshot screenshots Tim originally bundled. Every hole on those
 * courses shows the same wide course view until per-hole geometry exists.
 * Pure URL construction; no Mapbox-token side effects.
 */
export type CenteredImageryInput = {
  lat: number;
  lng: number;
  zoom?: number;
  width?: number;
  height?: number;
};

export function getCenteredImageryUrl(input: CenteredImageryInput): string | null {
  if (!MAPBOX_TOKEN) return null;
  const zoom = input.zoom ?? 16;
  const w = Math.min(input.width ?? 800, 1280);
  const h = Math.min(input.height ?? 600, 1280);
  return (
    `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/` +
    `${input.lng.toFixed(6)},${input.lat.toFixed(6)},${zoom},0/` +
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
