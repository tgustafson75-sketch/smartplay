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
import { getHoleView, type CourseHoleView } from './courseDataOrchestrator';
import { analyzePutt, type PuttingAnalysis, type PuttingAnalysisInput } from './puttingAnalysisService';
import { analyzeLie, type LieAnalysis, type LieAnalysisResult } from './lieAnalysisService';
import { bundleLieAnalysisContext } from './lieAnalysisContext';
import { getActiveVisionContext, type VisionContext } from './glassesVisionInput';
import { getCaddieName } from '../lib/persona';
import { devLog } from './devLog';

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
    pushHistory(envelope);
    if (request.speak) void speakEnvelope(envelope);
    return envelope;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    devLog(`[engine] error in kind=${request.kind}: ${msg}`);
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
  };
}

async function runPutting(req: PuttingRequest, persona: Persona, ctx: LearningContext): Promise<AnalysisEnvelope<PuttingAnalysis>> {
  const result = await analyzePutt(req.input);
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
    voice_summary: result.caddieComment,
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
  return {
    kind: 'lie',
    status: 'ok',
    result: result.analysis,
    confidence: conf,
    sources_used: ['image_capture', 'course_geometry', 'player_profile'],
    persona,
    voice_summary: result.analysis.tactical_advice,
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
  return {
    kind: 'green_read',
    status: 'ok',
    result: { spoken_read: spoken, context_note: contextNote, trust_level: trust },
    confidence: trustConfidence,
    sources_used: ['voice', 'course_geometry'],
    persona,
    voice_summary: `${caddieName} here. ${spoken}. ${contextNote}`,
    timestamp_ms: Date.now(),
    analysis_id: newId('read'),
  };
}

interface ClubRecResult {
  recommended_club: string;
  rationale: string;
  yards_to_target: number;
}

function runClubRecommend(req: ClubRecommendRequest, persona: Persona, ctx: LearningContext): AnalysisEnvelope<ClubRecResult> {
  // Heuristic baseline. Future: read player's typical club distances from
  // playerProfile.clubDistances (when populated) and dispersion patterns.
  const y = req.yards_to_target;
  const club =
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
  const note = req.conditions_note ? ` (${req.conditions_note})` : '';
  const caddieName = getCaddieName(persona);
  return {
    kind: 'club_recommend',
    status: 'ok',
    result: {
      recommended_club: club,
      rationale: `${y}y to target${note}. Baseline club at this distance.`,
      yards_to_target: y,
    },
    confidence: 60,
    sources_used: ['gps', 'course_geometry', 'player_profile'],
    persona,
    voice_summary: `${caddieName} — ${y} yards. ${club}${note}.`,
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
  return {
    kind: 'mental_check', status: 'ok',
    result: { state, cue },
    confidence: 70,
    sources_used: ['mental_state', 'voice'],
    persona,
    voice_summary: `${caddieName} — ${cue}`,
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
      process.env.EXPO_PUBLIC_API_URL ?? '',
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

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── 2026-05-22 — Caddie Brain dispatchers ──────────────────────────────

async function runShotStrategy(req: ShotStrategyRequest, persona: Persona, ctx: LearningContext): Promise<AnalysisEnvelope> {
  const meta = await import('./metaCourseIntelligence');
  const result = await meta.recommendShot({
    lie_hint: req.lie_hint ?? null,
    target_yards: req.target_yards ?? null,
    hole_number: ctx.holeNumber,
    player_location: ctx.holeView?.player_location ?? null,
  });
  return {
    kind: 'shot_strategy',
    status: result.confidence > 30 ? 'ok' : 'partial',
    result,
    confidence: result.confidence,
    sources_used: result.sources_used.map(mapMetaSource),
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
    return errorEnvelope('swing_compare', persona, 'no current swing video supplied');
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

  const cmp = compareMod.compareSwings({ current, reference, kind });
  void ctx;

  return {
    kind: 'swing_compare',
    status: cmp.overall_match >= 30 ? 'ok' : 'partial',
    result: cmp,
    confidence: cmp.overall_match,
    sources_used: reference ? ['player_profile', 'voice'] : ['player_profile'],
    persona,
    voice_summary: cmp.voice_summary,
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
  return {
    kind: 'pose_estimate',
    status: estimate.confidence > 0 ? 'ok' : 'partial',
    result: estimate,
    confidence: estimate.confidence,
    sources_used: estimate.frames.length > 0 ? ['glasses_vision', 'voice'] : ['voice'],
    persona,
    voice_summary: estimate.reason,
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
