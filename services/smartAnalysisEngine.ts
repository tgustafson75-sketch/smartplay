/**
 * 2026-05-22 — Smart Analysis Engine (orchestrator).
 *
 * Single entrypoint in front of every analyzer in SmartPlay. UI surfaces
 * and voice handlers call `analyze(request)`; the engine routes to the
 * right specialist service, assembles shared context (player profile,
 * active round, course geometry, ghost match, persona), and returns a
 * uniform AnalysisEnvelope.
 *
 * Why a central engine:
 *   - Existing analyzers (puttingAnalysis, lieAnalysis, spaceAssessment,
 *     courseDataOrchestrator, ghostStore) all evolved independently.
 *     Their inputs vary; their outputs vary; their persona threading
 *     varies. The engine harmonizes that surface so a voice intent or
 *     a SmartVision tap has ONE place to ask "give me analysis X for
 *     the current context" — and the engine handles all the plumbing.
 *   - It's where future Meta Ray-Ban real-time vision frames land: the
 *     engine attaches the freshest glasses frame to any analyzer that
 *     can use it, without each analyzer re-implementing the lookup.
 *   - It's where the learning-golfer feedback loop lives: every
 *     analyze() pushes a record into a rolling buffer so future calls
 *     can read recent context ("you tend to push right when stressed —
 *     here's the read this time").
 *
 * Philosophy:
 *   - The engine NEVER duplicates analyzer logic. It dispatches.
 *   - All side effects (voice playback, store writes) are opt-in via
 *     request flags so the caller can render the result themselves.
 *   - Every envelope carries a confidence + sources_used so the UI can
 *     surface honest "how much to trust this" copy.
 *   - Defensive: any analyzer failure returns a structured envelope
 *     with `kind: 'error'` rather than throwing. The caller still gets
 *     a render-ready result.
 *
 * Not in scope (call out for the next sprint):
 *   - Acoustics analysis (services/acousticsAnalyzer.ts — separate file)
 *   - Real-time frame queue from glasses (enhance glassesVisionInput)
 *   - Persistent learning model (golferModel.ts — feeds brain.ts)
 *   - Shot trace reconstruction (gpsManager rolling buffer + vision)
 */

import { useSettingsStore, type Persona } from '../store/settingsStore';
import { useRoundStore } from '../store/roundStore';
import { useGhostStore } from '../store/ghostStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { usePracticeStore } from '../store/practiceStore';
import { getHoleView, type CourseHoleView } from './courseDataOrchestrator';
import { analyzePutt, type PuttingAnalysis, type PuttingAnalysisInput } from './puttingAnalysisService';
import { analyzeLie, type LieAnalysis, type LieAnalysisResult } from './lieAnalysisService';
import { bundleLieAnalysisContext } from './lieAnalysisContext';
import { getActiveVisionContext, type VisionContext } from './glassesVisionInput';
import { buildGolferModel } from './golferModel';
import { recommendClubFromEquipmentIntelligence } from './distance/equipment_distance_modifier';
import { buildEvidenceStack, confidenceNote, clarifyingQuestion } from './recommendationTransparency';
import { adaptOnCourseVoice, deriveComplexityLevel, hasMobilityFlag, type CoachingComplexity } from './coachingAdaptation';
import { getCaddieName } from '../lib/persona';
import { devLog } from './devLog';
import { getApiBaseUrl } from './apiBase';

// ─── Public request union ─────────────────────────────────────────────────

export type AnalysisKind =
  | 'putting'
  | 'lie'
  | 'green_read'
  | 'club_recommend'
  | 'course_context'
  | 'ghost_status'
  | 'mental_check'
  // 2026-05-22 — Caddie Brain expansions.
  | 'shot_strategy'      // metaCourseIntelligence.recommendShot
  | 'swing_compare'      // swingComparisonEngine.compareSwings
  | 'pose_estimate'      // poseEstimator.estimatePose
  | 'lie_enriched';      // enrichedLieAnalysis (acoustics + risk overlay)

interface BaseRequest {
  /** Persona override — defaults to active caddiePersonality. Lets the
   *  caller pin a specific caddie for one analysis without changing
   *  the global selection. */
  persona?: Persona;
  /** When true, the engine plays the result's voice_summary through
   *  voiceService.speak after returning the envelope. */
  speak?: boolean;
}

export interface PuttingRequest extends BaseRequest {
  kind: 'putting';
  input: PuttingAnalysisInput;
}

export interface LieRequest extends BaseRequest {
  kind: 'lie';
  image_base64: string;
  image_media_type?: 'image/jpeg' | 'image/png';
}

export interface GreenReadRequest extends BaseRequest {
  kind: 'green_read';
  spoken_read: string | null;
  hole_number?: number;
}

export interface ClubRecommendRequest extends BaseRequest {
  kind: 'club_recommend';
  /** Distance to target in yards. Caller derived from SmartFinder. */
  yards_to_target: number;
  /** Optional player override of typical-conditions ("into wind", "uphill"). */
  conditions_note?: string | null;
}

export interface CourseContextRequest extends BaseRequest {
  kind: 'course_context';
  hole_number?: number;
}

export interface GhostStatusRequest extends BaseRequest {
  kind: 'ghost_status';
  hole_number?: number;
}

export interface MentalCheckRequest extends BaseRequest {
  kind: 'mental_check';
  /** Player's spoken state ("locked in", "rattled", "fine"). */
  state_note: string;
}

// 2026-05-22 — Caddie Brain request types.

export interface ShotStrategyRequest extends BaseRequest {
  kind: 'shot_strategy';
  /** Optional lie hint ("rough", "fairway", "sand"). When omitted the
   *  meta-intel service infers from the last shot. */
  lie_hint?: string | null;
  /** Optional explicit yardage override. */
  target_yards?: number | null;
  /** Pre-computed plays-like yardage (wind + temp + elevation already applied).
   *  When provided, recommendShot uses it as the base for club selection instead
   *  of computing wind adjustments internally. */
  plays_like_yards?: number | null;
}

export interface SwingCompareRequest extends BaseRequest {
  kind: 'swing_compare';
  /** Current swing (from poseEstimator). */
  current_swing_id?: string | null;
  /** What to compare against. */
  against?: 'self_previous' | 'tour_median' | 'amateur_good';
  /** Optional video URI of the current swing. The engine runs
   *  poseEstimator on it before comparing. */
  current_video_uri?: string | null;
  current_video_duration_ms?: number | null;
  /** Optional reference video URI (e.g. instructor swing). */
  reference_video_uri?: string | null;
  reference_video_duration_ms?: number | null;
  /** 2026-06-25 — the club the current swing was hit with. Used only for the
   *  tour-benchmark (self_vs_pro, no reference) path to pick the club-category
   *  profile (driver fuller, wedge more compact). Unknown → 'default' band. */
  club?: string | null;
}

export interface PoseEstimateRequestX extends BaseRequest {
  kind: 'pose_estimate';
  imageUri?: string;
  videoUri?: string;
  durationMs?: number;
  context?: {
    age?: number | null;
    handedness?: 'right' | 'left' | 'unknown';
    club?: string | null;
  };
}

export interface LieEnrichedRequest extends BaseRequest {
  kind: 'lie_enriched';
  imageBase64: string;
  imageMediaType?: 'image/jpeg' | 'image/png';
  /** Optional acoustic prior from the player's last strike (caller
   *  supplies; we don't synthesize one). */
  acoustic?: {
    strike: 'flush' | 'fat' | 'thin' | 'heel' | 'toe' | 'unknown';
    turf: 'grass' | 'sand' | 'hardpan' | 'rough' | 'unknown';
    confidence: number;
  } | null;
  /** When true, layer the risk/reward strategic call. */
  include_strategy?: boolean;
}

export type AnalysisRequest =
  | PuttingRequest
  | LieRequest
  | GreenReadRequest
  | ClubRecommendRequest
  | CourseContextRequest
  | GhostStatusRequest
  | MentalCheckRequest
  | ShotStrategyRequest
  | SwingCompareRequest
  | PoseEstimateRequestX
  | LieEnrichedRequest;

// ─── Public response envelope ────────────────────────────────────────────

export type AnalysisStatus = 'ok' | 'partial' | 'error';

export interface AnalysisEnvelope<T = unknown> {
  /** Echoes the request kind so callers can narrow the result. */
  kind: AnalysisKind;
  status: AnalysisStatus;
  /** Analyzer-specific result. Discriminate by `kind`. */
  result: T;
  /** 0..100 — engine-level confidence (already factors the analyzer's). */
  confidence: number;
  /** Data sources fused into this analysis — UI surfaces as chip row. */
  sources_used: AnalysisSource[];
  /** Persona that authored the response (after override resolution). */
  persona: Persona;
  /** 15-40 word spoken summary in the active caddie's voice. */
  voice_summary: string;
  /** Optional clarifying follow-up the caller should re-ask. */
  follow_up?: string | null;
  /** Free-text reason when status === 'error' or 'partial'. */
  reason?: string;
  /** Monotonic timestamp (ms) when the envelope was assembled. */
  timestamp_ms: number;
  /** Stable id — useful as a key in lists and for the learning buffer. */
  analysis_id: string;
}

export type AnalysisSource =
  | 'voice'
  | 'glasses_vision'
  | 'gps'
  | 'course_geometry'
  | 'player_profile'
  | 'ghost_match'
  | 'mental_state'
  | 'image_capture';

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Run analysis. Always resolves to an envelope (never throws). On any
 * internal failure, returns `{ status: 'error', ... }` with a useful
 * voice_summary the UI can still render / speak.
 */
export async function analyze(request: AnalysisRequest): Promise<AnalysisEnvelope> {
  const persona: Persona = request.persona ?? useSettingsStore.getState().caddiePersonality;
  const ctx = await buildLearningContext();
  devLog(`[engine] analyze kind=${request.kind} persona=${persona} hole=${ctx.holeNumber}`);

  try {
    let envelope: AnalysisEnvelope;
    switch (request.kind) {
      case 'putting':       envelope = await runPutting(request, persona, ctx); break;
      case 'lie':           envelope = await runLie(request, persona, ctx);       break;
      case 'green_read':    envelope = await runGreenRead(request, persona, ctx); break;
      case 'club_recommend':envelope = runClubRecommend(request, persona, ctx);   break;
      case 'course_context':envelope = runCourseContext(request, persona, ctx);   break;
      case 'ghost_status':  envelope = runGhostStatus(request, persona, ctx);     break;
      case 'mental_check':  envelope = runMentalCheck(request, persona, ctx);     break;
      case 'shot_strategy': envelope = await runShotStrategy(request, persona, ctx); break;
      case 'swing_compare': envelope = await runSwingCompare(request, persona, ctx); break;
      case 'pose_estimate': envelope = await runPoseEstimate(request, persona, ctx); break;
      case 'lie_enriched':  envelope = await runLieEnriched(request, persona, ctx);  break;
    }
    // 2026-05-23 — Persona Knowledge Layer enrichment. Folds Tank's
    // teaching wisdom into voice_summary when the envelope's voice
    // text + active persona match a KB entry. Non-fatal — failure
    // collapses to the un-enriched envelope.
    try {
      envelope = await enrichWithPersonaWisdom(envelope, persona);
    } catch (e) {
      devLog(`[engine] persona enrichment failed (non-fatal): ${String(e)}`);
    }
    pushHistory(envelope);
    if (request.speak) void speakEnvelope(envelope);
    return envelope;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    devLog(`[engine] error in kind=${request.kind}: ${msg}`);
    // 2026-06-28 (Tim — "everything that fails in the sub goes to the issue log") —
    // one place that catches EVERY structured analyzer (putting/lie/green_read/
    // shot_strategy/swing_compare/pose_estimate/lie_enriched). Best-effort.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../store/issueLogStore').useIssueLogStore.getState()
        .addAppEvent(`analysis:${request.kind}`, { error: msg }, 'analysis_error');
    } catch { /* best-effort — never let logging break the analyzer */ }
    if (request.kind === 'swing_compare' || request.kind === 'pose_estimate') {
      return swingRecoveryEnvelope(request.kind, persona, ctx, msg);
    }
    return errorEnvelope(request.kind, persona, msg);
  }
}

// ─── Dispatch implementations ────────────────────────────────────────────

interface LearningContext {
  persona: Persona;
  holeNumber: number;
  par: number | null;
  yardageYd: number | null;
  courseId: string | null;
  courseName: string | null;
  holeView: CourseHoleView | null;
  vision: VisionContext | null;
  ghostSummary: string | null;
  dominantMiss: string | null;
  firstName: string;
  /** 2026-05-23 — Unified vision context (GPS + hole geometry +
   *  active vision frame + recent shots + player profile). Null when
   *  the composer failed OR there's nothing rich to compose. When
   *  present, dispatch paths can lift player-relative yardages,
   *  hazard counts, last-shot pattern, and a coherent promptBlock
   *  for downstream voice copy — no per-dispatch re-derivation. */
  unifiedContext: import('./unifiedVisionContext').UnifiedVisionContext | null;
}

async function buildLearningContext(): Promise<LearningContext> {
  const settings = useSettingsStore.getState();
  const round = useRoundStore.getState();
  const ghost = useGhostStore.getState();
  const profile = usePlayerProfileStore.getState();
  const courseId = round.activeCourseId;
  const holeNumber = round.isRoundActive ? round.currentHole : 1;
  const holeView = courseId ? getHoleView(courseId, holeNumber) : null;
  let vision: VisionContext | null = null;
  try { vision = await getActiveVisionContext(); } catch { /* non-fatal */ }
  // 2026-05-23 — Unified context. Cheap to compose (all underlying
  // helpers are defensive + null-safe); never blocks dispatch on its
  // failure. The promptBlock + pre-computed yardages flow into the
  // dispatch implementations below where they meaningfully sharpen
  // the response.
  let unifiedContext: import('./unifiedVisionContext').UnifiedVisionContext | null = null;
  try {
    const uv = await import('./unifiedVisionContext');
    unifiedContext = await uv.getUnifiedVisionContext();
  } catch (e) {
    devLog(`[engine] unifiedContext compose failed (non-fatal): ${String(e)}`);
  }
  return {
    persona: settings.caddiePersonality,
    holeNumber,
    par: holeView?.par ?? null,
    yardageYd: holeView?.yardage_yd ?? null,
    courseId,
    courseName: round.activeCourse,
    holeView,
    vision,
    ghostSummary: ghost.getSummaryText?.() ?? null,
    dominantMiss: profile.dominantMiss ?? null,
    firstName: profile.firstName || 'you',
    unifiedContext,
  };
}

async function runPutting(req: PuttingRequest, persona: Persona, ctx: LearningContext): Promise<AnalysisEnvelope<PuttingAnalysis>> {
  const result = await analyzePutt(req.input);
  const profile = usePlayerProfileStore.getState();
  const adaptedVoice = adaptOnCourseVoice(
    result.caddieComment,
    deriveComplexityLevel(profile),
    hasMobilityFlag(profile),
    result.overallScore,
  );
  const sources: AnalysisSource[] = ['voice', 'course_geometry', 'player_profile'];
  if ((req.input.frames_base64?.length ?? 0) > 0) sources.push('glasses_vision');
  if (ctx.ghostSummary) sources.push('ghost_match');
  return {
    kind: 'putting',
    status: 'ok',
    result,
    confidence: result.overallScore,
    sources_used: sources,
    persona,
    voice_summary: adaptedVoice,
    timestamp_ms: Date.now(),
    analysis_id: newId('putt'),
  };
}

async function runLie(req: LieRequest, persona: Persona, _ctx: LearningContext): Promise<AnalysisEnvelope<LieAnalysis | null>> {
  const voiceGender = persona === 'serena' ? 'female' : 'male';
  const lieContext = await bundleLieAnalysisContext(null);
  const result: LieAnalysisResult = await analyzeLie(
    req.image_base64,
    lieContext,
    req.image_media_type ?? 'image/jpeg',
    voiceGender,
  );
  if (result.kind !== 'ok') {
    return {
      kind: 'lie',
      status: result.kind === 'low_quality' ? 'partial' : 'error',
      result: null,
      confidence: 0,
      sources_used: ['image_capture', 'course_geometry'],
      persona,
      voice_summary: result.kind === 'low_quality'
        ? result.follow_up
        : 'Lie read failed — try a fresh capture.',
      reason: result.kind,
      timestamp_ms: Date.now(),
      analysis_id: newId('lie'),
    };
  }
  const level = result.analysis.confidence_level;
  const conf: number = level === 'high' ? 90 : level === 'medium' ? 65 : 35;
  const profile = usePlayerProfileStore.getState();
  const adaptedVoice = adaptOnCourseVoice(
    result.analysis.tactical_advice,
    deriveComplexityLevel(profile),
    hasMobilityFlag(profile),
    conf,
  );
  return {
    kind: 'lie',
    status: 'ok',
    result: result.analysis,
    confidence: conf,
    sources_used: ['image_capture', 'course_geometry', 'player_profile'],
    persona,
    voice_summary: adaptedVoice,
    follow_up: result.analysis.follow_up_question ?? null,
    timestamp_ms: Date.now(),
    analysis_id: newId('lie'),
  };
}

interface GreenReadResult {
  spoken_read: string;
  context_note: string;
  trust_level: 'high' | 'medium' | 'low';
}

async function runGreenRead(req: GreenReadRequest, persona: Persona, ctx: LearningContext): Promise<AnalysisEnvelope<GreenReadResult>> {
  // Light-touch read aggregator. Defers to PuttingLab for full structured
  // analysis (caller passes spoken_read + frames). This branch handles
  // the case where the player asks for a quick read without a video.
  // High: polygons available (green outline known); Medium: green centroid only;
  // Low: no geometry at all.
  const polygonsKnown = !!ctx.holeView?.green_polygon || (ctx.holeView?.bunkers.length ?? 0) > 0;
  const trust: GreenReadResult['trust_level'] = polygonsKnown
    ? 'high'
    : ctx.holeView?.green ? 'medium' : 'low';
  const contextNote = ctx.holeView?.green
    ? `Green centroid known${ctx.holeView.bunkers.length > 0 ? `, ${ctx.holeView.bunkers.length} bunker${ctx.holeView.bunkers.length === 1 ? '' : 's'} flanking` : ''}.`
    : 'No green geometry — read from feel.';
  const spoken = req.spoken_read?.trim() || 'Trust your read.';
  const caddieName = getCaddieName(persona);
  const trustConfidence: number = trust === 'high' ? 80 : trust === 'medium' ? 55 : 30;
  const profile = usePlayerProfileStore.getState();
  const baseVoice = `${caddieName} here. ${spoken}. ${contextNote}`;
  const adaptedVoice = adaptOnCourseVoice(
    baseVoice,
    deriveComplexityLevel(profile),
    hasMobilityFlag(profile),
    trustConfidence,
  );
  return {
    kind: 'green_read',
    status: 'ok',
    result: { spoken_read: spoken, context_note: contextNote, trust_level: trust },
    confidence: trustConfidence,
    sources_used: ['voice', 'course_geometry'],
    persona,
    voice_summary: adaptedVoice,
    timestamp_ms: Date.now(),
    analysis_id: newId('read'),
  };
}

interface ClubRecResult {
  recommended_club: string;
  rationale: string;
  yards_to_target: number;
  evidence_stack?: string[];
  confidence_note?: string;
  clarification_question?: string | null;
}

function runClubRecommend(req: ClubRecommendRequest, persona: Persona, ctx: LearningContext): AnalysisEnvelope<ClubRecResult> {
  // Heuristic baseline. Future: read player's typical club distances from
  // playerProfile.clubDistances (when populated) and dispersion patterns.
  const y = req.yards_to_target;
  const baselineClub =
    y >= 240 ? 'Driver / 3W' :
    y >= 200 ? '3W / Hybrid' :
    y >= 175 ? '4 iron' :
    y >= 160 ? '5 iron' :
    y >= 145 ? '6 iron' :
    y >= 130 ? '7 iron' :
    y >= 115 ? '8 iron' :
    y >= 100 ? '9 iron' :
    y >= 80  ? 'PW' :
    y >= 60  ? 'GW' :
    y >= 40  ? 'SW' :
    y >= 20  ? 'LW' : 'Putter';

  const round = useRoundStore.getState();
  const practice = usePracticeStore.getState();
  const golfer = buildGolferModel();

  const actualShotHistory = round.shots
    .filter((s) => typeof s.club === 'string' && Number.isFinite(s.carry_distance ?? s.distance_yards ?? null))
    .map((s) => ({
      club: s.club as string,
      carryYards: Number(s.carry_distance ?? s.distance_yards ?? 0),
      tier: 'actual_shot_history' as const,
      sampleSize: 1,
    }));

  const launchMonitorData = [
    practice.avgCarryDriver > 0
      ? { club: 'Driver', carryYards: practice.avgCarryDriver, tier: 'launch_monitor_data' as const, sampleSize: Math.max(1, practice.swingCount) }
      : null,
    practice.avgCarry3Wood > 0
      ? { club: '3 wood', carryYards: practice.avgCarry3Wood, tier: 'launch_monitor_data' as const, sampleSize: Math.max(1, practice.swingCount) }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x != null);

  const roundHistory = golfer.club_distances
    .filter((c) => c.median_yd != null)
    .map((c) => ({
      club: c.club,
      carryYards: Number(c.median_yd),
      tier: 'round_history' as const,
      sampleSize: Math.max(1, c.sample_size),
    }));

  const equipmentResult = recommendClubFromEquipmentIntelligence({
    targetYards: y,
    fallbackClub: baselineClub,
    actualShotHistory,
    launchMonitorData,
    roundHistory,
  });
  const club = equipmentResult.recommendedClub || baselineClub;

  const note = req.conditions_note ? ` (${req.conditions_note})` : '';
  const caddieName = getCaddieName(persona);
  // 2026-05-23 — Unified context enrichment: fold hazard awareness +
  // dominant-miss bias into the rationale + voice_summary when the
  // unified context is rich. Each addition is a single short clause —
  // keeps the spoken line under the TTS budget while making the
  // recommendation visibly grounded in real data.
  const uc = ctx.unifiedContext;
  const hazardWarn = uc && uc.geometry.hazards.length > 0
    ? ` ${uc.geometry.hazards.length} hazard${uc.geometry.hazards.length === 1 ? '' : 's'} on this hole — aim for the fat side.`
    : '';
  const missWarn = uc?.player.dominantMiss
    ? ` (Watch the ${uc.player.dominantMiss}.)`
    : '';
  const sources_used: AnalysisSource[] = ['gps', 'course_geometry', 'player_profile'];
  if (uc?.vision.streaming) sources_used.push('glasses_vision');
  const confidenceScore = Math.round(Math.max(60, equipmentResult.confidence * 100));
  const confNote = confidenceNote(confidenceScore);
  const clarify = clarifyingQuestion(confidenceScore);
  const complexity = deriveComplexityLevel(usePlayerProfileStore.getState());
  const mobility = hasMobilityFlag(usePlayerProfileStore.getState());
  const evidenceStack = buildEvidenceStack([
    { source: 'Distance', detail: `${y}y to target` },
    { source: 'Baseline', detail: baselineClub },
    { source: 'Equipment Prior', detail: equipmentResult.rationale, confidence: equipmentResult.confidence * 100 },
  ]);
  const baseVoice = `${caddieName} — ${y} yards. ${club}${note}.${missWarn} ${confNote}${clarify ? ` ${clarify}` : ''}`.trim();
  const adaptedVoice = adaptOnCourseVoice(baseVoice, complexity, mobility, confidenceScore);
  return {
    kind: 'club_recommend',
    status: 'ok',
    result: {
      recommended_club: club,
      rationale: `${y}y to target${note}. Baseline club at this distance.${hazardWarn} ${equipmentResult.rationale}`.trim(),
      yards_to_target: y,
      evidence_stack: evidenceStack,
      confidence_note: confNote,
      clarification_question: clarify,
    },
    confidence: confidenceScore,
    sources_used,
    persona,
    voice_summary: adaptedVoice,
    timestamp_ms: Date.now(),
    analysis_id: newId('club'),
  };
}

function runCourseContext(req: CourseContextRequest, persona: Persona, ctx: LearningContext): AnalysisEnvelope<CourseHoleView | null> {
  const holeNumber = req.hole_number ?? ctx.holeNumber;
  const view = ctx.courseId ? getHoleView(ctx.courseId, holeNumber) : null;
  const caddieName = getCaddieName(persona);
  if (!view) {
    return {
      kind: 'course_context', status: 'partial',
      result: null, confidence: 0,
      sources_used: ['course_geometry'],
      persona,
      voice_summary: `${caddieName} — no course data loaded for hole ${holeNumber}.`,
      reason: 'no_geometry',
      timestamp_ms: Date.now(),
      analysis_id: newId('ctx'),
    };
  }
  return {
    kind: 'course_context', status: 'ok',
    result: view,
    confidence: view.confidence.overall,
    sources_used: ['course_geometry', 'gps'],
    persona,
    voice_summary: `Hole ${view.hole_number}. Par ${view.par ?? '?'}. ${view.yardage_yd ?? '?'} yards. ${view.confidence_label}.`,
    timestamp_ms: Date.now(),
    analysis_id: newId('ctx'),
  };
}

function runGhostStatus(_req: GhostStatusRequest, persona: Persona, ctx: LearningContext): AnalysisEnvelope<{ summary: string | null }> {
  const summary = ctx.ghostSummary;
  return {
    kind: 'ghost_status',
    status: summary ? 'ok' : 'partial',
    result: { summary },
    confidence: summary ? 90 : 0,
    sources_used: ['ghost_match'],
    persona,
    voice_summary: summary ?? 'No ghost loaded for this round.',
    timestamp_ms: Date.now(),
    analysis_id: newId('ghost'),
  };
}

function runMentalCheck(req: MentalCheckRequest, persona: Persona, ctx: LearningContext): AnalysisEnvelope<{ state: string; cue: string }> {
  const note = req.state_note.toLowerCase();
  const stressed = /\b(rattled|nervous|tight|tense|frustrat|angry|tilted)\b/.test(note);
  const calm = /\b(locked|focus|good|fine|smooth|easy|calm)\b/.test(note);
  const state = stressed ? 'stressed' : calm ? 'locked_in' : 'neutral';
  const cue = state === 'stressed'
    ? 'Three breaths. Pick the smallest target you can see. Commit and swing.'
    : state === 'locked_in'
      ? 'Stay in this rhythm. One shot at a time.'
      : 'Reset. Pick your target. Commit.';
  const caddieName = getCaddieName(persona);
  const profile = usePlayerProfileStore.getState();
  const adaptedVoice = adaptOnCourseVoice(
    `${caddieName} — ${cue}`,
    deriveComplexityLevel(profile),
    hasMobilityFlag(profile),
    70,
  );
  return {
    kind: 'mental_check', status: 'ok',
    result: { state, cue },
    confidence: 70,
    sources_used: ['mental_state', 'voice'],
    persona,
    voice_summary: adaptedVoice,
    timestamp_ms: Date.now(),
    analysis_id: newId('mental'),
  };
}

// ─── Voice playback ──────────────────────────────────────────────────────

async function speakEnvelope(env: AnalysisEnvelope): Promise<void> {
  if (!env.voice_summary || env.voice_summary.trim().length === 0) return;
  try {
    const settings = useSettingsStore.getState();
    const voiceMod = await import('./voiceService');
    void voiceMod.speak?.(
      env.voice_summary,
      settings.voiceGender,
      settings.language ?? 'en',
      getApiBaseUrl(),
      { userInitiated: true },
    )?.catch?.(() => undefined);
  } catch (e) {
    devLog('[engine] speak failed (non-fatal): ' + String(e));
  }
}

// ─── Recent-analysis ring buffer (learning seed) ─────────────────────────

interface HistoryEntry {
  timestamp_ms: number;
  kind: AnalysisKind;
  confidence: number;
  voice_summary: string;
  analysis_id: string;
}

const HISTORY_MAX = 50;
const history: HistoryEntry[] = [];

function pushHistory(env: AnalysisEnvelope): void {
  history.push({
    timestamp_ms: env.timestamp_ms,
    kind: env.kind,
    confidence: env.confidence,
    voice_summary: env.voice_summary,
    analysis_id: env.analysis_id,
  });
  if (history.length > HISTORY_MAX) history.shift();
}

/** Read recent analysis envelopes (newest last). Useful for the brain.ts
 *  system prompt builder to inject "what I just told you" context, and
 *  for the future learning model to detect patterns ("the player is
 *  asking for mental cues a lot today"). */
export function getRecentAnalyses(limit = 10): HistoryEntry[] {
  return history.slice(-limit);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function errorEnvelope(kind: AnalysisKind, persona: Persona, reason: string): AnalysisEnvelope {
  const caddieName = getCaddieName(persona);
  return {
    kind,
    status: 'error',
    result: null,
    confidence: 0,
    sources_used: [],
    persona,
    voice_summary: `${caddieName} — couldn't run that analysis. Try again in a moment.`,
    reason,
    timestamp_ms: Date.now(),
    analysis_id: newId(kind.slice(0, 4)),
  };
}

function swingRecoveryEnvelope(
  kind: 'swing_compare' | 'pose_estimate',
  persona: Persona,
  ctx: LearningContext,
  reason: string,
): AnalysisEnvelope {
  const caddieName = getCaddieName(persona);
  const profile = usePlayerProfileStore.getState();
  const complexity = deriveComplexityLevel(profile);
  const mobility = hasMobilityFlag(profile);
  const base = complexity === 'simple'
    ? 'I still have enough to coach one move now: smooth tempo, centered contact, and hold your finish for two seconds.'
    : 'I can still coach this rep: prioritize centered strike, stable head through impact, and a balanced finish.';
  const mobilityNote = mobility
    ? ' Keep the move compact and pain-free; no hard speed chase on this rep.'
    : '';
  return {
    kind,
    status: 'partial',
    result: {
      recovery_mode: true,
      reason,
      next_action: 'Record one additional swing from a steady side angle, then rerun analysis.',
      primary_focus: 'centered_contact',
      secondary_focus: 'balanced_finish',
    },
    confidence: 25,
    sources_used: ['player_profile', 'voice'],
    persona,
    voice_summary: `${caddieName} — swing read is partial right now. ${base}${mobilityNote}`,
    follow_up: `Try again on hole ${ctx.holeNumber} or your next practice rep and I will tighten this call.`,
    reason,
    timestamp_ms: Date.now(),
    analysis_id: newId(kind.slice(0, 4)),
  };
}

function prioritizeSwingFocus(metrics: Array<{ label: string; direction: string; match_score: number; verdict: string }>): { primary: string; secondary: string | null } {
  const weak = metrics
    .filter((m) => m.direction === 'worse')
    .sort((a, b) => a.match_score - b.match_score);
  if (weak.length === 0) return { primary: 'tempo_and_balance', secondary: null };
  const primary = weak[0].label;
  const secondary = weak.length > 1 ? weak[1].label : null;
  return { primary, secondary };
}

function adaptSwingVoice(
  base: string,
  priorities: { primary: string; secondary: string | null },
  complexity: CoachingComplexity,
  mobilitySafe: boolean,
): string {
  const focus = complexity === 'simple'
    ? `One focus right now: ${priorities.primary}.`
    : `Primary focus: ${priorities.primary}.${priorities.secondary ? ` Secondary: ${priorities.secondary}.` : ''}`;
  const mobility = mobilitySafe ? ' Keep effort at 70% and move pain-free.' : '';
  return `${base} ${focus}${mobility}`.trim();
}

function buildPoseFallbackVoice(
  persona: Persona,
  complexity: CoachingComplexity,
  mobilitySafe: boolean,
): string {
  const caddieName = getCaddieName(persona);
  const line = complexity === 'simple'
    ? 'Partial swing read: give me one more clean angle. For now, smooth tempo and balanced finish.'
    : 'Partial swing read: capture one cleaner angle and I will rank your top fix. For now, prioritize centered strike and stable head.';
  const mobility = mobilitySafe ? ' Stay compact and pain-free this rep.' : '';
  return `${caddieName} — ${line}${mobility}`;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── 2026-05-22 — Caddie Brain dispatchers ──────────────────────────────

async function runShotStrategy(req: ShotStrategyRequest, persona: Persona, ctx: LearningContext): Promise<AnalysisEnvelope> {
  const meta = await import('./metaCourseIntelligence');
  // 2026-05-23 — Use unifiedContext player-to-green yardage as the
  // target when the caller didn't specify one. The Haversine math is
  // already done; no need to re-derive. Falls back to the legacy
  // null when unifiedContext is sparse.
  const uc = ctx.unifiedContext;
  const inferredTarget = req.target_yards ?? uc?.geometry.yardagesFromPlayer.middle ?? null;
  const result = await meta.recommendShot({
    lie_hint: req.lie_hint ?? null,
    target_yards: inferredTarget,
    plays_like_yards: req.plays_like_yards ?? null,
    hole_number: ctx.holeNumber,
    player_location: ctx.holeView?.player_location ?? null,
  });
  // FIX M8 — stamp Kevin's rec so adherence can be tracked when the next
  // shot is logged. Only stamp when a real club was recommended.
  try {
    const { useRoundStore } = await import('../store/roundStore');
    useRoundStore.getState().setPendingKevinRec({
      club: result.recommended_club ?? null,
      shape: result.shot_shape ?? null,
      aimPoint: result.aim_point ?? null,
    });
  } catch { /* non-fatal */ }
  // Surface the unified promptBlock onto the envelope's voice_summary
  // when it adds information the meta engine didn't already include.
  // The promptBlock is concise + tagged so spoken delivery stays under
  // the TTS budget.
  const enrichedSources = result.sources_used.map(mapMetaSource);
  if (uc?.vision.streaming) enrichedSources.push('glasses_vision');
  if (uc && uc.geometry.hazards.length > 0 && !result.voice_summary.toLowerCase().includes('hazard')) {
    enrichedSources.push('course_geometry');
  }
  devLog(`[engine] shot_strategy enriched: target=${inferredTarget}, hazards=${uc?.geometry.hazards.length ?? 0}, glasses=${uc?.vision.streaming ? 'live' : 'off'}`);
  return {
    kind: 'shot_strategy',
    status: result.confidence > 30 ? 'ok' : 'partial',
    result,
    confidence: result.confidence,
    sources_used: enrichedSources,
    persona,
    voice_summary: result.voice_summary,
    timestamp_ms: Date.now(),
    analysis_id: newId('shot'),
  };
}

function mapMetaSource(s: string): AnalysisSource {
  switch (s) {
    case 'course_geometry': return 'course_geometry';
    case 'gps_position':    return 'gps';
    case 'vision_frame':    return 'glasses_vision';
    case 'ghost_match':     return 'ghost_match';
    case 'golfer_model':    return 'player_profile';
    case 'lie_analysis':    return 'image_capture';
    default:                return 'gps';
  }
}

async function runSwingCompare(req: SwingCompareRequest, persona: Persona, ctx: LearningContext): Promise<AnalysisEnvelope> {
  const poseMod = await import('./poseEstimator');
  const compareMod = await import('./swingComparisonEngine');

  const current = req.current_video_uri && req.current_video_duration_ms
    ? await poseMod.estimatePose({
        videoUri: req.current_video_uri,
        durationMs: req.current_video_duration_ms,
      })
    : null;

  if (!current) {
    return swingRecoveryEnvelope('swing_compare', persona, ctx, 'no current swing video supplied');
  }

  const reference = req.reference_video_uri && req.reference_video_duration_ms
    ? await poseMod.estimatePose({
        videoUri: req.reference_video_uri,
        durationMs: req.reference_video_duration_ms,
      })
    : null;

  const kind =
    req.against === 'tour_median' ? 'self_vs_pro' :
    req.against === 'amateur_good' ? 'self_vs_amateur' :
    reference ? 'self_vs_self' : 'self_vs_pro';

  const cmp = compareMod.compareSwings({ current, reference, kind, club: req.club });
  const profile = usePlayerProfileStore.getState();
  const priorities = prioritizeSwingFocus(cmp.metrics as Array<{ label: string; direction: string; match_score: number; verdict: string }>);
  const complexity = deriveComplexityLevel(profile);
  const mobility = hasMobilityFlag(profile);
  const adaptedVoice = adaptSwingVoice(cmp.voice_summary, priorities, complexity, mobility);

  return {
    kind: 'swing_compare',
    // null overall_match = insufficient data to compare → 'partial'
    // (never coerce null to a number here; that's the fabricated-0 bug).
    status: cmp.overall_match != null && cmp.overall_match >= 30 ? 'ok' : 'partial',
    result: {
      ...cmp,
      primary_focus: priorities.primary,
      secondary_focus: priorities.secondary,
      complexity_level: complexity,
      mobility_safe_mode: mobility,
    },
    // Envelope confidence is a numeric 0..100; insufficient data → 0
    // confidence (the 'partial' status already flags "couldn't compare").
    confidence: cmp.overall_match ?? 0,
    sources_used: reference ? ['player_profile', 'voice'] : ['player_profile'],
    persona,
    voice_summary: adaptedVoice,
    timestamp_ms: Date.now(),
    analysis_id: newId('cmp'),
  };
}

async function runPoseEstimate(req: PoseEstimateRequestX, persona: Persona, ctx: LearningContext): Promise<AnalysisEnvelope> {
  const poseMod = await import('./poseEstimator');
  const estimate = await poseMod.estimatePose({
    imageUri: req.imageUri,
    videoUri: req.videoUri,
    durationMs: req.durationMs,
    context: req.context,
  });
  void ctx;
  const profile = usePlayerProfileStore.getState();
  const complexity = deriveComplexityLevel(profile);
  const mobility = hasMobilityFlag(profile);
  const fallbackVoice = buildPoseFallbackVoice(persona, complexity, mobility);
  return {
    kind: 'pose_estimate',
    status: estimate.confidence > 0 ? 'ok' : 'partial',
    result: estimate,
    confidence: estimate.confidence,
    sources_used: estimate.frames.length > 0 ? ['glasses_vision', 'voice'] : ['voice'],
    persona,
    voice_summary: estimate.confidence > 0 ? estimate.reason : fallbackVoice,
    follow_up: estimate.confidence > 0 ? null : 'Capture one face-on swing and one down-the-line swing so I can rank your top fix.',
    timestamp_ms: Date.now(),
    analysis_id: newId('pose'),
  };
}

async function runLieEnriched(req: LieEnrichedRequest, persona: Persona, ctx: LearningContext): Promise<AnalysisEnvelope> {
  const lieMod = await import('./lieAnalysisService');
  const enriched = await lieMod.enrichedLieAnalysis({
    imageBase64: req.imageBase64,
    imageMediaType: req.imageMediaType,
    voiceGender: persona === 'serena' ? 'female' : 'male',
    acoustic: req.acoustic,
    include_strategy: req.include_strategy,
  });
  void ctx;
  const confidence =
    enriched.base.confidence_level === 'high' ? 88 :
    enriched.base.confidence_level === 'medium' ? 65 : 35;
  return {
    kind: 'lie_enriched',
    status: enriched.base.confidence_level === 'low' ? 'partial' : 'ok',
    result: enriched,
    confidence,
    sources_used: ['image_capture', 'course_geometry'].concat(
      enriched.sources_used.includes('acoustic') ? ['mental_state' as AnalysisSource] : [],
    ) as AnalysisSource[],
    persona,
    voice_summary: enriched.voice_summary,
    timestamp_ms: Date.now(),
    analysis_id: newId('lie+'),
  };
}

// ─── Persona Knowledge Layer enrichment ─────────────────────────────────

/**
 * 2026-05-23 — Fold Tank's teaching wisdom into voice_summary when:
 *   - persona === 'tank', AND
 *   - the envelope's voice_summary matches a KB entry above threshold,
 *     AND
 *   - the existing voice_summary doesn't already lead with Tank's
 *     signature phrasing (avoid double-quoting).
 *
 * When all three hit, appends a single "Tank's take: …" tail (first
 * sentence of the matched tankAnswer) so the player hears the
 * envelope's tactical content AND Tank's broader philosophy on it.
 * Non-Tank personas pass through unchanged.
 *
 * Tail is bounded: 1 sentence, prefixed with " — ". This keeps
 * voice_summary readable and bounded so TTS doesn't blow past the
 * UI's spoken-line budget.
 */
export async function enrichWithPersonaWisdom(
  envelope: AnalysisEnvelope,
  persona: Persona,
): Promise<AnalysisEnvelope> {
  if (persona !== 'tank') return envelope;
  if (!envelope.voice_summary || envelope.voice_summary.length < 12) return envelope;
  // Avoid double-enrich on history replays.
  if (envelope.voice_summary.includes("Tank's take:")) return envelope;
  let kb: typeof import('./personaKnowledgeBase');
  try {
    kb = await import('./personaKnowledgeBase');
  } catch {
    return envelope;
  }
  // Probe with the voice_summary text — short enough to be a good
  // matcher input, captures the tactical content already produced.
  const matches = kb.findRelevantPersonaKBEntries(envelope.voice_summary, 1);
  if (matches.length === 0) return envelope;
  const top = matches[0];
  // Take ONLY the first sentence of Tank's take — bounded tail.
  const firstSentence = top.entry.tankAnswer.split(/(?<=[.!?])\s/)[0].trim();
  if (!firstSentence) return envelope;
  const enrichedSummary = `${envelope.voice_summary} — Tank's take: ${firstSentence}`;
  devLog(`[engine] enriched envelope id=${envelope.analysis_id} with KB ${top.entry.id} (score=${top.score})`);
  return { ...envelope, voice_summary: enrichedSummary };
}
