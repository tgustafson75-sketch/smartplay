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
import { usePracticeStore } from '../store/practiceStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { getHoleView, type CourseHoleView } from './courseDataOrchestrator';
import { getActiveVisionContext, type VisionContext } from './glassesVisionInput';
import { buildGolferModel, type GolferModel } from './golferModel';
import { recommendClubFromEquipmentIntelligence } from './distance/equipment_distance_modifier';
import { getCachedWeather, fetchWeatherAt, type WeatherSnapshot } from './weatherService';
import { getLastFix } from './gpsManager';
import { haversineYards, bearingDegrees } from '../utils/geoDistance';
import { isValidGolfCoord } from '../utils/coordGuard';
import { getCaddieName } from '../lib/persona';
import { buildEvidenceStack, clarifyingQuestion, confidenceNote } from './recommendationTransparency';
import { adaptOnCourseVoice, deriveComplexityLevel, hasMobilityFlag } from './coachingAdaptation';
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
  /** Human-readable evidence sources used for this recommendation. */
  evidence_stack: string[];
  /** Confidence explanation line for UI/readback surfaces. */
  confidence_note: string;
  /** Follow-up when confidence is low; null otherwise. */
  clarification_question: string | null;

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
  /** Pre-computed plays-like yardage (wind + temp + elevation already applied).
   *  When provided, computeEffectiveTargetYards uses this as the base distance
   *  instead of target_yards, then applies lie adjustments on top. */
  plays_like_yards?: number | null;
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
  const profile = usePlayerProfileStore.getState();
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
  // 2026-06-02 — Fix GM: guard both inputs to haversine. holeView.green
  // can be a cached coord from a partial geometry response (placeholder
  // values still possible). playerLoc is gpsManager-guarded upstream but
  // defense-in-depth here costs nothing.
  let yardsToTarget: number | null = input.target_yards ?? null;
  const targetValid = playerLoc && holeView?.green
    && isValidGolfCoord(playerLoc.lat, playerLoc.lng)
    && isValidGolfCoord(holeView.green.lat, holeView.green.lng);
  if (yardsToTarget == null && targetValid) {
    yardsToTarget = Math.round(haversineYards(playerLoc!, holeView!.green!));
  }
  const targetBearing = targetValid
    ? bearingDegrees(playerLoc!, holeView!.green!)
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
  const playsLikeYards = input.plays_like_yards ?? null;
  const baselineClub = recommendClub(yardsToTarget, windFactor, lieHint, playsLikeYards);
  const roundForEvidence = useRoundStore.getState();
  const practice = usePracticeStore.getState();
  const effectiveTarget = computeEffectiveTargetYards(yardsToTarget, windFactor, lieHint, playsLikeYards);
  const equipmentResult = recommendClubFromEquipmentIntelligence({
    targetYards: effectiveTarget ?? yardsToTarget ?? 0,
    fallbackClub: baselineClub ?? '7 iron',
    actualShotHistory: roundForEvidence.shots
      .filter((s) => typeof s.club === 'string' && Number.isFinite(s.carry_distance ?? s.distance_yards ?? null))
      .map((s) => ({
        club: s.club as string,
        carryYards: Number(s.carry_distance ?? s.distance_yards ?? 0),
        tier: 'actual_shot_history' as const,
        sampleSize: 1,
      })),
    launchMonitorData: [
      practice.avgCarryDriver > 0
        ? { club: 'Driver', carryYards: practice.avgCarryDriver, tier: 'launch_monitor_data' as const, sampleSize: Math.max(1, practice.swingCount) }
        : null,
      practice.avgCarry3Wood > 0
        ? { club: '3 wood', carryYards: practice.avgCarry3Wood, tier: 'launch_monitor_data' as const, sampleSize: Math.max(1, practice.swingCount) }
        : null,
    ].filter((x): x is NonNullable<typeof x> => x != null),
    roundHistory: (golfer?.club_distances ?? [])
      .filter((c) => c.median_yd != null)
      .map((c) => ({
        club: c.club,
        carryYards: Number(c.median_yd),
        tier: 'round_history' as const,
        sampleSize: Math.max(1, c.sample_size),
      })),
  });
  const club = equipmentResult.recommendedClub ?? baselineClub;
  const shape = recommendShape(dominantMiss, missType, windFactor, lieHint);
  const risk = assessRisk(yardsToTarget, holeView, windFactor, lieHint, ghost);
  const aim = buildAimPoint(holeView, shape, dominantMiss, risk);
  const altPlay = buildAlternative(risk, yardsToTarget, holeView);

  const rationale = buildRationale({
    holeView, yardsToTarget, windFactor, lieHint, dominantMiss, missType,
    ghost: ghost.ghostRecord ? ghost.getSummaryText() : null,
    recentShots: recentShots.length,
  });
  rationale.push(equipmentResult.rationale);

  const confidence = computeConfidence(sources, holeView, weather, golfer);
  const evidenceStack = buildEvidenceStack([
    { source: 'Distance', detail: yardsToTarget != null ? `${yardsToTarget}y to target` : 'unknown yardage' },
    { source: 'Wind', detail: windFactor ? `${windFactor.total_mph} mph` : 'not available' },
    { source: 'Lie', detail: lieHint ?? 'not available' },
    { source: 'Club Prior', detail: equipmentResult.rationale, confidence: equipmentResult.confidence * 100 },
  ]);
  const confNote = confidenceNote(confidence);
  const clarify = clarifyingQuestion(confidence);
  const voice = buildVoiceSummary(caddieName, club, yardsToTarget, shape, aim, rationale, confNote, clarify, playsLikeYards);
  const adaptedVoice = adaptOnCourseVoice(
    voice,
    deriveComplexityLevel(profile),
    hasMobilityFlag(profile),
    confidence,
  );

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
    evidence_stack: evidenceStack,
    confidence_note: confNote,
    clarification_question: clarify,
    voice_summary: adaptedVoice,
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
  playsLikeYards: number | null = null,
): string | null {
  if (yards == null || yards <= 0) return null;
  const effective = computeEffectiveTargetYards(yards, wind, lieHint, playsLikeYards) ?? yards;

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

function computeEffectiveTargetYards(
  yards: number | null,
  wind: WindFactor | null,
  lieHint: string | null,
  playsLikeYards: number | null = null,
): number | null {
  if (yards == null || yards <= 0) return null;
  // When a pre-computed plays-like yardage is supplied (wind + temp + elevation
  // already baked in), use it as the base and skip the internal wind adjustment.
  // Only lie modifiers are applied on top.
  let effective = playsLikeYards != null && playsLikeYards > 0 ? playsLikeYards : yards;
  if (playsLikeYards == null && wind) effective += -wind.along_mph * 1.5;
  if (lieHint?.toLowerCase().includes('rough')) effective += 8;
  if (lieHint?.toLowerCase().includes('sand') || lieHint?.toLowerCase().includes('bunker')) effective += 12;
  return effective;
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
  confNote: string,
  clarify: string | null,
  playsLikeYards: number | null = null,
): string {
  if (yards == null || !club) {
    return `${caddieName} — not enough info to call a shot yet.`;
  }
  const shapePhrase =
    shape === 'low_punch' ? 'low punch' :
    shape === 'high_cut' ? 'high cut' :
    shape === 'draw' ? 'soft draw' :
    shape === 'fade' ? 'controlled fade' : 'straight';
  // Append "plays like N" when the pre-computed plays-like differs from raw GPS by
  // more than 5 yards so Kevin's voice read reflects the actual club distance.
  const playsLikeSuffix =
    playsLikeYards != null && Math.abs(playsLikeYards - yards) > 5
      ? `, plays like ${playsLikeYards}`
      : '';
  const lead = `${caddieName} — ${yards} yards${playsLikeSuffix}, ${club}, ${shapePhrase}.`;
  const focus = `Aim ${aim}.`;
  const because = rationale.length > 0 ? ` ${rationale.slice(0, 2).join(' ')}` : '';
  const conf = ` ${confNote}`;
  const follow = clarify ? ` ${clarify}` : '';
  return `${lead} ${focus}${because}${conf}${follow}`.trim();
}
