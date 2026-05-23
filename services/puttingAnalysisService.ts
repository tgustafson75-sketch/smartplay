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
import { getCaddieName } from '../lib/persona';
import { devLog } from './devLog';

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
}

// ─── Public API ──────────────────────────────────────────────────────────

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? '';

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

  // Opportunistic glasses frame (TTL inside glassesVisionInput).
  let frames = input.frames_base64 ?? [];
  if (frames.length === 0) {
    try {
      const vision = await getActiveVisionContext();
      if (vision?.frame.uri) devLog(`[putting] glasses frame uri available: ${vision.frame.uri}`);
    } catch { /* non-fatal */ }
  }

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
        persona: settings.caddiePersonality,
        voiceGender: settings.voiceGender,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn('[putting] api non-ok', res.status);
      return fallbackAnalysis(input, holeNumber, settings.caddiePersonality);
    }
    const data = (await res.json()) as Partial<PuttingAnalysis>;
    const normalized = normalize(data, input, holeNumber, settings.caddiePersonality);
    devLog(`[putting] analysis ok overallScore=${normalized.overallScore} dist=${normalized.distanceFeet}ft`);
    return normalized;
  } catch (e) {
    console.warn('[putting] analyze exception:', e);
    return fallbackAnalysis(input, holeNumber, settings.caddiePersonality);
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
    void voiceMod.speak?.(
      result.caddieComment,
      settings.voiceGender,
      settings.language ?? 'en',
      apiUrl(),
      { userInitiated: true },
    )?.catch?.(() => undefined);
  } catch (e) {
    devLog('[putting] caddieComment speak failed (non-fatal): ' + String(e));
  }
  return result;
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
 *  never to leave the player without coaching. */
function fallbackAnalysis(
  input: PuttingAnalysisInput,
  holeNumber: number | undefined,
  persona: string,
): PuttingAnalysis {
  const caddieName = getCaddieName(persona);
  const echo = input.spoken_read && input.spoken_read.trim().length > 0
    ? `Heard "${input.spoken_read.trim()}". `
    : '';
  return {
    puttId: newPuttId(),
    timestamp: new Date().toISOString(),
    holeNumber,
    distanceFeet: input.distance_feet ?? 0,
    greenSlope: { direction: 'straight', severity: 'subtle', breakInches: 0, confidence: 25 },
    setup: { alignment: 'square', ballPosition: 'center', stanceWidth: 'standard', gripPressure: 'medium', quality: 50 },
    stroke: { path: 'straight', tempo: 'smooth', faceAngleAtImpact: 'square', deceleration: false, quality: 50 },
    readAccuracy: { wasCorrect: true, suggestedAdjustment: 'Trust your read.', confidence: 25 },
    recommendation: {
      line: 'Trust your read.',
      speedFeel: 'Die it into the hole — smooth pendulum.',
      mentalCue: 'Smooth pendulum, eyes still through impact.',
      technicalCue: 'Accelerate gently — no deceleration.',
    },
    overallScore: 50,
    caddieComment: `${caddieName} here. ${echo}Smooth pendulum, eyes still, trust the line.`,
  };
}
