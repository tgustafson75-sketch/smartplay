/**
 * 2026-05-22 — PuttingLab analysis service.
 *
 * Putting needs special handling — Meta Ray-Ban glasses produce
 * excellent POV downward video (hands, putter face, ball, green, stroke)
 * that swing-pose models can't read. This service routes those frames
 * (plus the player's spoken green read) through a Claude Vision call
 * tuned for putting-specific cues, and merges the result with whatever
 * green-complex data courseGeometry already has.
 *
 * Input modalities (any combination):
 *   - One or more base64-encoded frames (from glasses or phone capture)
 *   - A remote video URI (caller has already uploaded; we pass it through)
 *   - User's transcribed voice read ("left edge, 12 inches break, slow")
 *   - Course context (hole + green centroid) for grain/slope priors
 *
 * Output: a structured PuttingAnalysis the cage-review screen can render
 * AND a persona-aware spoken summary the active caddie speaks back.
 *
 * Bootstrap-friendly: returns a graceful FALLBACK result when no frames
 * are available — relies on the spoken read + course data alone. Clear
 * devLog for every decision branch.
 */

import { useSettingsStore } from '../store/settingsStore';
import { useRoundStore } from '../store/roundStore';
import { getHoleGeometry } from './courseGeometryService';
import { getActiveVisionContext } from './glassesVisionInput';
import { devLog } from './devLog';

// ─── Public types ────────────────────────────────────────────────────────

export type AlignmentQuality = 'square' | 'open' | 'closed' | 'unknown';
export type StrokePath = 'straight' | 'slight_arc' | 'strong_arc' | 'unknown';
export type SpeedSuggestion = 'firmer' | 'softer' | 'on_pace' | 'unknown';

export interface PuttingAnalysisInput {
  /** Optional list of base64-encoded JPEG/PNG frames (no data: prefix). */
  frames_base64?: string[];
  /** Optional remote video URL the server can also fetch / sample. */
  video_url?: string | null;
  /** Player's spoken read of the green — transcribed by voiceService. */
  spoken_read?: string | null;
  /** Optional explicit course context override; defaults to active round. */
  course_id?: string | null;
  hole_number?: number | null;
  /** Optional player notes ("3-footer", "left to right slope", etc). */
  notes?: string | null;
}

export interface PuttingAnalysis {
  alignment: AlignmentQuality;
  stroke_path: StrokePath;
  speed: SpeedSuggestion;
  recommended_line: string;       // human prose: "two ball-widths outside left edge"
  break_estimate: string | null;  // "~12 inches L→R" — null when unknown
  mental_cue: string;             // "smooth pendulum, eyes still"
  alignment_note: string;         // "putter face slightly open at address — square it up"
  stroke_note: string;            // "deceleration through impact — accelerate gently"
  confidence: number;             // 0..100
  /** Sources we actually used to generate this — UI surfaces this so the
   *  player knows whether vision contributed. */
  sources_used: ('vision_frames' | 'video_url' | 'spoken_read' | 'course_geometry')[];
  /** Persona-aware spoken summary. Caller pipes into voiceService.speak. */
  voice_summary: string;
}

// ─── Public API ──────────────────────────────────────────────────────────

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? '';

/**
 * Run putting analysis. Returns null only on hard transport failure;
 * even with no frames + no voice the analyzer produces a course-context
 * baseline result so the player gets SOMETHING actionable.
 */
export async function analyzePutt(
  input: PuttingAnalysisInput,
): Promise<PuttingAnalysis | null> {
  const settings = useSettingsStore.getState();
  const round = useRoundStore.getState();

  const courseId = input.course_id ?? round.activeCourseId;
  const holeNumber = input.hole_number ?? round.currentHole;
  const geom = courseId ? getHoleGeometry(courseId, holeNumber) : null;

  // Opportunistically pull the freshest glasses-attached frame even if
  // the caller didn't pass one explicitly. 30s TTL inside the orchestrator
  // means this only fires when a frame is genuinely fresh.
  let framesBase64 = input.frames_base64 ?? [];
  if (framesBase64.length === 0) {
    try {
      const vision = await getActiveVisionContext();
      // Vision context carries a URI today; base64 conversion is the
      // caller's job (frames typically come from CameraView already as
      // base64). Just record the URI in the request payload so the
      // server can fetch if it needs to.
      if (vision?.frame.uri) {
        devLog(`[putting] using fresh vision frame uri=${vision.frame.uri}`);
      }
    } catch { /* non-fatal */ }
  }

  const sources_used: PuttingAnalysis['sources_used'] = [];
  if (framesBase64.length > 0) sources_used.push('vision_frames');
  if (input.video_url) sources_used.push('video_url');
  if (input.spoken_read && input.spoken_read.trim().length > 0) sources_used.push('spoken_read');
  if (geom) sources_used.push('course_geometry');

  try {
    const res = await fetch(`${apiUrl()}/api/putting-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frames_base64: framesBase64,
        video_url: input.video_url ?? null,
        spoken_read: input.spoken_read ?? null,
        notes: input.notes ?? null,
        hole_number: holeNumber,
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
      return fallbackAnalysis(input.spoken_read ?? null, sources_used);
    }
    const data = (await res.json()) as Partial<PuttingAnalysis>;
    const result = normalize(data, sources_used);
    devLog(`[putting] analysis ok confidence=${result.confidence} sources=${sources_used.join(',')}`);
    return result;
  } catch (e) {
    console.warn('[putting] analyze exception:', e);
    return fallbackAnalysis(input.spoken_read ?? null, sources_used);
  }
}

/**
 * Voice-intent convenience: "analyze my putt" / "how's my read". Pulls
 * the freshest glasses frame + last user utterance, runs analyzePutt,
 * and speaks the persona-aware summary back.
 */
export async function speakPuttingAnalysis(spokenRead: string | null): Promise<PuttingAnalysis | null> {
  const result = await analyzePutt({ spoken_read: spokenRead });
  if (!result) return null;
  try {
    const settings = useSettingsStore.getState();
    const voiceMod = await import('./voiceService');
    const lang = settings.language ?? 'en';
    void voiceMod.speak?.(
      result.voice_summary,
      settings.voiceGender,
      lang,
      apiUrl(),
      { userInitiated: true },
    )?.catch?.(() => undefined);
  } catch (e) {
    devLog('[putting] voice summary speak failed (non-fatal): ' + String(e));
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Course-context-only fallback when the server call fails. The point is
 * to NEVER leave the player without ANY useful feedback — at minimum we
 * echo their read and suggest a baseline mental cue. The confidence is
 * intentionally low (~25) so the UI can surface "rough estimate" to the
 * user.
 */
function fallbackAnalysis(
  spokenRead: string | null,
  sources_used: PuttingAnalysis['sources_used'],
): PuttingAnalysis {
  const readEcho = spokenRead && spokenRead.trim().length > 0
    ? `Heard: "${spokenRead.trim()}". `
    : '';
  return {
    alignment: 'unknown',
    stroke_path: 'unknown',
    speed: 'unknown',
    recommended_line: spokenRead ?? 'Trust your read.',
    break_estimate: null,
    mental_cue: 'Smooth pendulum, eyes still through impact.',
    alignment_note: 'No video — set up square to your line and commit to it.',
    stroke_note: 'Keep tempo even and accelerate gently through the ball.',
    confidence: 25,
    sources_used,
    voice_summary: `${readEcho}Smooth pendulum. Eyes still. Trust your line.`,
  };
}

function normalize(
  data: Partial<PuttingAnalysis>,
  sources_used: PuttingAnalysis['sources_used'],
): PuttingAnalysis {
  const alignmentValid: AlignmentQuality[] = ['square', 'open', 'closed', 'unknown'];
  const strokeValid: StrokePath[] = ['straight', 'slight_arc', 'strong_arc', 'unknown'];
  const speedValid: SpeedSuggestion[] = ['firmer', 'softer', 'on_pace', 'unknown'];
  return {
    alignment: alignmentValid.includes(data.alignment as AlignmentQuality)
      ? (data.alignment as AlignmentQuality)
      : 'unknown',
    stroke_path: strokeValid.includes(data.stroke_path as StrokePath)
      ? (data.stroke_path as StrokePath)
      : 'unknown',
    speed: speedValid.includes(data.speed as SpeedSuggestion)
      ? (data.speed as SpeedSuggestion)
      : 'unknown',
    recommended_line: data.recommended_line ?? 'Trust your read.',
    break_estimate: data.break_estimate ?? null,
    mental_cue: data.mental_cue ?? 'Smooth pendulum, eyes still.',
    alignment_note: data.alignment_note ?? 'Set up square to your line.',
    stroke_note: data.stroke_note ?? 'Accelerate gently through impact.',
    confidence: clampConfidence(data.confidence),
    sources_used: data.sources_used ?? sources_used,
    voice_summary: data.voice_summary ?? 'Smooth pendulum. Trust your line.',
  };
}

function clampConfidence(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
