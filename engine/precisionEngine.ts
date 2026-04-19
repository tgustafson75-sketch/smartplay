/**
 * engine/precisionEngine.ts
 *
 * Precision Vision Engine — core decision maker.
 *
 * Contract: holeData is NEVER optional. Callers must resolve the
 * active CourseHole from COURSE_DB before calling runPrecisionEngine().
 * Use requireCurrentHole() from state/holeStore as a convenient guard.
 *
 * Pipeline position:
 *   ImageClassifier → VisionRouter → THIS → PrecisionView
 */

import type { CourseHole, Hazard } from '../data/courses';
import { getCaddieRecommendation } from './caddieEngine';
import type { CaddieInput } from './caddieEngine';
import { computePlaysLike } from '../utils/playsLikeEngine';
import type { PlaysLikeInput } from '../utils/playsLikeEngine';
import type { SceneType, InputSource } from '../utils/imageClassifier';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlayerCoords {
  latitude:  number;
  longitude: number;
}

export interface PrecisionInput {
  /** Active hole data — ALWAYS required */
  holeData: CourseHole;
  /** Player's GPS position. Null = no fix, GPS yardages will be null. */
  playerCoords?: PlayerCoords | null;
  /** Computed GPS yardages (optional override — if null, computed from coords). */
  gpsYards?: { front: number | null; middle: number | null; back: number | null };
  /** Image scene classification result */
  sceneType?: SceneType;
  /** Original input source */
  source?: InputSource;
  /** Club distance map from player profile */
  clubDistances?: Record<string, number>;
  /** Wind speed in mph (positive = headwind) */
  windSpeed?: number;
  /** 'head' | 'tail' | 'cross' */
  windDirection?: PlaysLikeInput['windDirection'];
  /** Feet of elevation change over the shot */
  elevationChange?: number;
  /** Current lie */
  lie?: CaddieInput['lie'];
  /** Player mental state */
  mentalState?: CaddieInput['mentalState'];
  /** Shot history for miss-pattern detection */
  shots?: Array<{ result: string }>;
  /** Player-selected pin position */
  pinPosition?: 'front' | 'middle' | 'back';
}

export interface HazardWarning {
  type: Hazard['type'];
  avoidDir: Hazard['avoidDir'];
  message: string;
}

export interface PrecisionDecision {
  /** Recommended club */
  club: string | null;
  /** Raw GPS/hole yardage to pin */
  targetYards: number | null;
  /** Plays-like adjusted yardage (wind + elevation + lie) */
  playsLike: number | null;
  /** Aim direction label */
  aimDirection: string;
  /** Miss pattern for club alignment */
  missPattern: 'left' | 'right' | 'neutral';
  /** Relevant hazard alerts for this shot */
  hazardWarnings: HazardWarning[];
  /** Pre-built voice line for ElevenLabs pipeline */
  voiceLine: string;
  /** 0–1 confidence based on GPS quality + scene match */
  confidence: number;
  /** Scene type that drove this decision */
  sceneType: SceneType;
  /** Input source */
  source: InputSource;
  /** Hole metadata passthrough */
  hole: number;
  par: number;
}

// ─── Haversine ────────────────────────────────────────────────────────────────

function haversineYards(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // metres
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  const metres = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return metres * 1.09361; // → yards
}

// ─── Hazard Filtering ─────────────────────────────────────────────────────────

function buildHazardWarnings(hazards: Hazard[] | undefined): HazardWarning[] {
  if (!hazards || hazards.length === 0) return [];
  return hazards.map((h) => {
    const typeLabel = h.type === 'water' ? 'Water' : h.type === 'bunker' ? 'Bunker' : 'OB';
    return {
      type: h.type,
      avoidDir: h.avoidDir,
      message: `${typeLabel} — miss ${h.avoidDir}`,
    };
  });
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

/**
 * computePrecisionDecision — synchronous core used by visionRouter and
 * the async runPrecisionEngine below.
 */
export function computePrecisionDecision(input: PrecisionInput): PrecisionDecision {
  const {
    holeData,
    playerCoords,
    gpsYards,
    sceneType = 'gps_only',
    source = 'gps',
    clubDistances,
    windSpeed = 0,
    windDirection = 'head',
    elevationChange = 0,
    lie = 'fairway',
    mentalState = 'neutral',
    shots = [],
    pinPosition = 'middle',
  } = input;

  // ── 1. Resolve GPS yardages ──────────────────────────────────────────────
  let yards: { front: number | null; middle: number | null; back: number | null };

  if (gpsYards) {
    yards = gpsYards;
  } else if (playerCoords) {
    const { latitude: pLat, longitude: pLon } = playerCoords;
    yards = {
      front:  haversineYards(pLat, pLon, holeData.front.lat,  holeData.front.lng),
      middle: haversineYards(pLat, pLon, holeData.middle.lat, holeData.middle.lng),
      back:   haversineYards(pLat, pLon, holeData.back.lat,   holeData.back.lng),
    };
  } else {
    // Fallback: use static hole distance split across front/middle/back
    yards = {
      front:  Math.round(holeData.distance * 0.95),
      middle: holeData.distance,
      back:   Math.round(holeData.distance * 1.05),
    };
  }

  // ── 2. Caddie recommendation ─────────────────────────────────────────────
  const caddieInput: CaddieInput = {
    front:  yards.front,
    middle: yards.middle,
    back:   yards.back,
    pinPosition,
    lie,
    mentalState,
    shots,
    clubDistances,
    wind: windSpeed,
  };
  const decision = getCaddieRecommendation(caddieInput);

  // ── 3. Plays-like adjustment ─────────────────────────────────────────────
  const rawYards = decision.targetYards;
  let playsLike: number | null = null;
  if (rawYards != null) {
    const pl = computePlaysLike({
      rawYardage: rawYards,
      windSpeed,
      windDirection,
      elevationChange,
      lie,
    });
    playsLike = pl.playsLikeYardage;
  }

  // ── 4. Hazard warnings ───────────────────────────────────────────────────
  const hazardWarnings = buildHazardWarnings(holeData.hazards);

  // ── 5. Confidence ────────────────────────────────────────────────────────
  const gpsConfidence = playerCoords ? 0.9 : 0.5;
  const sceneConfidence: Record<SceneType, number> = {
    green:        1.0,
    fairway:      0.9,
    hole_overview: 0.85,
    scorecard:    0.7,
    gps_only:     0.6,
    unknown:      0.4,
  };
  const confidence = Math.min(1, gpsConfidence * (sceneConfidence[sceneType] ?? 0.6));

  // ── 6. Voice line ─────────────────────────────────────────────────────────
  const clubText = decision.recommendedClub ?? 'a club';
  const yardsText = playsLike != null ? `${Math.round(playsLike)}` : rawYards != null ? `${Math.round(rawYards)}` : 'unknown';
  const hazardText = hazardWarnings.length > 0
    ? ` Watch out — ${hazardWarnings[0].message.toLowerCase()}.`
    : '';
  const voiceLine =
    `${decision.aimLabel}. ${yardsText} yards, take the ${clubText}.${hazardText} ${decision.shotSuggestion}`.trim();

  return {
    club:           decision.recommendedClub,
    targetYards:    rawYards,
    playsLike,
    aimDirection:   decision.aimLabel,
    missPattern:    decision.missPattern,
    hazardWarnings,
    voiceLine,
    confidence,
    sceneType,
    source,
    hole:           holeData.hole,
    par:            holeData.par,
  };
}

// ─── Async Camera-Mode Entry Point ───────────────────────────────────────────

export type PrecisionInputType = 'camera' | 'screenshot' | 'gps';

export interface VisionData {
  /** Hazards detected by processCameraImage */
  hazards: Array<{
    type: 'water' | 'bunker' | 'ob' | 'unknown';
    x: number;
    y: number;
    confidence: number;
  }>;
  /** Depth map URI or null */
  depthMap: string | null;
}

export interface PrecisionEngineInput {
  /** Input modality */
  inputType: PrecisionInputType;
  /** Active hole — NEVER optional */
  holeData: CourseHole;
  /** Camera/screenshot vision output (only used when inputType === 'camera') */
  visionData?: VisionData | null;
  /** Override target point. Falls back to middle green coords. */
  target?: { lat: number; lng: number } | null;
  /** Optional caddie engine context */
  context?: Omit<PrecisionInput, 'holeData' | 'sceneType' | 'source'>;
}

export interface PrecisionEngineResult extends PrecisionDecision {
  /** Input modality that produced this result */
  mode: PrecisionInputType;
  /** Tee GPS coords (from holeData.tee) */
  tee: { lat: number; lng: number } | null;
  /** Resolved green centre coords */
  green: { lat: number; lng: number };
  /** Static hole yardage from course data */
  yardage: number;
  /** Resolved target point (override or green centre) */
  target: { lat: number; lng: number };
  /** Shot line endpoints */
  shotLine: {
    from: { lat: number; lng: number } | null;
    to: { lat: number; lng: number };
  };
  /** Depth map passed through from visionData (camera mode only) */
  depthMap: string | null;
}

/**
 * runPrecisionEngine — async entry point for the Precision Vision pipeline.
 *
 * Accepts the high-level camera/screenshot/GPS input shape, maps it onto
 * CourseHole fields, and delegates caddie logic to computePrecisionDecision.
 * In camera mode the visionData hazards are merged in on top of course hazards.
 *
 * @throws Error when holeData is not provided.
 */
export const runPrecisionEngine = async (
  input: PrecisionEngineInput,
): Promise<PrecisionEngineResult> => {
  const { inputType, holeData, visionData, target, context = {} } = input;

  if (!holeData) throw new Error('[precisionEngine] No hole data provided.');

  // Map CourseHole → canonical coords
  const tee   = holeData.tee ?? null;
  const green = holeData.middle;          // green centre
  const yardage = holeData.distance;

  // Resolve target — caller override or fall back to green centre
  const targetPoint = target ?? green;

  // Merge vision hazards into hole hazards for camera mode
  let mergedHazards = holeData.hazards ? [...holeData.hazards] : [];
  let depthMap: string | null = null;

  if (inputType === 'camera' && visionData) {
    depthMap = visionData.depthMap;
    // Convert detected visual hazards to course Hazard shape
    const visualHazards = visionData.hazards
      .filter((h) => h.confidence >= 0.5)
      .map((h) => ({
        type:     (h.type === 'unknown' ? 'bunker' : h.type) as 'water' | 'bunker' | 'ob',
        x:        h.x,
        y:        h.y,
        r:        0.06 as const,
        avoidDir: 'short' as const,
      }));
    mergedHazards = [...mergedHazards, ...visualHazards];
  }

  // Run synchronous caddie core with the enriched hole data
  const enrichedHole: CourseHole = { ...holeData, hazards: mergedHazards };

  const sourceMap: Record<PrecisionInputType, PrecisionInput['source']> = {
    camera:     'camera',
    screenshot: 'screenshot',
    gps:        'gps',
  };
  const sceneMap: Record<PrecisionInputType, PrecisionInput['sceneType']> = {
    camera:     'fairway',
    screenshot: 'hole_overview',
    gps:        'gps_only',
  };

  const decision = computePrecisionDecision({
    ...context,
    holeData:  enrichedHole,
    sceneType: sceneMap[inputType],
    source:    sourceMap[inputType],
  });

  return {
    ...decision,
    mode:     inputType,
    tee,
    green,
    yardage,
    target:   targetPoint,
    shotLine: { from: tee, to: targetPoint },
    depthMap,
  };
};
