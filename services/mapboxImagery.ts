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

import { Directory, File, Paths } from 'expo-file-system';
import { haversineMeters, bearingDegrees } from '../utils/geoDistance';
import { isValidGolfCoord } from '../utils/coordGuard';

// 2026-06-23 — EXPO_PUBLIC_* is inlined at BUILD time, so eas-update OTA bundles
// built without it get '' and all satellite imagery goes dark (same trap as the
// API base-URL spine). A Mapbox `pk.` token is a PUBLIC client token — designed to
// ship in client code — so a hardcoded fallback is safe and makes imagery work over
// OTA with no native rebuild. Rotate via the Mapbox dashboard if ever needed.
const MAPBOX_PUBLIC_FALLBACK =
  'pk.eyJ1Ijoic21hcnRwbGF5Y2FkZGllIiwiYSI6ImNtb28yZm9wNzE2YXYyb3B4aTZpdzVxd2sifQ.-8O0hpwyO5XRNPz5cc541w';
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || MAPBOX_PUBLIC_FALLBACK;
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

/**
 * 2026-09-23 — MEASURED, NOT ASSUMED. Mapbox Static Images zoom is on 512-px tiles: 78271.5 m/px at
 * the equator at z0. Every projection here used 156543 (the 256-px raster figure), twice the truth.
 * Drawn at 16, 600x600, 33.683N: a 150 m line measured 148 px (this constant predicts 149; the old
 * one 75), and a 300 m line ran off the edge (old constant: it would have ended at px 451).
 *
 * What that did: computeFitView picked a zoom one level too tight, so the tile showed about half the
 * hole it was sized for (the tee "always cut off"), and every marker, the player's dot and every
 * tapped yardage were projected at half their true distance from the centre. AI-found greens were
 * unprojected at twice theirs. ONE constant now, used by every projection in the app.
 */
export const MAPBOX_Z0_METERS_PER_PX = 78271.51696;

export function mapboxMetersPerPixel(lat: number, zoom: number): number {
  return (MAPBOX_Z0_METERS_PER_PX * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}
const MAPBOX_BASE_MPP = MAPBOX_Z0_METERS_PER_PX;

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
  // 2026-06-30 (Tim — Greenhill 8292: "the images are a little zoomed so the green gets
  // overlapped by graphics") — nudged 0.15 → 0.20 so the green + tee sit further inside the
  // frame, clear of the top vignette + the P marker. Modest on purpose: a big increase would
  // re-trigger the 2026-06-23 "it zooms the hell out, we don't isolate the holes" complaint.
  // Default drives BOTH the projection (smartvision) and the fetched tile (getHoleImageryUrl),
  // so they stay aligned. Callers can still override via input.marginPct.
  const marginPct = input.marginPct ?? 0.24;
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
  // 2026-06-23 (Tim — "it zooms the hell out, we don't isolate the holes") —
  // Math.floor() discarded up to a FULL zoom level, and zoom is log2, so the
  // worst case rendered the hole ~2× too far out (tee/pin pushed toward the
  // edges, clipped on wide Fold-open aspect). Mapbox accepts fractional zoom,
  // and the 15% margin already guards the endpoints, so keep the PRECISE zoom
  // (rounded to 0.1 for stable cache keys) — the hole now fills the frame.
  let zoom = Math.round(rawZoom * 10) / 10;
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
/**
 * 2026-09-23 (Tim — "I get SmartVision images correctly every time") — THE FRAME OF A TILE.
 *
 * Everything SmartVision draws on a tile (tee, pin, the player's dot, a tapped target's yardage) is
 * projected with a centre, zoom and bearing. Those have to be the ones the tile ON SCREEN was
 * rendered with. They were recomputed separately, from a different tee source, at a different
 * size, and re-centred when the green was marked — while a cached tile of another framing could
 * be the one displayed. A tile now carries its frame, and the screen projects with that.
 */
export type TileFrame = { center: { lat: number; lng: number }; zoom: number; bearing: number; width: number; height: number };

/** The frame getHoleImageryUrl renders for this hole at this size (null: no valid green). */
export function frameForHole(input: HoleImageryInput, options: HoleImageryOptions = {}): TileFrame | null {
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
  const fit = computeFitView({ tee, green, width, height });
  return {
    center: options.centerOverride ?? fit?.center ?? green,
    bearing: Math.round((options.bearingOverride ?? fit?.bearing ?? 0) * 10) / 10,
    zoom: options.zoom ?? fit?.zoom ?? autoZoom(input.yardage, input.par),
    width,
    height,
  };
}

/** The Static Images URL for exactly this frame. */
export function urlForFrame(frame: TileFrame): string | null {
  if (!MAPBOX_TOKEN) return null;
  return (
    `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/` +
    `${frame.center.lng.toFixed(6)},${frame.center.lat.toFixed(6)},` +
    `${frame.zoom},${frame.bearing.toFixed(1)}/` +
    `${frame.width}x${frame.height}` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&attribution=false&logo=false`
  );
}

/**
 * The frame to PROJECT with when a tile of `frame` is drawn `resizeMode="cover"` into a
 * containerW x containerH box: cover scales by the larger ratio and crops about the centre, so the
 * centre and bearing hold and the zoom rises by log2 of that scale.
 */
export function displayFrame(frame: TileFrame, containerW: number, containerH: number): { center: { lat: number; lng: number }; zoom: number; bearing: number } {
  const scale = Math.max(containerW / frame.width, containerH / frame.height);
  return { center: frame.center, bearing: frame.bearing, zoom: frame.zoom + Math.log2(scale > 0 && Number.isFinite(scale) ? scale : 1) };
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
  const frame = frameForHole(input, options);
  return frame ? urlForFrame(frame) : null;
}

function safeCourseKey(courseId: string | null): string {
  return (courseId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * The tile's file name IS its frame: course, hole, centre, zoom, bearing, size. Two consequences,
 * both the point: a hole whose geometry changed (an engine rebuild, a corrected green, a layout
 * switch) can never be served its old picture under the new frame, and any cached tile can be
 * projected correctly because its frame is read back from its name.
 */
const FRAME_TAG = 'f2';
function holePrefix(courseId: string | null, holeNumber: number): string {
  return `${CACHE_DIR_NAME}_${FRAME_TAG}_${safeCourseKey(courseId)}_h${holeNumber}_`;
}
export function tileFileName(courseId: string | null, holeNumber: number, f: TileFrame): string {
  return `${holePrefix(courseId, holeNumber)}${f.center.lat.toFixed(6)}_${f.center.lng.toFixed(6)}_z${f.zoom}_b${f.bearing.toFixed(1)}_${f.width}x${f.height}.png`;
}
export function frameFromFileName(name: string): TileFrame | null {
  const m = /_(-?\d+\.\d{6})_(-?\d+\.\d{6})_z(\d+(?:\.\d+)?)_b(-?\d+\.\d)_(\d+)x(\d+)\.png$/.exec(name);
  if (!m) return null;
  const f = { center: { lat: Number(m[1]), lng: Number(m[2]) }, zoom: Number(m[3]), bearing: Number(m[4]), width: Number(m[5]), height: Number(m[6]) };
  return isValidGolfCoord(f.center.lat, f.center.lng) && f.width > 0 && f.height > 0 ? f : null;
}

let cacheListing: { at: number; names: string[] } | null = null;
const CACHE_LISTING_TTL_MS = 30_000;

function listCache(): string[] {
  const now = Date.now();
  if (!cacheListing || now - cacheListing.at > CACHE_LISTING_TTL_MS) {
    // Listing the cache directory is not free, so it is memoized briefly — a hole view flicks
    // through several holes in a few seconds and must not re-walk the directory each time.
    const entries = new Directory(Paths.cache).list();
    cacheListing = { at: now, names: entries.map((e) => e.uri.slice(e.uri.lastIndexOf('/') + 1)) };
  }
  return cacheListing.names;
}

/**
 * The cached tiles of this hole, closest in frame to `want` first: same centre and bearing (the
 * same geometry) before anything else. A tile of stale geometry is still a picture of the right
 * hole, and with its frame read back it is projected correctly — it is only ever the fallback.
 */
function cachedTilesForHole(courseId: string | null, holeNumber: number, want: TileFrame): { uri: string; frame: TileFrame }[] {
  try {
    const prefix = holePrefix(courseId, holeNumber);
    const out: { uri: string; frame: TileFrame; score: number }[] = [];
    for (const n of listCache()) {
      if (!n.startsWith(prefix)) continue;
      const frame = frameFromFileName(n);
      if (!frame) continue;
      const sameGeometry = sameSpot(frame, want) ? 0 : 1;
      const aspect = Math.abs(frame.width / frame.height - want.width / want.height);
      out.push({ uri: new File(Paths.cache, n).uri, frame, score: sameGeometry * 10 + aspect });
    }
    return out.sort((a, b) => a.score - b.score).map(({ uri, frame }) => ({ uri, frame }));
  } catch {
    return []; // a cache miss is never worth an exception
  }
}

function sameSpot(a: TileFrame, b: TileFrame): boolean {
  return a.center.lat.toFixed(6) === b.center.lat.toFixed(6) && a.center.lng.toFixed(6) === b.center.lng.toFixed(6)
    && a.bearing.toFixed(1) === b.bearing.toFixed(1);
}

/** Tiles of this hole drawn for geometry it no longer has — superseded, so removed on a fresh write. */
function evictStale(courseId: string | null, holeNumber: number, current: TileFrame): void {
  try {
    const prefix = holePrefix(courseId, holeNumber);
    for (const n of listCache()) {
      if (!n.startsWith(prefix)) continue;
      const f = frameFromFileName(n);
      if (f && !sameSpot(f, current)) {
        try { new File(Paths.cache, n).delete(); } catch { /* already gone */ }
      }
    }
  } catch { /* eviction is housekeeping; never an error */ }
}

export type HoleTile = {
  /** What to draw now: the exact cached file, else the live URL. */
  uri: string;
  frame: TileFrame;
  /** A cached tile of this hole to draw if `uri` fails to load (no signal), with ITS frame. */
  fallback: { uri: string; frame: TileFrame } | null;
};

const writesInFlight = new Set<string>();

/**
 * The tile for this hole at this size, with the frame it is rendered in.
 *
 * Exact file on disk → that. Otherwise the live URL — never a cached tile of another framing in
 * its place while there may be signal — plus that cached tile as the fallback for when the live
 * load fails. The exact file is written in the background for next time.
 */
/**
 * The same answer with no download: for surfaces that draw a tile but should not write one (the
 * caddie tab's hole preview). The exact file when it is on disk, else the live URL, with this
 * hole's cached tile as the fallback — so a preview with no signal still shows the hole.
 */
export function holeTile(input: HoleImageryInput, options: HoleImageryOptions = {}): HoleTile | null {
  const frame = frameForHole(input, options);
  const url = frame ? urlForFrame(frame) : null;
  if (!frame || !url) return null;
  try {
    const cacheFile = new File(Paths.cache, tileFileName(input.courseId, input.holeNumber, frame));
    if (cacheFile.exists) return { uri: cacheFile.uri, frame, fallback: null };
  } catch { /* a cache read is never worth an exception */ }
  return { uri: url, frame, fallback: cachedTilesForHole(input.courseId, input.holeNumber, frame)[0] ?? null };
}

export async function fetchHoleImagery(
  input: HoleImageryInput,
  options: HoleImageryOptions = {},
): Promise<HoleTile | null> {
  const tile = holeTile(input, options);
  if (!tile) return null;
  if (tile.uri.startsWith('file:')) return tile;
  const { frame, fallback } = tile;
  const url = tile.uri;
  const name = tileFileName(input.courseId, input.holeNumber, frame);
  const cacheFile = new File(Paths.cache, name);

  if (!writesInFlight.has(name)) {
    writesInFlight.add(name);
    void (async () => {
      try {
        // 2026-07-06 (audit) — bound the wait; a stalled download abandons the write, never hangs.
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        cacheFile.write(new Uint8Array(buf));
        cacheListing = null; // a new file exists; do not serve a stale listing
        evictStale(input.courseId, input.holeNumber, frame);
        cacheListing = null;
      } catch (e) {
        console.log('[mapboxImagery] cache write failed:', e);
      } finally {
        writesInFlight.delete(name);
      }
    })();
  }

  return { uri: url, frame, fallback };
}

/**
 * 2026-09-23 — the size SmartVision actually draws at, so round prep caches the tile it will ask
 * for, not a 600x500 nobody requests. Remembered for the session once SmartVision has measured its
 * container; before that, the default.
 */
let preferredTileSize: { width: number; height: number } | null = null;
export function rememberTileSize(width: number, height: number): void {
  if (width > 0 && height > 0) preferredTileSize = { width: Math.min(Math.round(width), 1280), height: Math.min(Math.round(height), 1280) };
}
export function tileSizeForPrefetch(): { width: number; height: number } | undefined {
  return preferredTileSize ?? undefined;
}

/**
 * Pre-fetch a range of holes during round prep so subsequent navigation
 * is instant. Fire-and-forget; errors are swallowed.
 */
export async function prefetchHoles(
  inputs: HoleImageryInput[],
  options: HoleImageryOptions = {},
): Promise<void> {
  const size = options.width || options.height ? {} : tileSizeForPrefetch() ?? {};
  await Promise.all(inputs.map(i => fetchHoleImagery(i, { ...size, ...options }).catch(() => null)));
}

/**
 * Course-wide aerial — single Mapbox tile sized to span the bounding box
 * of all hole geometries. Used as the hero thumbnail on Course Detail
 * before a round starts. Returns null if Mapbox isn't configured or no
 * hole has usable coordinates.
 */
export type CourseImageryInput = {
  courseId: string | null;
  holes: { tee: { lat: number; lng: number } | null; green: { lat: number; lng: number } | null }[];
};

export function getCourseImageryUrl(
  input: CourseImageryInput,
  width = 800,
  height = 400,
): string | null {
  if (!MAPBOX_TOKEN) return null;
  // Collect all valid coords
  const coords: { lat: number; lng: number }[] = [];
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

/** The frame a centred, north-up tile is rendered in. */
export function centeredFrame(input: CenteredImageryInput): TileFrame {
  return {
    center: { lat: input.lat, lng: input.lng }, zoom: input.zoom ?? 16, bearing: 0,
    width: Math.min(input.width ?? 800, 1280), height: Math.min(input.height ?? 600, 1280),
  };
}

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
