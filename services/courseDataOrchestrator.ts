/**
 * 2026-05-22 — Course Data Orchestration Layer.
 *
 * One unified API in front of every course-data source:
 *   - courseGeometryService     → tee/green points + polygons (golfcourseapi + OSM Overpass)
 *   - courseGreenOverrides      → manual lat/lng corrections per hole
 *   - mapboxImagery             → satellite tile URLs (per-hole + course-wide)
 *   - localCourseImages         → bundled screenshots (legacy + offline fallback)
 *   - glassesVisionInput        → live camera frame context (Meta Ray-Ban future)
 *   - gpsManager rolling buffer → sustained-position history for reconciliation
 *
 * Consumers (SmartVision, HoleView, holeReconciliation, voice intents,
 * the brain prompt builder) all read THIS module instead of poking at
 * the underlying services. That decouples them from data-source churn
 * and means a new source only has to register here once.
 *
 * Design notes:
 *   - All accessors are SYNCHRONOUS where possible. Geometry is cached;
 *     imagery URLs are pure URL construction; the sustained-fix buffer
 *     is in-memory. Async surfaces (`primeCourse`) exist only to warm
 *     the geometry cache up front.
 *   - Every assembled view carries a per-section CONFIDENCE score so
 *     UI surfaces can show the user how much to trust what they see.
 *     This is the "data honesty" lever (CLAUDE.md: no fake precision).
 *   - The vision hook (attachVisionContextToHole) is a stub today —
 *     it just records that a frame was attached. When the multimodal
 *     model wiring lands, the registered frame will travel with the
 *     next brain.ts call for that hole.
 */

import {
  fetchCourseGeometry,
  getCachedGeometry,
  getHoleGeometry,
  type HoleGeometry,
  type LandmarkFeature,
  type Polygon,
} from './courseGeometryService';
import {
  getHoleImageryUrl,
  getCourseImageryUrl,
  getHoleThumbnailUrl,
  getCenteredImageryUrl,
  isMapboxConfigured,
} from './mapboxImagery';
import { LOCAL_COURSE_CENTROIDS, type LocalCourseSlug } from '../data/localCourseImages';
import type { GpsFix } from './gpsManager';
import { haversineYards, bearingDegrees } from '../utils/geoDistance';
import { getActiveVisionContext, type VisionContext } from './glassesVisionInput';
import type { ShotLocation } from '../store/roundStore';
import { devLog } from './devLog';

// ─── Confidence model ────────────────────────────────────────────────────

/**
 * Per-source confidence. Numbers are 0..100; UI thresholds:
 *   >=80  "High confidence" (green check)
 *   60-79 "Good"           (white)
 *   40-59 "Approximate"    (amber)
 *   <40   "Unverified"     (red — show manual-correction hint)
 *
 * Tuning is intentionally conservative: when in doubt, downgrade.
 * Better to tell the user "approximate" and have them trust the data
 * than overpromise and erode trust.
 */
export interface DataConfidence {
  /** Tee + green centroid confidence. 0 when missing entirely. */
  geometry: number;
  /** Polygon fidelity (fairway / green / bunkers). 0 when point-only. */
  polygons: number;
  /** Visual asset (satellite tile or bundled screenshot). */
  imagery: number;
  /** Live vision frame freshness. 0 when no frame attached. */
  vision: number;
  /** Weighted overall used for the headline trust badge. */
  overall: number;
}

// ─── Unified type ────────────────────────────────────────────────────────

/**
 * Full course-data snapshot for one hole. Every field is optional so
 * partial data (a course we only have geometry for, no imagery) still
 * renders gracefully.
 */
export interface CourseHoleView {
  /** Stable key for the consumer's memoization. */
  course_id: string;
  hole_number: number;
  par: number | null;
  yardage_yd: number | null;

  // Geometry
  tee: ShotLocation | null;
  green: ShotLocation | null;
  green_front: ShotLocation | null;
  green_back: ShotLocation | null;
  bearing_deg: number | null;
  hazards: { label: string; location: ShotLocation | null }[];
  fairway_polygons: Polygon[];
  green_polygon: Polygon | null;
  tee_polygon: Polygon | null;
  bunkers: LandmarkFeature[];
  water_hazards: LandmarkFeature[];

  // Visual
  imagery_url: string | null;
  thumbnail_url: string | null;
  imagery_source: 'mapbox' | 'bundled_screenshot' | 'centroid_fallback' | 'none';

  // Live overlays
  player_location: ShotLocation | null;
  player_to_green_yd: number | null;
  player_heading_deg: number | null;
  sustained_heading_deg: number | null;

  // Vision (Meta Ray-Ban future)
  vision_context: VisionContext | null;

  // Trust
  confidence: DataConfidence;
  /** Free-text trust badge for the UI. e.g. "High confidence — Mapbox + GolfBert." */
  confidence_label: string;
}

// ─── Sustained-fix rolling buffer ────────────────────────────────────────

/**
 * The reconciliation service needs more than a single fix to break ties
 * between parallel holes. A 30-second window of fixes gives us:
 *   - sustained heading (where the player is actually MOVING)
 *   - speed-derived "stationary vs traveling" hint (already in
 *     gpsManager but lives in walkingDetector for a different purpose)
 *   - rejection of single outliers without rejecting the buffer
 *
 * Buffer size: 30 fixes. At active-mode 1Hz that's 30s; at walking-mode
 * 0.1Hz that's 5 minutes — both useful windows. Older entries roll off.
 */
const SUSTAINED_BUFFER_MAX = 30;
const sustainedFixes: GpsFix[] = [];

export function pushSustainedFix(fix: GpsFix): void {
  sustainedFixes.push(fix);
  if (sustainedFixes.length > SUSTAINED_BUFFER_MAX) {
    sustainedFixes.shift();
  }
}

export function getSustainedFixes(): readonly GpsFix[] {
  return sustainedFixes;
}

/**
 * Compute a sustained heading from the buffer. Returns null when we
 * don't have enough movement to be confident (< 10 yards of total
 * travel, which is roughly within GPS noise). Heading is from the
 * oldest accepted fix to the newest accepted fix, NOT the per-fix
 * bearing — that's noisier on slow walks.
 *
 * Golf rationale: a player walking down hole 4 will produce a sustained
 * tee→green-axis-aligned heading. A player crossing from 4-green to
 * 5-tee will produce a heading perpendicular to 4's axis. That signal
 * lets reconciliation favor the hole the player is moving ALONG vs the
 * hole they're moving AWAY from.
 */
const MIN_SUSTAINED_TRAVEL_YD = 10;

export function getSustainedHeading(): number | null {
  if (sustainedFixes.length < 2) return null;
  const oldest = sustainedFixes[0];
  const newest = sustainedFixes[sustainedFixes.length - 1];
  const travel = haversineYards(
    { lat: oldest.lat, lng: oldest.lng },
    { lat: newest.lat, lng: newest.lng },
  );
  if (travel < MIN_SUSTAINED_TRAVEL_YD) return null;
  return bearingDegrees(
    { lat: oldest.lat, lng: oldest.lng },
    { lat: newest.lat, lng: newest.lng },
  );
}

/**
 * Clear the buffer — call on round start / end so a stale heading
 * from a prior round can't bias reconciliation on a new one.
 */
export function clearSustainedBuffer(): void {
  sustainedFixes.length = 0;
}

// ─── Vision attachment ───────────────────────────────────────────────────

interface AttachedVisionFrame {
  hole_number: number;
  attached_at: number;
  context: VisionContext;
}
const visionByHole: Map<number, AttachedVisionFrame> = new Map();
const VISION_TTL_MS = 60_000;

/**
 * Bind a vision frame (already submitted via glassesVisionInput) to a
 * specific hole. The orchestrator's getHoleView will surface the frame
 * for that hole until TTL expires. Future: the brain.ts system prompt
 * builder will check this map and inject the frame URI into a
 * multimodal Sonnet call.
 */
export async function attachVisionContextToHole(holeNumber: number): Promise<boolean> {
  const ctx = await getActiveVisionContext();
  if (!ctx) return false;
  visionByHole.set(holeNumber, {
    hole_number: holeNumber,
    attached_at: Date.now(),
    context: ctx,
  });
  devLog(`[orchestrator] vision attached to hole ${holeNumber} (source=${ctx.frame.source})`);
  return true;
}

function readAttachedVision(holeNumber: number): VisionContext | null {
  const v = visionByHole.get(holeNumber);
  if (!v) return null;
  if (Date.now() - v.attached_at > VISION_TTL_MS) {
    visionByHole.delete(holeNumber);
    return null;
  }
  return v.context;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Warm the geometry cache for a course. Call from round-start
 * orchestration (already wired in roundStore.startRound via
 * fetchCourseGeometry — this is a convenience re-export so consumers
 * don't have to know that internal name).
 */
export async function primeCourse(courseId: string): Promise<void> {
  await fetchCourseGeometry(courseId).catch(err =>
    devLog('[orchestrator] primeCourse failed (non-fatal):', err),
  );
}

/**
 * Assemble a CourseHoleView from every source we have data from.
 * Synchronous — relies on the geometry cache being warm. Callers that
 * want fresh-fetched data should `await primeCourse(courseId)` first.
 *
 * Returns null when we have literally no data (no geometry, no centroid,
 * no Mapbox). UI surfaces should treat null as "render the 'no data'
 * empty state" — never crash.
 */
export function getHoleView(
  courseId: string | null,
  holeNumber: number,
  playerLocation: ShotLocation | null = null,
): CourseHoleView | null {
  if (!courseId || holeNumber < 1) return null;

  const geom = getHoleGeometry(courseId, holeNumber);
  const cached = getCachedGeometry(courseId);

  // ─── Geometry section ───────────────────────────────────────────────
  const tee = geom?.tee ?? null;
  const green = geom?.green ?? null;
  const bearing_deg = geom?.bearing_deg ?? (tee && green ? bearingDegrees(tee, green) : null);

  // ─── Imagery section ────────────────────────────────────────────────
  // Priority:
  //   1. Mapbox per-hole tile (tee + green known) — best
  //   2. Mapbox centered on green (green only) — second-best
  //   3. Mapbox centered on course centroid (local: courses) — fallback
  //   4. null — UI shows empty state
  let imagery_url: string | null = null;
  let thumbnail_url: string | null = null;
  let imagery_source: CourseHoleView['imagery_source'] = 'none';

  if (isMapboxConfigured() && green) {
    const imageryInput = {
      courseId,
      holeNumber,
      par: geom?.par ?? 4,
      yardage: geom?.yardage ?? 380,
      tee,
      green,
    };
    imagery_url = getHoleImageryUrl(imageryInput);
    thumbnail_url = getHoleThumbnailUrl(imageryInput);
    imagery_source = 'mapbox';
  } else if (isMapboxConfigured() && courseId.startsWith('local:')) {
    const slug = courseId.slice('local:'.length) as LocalCourseSlug;
    const centroid = LOCAL_COURSE_CENTROIDS[slug];
    if (centroid) {
      imagery_url = getCenteredImageryUrl({ lat: centroid.lat, lng: centroid.lng });
      imagery_source = 'centroid_fallback';
    }
  }

  // ─── Player overlays ────────────────────────────────────────────────
  const player_to_green_yd =
    playerLocation && green ? Math.round(haversineYards(playerLocation, green)) : null;
  const player_heading_deg =
    playerLocation && green ? bearingDegrees(playerLocation, green) : null;
  const sustained_heading_deg = getSustainedHeading();

  // ─── Vision ────────────────────────────────────────────────────────
  const vision_context = readAttachedVision(holeNumber);

  // ─── Confidence ────────────────────────────────────────────────────
  const confidence = scoreConfidence({
    hasTee: !!tee,
    hasGreen: !!green,
    hasGreenFrontBack: !!(geom?.green_front && geom?.green_back),
    polygonCount:
      (geom?.fairway_polygons?.length ?? 0) +
      (geom?.green_polygon ? 1 : 0) +
      (geom?.tee_polygon ? 1 : 0),
    landmarkCount:
      (geom?.bunkers?.length ?? 0) + (geom?.water_hazards?.length ?? 0),
    imagerySource: imagery_source,
    hasVision: !!vision_context,
  });

  return {
    course_id: courseId,
    hole_number: holeNumber,
    par: geom?.par ?? null,
    yardage_yd: geom?.yardage ?? null,
    tee,
    green,
    green_front: geom?.green_front ?? null,
    green_back: geom?.green_back ?? null,
    bearing_deg,
    hazards: geom?.hazards ?? [],
    fairway_polygons: geom?.fairway_polygons ?? [],
    green_polygon: geom?.green_polygon ?? null,
    tee_polygon: geom?.tee_polygon ?? null,
    bunkers: geom?.bunkers ?? [],
    water_hazards: geom?.water_hazards ?? [],
    imagery_url,
    thumbnail_url,
    imagery_source,
    player_location: playerLocation,
    player_to_green_yd,
    player_heading_deg,
    sustained_heading_deg,
    vision_context,
    confidence,
    confidence_label: buildConfidenceLabel(confidence, imagery_source, !!cached),
  };
}

/**
 * Course-wide thumbnail URL (the hero image on Course Detail). Wraps
 * mapboxImagery.getCourseImageryUrl with sensible defaults so consumers
 * don't have to assemble the input shape themselves.
 */
export function getCourseHeroImagery(
  courseId: string | null,
  width = 800,
  height = 400,
): string | null {
  if (!courseId) return null;
  const cached = getCachedGeometry(courseId);
  if (!cached) return null;
  const holes = cached.holes.map(h => ({ tee: h.tee, green: h.green }));
  return getCourseImageryUrl({ courseId, holes }, width, height);
}

// ─── Confidence scoring ──────────────────────────────────────────────────

function scoreConfidence(input: {
  hasTee: boolean;
  hasGreen: boolean;
  hasGreenFrontBack: boolean;
  polygonCount: number;
  landmarkCount: number;
  imagerySource: CourseHoleView['imagery_source'];
  hasVision: boolean;
}): DataConfidence {
  // Geometry: tee + green is the baseline (60). Add 20 for front/back, +20
  // when both come from the same source (we assume so today).
  let geometry = 0;
  if (input.hasTee && input.hasGreen) geometry += 60;
  if (input.hasGreenFrontBack) geometry += 20;
  if (input.hasTee && input.hasGreen) geometry += 20;
  geometry = Math.min(100, geometry);

  // Polygons: 0 polygons = 0; 1-2 = 40; 3-4 = 70; 5+ = 95. Bluegolf/Golfshot
  // parity requires fairway + green + tee + a bunker or two.
  const polygons =
    input.polygonCount === 0 ? 0 :
    input.polygonCount <= 2 ? 40 :
    input.polygonCount <= 4 ? 70 : 95;

  // Imagery: Mapbox per-hole > centroid > screenshot > none.
  const imagery =
    input.imagerySource === 'mapbox' ? 90 :
    input.imagerySource === 'centroid_fallback' ? 55 :
    input.imagerySource === 'bundled_screenshot' ? 70 : 0;

  // Vision: present is 80, absent is 0 (no model penalty when not used).
  const vision = input.hasVision ? 80 : 0;

  // Weighted overall: geometry matters most (driving yardages), then
  // imagery (driving the visual), polygons + vision are bonuses.
  // Weights sum to 1.0.
  const overall = Math.round(
    geometry * 0.45 +
    imagery * 0.30 +
    polygons * 0.15 +
    (vision || 50) * 0.10, // baseline 50 for vision so "no vision yet" isn't punitive
  );

  return { geometry, polygons, imagery, vision, overall };
}

function buildConfidenceLabel(
  c: DataConfidence,
  imagery: CourseHoleView['imagery_source'],
  cached: boolean,
): string {
  const tier =
    c.overall >= 80 ? 'High confidence' :
    c.overall >= 60 ? 'Good data' :
    c.overall >= 40 ? 'Approximate' : 'Unverified';
  const sourceParts: string[] = [];
  if (imagery === 'mapbox') sourceParts.push('Mapbox tile');
  if (imagery === 'centroid_fallback') sourceParts.push('Course-wide tile');
  if (imagery === 'bundled_screenshot') sourceParts.push('Bundled image');
  if (c.geometry >= 80) sourceParts.push('Tee/Green coords');
  if (c.polygons >= 70) sourceParts.push('Polygons');
  if (c.vision >= 60) sourceParts.push('Live vision');
  const sources = sourceParts.join(' + ');
  const stale = cached ? '' : ' (cold)';
  return sources ? `${tier} — ${sources}${stale}` : `${tier}${stale}`;
}

// ─── Direct re-exports for callers that already used the helpers ─────────
// These let the orchestrator be the single import for consumers without
// breaking existing modules that import directly. New code should prefer
// the orchestrator's getHoleView / getCourseHeroImagery so we control the
// data fusion at one site.

export { fetchCourseGeometry, getHoleGeometry, getCachedGeometry };
export type { HoleGeometry, Polygon, LandmarkFeature };
