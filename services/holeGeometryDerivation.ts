/**
 * 2026-07-14 (Tim — "cheat the paid geometry DB. I have no money for it. Pull up ANY course →
 * AI auto-assembles satellite + geometry") — AI-VISION HOLE GEOMETRY DERIVATION (client).
 *
 * Flow:
 *   1. From a seed coordinate (the player's live GPS, or the course centroid), build a NORTH-UP
 *      satellite tile (bearing 0 — the endpoint requires north-up).
 *   2. Fetch the tile → base64 → POST to /api/hole-scan (our own vision brain, no Google key).
 *   3. Unproject the returned normalized green/tee PIXELS back into lat/lng using the tile's
 *      known center+zoom+size (services/smartVisionOverlay.unprojectTilePixel — the exact
 *      inverse of the marker projection, so no drift).
 *   4. Assemble a HoleGeometry the rest of the app already understands, flagged `estimated: true`.
 *
 * HONESTY / ZERO-REGRESSION (app-wide tenet):
 *   - Returns null when the model says found_green=false — a wrong green is worse than none.
 *   - The result is ESTIMATED. Callers use it ONLY as a fallback when no curated/API geometry
 *     exists, and badge it as AI-estimated. It never overrides real geometry.
 *   - Requires Mapbox configured; degrades to null otherwise (no crash, no fabricated coords).
 */

import * as Sentry from '@sentry/react-native';
import { getApiBaseUrl } from './apiBase';
import { getCenteredImageryUrl, isMapboxConfigured } from './mapboxImagery';
import { unprojectTilePixel, type LatLng } from './smartVisionOverlay';
import { bearingDegrees, haversineMeters } from '../utils/geoDistance';
import { saveDerivedHoleGeometry, type HoleGeometry, type LandmarkFeature } from './courseGeometryService';

/** The side vocabulary LandmarkFeature uses — kept in one place so the derived side can't drift. */
type LandmarkSide = LandmarkFeature['side'];

/** Zoom for the derivation tile. At z16, a 1024px tile spans ~2 km — wide enough to contain a
 *  full par-5 green even when the seed is the tee, while keeping the green large enough (~30-60px)
 *  for the model to localize. Square so x and y normalize identically. */
const TILE_ZOOM = 16;
const TILE_SIZE = 1024;

/**
 * 2026-08-10 (Tim — "locate the green, the tee box, the fairway, hazards correctly and TIGHTLY").
 *
 * THE HARD LIMIT nobody had measured. At z16 a 1024px tile spans ~1990 yards — the whole property,
 * not one hole. A 30-yard green is therefore about **15 pixels across**. You cannot trace 8-14 tight
 * vertices around a 15px blob, and "find THE green" is ambiguous when eighteen of them are in frame.
 * No amount of prompt work fixes that; it is a resolution ceiling. (Verified by pulling the real
 * Connecticut National tile: clubhouse, parking lot and most of the course, all in one frame.)
 *
 * So the read is now TWO PASSES, which is also how a person would do it:
 *   1. LOCATE on the wide z16 tile — plenty for "which blob is this hole's green", the job the wide
 *      view is actually good at.
 *   2. TRACE on a z18 tile re-centred on that green — ~498 yards across, where the same green is
 *      ~62 pixels and its collar, bunker edges and tee pad are genuinely resolvable.
 * Pass 2 is where every outline comes from. If it fails for any reason we keep pass 1's result, so
 * this is strictly additive — worst case is exactly the old behavior.
 */
const TRACE_ZOOM = 18;

/**
 * 2026-08-10 — how many YARDS the square tile spans edge to edge at this latitude.
 * Web-Mercator ground resolution is 156543.03 m/px at z0 scaled by cos(lat), halving each zoom.
 * Sent to the vision route as an absolute scale cue so the model can size-check a candidate green
 * instead of judging it purely on appearance.
 */
function tileSpanYards(lat: number, zoom: number = TILE_ZOOM): number {
  const metresPerPx = (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return Math.round(metresPerPx * TILE_SIZE * 1.09361);
}

/** One scan of one tile. Shared by the locate pass and the trace pass so they cannot drift apart. */
async function scanTile(
  center: LatLng,
  zoom: number,
  opts: { holeNumber: number; par?: number | null; signal: AbortSignal },
): Promise<HoleScanResponse | null> {
  const url = getCenteredImageryUrl({ lat: center.lat, lng: center.lng, zoom, width: TILE_SIZE, height: TILE_SIZE });
  if (!url) return null;
  const b64 = await fetchTileAsBase64(url);
  if (!b64) return null;
  const res = await fetch(`${getApiBaseUrl()}/api/hole-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_b64: b64,
      image_media_type: 'image/jpeg',
      hole_number: opts.holeNumber,
      par: opts.par ?? undefined,
      // The tile's true span at THIS zoom — the model's absolute scale reference, so the same code
      // gives an honest cue whether it's reading the wide locate tile or the tight trace tile.
      tile_span_yards: tileSpanYards(center.lat, zoom),
    }),
    signal: opts.signal,
  });
  if (!res.ok) return null;
  return (await res.json()) as HoleScanResponse;
}
// 2026-08-10 — was 30s for ONE vision pass. The read is now locate + trace (two tile fetches and two
// vision calls, the second returning polygons), so a 30s budget would abort mid-trace and quietly
// throw away a good wide read. This is a background derivation, never a blocking UI wait.
const REQUEST_TIMEOUT_MS = 75_000;

export type DerivedHoleGeometry = HoleGeometry & {
  /** Always true — this geometry came from AI vision, not a curated/API source. */
  estimated: true;
  /** Model self-reported confidence for the green localization. */
  confidence: 'high' | 'medium' | 'low';
};

type NormPoint = { x: number; y: number };

export type HoleScanResponse = {
  found_green: boolean;
  green_center: NormPoint | null;
  green_front: NormPoint | null;
  green_back: NormPoint | null;
  tee: NormPoint | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
  provider?: string;
  // 2026-08-10 (Tim — "locate the green, the tee box, the fairway, hazards correctly and TIGHTLY").
  // The scan now traces OUTLINES, not just centre points. All optional: an older deployment of
  // api/hole-scan (or an honest "couldn't resolve the edge") simply omits them and the derivation
  // degrades to the previous point-only behavior.
  green_polygon?: NormPoint[] | null;
  tee_polygon?: NormPoint[] | null;
  fairway_centerline?: NormPoint[] | null;
  hazards?: { kind: 'bunker' | 'water'; polygon: NormPoint[]; carry_side?: string }[] | null;
};

async function fetchTileAsBase64(url: string): Promise<string | null> {
  // Download the tile to a transient cache file, read it back as base64 (correct binary
  // handling — no Buffer/btoa latin1 assumptions), then delete. Mirrors the local-uri →
  // base64 pattern used elsewhere (glassesVisionInput).
  const FS = await import('expo-file-system/legacy');
  const tmp = `${FS.cacheDirectory ?? ''}holescan_${Math.abs(hashStr(url))}.jpg`;
  try {
    const dl = await FS.downloadAsync(url, tmp);
    if (dl.status !== 200) return null;
    const b64 = await FS.readAsStringAsync(tmp, { encoding: FS.EncodingType.Base64 });
    return b64 || null;
  } catch {
    return null;
  } finally {
    FS.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Derive a single hole's geometry from satellite imagery around `seed`.
 * Returns null on any failure or when the model can't honestly see a green.
 */
export async function deriveHoleGeometry(input: {
  seed: LatLng;              // player GPS or course centroid to center the satellite tile on
  holeNumber: number;
  par?: number | null;
  yardage?: number | null;
  courseId?: string | null;  // when set, the derived hole is persisted to the derived cache
  signal?: AbortSignal;
  /**
   * 2026-08-10 (Tim — "once you get the OSM and you get the coordinates, then you zoom on the
   * available tiles, and you orient it correctly").
   *
   * The KNOWN green (and tee, when we have one) from OSM / golfcourseapi / Course Cloud. When these
   * are supplied, vision is not asked to FIND anything — the search pass is skipped entirely and we
   * go straight to a tight tile centred on the real green. That removes the whole class of error
   * that put a swimming pool on the map, because there is nothing left to guess: the location is
   * given, and vision only reads DETAIL (green edge, tee pad, fairway corridor, hazards).
   *
   * Orientation comes from the known tee→green axis, never from vision, so the hole cannot be drawn
   * rotated even if the model mis-reads a feature.
   */
  knownGreen?: LatLng | null;
  knownTee?: LatLng | null;
}): Promise<DerivedHoleGeometry | null> {
  if (!isMapboxConfigured()) return null;
  const { seed, holeNumber } = input;
  if (!Number.isFinite(seed.lat) || !Number.isFinite(seed.lng)) return null;

  const ctrl = new AbortController();
  const outerSignal = input.signal;
  const onAbort = () => ctrl.abort();
  if (outerSignal) outerSignal.addEventListener('abort', onAbort);
  const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const unproject = (p: { x: number; y: number } | null, center: LatLng, zoom: number): LatLng | null => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      const c = unprojectTilePixel(p.x * TILE_SIZE, p.y * TILE_SIZE, center, zoom, 0, TILE_SIZE, TILE_SIZE);
      return Number.isFinite(c.lat) && Number.isFinite(c.lng) ? c : null;
    };

    /**
     * ── PASS 1 — WHERE IS THE GREEN?
     *
     * SEEDED (the normal case once OSM has run): we already KNOW. Skip the search entirely and go
     * straight to the tight trace. This is the whole point — vision should never be hunting for a
     * green we already hold coordinates for, and every false positive this pipeline has produced
     * came from the hunting, not the reading.
     *
     * UNSEEDED (a course OSM doesn't cover): fall back to locating on the wide tile. At that zoom a
     * green is ~15px, so this pass can only say WHICH blob — the tight pass still has to confirm it.
     */
    const seeded = input.knownGreen && Number.isFinite(input.knownGreen.lat) && Number.isFinite(input.knownGreen.lng)
      ? input.knownGreen
      : null;

    let wide: HoleScanResponse | null = null;
    let coarseGreen: LatLng | null = seeded;
    if (!coarseGreen) {
      wide = await scanTile(seed, TILE_ZOOM, { holeNumber, par: input.par, signal: ctrl.signal });
      if (!wide?.found_green || !wide.green_center) return null;
      coarseGreen = unproject(wide.green_center, seed, TILE_ZOOM);
    } else {
      console.log(`[holeGeometry] hole ${holeNumber}: SEEDED from known coords — skipping the locate pass`);
    }
    if (!coarseGreen) return null;

    // ── PASS 2 — TRACE on a tight tile re-centred on that green. Same green is now ~62px, so the
    // collar, bunker lips and tee pad are actually resolvable. Everything we render comes from here.
    // Any failure falls back to the wide read, so this can only add detail, never remove it.
    let data: HoleScanResponse | null = wide;
    let tileCenter: LatLng = seed;
    let tileZoom = TILE_ZOOM;
    const tight = await scanTile(coarseGreen, TRACE_ZOOM, { holeNumber, par: input.par, signal: ctrl.signal }).catch(() => null);

    if (tight?.found_green && tight.green_center) {
      data = tight;
      tileCenter = coarseGreen;
      tileZoom = TRACE_ZOOM;
    } else if (tight && !tight.found_green) {
      /**
       * 2026-08-10 — PASS 2 IS THE VERIFIER, not just a refiner. This distinction is the difference
       * between an elite read and a confident lie, and it was found by testing rather than reasoning:
       * pointed at Connecticut National's wide tile, the model located a "green" with HIGH confidence
       * on a private house 945m away — reporting the swimming pool as a water hazard and the driveway
       * and patio as bunkers. Its own polygon was a perfectly plausible 16y x 28y, so neither the
       * extent check nor the confidence field caught it. Nothing in the model's self-report could.
       *
       * What DID catch it: looking closer. A tight tile re-centred on the claim returns
       * found_green=false, because at 62px-per-green the house is obviously a house. So a NEGATIVE
       * verdict from the tight pass now discards the derivation outright.
       *
       * The distinction below is load-bearing: `tight === null` is a TRANSPORT failure (timeout,
       * offline, 5xx) — no verdict was reached, so we keep the wide read, degraded. `found_green
       * === false` is a VERDICT — the close look actively disproved the claim, and a disproved
       * green must never reach the map.
       */
      // SEEDED case: the coordinates came from OSM, not from a guess, so a vision "no green here"
      // does NOT disprove them — it just means the model couldn't read the edge (imagery age, tree
      // shadow, winter turf). Keep the known geometry and go on without vision detail. Only an
      // UNSEEDED claim, which vision itself invented, can be disproved by vision.
      if (seeded) {
        console.log(`[holeGeometry] hole ${holeNumber}: trace pass saw no green at the KNOWN coords — keeping OSM geometry, no vision detail`);
        data = null;
      } else {
        console.log(`[holeGeometry] hole ${holeNumber}: trace pass DISPROVED the located green — discarding (${tight.notes || 'no green at that spot'})`);
        return null;
      }
    } else {
      console.log(`[holeGeometry] hole ${holeNumber}: trace pass unreachable — keeping the wide read unverified`);
    }
    // Seeded with no usable vision read at all: still emit the hole from the known coordinates.
    // The geometry we were given is the product; vision detail is the enhancement.
    if (!data && !seeded) return null;

    /**
     * From here on the code reads ONE object. When we're seeded and vision gave us nothing usable,
     * this is an empty read: the known coordinates still produce a hole, just without traced detail.
     * Confidence is 'high' in the seeded case because the LOCATION came from surveyed OSM data, not
     * from a model — the missing polygons are detail, not doubt about where the hole is.
     */
    const scan: HoleScanResponse = data ?? {
      found_green: true,
      green_center: null,
      green_front: null,
      green_back: null,
      tee: null,
      confidence: 'high',
      notes: 'Seeded from known course geometry; vision detail unavailable.',
    };

    // Unproject normalized pixels → lat/lng against WHICHEVER tile produced `data` (north-up,
    // square TILE_SIZE). Binding these together is what stops a pass-2 pixel being read against
    // pass-1's projection, which would silently offset every coordinate on the hole.
    const toCoord = (p: { x: number; y: number } | null): LatLng | null => unproject(p, tileCenter, tileZoom);

    /**
     * 2026-08-10 — the KNOWN green is the location; vision supplies detail around it.
     *
     * When seeded, the surveyed coordinate wins outright — it cannot drift because a model nudged
     * the centre onto the apron. And if vision's own centre lands far from the known green, that
     * read is about some OTHER feature (a neighbouring green, a bunker, a pale patch), so its
     * outlines and hazards are discarded rather than being stitched onto this hole.
     */
    const visionGreen = toCoord(scan.green_center);
    const green = seeded ?? visionGreen;
    if (!green) return null;
    const visionDriftYds = seeded && visionGreen ? haversineMeters(seeded, visionGreen) * 1.09361 : 0;
    const visionAgrees = !seeded || !visionGreen || visionDriftYds <= 60;
    if (!visionAgrees) {
      console.log(`[holeGeometry] hole ${holeNumber}: vision centre ${Math.round(visionDriftYds)}y off the known green — dropping its detail, keeping surveyed coords`);
    }

    const green_front = visionAgrees ? toCoord(scan.green_front) : null;
    const green_back = visionAgrees ? toCoord(scan.green_back) : null;
    const tee = visionAgrees ? toCoord(scan.tee) : null;

    // Sanity: reject an "estimated" green implausibly far from the seed (>800m ≈ 875y) — that's a
    // mis-projection or a hallucinated far-field green, not a hole the player is standing on.
    // Skipped when seeded: the coordinate is surveyed, and the seed may legitimately be the
    // clubhouse or a distant tee, so distance from it says nothing about correctness.
    if (!seeded && haversineMeters(seed, green) > 800) return null;

    // 2026-08-10 — unproject each traced OUTLINE the same way as the points, dropping any vertex
    // that fails to project. A ring reduced below 3 usable vertices isn't a shape, so it becomes
    // null rather than a degenerate sliver.
    const toRing = (pts: NormPoint[] | null | undefined, minPts: number): LatLng[] | null => {
      if (!Array.isArray(pts)) return null;
      const ring = pts.map(toCoord).filter((c): c is LatLng => c != null);
      return ring.length >= minPts ? ring : null;
    };
    const greenOutline = visionAgrees ? toRing(scan.green_polygon, 3) : null;
    const teeOutline = visionAgrees ? toRing(scan.tee_polygon, 3) : null;
    const fairwayLine = visionAgrees ? toRing(scan.fairway_centerline, 2) : null;

    /**
     * 2026-08-10 — SCORECARD VERIFICATION, the same discipline that fixed the OSM tee↔green
     * mis-pairing: when we know the hole's real yardage, the vision read has to AGREE with it.
     * A tee the model placed on the wrong pad (or on a neighbouring hole) shows up immediately as
     * a tee→green distance nothing like the card. Drop that tee and its bearing rather than draw a
     * confidently mis-oriented hole; the green — the part live GPS yardages depend on — is kept.
     */
    /**
     * 2026-08-10 (Tim — "you get the coordinates, then you zoom on the available tiles, and you
     * orient it correctly"). ORIENTATION COMES FROM THE KNOWN AXIS, NOT FROM VISION.
     *
     * A surveyed OSM tee is authoritative; a vision-read tee is a guess about a small pale
     * rectangle. When we have the real one, it wins outright — so the hole can never render rotated
     * because the model picked the wrong pad. Vision's tee is only consulted when nothing else
     * knows where the tee is, and even then it has to survive the scorecard check below.
     */
    let verifiedTee = input.knownTee && Number.isFinite(input.knownTee.lat) && Number.isFinite(input.knownTee.lng)
      ? input.knownTee
      : tee;
    const teeIsKnown = verifiedTee === input.knownTee && verifiedTee != null;
    const cardYards = input.yardage ?? 0;
    if (verifiedTee && !teeIsKnown && cardYards > 0) {
      const measured = haversineMeters(verifiedTee, green) * 1.09361;
      if (measured > cardYards * 1.35 || measured < cardYards * 0.65) {
        console.log(`[holeGeometry] hole ${holeNumber}: vision tee ${Math.round(measured)}y vs card ${cardYards}y — rejecting tee`);
        verifiedTee = null;
      }
    }

    const bearing_deg = verifiedTee ? bearingDegrees(verifiedTee, green) : null;

    // Bunkers/water carry their own outline + centroid so the renderer and the brain can both use
    // them (distance-to-carry, "bunker short-left") without re-deriving anything.
    const centroidOf = (ring: LatLng[]): LatLng => ({
      lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length,
      lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length,
    });
    /**
     * Which SIDE of the hole a hazard sits on, derived from geometry rather than taken from the
     * model's word for it — the caddie says "bunker short-left", and that phrase has to be true.
     * Greenside (within 30y of the green) wins over left/right because it's the more useful fact;
     * otherwise the sign of the cross product of tee→green against tee→hazard gives the side.
     * Null when there's no verified tee to reference, per the honesty rule.
     */
    const sideOf = (p: LatLng): LandmarkSide => {
      if (haversineMeters(p, green) * 1.09361 <= 30) return 'greenside';
      if (!verifiedTee) return null;
      const ax = green.lng - verifiedTee.lng, ay = green.lat - verifiedTee.lat;
      const bx = p.lng - verifiedTee.lng, by = p.lat - verifiedTee.lat;
      const cross = ax * by - ay * bx;
      if (!Number.isFinite(cross) || cross === 0) return null;
      // Looking down the hole from the tee, a positive cross product is to the player's LEFT.
      return cross > 0 ? 'left' : 'right';
    };

    const scanned = visionAgrees && Array.isArray(scan.hazards) ? scan.hazards : [];
    const features = scanned
      .map((h) => {
        const ring = toRing(h.polygon, 3);
        if (!ring) return null;
        const centroid = centroidOf(ring);
        const side = sideOf(centroid);
        return {
          kind: h.kind,
          polygon: ring,
          centroid,
          side,
          // A readable label the brain and the UI can both quote: "Bunker (short-left)" reads like
          // a caddie; an unnamed polygon reads like a database row.
          name: side ? `${h.kind === 'water' ? 'Water' : 'Bunker'} (${side})` : h.kind === 'water' ? 'Water' : 'Bunker',
        };
      })
      .filter((h): h is { kind: 'bunker' | 'water'; polygon: LatLng[]; centroid: LatLng; side: LandmarkSide; name: string } => h != null);
    const bunkers = features.filter((f) => f.kind === 'bunker').map(({ polygon, centroid, side, name }) => ({ polygon, centroid, side, name }));
    const waters = features.filter((f) => f.kind === 'water').map(({ polygon, centroid, side, name }) => ({ polygon, centroid, side, name }));

    const derived: DerivedHoleGeometry = {
      hole_number: holeNumber,
      par: input.par ?? 0,
      yardage: input.yardage ?? 0,
      tee: verifiedTee,
      green,
      green_front,
      green_back,
      bearing_deg,
      // Labeled hazard points for the text/brain surfaces that read `hazards`.
      hazards: features.map((f) => ({ label: f.name, location: f.centroid })),
      fairway_centerline: fairwayLine ?? [],
      green_outline: greenOutline ?? [],
      green_polygon: greenOutline,
      tee_polygon: teeOutline,
      bunkers,
      water_hazards: waters,
      estimated: true,
      estimated_confidence: scan.confidence,
      confidence: scan.confidence,
    };

    // Anchor into the derived (estimated) CNS geometry cache — offline + brain-readable — when
    // we know the course. Best-effort; a persistence failure never fails the derivation.
    if (input.courseId) {
      await saveDerivedHoleGeometry(input.courseId, derived).catch(() => null);
      // 2026-07-23 — Course Cloud: share this AI-derived hole (consent-gated inside) so the
      // next player of this course reads it back with no AI pass. Fire-and-forget; require
      // lazily so this module has no hard dependency on the sharing path.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cc = require('./courseCloud') as typeof import('./courseCloud');
        void cc.shareCourseGeometry(input.courseId, [derived]);
      } catch { /* sharing is optional */ }
    }

    return derived;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
    try { Sentry.addBreadcrumb({ category: 'hole_scan', level: 'info', message: `derive hole ${holeNumber}` }); } catch {}
  }
}
