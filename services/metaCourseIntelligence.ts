/**
 * 2026-05-22 — Meta-Level Course Intelligence ("See What You See").
 *
 * When the player has the glasses (or phone camera) pointed at a shot,
 * this service fuses every available signal into a single coherent
 * strategic recommendation:
 *
 *   - Vision context (services/glassesVisionInput) — the freshest frame
 *   - Course geometry (services/courseDataOrchestrator) — hole layout,
 *     hazards, green centroid + front/back
 *   - GPS (services/gpsManager) — player position, distance to green
 *   - Tough lie (services/lieAnalysisService) — image-derived lie call
 *   - Weather (services/weatherService) — wind direction + speed
 *   - Ghost match (store/ghostStore) — pacing context
 *   - Golfer model (services/golferModel) — tendencies + dominant miss
 *   - Recent shots (store/roundStore) — what's happening right now
 *
 * Output: a StrategicRecommendation the caddie speaks aloud and the
 * UI renders as a "what's the play" card. Composes existing services —
 * no new vision calls beyond what's already cached.
 *
 * The point is COHERENT, not just additive. A 165y shot from rough with
 * 8mph headwind to a tucked back-right pin gets a different
 * recommendation than the same yardage with no wind to an open green —
 * because the inputs combine into a single strategic frame, not a list
 * of facts.
 *
 * Defensive: every signal is optional. With only GPS + course geometry
 * you get a clean baseline recommendation. With every signal you get
 * a strategic call.
 */

import { useRoundStore } from '../store/roundStore';
import { useGhostStore } from '../store/ghostStore';
import { useSettingsStore } from '../store/settingsStore';
import { getHoleView, type CourseHoleView } from './courseDataOrchestrator';
import { getActiveVisionContext, type VisionContext } from './glassesVisionInput';
import { buildGolferModel, type GolferModel } from './golferModel';
import { getCachedWeather, fetchWeatherAt, type WeatherSnapshot } from './weatherService';
import { getLastFix } from './gpsManager';
import { haversineYards, bearingDegrees } from '../utils/geoDistance';
import { getCaddieName } from '../lib/persona';
import { devLog } from './devLog';

// ─── Public types ────────────────────────────────────────────────────────

export type ShotShape = 'straight' | 'draw' | 'fade' | 'low_punch' | 'high_cut';
export type RiskAssessment = 'conservative' | 'standard' | 'aggressive' | 'go_for_it';

export interface StrategicRecommendation {
  /** Recommendation id — stable + unique per call. */
  recId: string;
  timestamp: string;
  hole_number: number | null;

  /** Distance to target in yards (typically green centroid). */
  yards_to_target: number | null;
  /** Recommended club. Honest "unsure" when context is too thin. */
  recommended_club: string | null;
  /** Recommended shot shape. */
  shot_shape: ShotShape;
  /** Recommended aim point — free text ("two paces left of pin",
   *  "left bunker edge"). */
  aim_point: string;
  /** Risk band the recommendation lands in. */
  risk: RiskAssessment;
  /** Optional alternative — the "if you're feeling cautious" play. */
  alternative_play: string | null;

  /** Strategic rationale — composed from every signal that informed it. */
  rationale: string[];
  /** Sources actually used in this call. */
  sources_used: SourceTag[];
  /** 0..100 — overall confidence. */
  confidence: number;

  /** Persona-aware voice summary the caddie speaks (caller pipes
   *  through voiceService.speak). */
  voice_summary: string;
}

export type SourceTag =
  | 'course_geometry'
  | 'gps_position'
  | 'weather_wind'
  | 'vision_frame'
  | 'lie_analysis'
  | 'ghost_match'
  | 'golfer_model'
  | 'recent_shots';

export interface MetaIntelInput {
  /** Player's lat/lng. When omitted, pulled from gpsManager.getLastFix. */
  player_location?: { lat: number; lng: number } | null;
  /** Optional explicit hole override. Defaults to active round's currentHole. */
  hole_number?: number | null;
  /** Optional explicit yardage override. Defaults to haversine to green. */
  target_yards?: number | null;
  /** Optional lie hint from the player ("fairway", "rough", "sand", etc).
   *  Pulled from the player's last spoken context when present. */
  lie_hint?: string | null;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Build a coherent strategic recommendation from every available signal.
 * Always resolves to a StrategicRecommendation — even when only baseline
 * GPS + geometry are available. Confidence + sources_used surface the
 * trust signal so the UI can render "rough idea" vs "high confidence".
 */
export async function recommendShot(input: MetaIntelInput = {}): Promise<StrategicRecommendation> {
  const round = useRoundStore.getState();
  const ghost = useGhostStore.getState();
  const settings = useSettingsStore.getState();
  const persona = settings.caddiePersonality;
  const caddieName = getCaddieName(persona);

  // ─── Resolve required signals ─────────────────────────────────────
  const holeNumber = input.hole_number ?? (round.isRoundActive ? round.currentHole : null);
  const courseId = round.activeCourseId;
  const playerLoc = input.player_location ?? (getLastFix() ?? null) as { lat: number; lng: number } | null;

  const holeView: CourseHoleView | null = courseId && holeNumber
    ? getHoleView(courseId, holeNumber, playerLoc)
    : null;

  // Weather — try cache, then a fresh fetch with a tight timeout.
  let weather: WeatherSnapshot | null = null;
  if (playerLoc) {
    try {
      weather = getCachedWeather(playerLoc) ?? await fetchWeatherAt(playerLoc).catch(() => null);
    } catch { /* non-fatal */ }
  }

  // Vision frame — freshest in the queue (within 30s TTL).
  let vision: VisionContext | null = null;
  try { vision = await getActiveVisionContext(); } catch { /* non-fatal */ }

  // Golfer model — tendencies feed risk calibration + miss-pattern bias.
  let golfer: GolferModel | null = null;
  try { golfer = buildGolferModel(); } catch { /* non-fatal */ }

  // ─── Derive target distance + bearing ─────────────────────────────
  let yardsToTarget: number | null = input.target_yards ?? null;
  if (yardsToTarget == null && playerLoc && holeView?.green) {
    yardsToTarget = Math.round(haversineYards(playerLoc, holeView.green));
  }
  const targetBearing = playerLoc && holeView?.green
    ? bearingDegrees(playerLoc, holeView.green)
    : null;

  // ─── Wind decomposition ───────────────────────────────────────────
  const windFactor = weather && targetBearing != null
    ? decomposeWind(weather, targetBearing)
    : null;

  // ─── Recent shots + miss pattern ──────────────────────────────────
  const recentShots = round.shots.slice(-5);
  const dominantMiss = golfer?.miss_direction ?? null;
  const missType = golfer?.miss_type ?? null;

  // ─── Lie context (player-stated hint + last shot's lie analysis) ──
  const lastShot = recentShots[recentShots.length - 1];
  const lieFromShot = lastShot?.lie_analysis?.situation_description ?? null;
  const lieHint = input.lie_hint ?? lieFromShot ?? null;

  // ─── Sources tracking ────────────────────────────────────────────
  const sources: SourceTag[] = [];
  if (holeView?.green) sources.push('course_geometry');
  if (playerLoc) sources.push('gps_position');
  if (weather) sources.push('weather_wind');
  if (vision) sources.push('vision_frame');
  if (lieFromShot || input.lie_hint) sources.push('lie_analysis');
  if (ghost.ghostRecord) sources.push('ghost_match');
  if (golfer?.is_confident) sources.push('golfer_model');
  if (recentShots.length > 0) sources.push('recent_shots');

  // ─── Strategic synthesis ──────────────────────────────────────────
  const club = recommendClub(yardsToTarget, windFactor, lieHint);
  const shape = recommendShape(dominantMiss, missType, windFactor, lieHint);
  const risk = assessRisk(yardsToTarget, holeView, windFactor, lieHint, ghost);
  const aim = buildAimPoint(holeView, shape, dominantMiss, risk);
  const altPlay = buildAlternative(risk, yardsToTarget, holeView);

  const rationale = buildRationale({
    holeView, yardsToTarget, windFactor, lieHint, dominantMiss, missType,
    ghost: ghost.ghostRecord ? ghost.getSummaryText() : null,
    recentShots: recentShots.length,
  });

  const confidence = computeConfidence(sources, holeView, weather, golfer);
  const voice = buildVoiceSummary(caddieName, club, yardsToTarget, shape, aim, rationale);

  const result: StrategicRecommendation = {
    recId: 'meta_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
    timestamp: new Date().toISOString(),
    hole_number: holeNumber,
    yards_to_target: yardsToTarget,
    recommended_club: club,
    shot_shape: shape,
    aim_point: aim,
    risk,
    alternative_play: altPlay,
    rationale,
    sources_used: sources,
    confidence,
    voice_summary: voice,
  };
  devLog(
    `[metaIntel] hole=${holeNumber} yd=${yardsToTarget} club=${club} ` +
    `shape=${shape} risk=${risk} sources=${sources.length} conf=${confidence}`,
  );
  return result;
}

// ─── Strategic synthesis helpers ─────────────────────────────────────────

interface WindFactor {
  /** Effective along-shot wind. Positive = tailwind, negative = headwind. */
  along_mph: number;
  /** Crosswind component. Positive = right-to-left, negative = left-to-right. */
  cross_mph: number;
  /** Absolute total wind speed mph. */
  total_mph: number;
  /** Compass direction the wind is FROM. */
  from_deg: number;
}

function decomposeWind(w: WeatherSnapshot, targetBearingDeg: number): WindFactor | null {
  if (w.wind_direction_deg == null) return null;
  const windTo = (w.wind_direction_deg + 180) % 360;
  const rel = ((windTo - targetBearingDeg + 540) % 360) - 180;
  const relRad = (rel * Math.PI) / 180;
  const along = Math.cos(relRad) * w.wind_speed_mph;
  const cross = Math.sin(relRad) * w.wind_speed_mph;
  return {
    along_mph: Math.round(along),
    cross_mph: Math.round(cross),
    total_mph: Math.round(w.wind_speed_mph),
    from_deg: w.wind_direction_deg,
  };
}

function recommendClub(
  yards: number | null,
  wind: WindFactor | null,
  lieHint: string | null,
): string | null {
  if (yards == null || yards <= 0) return null;
  // Adjust for wind + lie. Headwind adds yards (need MORE club).
  // Tailwind subtracts. Rough adds ~1 club's worth of needed yards.
  let effective = yards;
  if (wind) effective += -wind.along_mph * 1.5; // 1.5y per mph headwind
  if (lieHint?.toLowerCase().includes('rough')) effective += 8;
  if (lieHint?.toLowerCase().includes('sand') || lieHint?.toLowerCase().includes('bunker')) effective += 12;

  // Adult-amateur club distance ladder.
  if (effective >= 240) return 'Driver';
  if (effective >= 215) return '3 wood';
  if (effective >= 195) return 'hybrid';
  if (effective >= 178) return '4 iron';
  if (effective >= 165) return '5 iron';
  if (effective >= 152) return '6 iron';
  if (effective >= 138) return '7 iron';
  if (effective >= 125) return '8 iron';
  if (effective >= 110) return '9 iron';
  if (effective >= 95)  return 'PW';
  if (effective >= 75)  return 'GW';
  if (effective >= 55)  return 'SW';
  if (effective >= 25)  return 'LW';
  return 'putter';
}

function recommendShape(
  dominantMiss: string | null,
  missType: string | null,
  wind: WindFactor | null,
  lieHint: string | null,
): ShotShape {
  // Low punch when out of trees / very strong headwind / under branches.
  if (lieHint?.toLowerCase().includes('tree') || lieHint?.toLowerCase().includes('punch')) return 'low_punch';
  if (wind && Math.abs(wind.along_mph) >= 12 && wind.along_mph < 0) return 'low_punch';
  // Fade INTO a crosswind from right-to-left; draw INTO left-to-right.
  if (wind && Math.abs(wind.cross_mph) >= 8) {
    return wind.cross_mph > 0 ? 'fade' : 'draw';
  }
  // Play the natural shape when miss-type indicates a curve preference.
  if (missType === 'slice' || dominantMiss === 'right') return 'fade';
  if (missType === 'hook' || dominantMiss === 'left') return 'draw';
  return 'straight';
}

function assessRisk(
  yards: number | null,
  holeView: CourseHoleView | null,
  wind: WindFactor | null,
  lieHint: string | null,
  ghost: ReturnType<typeof useGhostStore.getState>,
): RiskAssessment {
  // Default to standard. Slide toward conservative when:
  //   - heavy lie (sand/rough/punch)
  //   - strong head/crosswind
  //   - playing behind the ghost (don't compound the deficit)
  // Slide toward go_for_it when:
  //   - clean lie + tailwind + favorable yardage range
  let riskBias = 0;
  if (lieHint?.toLowerCase().match(/rough|sand|bunker|tree|punch/)) riskBias -= 2;
  if (wind && wind.along_mph < -10) riskBias -= 1;
  if (wind && Math.abs(wind.cross_mph) > 10) riskBias -= 1;
  if (wind && wind.along_mph > 8) riskBias += 1;
  if (ghost.overall_delta > 5) riskBias -= 1; // behind on ghost → don't press
  if (ghost.overall_delta < -3) riskBias += 1; // ahead → can take a calculated risk
  void yards;
  void holeView;
  if (riskBias <= -2) return 'conservative';
  if (riskBias === -1) return 'conservative';
  if (riskBias === 0)  return 'standard';
  if (riskBias === 1)  return 'aggressive';
  return 'go_for_it';
}

function buildAimPoint(
  holeView: CourseHoleView | null,
  shape: ShotShape,
  dominantMiss: string | null,
  risk: RiskAssessment,
): string {
  // Aim point biases AWAY from the player's dominant miss + AWAY from
  // hazards on the relevant side when known.
  const safeSide = dominantMiss === 'right' ? 'left' : dominantMiss === 'left' ? 'right' : 'center';
  if (risk === 'conservative') return 'middle of the green; favor the fat side';
  if (risk === 'go_for_it') return 'directly at the pin';
  if (holeView?.bunkers && holeView.bunkers.length > 0) {
    return `${safeSide} edge of the green — bunkers flanking`;
  }
  if (shape === 'fade') return 'start at the left edge; let it fade to center';
  if (shape === 'draw') return 'start at the right edge; let it draw to center';
  if (shape === 'low_punch') return 'low at the front-middle — keep it under';
  return 'middle of the green';
}

function buildAlternative(
  risk: RiskAssessment,
  yards: number | null,
  holeView: CourseHoleView | null,
): string | null {
  if (risk === 'conservative') return null; // already the safe play
  if (risk === 'standard') return null;
  if (risk === 'aggressive' || risk === 'go_for_it') {
    if (yards != null && yards >= 200) {
      return `Lay up to ${Math.round(yards * 0.6)}y for a full wedge in.`;
    }
    return 'Bail to the fat side of the green.';
  }
  void holeView;
  return null;
}

function buildRationale(input: {
  holeView: CourseHoleView | null;
  yardsToTarget: number | null;
  windFactor: WindFactor | null;
  lieHint: string | null;
  dominantMiss: string | null;
  missType: string | null;
  ghost: string | null;
  recentShots: number;
}): string[] {
  const out: string[] = [];
  if (input.yardsToTarget != null) out.push(`${input.yardsToTarget} yards to the green.`);
  if (input.windFactor) {
    const w = input.windFactor;
    if (Math.abs(w.along_mph) >= 5) {
      out.push(`${Math.abs(w.along_mph)} mph ${w.along_mph < 0 ? 'into the face' : 'at the back'}.`);
    }
    if (Math.abs(w.cross_mph) >= 5) {
      out.push(`${Math.abs(w.cross_mph)} mph crosswind from ${w.cross_mph > 0 ? 'the left' : 'the right'}.`);
    }
  }
  if (input.lieHint) out.push(`Lie: ${input.lieHint}.`);
  if (input.dominantMiss && input.dominantMiss !== 'unknown' && input.dominantMiss !== 'straight') {
    out.push(`Your miss bias is ${input.dominantMiss}; planning for it.`);
  }
  if (input.holeView?.bunkers && input.holeView.bunkers.length > 0) {
    out.push(`${input.holeView.bunkers.length} bunker${input.holeView.bunkers.length === 1 ? '' : 's'} flanking the green.`);
  }
  if (input.ghost) out.push(input.ghost);
  return out;
}

function computeConfidence(
  sources: SourceTag[],
  holeView: CourseHoleView | null,
  weather: WeatherSnapshot | null,
  golfer: GolferModel | null,
): number {
  let conf = 30; // baseline when ANY signal landed
  if (sources.includes('course_geometry') && holeView?.green) conf += 20;
  if (sources.includes('gps_position')) conf += 15;
  if (sources.includes('weather_wind') && weather) conf += 10;
  if (sources.includes('vision_frame')) conf += 10;
  if (sources.includes('lie_analysis')) conf += 5;
  if (sources.includes('golfer_model') && golfer?.is_confident) conf += 10;
  return Math.max(0, Math.min(100, conf));
}

function buildVoiceSummary(
  caddieName: string,
  club: string | null,
  yards: number | null,
  shape: ShotShape,
  aim: string,
  rationale: string[],
): string {
  if (yards == null || !club) {
    return `${caddieName} — not enough info to call a shot yet.`;
  }
  const shapePhrase =
    shape === 'low_punch' ? 'low punch' :
    shape === 'high_cut' ? 'high cut' :
    shape === 'draw' ? 'soft draw' :
    shape === 'fade' ? 'controlled fade' : 'straight';
  const lead = `${caddieName} — ${yards} yards, ${club}, ${shapePhrase}.`;
  const focus = `Aim ${aim}.`;
  const because = rationale.length > 0 ? ` ${rationale.slice(0, 2).join(' ')}` : '';
  return `${lead} ${focus}${because}`.trim();
}
