/**
 * 2026-05-22 — Swing Comparison Engine.
 *
 * Quantitative comparison between two PoseEstimate results. Used for:
 *   - Self vs self (current swing vs personal best / vs 30 days ago)
 *   - Self vs reference (pro / instructor swing / ideal avatar)
 *   - Team captain reviewing teammate vs teammate
 *
 * Output: a SwingComparison with per-metric delta + qualitative verdict
 * + heat-map overlay coordinates the UI can render on top of the swing
 * still frames. Defensive — when one or both estimates lack biomechanics
 * the engine returns a partial comparison flagged with reasons so the
 * caller can decide whether to render or fall back.
 *
 * Compare dimensions (all derived from poseAnalysisApi.SwingBiomechanics):
 *   - hipTurnDeg
 *   - shoulderTurnDeg
 *   - weightShiftPct
 *   - spineAngleDeltaDeg
 *   - headDriftPxNorm
 *   - hipSlideRatio
 *
 * Reference-bank seed values (PGA-tour median) live in this file so
 * "self vs pro" works even when no recorded pro swing is supplied.
 * Future: load real pro pose data from a server bank keyed by club +
 * handedness.
 */

import type { PoseEstimate, PoseFrame, Keypoint, SwingBiomechanics } from './poseEstimator';
import { devLog } from './devLog';

// ─── Reference bank (PGA-tour median, single-digit amateur upper) ───────
// Numbers anchor against publicly documented coaching standards.
const TOUR_MEDIAN: SwingBiomechanics = {
  hipTurnDeg: 45,
  shoulderTurnDeg: 95,
  weightShiftPct: 80,
  spineAngleDeltaDeg: 4,
  headDriftPxNorm: 0.02,
  hipSlideRatio: 0.6,
  frames: [],
  verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null },
};

const AMATEUR_GOOD: SwingBiomechanics = {
  hipTurnDeg: 38,
  shoulderTurnDeg: 88,
  weightShiftPct: 72,
  spineAngleDeltaDeg: 6,
  headDriftPxNorm: 0.035,
  hipSlideRatio: 0.7,
  frames: [],
  verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null },
};

// ─── Public types ────────────────────────────────────────────────────────

export type CompareKind = 'self_vs_self' | 'self_vs_pro' | 'self_vs_amateur' | 'self_vs_avatar';

export type MetricDirection = 'better' | 'worse' | 'same' | 'unknown';

export interface MetricDelta {
  key: keyof Omit<SwingBiomechanics, 'frames' | 'verdicts'>;
  label: string;
  current: number | null;
  reference: number | null;
  delta: number | null;
  /** Lower is better for some metrics (headDrift, hipSlideRatio,
   *  spineAngleDelta). Higher is better for hipTurn, shoulderTurn,
   *  weightShift. The engine factors that in to direction. */
  direction: MetricDirection;
  /** 0..100 — qualitative score: 100 = exact match, drops with deviation. */
  match_score: number;
  /** Human-readable verdict. Calibrated to encourage rather than scold. */
  verdict: string;
}

export interface HeatmapHotspot {
  /** Joint name (COCO-17). */
  joint: string;
  /** Normalized 0..1 coords on the rendered swing still. */
  x: number;
  y: number;
  /** 0..1 — intensity of the difference at this joint. */
  intensity: number;
  /** Free-text note rendered with the hotspot. */
  note: string;
}

export interface SwingComparison {
  comparisonId: string;
  timestamp: string;
  kind: CompareKind;
  /** Sources used — surfaced as chips. */
  sources_used: ('current_pose' | 'reference_pose' | 'tour_median' | 'amateur_good')[];
  /** Aggregated 0..100 match score across all metrics. */
  overall_match: number;
  metrics: MetricDelta[];
  /** Visual diff cues. Empty when no keypoint data is available. */
  hotspots: HeatmapHotspot[];
  /** Top 1-3 takeaways the UI / coach voice can lead with. */
  takeaways: string[];
  /** Optional persona-aware spoken summary. Caller pipes through voice. */
  voice_summary: string;
}

export interface CompareInput {
  current: PoseEstimate;
  /** When omitted, the engine compares against TOUR_MEDIAN or AMATEUR_GOOD
   *  based on `kind`. */
  reference?: PoseEstimate | null;
  kind?: CompareKind;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Run a comparison. Always resolves to a SwingComparison even when
 * inputs are thin; caller checks `overall_match` + `sources_used` to
 * decide how prominently to render.
 */
export function compareSwings(input: CompareInput): SwingComparison {
  const kind = input.kind ?? (input.reference ? 'self_vs_self' : 'self_vs_pro');
  const currentBio = input.current.biomechanics;
  const referenceBio = pickReferenceBio(input, kind);

  const sources_used: SwingComparison['sources_used'] = [];
  if (currentBio) sources_used.push('current_pose');
  if (input.reference?.biomechanics) sources_used.push('reference_pose');
  if (kind === 'self_vs_pro' && !input.reference) sources_used.push('tour_median');
  if (kind === 'self_vs_amateur' && !input.reference) sources_used.push('amateur_good');

  const metrics: MetricDelta[] = [
    buildMetric('hipTurnDeg', 'Hip turn', currentBio?.hipTurnDeg ?? null, referenceBio.hipTurnDeg, 'higher_better', 15, 'degrees'),
    buildMetric('shoulderTurnDeg', 'Shoulder turn', currentBio?.shoulderTurnDeg ?? null, referenceBio.shoulderTurnDeg, 'higher_better', 18, 'degrees'),
    buildMetric('weightShiftPct', 'Weight shift', currentBio?.weightShiftPct ?? null, referenceBio.weightShiftPct, 'higher_better', 15, '% to lead'),
    buildMetric('spineAngleDeltaDeg', 'Spine stability', currentBio?.spineAngleDeltaDeg ?? null, referenceBio.spineAngleDeltaDeg, 'lower_better', 5, 'degrees of change'),
    buildMetric('headDriftPxNorm', 'Head still', currentBio?.headDriftPxNorm ?? null, referenceBio.headDriftPxNorm, 'lower_better', 0.04, 'units of drift'),
    buildMetric('hipSlideRatio', 'Hip rotate vs slide', currentBio?.hipSlideRatio ?? null, referenceBio.hipSlideRatio, 'lower_better', 0.4, 'ratio'),
  ];

  const overall_match = computeOverall(metrics);
  const hotspots = buildHotspots(input.current.frames, metrics);
  const takeaways = buildTakeaways(metrics, overall_match);
  const voice_summary = buildVoiceSummary(kind, overall_match, takeaways);

  const result: SwingComparison = {
    comparisonId: 'cmp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
    timestamp: new Date().toISOString(),
    kind,
    sources_used,
    overall_match,
    metrics,
    hotspots,
    takeaways,
    voice_summary,
  };
  devLog(`[swingCompare] kind=${kind} overall=${overall_match} hotspots=${hotspots.length}`);
  return result;
}

// ─── Reference selection ─────────────────────────────────────────────────

function pickReferenceBio(input: CompareInput, kind: CompareKind): SwingBiomechanics {
  if (input.reference?.biomechanics) return input.reference.biomechanics;
  switch (kind) {
    case 'self_vs_pro':     return TOUR_MEDIAN;
    case 'self_vs_amateur': return AMATEUR_GOOD;
    case 'self_vs_avatar':  return AMATEUR_GOOD;
    case 'self_vs_self':
    default:                return AMATEUR_GOOD;
  }
}

// ─── Metric construction ─────────────────────────────────────────────────

type DirectionPreference = 'higher_better' | 'lower_better';

function buildMetric(
  key: MetricDelta['key'],
  label: string,
  current: number | null,
  reference: number | null,
  pref: DirectionPreference,
  spread: number,
  unit: string,
): MetricDelta {
  if (current == null || reference == null) {
    return {
      key, label, current, reference, delta: null, direction: 'unknown', match_score: 0,
      verdict: 'Not enough data to compare yet.',
    };
  }
  const delta = round2(current - reference);
  const distance = Math.abs(delta);
  // Match score: 100 at exact match, 0 at "spread" units away (clamped).
  const match_score = Math.max(0, Math.min(100, Math.round(100 - (distance / spread) * 100)));
  // Direction: which side of the reference is the player on, and is that "better"?
  let direction: MetricDirection = 'same';
  if (distance < spread * 0.05) {
    direction = 'same';
  } else if (pref === 'higher_better') {
    direction = current > reference ? 'better' : 'worse';
  } else {
    direction = current < reference ? 'better' : 'worse';
  }
  const verdict = renderVerdict(label, direction, distance, unit);
  return { key, label, current, reference, delta, direction, match_score, verdict };
}

function renderVerdict(label: string, dir: MetricDirection, distance: number, unit: string): string {
  if (dir === 'same') return `${label}: dialed in.`;
  if (dir === 'better') return `${label}: ahead of reference by ${round1(distance)} ${unit}.`;
  return `${label}: ${round1(distance)} ${unit} off — focus area.`;
}

// ─── Overall + hotspots + takeaways ──────────────────────────────────────

function computeOverall(metrics: MetricDelta[]): number {
  const usable = metrics.filter((m) => m.current != null && m.reference != null);
  if (usable.length === 0) return 0;
  const sum = usable.reduce((a, m) => a + m.match_score, 0);
  return Math.round(sum / usable.length);
}

/**
 * Build heatmap hotspots from current-swing frames. We map each
 * "worse"-direction metric to the JOINT that's most associated with it
 * (e.g. hipTurnDeg → hip joints). Picks the first frame where the
 * joint is present + scores >= USABLE.
 */
function buildHotspots(frames: PoseFrame[], metrics: MetricDelta[]): HeatmapHotspot[] {
  if (frames.length === 0) return [];
  const worse = metrics.filter((m) => m.direction === 'worse' && m.match_score < 60);
  const hotspots: HeatmapHotspot[] = [];
  for (const m of worse) {
    const jointPair = jointsForMetric(m.key);
    for (const joint of jointPair) {
      const found = findJointInFrames(frames, joint);
      if (found) {
        hotspots.push({
          joint,
          x: found.x <= 1 ? found.x : found.x / 1000, // normalize if pixel-absolute
          y: found.y <= 1 ? found.y : found.y / 1000,
          intensity: Math.max(0.4, Math.min(1, 1 - m.match_score / 100)),
          note: m.verdict,
        });
      }
    }
  }
  return hotspots;
}

function jointsForMetric(key: MetricDelta['key']): string[] {
  switch (key) {
    case 'hipTurnDeg':         return ['left_hip', 'right_hip'];
    case 'shoulderTurnDeg':    return ['left_shoulder', 'right_shoulder'];
    case 'weightShiftPct':     return ['left_ankle', 'right_ankle'];
    case 'spineAngleDeltaDeg': return ['left_shoulder', 'right_hip'];
    case 'headDriftPxNorm':    return ['nose'];
    case 'hipSlideRatio':      return ['left_hip', 'right_hip'];
  }
}

function findJointInFrames(frames: PoseFrame[], jointName: string): Keypoint | null {
  for (const f of frames) {
    const k = f.keypoints.find((kp) => kp.name === jointName && kp.score >= 0.3);
    if (k) return k;
  }
  return null;
}

function buildTakeaways(metrics: MetricDelta[], overall: number): string[] {
  const wins = metrics.filter((m) => m.direction === 'better' && m.match_score >= 70);
  const focuses = metrics.filter((m) => m.direction === 'worse').sort((a, b) => a.match_score - b.match_score);
  const out: string[] = [];
  if (wins.length > 0) {
    out.push(`Strong: ${wins.slice(0, 2).map((w) => w.label.toLowerCase()).join(' + ')}.`);
  }
  if (focuses.length > 0) {
    out.push(`Focus: ${focuses[0].label.toLowerCase()} — ${focuses[0].verdict.toLowerCase()}`);
  }
  if (overall >= 85) out.push('Overall — very close to the reference.');
  else if (overall >= 65) out.push('Overall — solid pattern with one or two leaks to close.');
  else if (overall > 0) out.push('Overall — meaningful gaps; pick one focus and rep it.');
  return out;
}

function buildVoiceSummary(kind: CompareKind, overall: number, takeaways: string[]): string {
  if (overall === 0) return 'Not enough pose data to compare cleanly yet.';
  const lead =
    kind === 'self_vs_self' ? 'Comparing your swings'
    : kind === 'self_vs_pro' ? 'Vs tour median'
    : kind === 'self_vs_amateur' ? 'Vs single-digit baseline'
    : 'Vs ideal avatar';
  return `${lead}: ${overall}% match. ${takeaways.slice(0, 2).join(' ')}`.trim();
}

// ─── Small helpers ───────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }
