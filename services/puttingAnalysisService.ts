/**
 * 2026-05-22 — PuttingLab analysis service (v2 — structured schema).
 *
 * Putting needs special handling — Meta Ray-Ban glasses produce
 * excellent POV downward video (hands, putter face, ball, green,
 * stroke) that swing-pose models can't read. This service routes
 * frames + the player's spoken green read through a Claude Vision
 * call tuned for putting-specific cues, merges course-complex data
 * from courseGeometryService, and returns a fully-structured
 * PuttingAnalysis the cage-review UI renders.
 *
 * Inputs (any combination):
 *   - frames_base64[]  — JPEG/PNG frames (no data: prefix)
 *   - video_url        — remote URL (we pass through; server fetches)
 *   - spoken_read      — transcribed read ("left edge, 12 inches break")
 *   - notes            — free-text player note
 *   - hole_number      — active hole (auto-resolved from roundStore)
 *   - distance_feet    — explicit override; else estimated server-side
 *
 * Bootstrap-friendly: with no frames + no read, the fallback returns a
 * complete result with confidence ~25 so the player gets actionable
 * coaching every time. Defensive normalization clamps every enum into
 * the schema's allowed set.
 */

import { useSettingsStore } from '../store/settingsStore';
import { useRoundStore } from '../store/roundStore';
import { getHoleGeometry } from './courseGeometryService';
import { getActiveVisionContext } from './glassesVisionInput';
import { getCaddieName, personaToVoiceGender } from '../lib/persona';
import { devLog } from './devLog';
import { getApiBaseUrl } from './apiBase';

// ─── Schema (matches the user's 2026-05-22 spec exactly) ─────────────

export type SlopeDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'straight'
  | 'uphill'
  | 'downhill';
export type SlopeSeverity = 'flat' | 'subtle' | 'moderate' | 'severe';
export type Alignment = 'square' | 'open' | 'closed' | 'slightly-open' | 'slightly-closed';
export type BallPosition = 'center' | 'forward' | 'back';
export type StanceWidth = 'narrow' | 'standard' | 'wide';
export type GripPressure = 'light' | 'medium' | 'firm';
export type StrokePath = 'straight' | 'slight-arc' | 'outside-in' | 'inside-out';
export type StrokeTempo = 'smooth' | 'decelerating' | 'jerky' | 'accelerating';
export type FaceAngleAtImpact = 'square' | 'open' | 'closed';

export interface PuttingAnalysis {
  puttId: string;
  timestamp: string;        // ISO 8601
  holeNumber?: number;
  distanceFeet: number;
  /** 2026-05-23 — true when the analysis was produced with thin
   *  inputs (no frames usable, low-light flag, partial-view frame
   *  count). UI surfaces a hint when true so the player knows the
   *  recommendation is approximate. Optional so legacy persisted
   *  PuttingAnalysis records continue to read clean. */
  partialCapture?: boolean;

  greenSlope: {
    direction: SlopeDirection;
    severity: SlopeSeverity;
    breakInches: number;
    confidence: number;     // 0-100
  };

  setup: {
    alignment: Alignment;
    ballPosition: BallPosition;
    stanceWidth: StanceWidth;
    gripPressure: GripPressure;
    quality: number;        // 0-100
  };

  stroke: {
    path: StrokePath;
    tempo: StrokeTempo;
    faceAngleAtImpact: FaceAngleAtImpact;
    deceleration: boolean;
    quality: number;
  };

  readAccuracy: {
    wasCorrect: boolean;
    suggestedAdjustment: string;
    confidence: number;
  };

  recommendation: {
    line: string;
    speedFeel: string;
    mentalCue: string;
    technicalCue: string;
  };

  overallScore: number;     // 0-100
  caddieComment: string;    // persona-aware spoken summary
}

export interface PuttingAnalysisInput {
  frames_base64?: string[];
  video_url?: string | null;
  spoken_read?: string | null;
  notes?: string | null;
  course_id?: string | null;
  hole_number?: number | null;
  distance_feet?: number | null;
  // 2026-06-08 (audit #1 #12) — user-marked ball + aim target (normalized
  // 0..1 frame coords) so the vision model can anchor its read to where
  // the ball actually sat and where the player aimed.
  ball_area_norm?: { x: number; y: number; r: number } | null;
  target_norm?: { x: number; y: number } | null;
}

// ─── Public API ──────────────────────────────────────────────────────────

const apiUrl = (): string => getApiBaseUrl();

/**
 * Run putting analysis. Always returns a fully-populated PuttingAnalysis;
 * on transport failure the result is the course-context fallback (lower
 * confidence + bootstrap mental-cue).
 */
export async function analyzePutt(
  input: PuttingAnalysisInput,
): Promise<PuttingAnalysis> {
  const settings = useSettingsStore.getState();
  const round = useRoundStore.getState();

  const courseId = input.course_id ?? round.activeCourseId;
  const holeNumber = input.hole_number ?? (round.isRoundActive ? round.currentHole : undefined);
  const geom = courseId && holeNumber ? getHoleGeometry(courseId, holeNumber) : null;

  // Opportunistic glasses frame. 2026-05-23 — now actually fetches
  // the latest frame as base64 from the rolling queue (was only
  // checking URI presence before). When extractPuttKeyFrames isn't
  // already feeding frames, this picks up a glasses POV frame for
  // free so Tank/Kevin can see what the player just lined up over.
  let frames = input.frames_base64 ?? [];
  if (frames.length === 0) {
    try {
      const visionMod = await import('./glassesVisionInput');
      const ctx = await visionMod.getActiveVisionContext();
      if (ctx?.detected_mode === 'putting' || ctx?.detected_mode === 'green_read') {
        const b64 = await visionMod.getActiveVisionFrameBase64();
        if (b64?.base64) {
          frames = [b64.base64];
          devLog(`[putting] auto-folded glasses frame caption="${b64.caption}"`);
        }
      } else if (ctx?.frame.uri) {
        devLog(`[putting] glasses frame in queue but mode=${ctx.detected_mode} — not auto-folded`);
      }
    } catch { /* non-fatal */ }
  }
  // 2026-05-23 — partial_capture flag. The pipeline still runs with
  // thin inputs, but downstream consumers (cage review card, voice
  // narration) can surface a "captured under low light / partial
  // view" hint when this is true. Heuristic: no frames + no video +
  // no spoken read → mostly working from green geometry alone.
  const partialCapture =
    frames.length === 0 && !input.video_url && (!input.spoken_read || input.spoken_read.trim().length < 4);

  try {
    const res = await fetch(`${apiUrl()}/api/putting-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frames_base64: frames,
        video_url: input.video_url ?? null,
        spoken_read: input.spoken_read ?? null,
        notes: input.notes ?? null,
        distance_feet: input.distance_feet ?? null,
        hole_number: holeNumber ?? null,
        course_id: courseId,
        green_centroid: geom?.green ?? null,
        green_front: geom?.green_front ?? null,
        green_back: geom?.green_back ?? null,
        ball_area_norm: input.ball_area_norm ?? null,
        target_norm: input.target_norm ?? null,
        persona: settings.caddiePersonality,
        voiceGender: settings.voiceGender,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn('[putting] api non-ok', res.status);
      return fallbackAnalysis(input, holeNumber, settings.caddiePersonality, partialCapture);
    }
    const data = (await res.json()) as Partial<PuttingAnalysis>;
    const normalized = normalize(data, input, holeNumber, settings.caddiePersonality);
    // Persona enrichment: fold Tank's putting wisdom into the
    // mentalCue when the persona is Tank and the KB has a relevant
    // entry. The server's mentalCue stays as the fallback; this only
    // strengthens it.
    const enriched = await enrichRecommendationWithPersonaKB(normalized, settings.caddiePersonality);
    enriched.partialCapture = partialCapture || normalized.partialCapture;
    devLog(`[putting] analysis ok overallScore=${enriched.overallScore} dist=${enriched.distanceFeet}ft partial=${enriched.partialCapture ?? false}`);
    return enriched;
  } catch (e) {
    console.warn('[putting] analyze exception:', e);
    return fallbackAnalysis(input, holeNumber, settings.caddiePersonality, partialCapture);
  }
}

/**
 * 2026-05-23 — When persona is Tank AND the personaKnowledgeBase has
 * a relevant putting entry for the situation, replace the generic
 * mentalCue with Tank's first-sentence take. Tactical/technical cues
 * stay as-is (server already tuned for putting specifics). Non-Tank
 * personas pass through unchanged.
 */
async function enrichRecommendationWithPersonaKB(
  analysis: PuttingAnalysis,
  persona: string,
): Promise<PuttingAnalysis> {
  const p = (persona ?? '').toLowerCase();
  if (p !== 'tank') return analysis;
  try {
    const kb = await import('./personaKnowledgeBase');
    // Probe the KB with the analysis's situation — uses recommendation
    // lines + slope direction as the input phrase.
    const probe = `putt ${analysis.recommendation.line} ${analysis.greenSlope.direction} ${analysis.greenSlope.severity}`;
    const matches = kb.findRelevantPersonaKBEntries(probe, 1);
    if (matches.length === 0) return analysis;
    const firstSentence = matches[0].entry.tankAnswer.split(/(?<=[.!?])\s/)[0].trim();
    if (!firstSentence) return analysis;
    devLog(`[putting] enriched recommendation with KB ${matches[0].entry.id}`);
    return {
      ...analysis,
      recommendation: {
        ...analysis.recommendation,
        mentalCue: firstSentence,
      },
    };
  } catch (e) {
    devLog(`[putting] persona KB enrich failed (non-fatal): ${String(e)}`);
    return analysis;
  }
}

/**
 * Voice-intent convenience: pulls input, analyzes, speaks the persona-
 * aware caddieComment back through voiceService.
 */
export async function speakPuttingAnalysis(spokenRead: string | null): Promise<PuttingAnalysis> {
  const result = await analyzePutt({ spoken_read: spokenRead });
  try {
    const settings = useSettingsStore.getState();
    const voiceMod = await import('./voiceService');
    // Phase 100: pass caddiePersonality (not voiceGender) so Tank / Harry
    // use their correct male voice, not Kevin's default.
    const persona = (settings.caddiePersonality ?? 'kevin') as import('../lib/persona').Persona;
    void voiceMod.speak?.(
      result.caddieComment,
      personaToVoiceGender(persona),
      settings.language ?? 'en',
      apiUrl(),
      { userInitiated: true },
    )?.catch?.(() => undefined);
  } catch (e) {
    devLog('[putting] caddieComment speak failed (non-fatal): ' + String(e));
  }
  return result;
}

// ─── Public synthesizer ──────────────────────────────────────────────────

/**
 * 2026-05-23 (Fix #5) — Synthesize a lightweight PrimaryIssue from an
 * existing PuttingAnalysis result. Closes the diagnosis gap: glasses
 * POV uploads route to the putting analyzer for granular grip / stroke
 * / read detail, but the swing detail screen's PrimaryIssueCard
 * (overall fault read) never landed because no primary_issue was ever
 * computed for putting sessions.
 *
 * This synthesizer uses ONLY the data we already have — no new vision
 * call, no API round-trip. It maps the PuttingAnalysis's three quality
 * signals (setup.quality, stroke.quality, readAccuracy.confidence) to a
 * dominant weak area name + category, derives severity from
 * overallScore, and lifts the recommendation's technicalCue +
 * mentalCue verbatim into mechanical_breakdown + feel_cue.
 *
 * Persisted via setSessionAnalysis alongside the existing
 * addPuttingAnalysis call, so BOTH cards render on the swing detail —
 * granular PuttingAnalysisCard stays as-is, PrimaryIssueCard layers
 * the overall read on top.
 *
 * Drill recommendation is intentionally NOT synthesized here — putting
 * drills live in a separate small catalog and a generic drill mapping
 * from putt issues isn't reliable enough to ship without curated content.
 * The swing-detail render gates DrillCard on drill_recommendation being
 * non-null so the placeholder card just doesn't appear for putts.
 */
export function synthesizePrimaryIssueFromPutting(
  analysis: PuttingAnalysis,
  detectedShotId: string | null,
  thumbnailPath: string | null = null,
): import('../store/cageStore').PrimaryIssue {
  const score = analysis.overallScore ?? 50;
  const severity: 'minor' | 'moderate' | 'significant' =
    score >= 75 ? 'minor' : score >= 50 ? 'moderate' : 'significant';

  const setupQ = analysis.setup.quality ?? 50;
  const strokeQ = analysis.stroke.quality ?? 50;
  const readConf = analysis.readAccuracy.confidence ?? 50;

  // Pick the weakest of the three measured areas as the headline issue.
  // Ties resolve toward stroke > setup > read (more actionable on the
  // tee than a green-read coaching note). If everything is solid
  // (>= 75 on the lowest), fall through to a generic "fundamentals" label.
  let name: string;
  let category: import('../store/cageStore').PrimaryIssue['category'];
  let issueId: string;

  const allHigh = strokeQ >= 75 && setupQ >= 75 && readConf >= 75;
  if (allHigh) {
    name = 'Putting fundamentals — solid';
    category = 'other';
    issueId = 'putting_fundamentals_solid';
  } else if (strokeQ <= setupQ && strokeQ <= readConf) {
    name = 'Stroke path / face control';
    category = 'swing_path';
    issueId = 'putting_stroke';
  } else if (setupQ <= strokeQ && setupQ <= readConf) {
    name = 'Setup alignment';
    category = 'setup';
    issueId = 'putting_setup';
  } else {
    name = 'Green read';
    category = 'other';
    issueId = 'putting_read';
  }

  // Confidence on the synthesized issue tracks severity inversely —
  // significant problems usually surface with high signal in the
  // putting analyzer; minor ones may be noise.
  const confidence: 'high' | 'medium' | 'low' =
    severity === 'significant' ? 'high' : severity === 'moderate' ? 'medium' : 'low';

  return {
    issue_id: issueId,
    name,
    category,
    severity,
    occurrence_count: 1,
    visual_reference_path: thumbnailPath,
    mechanical_breakdown: analysis.recommendation.technicalCue,
    feel_cue: analysis.recommendation.mentalCue,
    detected_in_shots: detectedShotId ? [detectedShotId] : [],
    confidence,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function newPuttId(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `putt_${y}${m}${day}_${rand}`;
}

function clamp01_100(n: unknown, dflt = 50): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return dflt;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pickEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  dflt: T,
): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}

function normalize(
  data: Partial<PuttingAnalysis>,
  input: PuttingAnalysisInput,
  holeNumber: number | undefined,
  persona: string,
): PuttingAnalysis {
  const slopeDirs: readonly SlopeDirection[] = ['left-to-right', 'right-to-left', 'straight', 'uphill', 'downhill'];
  const slopeSevs: readonly SlopeSeverity[] = ['flat', 'subtle', 'moderate', 'severe'];
  const aligns: readonly Alignment[] = ['square', 'open', 'closed', 'slightly-open', 'slightly-closed'];
  const ballPos: readonly BallPosition[] = ['center', 'forward', 'back'];
  const stances: readonly StanceWidth[] = ['narrow', 'standard', 'wide'];
  const grips: readonly GripPressure[] = ['light', 'medium', 'firm'];
  const paths: readonly StrokePath[] = ['straight', 'slight-arc', 'outside-in', 'inside-out'];
  const tempos: readonly StrokeTempo[] = ['smooth', 'decelerating', 'jerky', 'accelerating'];
  const faces: readonly FaceAngleAtImpact[] = ['square', 'open', 'closed'];

  const dataAny = data as Record<string, unknown>;
  const slope = (dataAny.greenSlope ?? {}) as Record<string, unknown>;
  const setup = (dataAny.setup ?? {}) as Record<string, unknown>;
  const stroke = (dataAny.stroke ?? {}) as Record<string, unknown>;
  const read = (dataAny.readAccuracy ?? {}) as Record<string, unknown>;
  const rec = (dataAny.recommendation ?? {}) as Record<string, unknown>;

  const distance = typeof data.distanceFeet === 'number' && Number.isFinite(data.distanceFeet)
    ? Math.max(0, Math.round(data.distanceFeet))
    : (input.distance_feet ?? 0);

  return {
    puttId: typeof data.puttId === 'string' && data.puttId.length > 0 ? data.puttId : newPuttId(),
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
    holeNumber: data.holeNumber ?? holeNumber,
    distanceFeet: distance,
    greenSlope: {
      direction: pickEnum(slope.direction, slopeDirs, 'straight'),
      severity: pickEnum(slope.severity, slopeSevs, 'subtle'),
      breakInches: typeof slope.breakInches === 'number' && Number.isFinite(slope.breakInches)
        ? Math.max(0, Math.round((slope.breakInches as number) * 10) / 10)
        : 0,
      confidence: clamp01_100(slope.confidence, 50),
    },
    setup: {
      alignment: pickEnum(setup.alignment, aligns, 'square'),
      ballPosition: pickEnum(setup.ballPosition, ballPos, 'center'),
      stanceWidth: pickEnum(setup.stanceWidth, stances, 'standard'),
      gripPressure: pickEnum(setup.gripPressure, grips, 'medium'),
      quality: clamp01_100(setup.quality, 60),
    },
    stroke: {
      path: pickEnum(stroke.path, paths, 'straight'),
      tempo: pickEnum(stroke.tempo, tempos, 'smooth'),
      faceAngleAtImpact: pickEnum(stroke.faceAngleAtImpact, faces, 'square'),
      deceleration: typeof stroke.deceleration === 'boolean' ? stroke.deceleration : false,
      quality: clamp01_100(stroke.quality, 60),
    },
    readAccuracy: {
      wasCorrect: typeof read.wasCorrect === 'boolean' ? read.wasCorrect : true,
      suggestedAdjustment: typeof read.suggestedAdjustment === 'string' && read.suggestedAdjustment.length > 0
        ? (read.suggestedAdjustment as string)
        : 'Trust your read.',
      confidence: clamp01_100(read.confidence, 50),
    },
    recommendation: {
      line: typeof rec.line === 'string' && rec.line.length > 0 ? (rec.line as string) : 'Trust your read.',
      speedFeel: typeof rec.speedFeel === 'string' && rec.speedFeel.length > 0 ? (rec.speedFeel as string) : 'Die it into the hole — smooth pendulum.',
      mentalCue: typeof rec.mentalCue === 'string' && rec.mentalCue.length > 0 ? (rec.mentalCue as string) : 'Smooth pendulum, eyes still.',
      technicalCue: typeof rec.technicalCue === 'string' && rec.technicalCue.length > 0 ? (rec.technicalCue as string) : 'Accelerate gently through impact.',
    },
    overallScore: clamp01_100(data.overallScore, 60),
    caddieComment: typeof data.caddieComment === 'string' && data.caddieComment.length > 0
      ? (data.caddieComment as string)
      : `${getCaddieName(persona)} here. Smooth pendulum. Eyes still. Trust your line.`,
  };
}

/** Bootstrap path: when frames + voice + network all unavailable, still
 *  return a complete PuttingAnalysis with low confidence. The point is
 *  never to leave the player without coaching.
 *
 *  2026-05-23 — Tank-specific copy when persona === 'tank'. Marine
 *  cadence + signature phrases instead of generic putting cues. Other
 *  personas keep the prior copy. Also stamps `partialCapture` so the
 *  UI can surface the "approximate" hint. */
function fallbackAnalysis(
  input: PuttingAnalysisInput,
  holeNumber: number | undefined,
  persona: string,
  partialCapture: boolean = true,
): PuttingAnalysis {
  const caddieName = getCaddieName(persona);
  const p = (persona ?? '').toLowerCase();
  const echo = input.spoken_read && input.spoken_read.trim().length > 0
    ? `Heard "${input.spoken_read.trim()}". `
    : '';
  // Tank-specific copy bank — clipped, command-stacked, no fluff.
  const isTank = p === 'tank';
  const recommendation = isTank
    ? {
        line: 'Trust your read. Pick the apex. Aim there.',
        speedFeel: 'Three-foot circle past the hole. Lag distance, not line.',
        mentalCue: 'Speed first. Line second. Standards are non-negotiable.',
        technicalCue: 'Accelerate through. No decel. Eyes still.',
      }
    : {
        line: 'Trust your read.',
        speedFeel: 'Die it into the hole — smooth pendulum.',
        mentalCue: 'Smooth pendulum, eyes still through impact.',
        technicalCue: 'Accelerate gently — no deceleration.',
      };
  const caddieComment = isTank
    ? `${echo}Limited reads on this one. Run the routine. Speed first. Line second. Lock it in.`
    : `${caddieName} here. ${echo}Smooth pendulum, eyes still, trust the line.`;
  return {
    puttId: newPuttId(),
    timestamp: new Date().toISOString(),
    holeNumber,
    distanceFeet: input.distance_feet ?? 0,
    partialCapture,
    greenSlope: { direction: 'straight', severity: 'subtle', breakInches: 0, confidence: 25 },
    setup: { alignment: 'square', ballPosition: 'center', stanceWidth: 'standard', gripPressure: 'medium', quality: 50 },
    stroke: { path: 'straight', tempo: 'smooth', faceAngleAtImpact: 'square', deceleration: false, quality: 50 },
    readAccuracy: { wasCorrect: true, suggestedAdjustment: 'Trust your read.', confidence: 25 },
    recommendation,
    overallScore: 50,
    caddieComment,
  };
}
