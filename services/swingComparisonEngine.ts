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
import {
  benchmarkIdealBiomech,
  getBenchmarkProfile,
  getBenchmarkMetric,
  clubCategoryFor,
  withinBenchmark,
  BENCHMARK_FRAMING,
  type BenchmarkClubCategory,
  type BenchmarkMetricKey,
} from './swingBenchmarks';
import { PRO_EXEMPLARS } from './knowledgeBase/modules/proExemplars';

// ─── Reference bank ──────────────────────────────────────────────────────
// 2026-06-25 — self_vs_pro now grades against the BENCHMARK BANK
// (services/swingBenchmarks.ts): tour-standard directional RANGES keyed by
// club, each tied to a proExemplars feel + drill, server-hostable for future
// real pro-pose data. The old in-file TOUR_MEDIAN constant moved INTO the
// bank as the 'default' (all-clubs) profile's ideal values — pickReferenceBio
// reads it through benchmarkIdealBiomech(), so there's no second copy here.
//
// HONESTY: the bank holds tour-standard RANGES, NOT a captured named-pro
// pose. The result is framed "vs the tour benchmark (directional)", never
// "you're X° off [pro]".
//
// AMATEUR_GOOD stays in-file — it's the self_vs_amateur / avatar baseline,
// a "good single-digit" reference, not a tour benchmark.
const AMATEUR_GOOD: SwingBiomechanics = {
  hipTurnDeg: 38,
  shoulderTurnDeg: 88,
  shoulderTiltDeg: 25,
  weightShiftPct: 72,
  spineAngleDeltaDeg: 6,
  headDriftPxNorm: 0.035,
  hipSlideRatio: 0.7,
  sequencingScore: 62,
  frames: [],
  verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null, shoulderTilt: null, sequencing: null },
};

// ─── Public types ────────────────────────────────────────────────────────

export type CompareKind = 'self_vs_self' | 'self_vs_pro' | 'self_vs_amateur' | 'self_vs_avatar';

export type MetricDirection = 'better' | 'worse' | 'same' | 'unknown';

/**
 * 2026-06-25 — the honest benchmark payload that rides on a self_vs_pro
 * comparison graded against the BENCHMARK BANK (no captured pro supplied).
 *
 * HONESTY: this is the framing the UI/voice MUST lead with. It is a
 * directional "vs the tour benchmark" — a tour-standard RANGE, never a
 * measured "you're X° off [named pro]". Each focus carries the matching
 * proExemplars FEEL + DRILL so the gap comes with a way to close it.
 */
export interface BenchmarkFocus {
  /** Metric label, e.g. "Shoulder turn". */
  label: string;
  /** Are you inside the tour band for this metric? */
  withinBand: boolean;
  /** The hedged, honest benchmark note (never "X° off a pro"). */
  note: string;
  /** proExemplars entry this focus maps to (the model to copy by feel). */
  exemplarTopic: string;
  /** The single FEEL cue from that exemplar. */
  feel: string;
  /** A drill id (from the exemplar's related[]) to close the gap, if any. */
  drillId: string | null;
}

export interface BenchmarkContext {
  /** The honesty framing the UI/voice MUST lead with. */
  framing: string;
  /** Which club category the bank graded against. */
  club: BenchmarkClubCategory;
  /** 'in_bundle' (curated, shipped now) or 'server' (future real pro-pose
   *  Tier-2 payload) — surfaced so the UI can be transparent. */
  origin: 'in_bundle' | 'server';
  /** Per-focus feel + drill for the metrics that fell OUTSIDE the band,
   *  worst first. Empty when the read is inside the tour benchmark on
   *  everything we could measure. */
  focuses: BenchmarkFocus[];
}

export interface MetricDelta {
  key: keyof Omit<SwingBiomechanics, 'frames' | 'verdicts' | 'metric_confidence' | 'angle'>;
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
  /** Sources used — surfaced as chips. ('tour_median' retained in the union
   *  for back-compat; the bank path now emits 'tour_benchmark'.) */
  sources_used: ('current_pose' | 'reference_pose' | 'tour_median' | 'tour_benchmark' | 'amateur_good')[];
  /** Aggregated 0..100 match score across all metrics, or `null` when
   *  there was no usable biomechanics to compare. `null` must NOT be
   *  coerced to 0 — a confident "0% match" is a fabricated negative.
   *  Callers render an "insufficient data" state for null. */
  overall_match: number | null;
  metrics: MetricDelta[];
  /** Visual diff cues. Empty when no keypoint data is available. */
  hotspots: HeatmapHotspot[];
  /** Top 1-3 takeaways the UI / coach voice can lead with. */
  takeaways: string[];
  /** Optional persona-aware spoken summary. Caller pipes through voice. */
  voice_summary: string;
  /** 2026-06-25 — present ONLY when self_vs_pro was graded against the
   *  BENCHMARK BANK (no captured pro reference supplied). Carries the honest
   *  "vs tour benchmark (directional)" framing + the proExemplars feel/drill
   *  for each focus. Absent for self_vs_self / a real reference pose. */
  benchmark?: BenchmarkContext;
}

export interface CompareInput {
  current: PoseEstimate;
  /** When omitted, the engine compares against the BENCHMARK BANK (pro) or
   *  AMATEUR_GOOD based on `kind`. */
  reference?: PoseEstimate | null;
  kind?: CompareKind;
  /** 2026-06-25 — the club the swing was hit with (free text / chip, e.g.
   *  "Driver", "7 iron", "PW"). Used ONLY for self_vs_pro against the
   *  benchmark bank: it picks the club-category profile (driver fuller,
   *  wedge more compact). Ignored when a real reference pose is supplied.
   *  Unknown / omitted → the 'default' all-clubs band (no fabricated
   *  precision). */
  club?: string | null;
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

  // 2026-06-25 — when self_vs_pro runs WITHOUT a captured reference pose, the
  // BENCHMARK BANK (services/swingBenchmarks.ts) is the reference. We grade
  // against the club-category profile's tour-standard RANGES, never a
  // fabricated named-pro capture.
  const usesBenchmark = kind === 'self_vs_pro' && !input.reference?.biomechanics;
  const benchClub: BenchmarkClubCategory = usesBenchmark ? clubCategoryFor(input.club) : 'default';

  const sources_used: SwingComparison['sources_used'] = [];
  if (currentBio) sources_used.push('current_pose');
  if (input.reference?.biomechanics) sources_used.push('reference_pose');
  if (usesBenchmark) sources_used.push('tour_benchmark');
  if (kind === 'self_vs_amateur' && !input.reference) sources_used.push('amateur_good');

  const metrics: MetricDelta[] = [
    buildMetric('hipTurnDeg', 'Hip turn', currentBio?.hipTurnDeg ?? null, referenceBio.hipTurnDeg, 'higher_better', 15, 'degrees'),
    buildMetric('shoulderTurnDeg', 'Shoulder turn', currentBio?.shoulderTurnDeg ?? null, referenceBio.shoulderTurnDeg, 'higher_better', 18, 'degrees'),
    // 2026-05-22 audit refinement — shoulder tilt is distinct from
    // shoulder turn (tilt = lead-shoulder dip at top; turn = rotational
    // coil). Both metrics ride alongside; older biomech without tilt
    // simply returns null current → "not enough data" verdict.
    buildMetric('shoulderTiltDeg', 'Shoulder tilt', currentBio?.shoulderTiltDeg ?? null, referenceBio.shoulderTiltDeg ?? null, 'higher_better', 12, 'degrees'),
    buildMetric('weightShiftPct', 'Weight shift', currentBio?.weightShiftPct ?? null, referenceBio.weightShiftPct, 'higher_better', 15, '% to lead'),
    buildMetric('spineAngleDeltaDeg', 'Spine stability', currentBio?.spineAngleDeltaDeg ?? null, referenceBio.spineAngleDeltaDeg, 'lower_better', 5, 'degrees of change'),
    buildMetric('headDriftPxNorm', 'Head still', currentBio?.headDriftPxNorm ?? null, referenceBio.headDriftPxNorm, 'lower_better', 0.04, 'units of drift'),
    buildMetric('hipSlideRatio', 'Hip rotate vs slide', currentBio?.hipSlideRatio ?? null, referenceBio.hipSlideRatio, 'lower_better', 0.4, 'ratio'),
    // 2026-05-22 audit refinement — sequencing 0..100 (hips lead = high).
    buildMetric('sequencingScore', 'Kinematic sequencing', currentBio?.sequencingScore ?? null, referenceBio.sequencingScore ?? null, 'higher_better', 30, 'sequence units'),
  ];

  const overall_match = computeOverall(metrics);
  const hotspots = buildHotspots(input.current.frames, metrics);
  // Benchmark context (feel + drill) only when the bank was the reference.
  const benchmark = usesBenchmark ? buildBenchmarkContext(metrics, benchClub) : undefined;
  const takeaways = buildTakeaways(metrics, overall_match, benchmark);
  const voice_summary = buildVoiceSummary(kind, overall_match, takeaways, benchmark);

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
    ...(benchmark ? { benchmark } : {}),
  };
  devLog(`[swingCompare] kind=${kind} overall=${overall_match} hotspots=${hotspots.length} bench=${benchmark ? benchmark.club : 'no'}`);
  return result;
}

// ─── 2026-06-25 — Benchmark context (feel + drill bridge) ────────────────
//
// Maps each metric that fell OUTSIDE the tour band to its proExemplars
// entry (the model to copy by FEEL) + a drill id to close the gap. This is
// what turns "your shoulder turn is short" into "vs the tour benchmark
// (directional) — chase the Rose full-coil feel, drill.feet-together".
// HONEST: ranges, hedged language, never "you're X° off a named pro".

/** A focus is "outside the band" when its current read falls beyond the
 *  benchmark RANGE for that metric (we re-check via withinBenchmark using
 *  the same bank the reference came from). We surface the worst first. */
function buildBenchmarkContext(metrics: MetricDelta[], club: BenchmarkClubCategory): BenchmarkContext {
  const prof = getBenchmarkProfile(club);
  const focuses: BenchmarkFocus[] = [];
  for (const m of metrics) {
    if (m.current == null) continue;
    const benchKey = m.key as BenchmarkMetricKey;
    const bm = getBenchmarkMetric(benchKey, club);
    if (!bm) continue;
    const inBand = withinBenchmark(benchKey, m.current, club);
    if (inBand) continue; // only the gaps become focuses
    const ex = PRO_EXEMPLARS.find((e) => e.id === bm.exemplarId);
    focuses.push({
      label: m.label,
      withinBand: false,
      note: bm.benchmarkNote,
      exemplarTopic: ex?.topic ?? bm.exemplarId,
      feel: feelFromExemplar(ex) ?? bm.benchmarkNote,
      drillId: drillFromExemplar(ex),
    });
  }
  // Worst (lowest match_score) first so the UI leads with the biggest gap.
  focuses.sort((a, b) => {
    const sa = metrics.find((m) => m.label === a.label)?.match_score ?? 0;
    const sb = metrics.find((m) => m.label === b.label)?.match_score ?? 0;
    return sa - sb;
  });
  return {
    framing: prof.framing || BENCHMARK_FRAMING,
    club,
    origin: prof.origin,
    focuses,
  };
}

/** The single FEEL cue from an exemplar — its coachingCues entries lead with
 *  a "feel:" line; pick the first one, else the first cue, else null. */
function feelFromExemplar(ex: (typeof PRO_EXEMPLARS)[number] | undefined): string | null {
  if (!ex?.coachingCues || ex.coachingCues.length === 0) return null;
  const feelLine = ex.coachingCues.find((c) => /^feel:/i.test(c.trim()));
  const raw = feelLine ?? ex.coachingCues[0];
  return raw.replace(/^feel:\s*/i, '').trim();
}

/** The drill id from an exemplar's related[] (the `drill.*` link), if any. */
function drillFromExemplar(ex: (typeof PRO_EXEMPLARS)[number] | undefined): string | null {
  if (!ex?.related || ex.related.length === 0) return null;
  return ex.related.find((r) => r.startsWith('drill.')) ?? null;
}

// ─── Reference selection ─────────────────────────────────────────────────

function pickReferenceBio(input: CompareInput, kind: CompareKind): SwingBiomechanics {
  if (input.reference?.biomechanics) return input.reference.biomechanics;
  switch (kind) {
    // 2026-06-25 — the BENCHMARK BANK is now the pro reference (club-aware
    // tour-standard ranges; the profile's `ideal` values are the comparison
    // anchor). The old TOUR_MEDIAN numbers live on as the bank's 'default'
    // profile, reached when the club is unknown.
    case 'self_vs_pro':     return benchmarkIdealBiomech(clubCategoryFor(input.club));
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

function computeOverall(metrics: MetricDelta[]): number | null {
  const usable = metrics.filter((m) => m.current != null && m.reference != null);
  // No usable biomechanics → there is nothing to compare. Return null
  // (insufficient data), NOT 0 — a 0 would render as a confident "0%
  // match", telling the player their swing is the polar opposite of the
  // reference, which is a fabricated negative.
  if (usable.length === 0) return null;
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
    case 'shoulderTiltDeg':    return ['left_shoulder', 'right_shoulder'];
    case 'weightShiftPct':     return ['left_ankle', 'right_ankle'];
    case 'spineAngleDeltaDeg': return ['left_shoulder', 'right_hip'];
    case 'headDriftPxNorm':    return ['nose'];
    case 'hipSlideRatio':      return ['left_hip', 'right_hip'];
    case 'sequencingScore':    return ['left_hip', 'left_shoulder'];
  }
}

function findJointInFrames(frames: PoseFrame[], jointName: string): Keypoint | null {
  for (const f of frames) {
    const k = f.keypoints.find((kp) => kp.name === jointName && kp.score >= 0.3);
    if (k) return k;
  }
  return null;
}

function buildTakeaways(
  metrics: MetricDelta[],
  overall: number | null,
  benchmark?: BenchmarkContext,
): string[] {
  // Insufficient data — no honest takeaways to draw.
  if (overall == null) return ['Not enough pose data to compare yet.'];
  const wins = metrics.filter((m) => m.direction === 'better' && m.match_score >= 70);
  const out: string[] = [];
  if (wins.length > 0) {
    out.push(`Strong: ${wins.slice(0, 2).map((w) => w.label.toLowerCase()).join(' + ')}.`);
  }
  // When the BENCHMARK BANK is the reference, lead the focus with the honest
  // "vs tour benchmark (directional)" framing + the proExemplars FEEL and a
  // drill to close it — never a "you're X° off [pro]" claim.
  if (benchmark && benchmark.focuses.length > 0) {
    const f = benchmark.focuses[0];
    const drill = f.drillId ? ` (drill: ${f.drillId})` : '';
    out.push(
      `Vs the tour benchmark (directional): your ${f.label.toLowerCase()} tends outside the tour range — feel: ${f.feel}${drill}.`,
    );
  } else {
    const focuses = metrics.filter((m) => m.direction === 'worse').sort((a, b) => a.match_score - b.match_score);
    if (focuses.length > 0) {
      out.push(`Focus: ${focuses[0].label.toLowerCase()} — ${focuses[0].verdict.toLowerCase()}`);
    }
  }
  if (benchmark && benchmark.focuses.length === 0) {
    out.push('Looks tour-standard on everything we could measure — directionally inside the benchmark range.');
  } else if (overall >= 85) out.push('Overall — very close to the reference.');
  else if (overall >= 65) out.push('Overall — solid pattern with one or two leaks to close.');
  else if (overall > 0) out.push('Overall — meaningful gaps; pick one focus and rep it.');
  return out;
}

function buildVoiceSummary(
  kind: CompareKind,
  overall: number | null,
  takeaways: string[],
  benchmark?: BenchmarkContext,
): string {
  if (overall == null) return 'Not enough pose data to compare cleanly yet.';
  // HONEST framing for the bank path: "vs the tour benchmark", directional —
  // not "vs a measured pro". Hedged ("looks like", "tends toward") per the
  // app's honesty bar.
  const lead =
    kind === 'self_vs_self' ? 'Comparing your swings'
    : kind === 'self_vs_pro' ? (benchmark ? 'Vs the tour benchmark (directional)' : 'Vs tour median')
    : kind === 'self_vs_amateur' ? 'Vs single-digit baseline'
    : 'Vs ideal avatar';
  return `${lead}: ${overall}% match. ${takeaways.slice(0, 2).join(' ')}`.trim();
}

// ─── 2026-05-22 — Multi-reference compare ────────────────────────────────
//
// Phase 2 addition: caller wants to see how the current swing stacks
// up against MULTIPLE references in one pass ("vs my best swing" +
// "vs Rory 2023" + "vs amateur baseline"). compareSwingsMulti runs
// compareSwings against each reference and returns a deck of results
// sorted by overall_match descending, plus a synthesized voice line
// that pulls the top insight from each comparison.

export interface MultiReferenceInput {
  current: PoseEstimate;
  /** Named references to compare against. Each gets its own
   *  SwingComparison. UI typically renders them as a horizontal card
   *  carousel. */
  references: Array<{
    label: string;
    estimate: PoseEstimate;
    kind?: CompareKind;
  }>;
}

export interface MultiReferenceComparison {
  /** Per-reference results, sorted by overall_match desc. */
  results: Array<{ label: string; comparison: SwingComparison }>;
  /** Highest match across all references. UI uses this as the
   *  headline number ("83% match to your best swing"). */
  best_match: { label: string; overall: number } | null;
  /** Synthesized 2-3 sentence voice summary blending the top insights
   *  from each comparison. Persona prepend is the caller's job. */
  voice_summary: string;
}

export function compareSwingsMulti(input: MultiReferenceInput): MultiReferenceComparison {
  if (input.references.length === 0) {
    return {
      results: [],
      best_match: null,
      voice_summary: 'No references provided.',
    };
  }
  const results = input.references.map((ref) => {
    const cmp = compareSwings({
      current: input.current,
      reference: ref.estimate,
      kind: ref.kind,
    });
    return { label: ref.label, comparison: cmp };
  });
  // Sort by overall_match desc, but treat insufficient-data (null)
  // comparisons as ranking LAST — never let null coerce to 0 and pose
  // as the "worst match." A real 0% (genuinely opposite) still outranks
  // "no data to compare."
  results.sort((a, b) => matchRank(b.comparison.overall_match) - matchRank(a.comparison.overall_match));

  // The headline best_match must be a REAL comparison — skip any whose
  // overall is null (insufficient data).
  const top = results.find((r) => r.comparison.overall_match != null);
  const voice = composeMultiVoice(results);

  return {
    results,
    best_match: top
      ? { label: top.label, overall: top.comparison.overall_match as number }
      : null,
    voice_summary: voice,
  };
}

/** Sort key for overall_match: real scores rank by value; null
 *  (insufficient data) sinks below every real score, including a real 0. */
function matchRank(overall: number | null): number {
  return overall == null ? -1 : overall;
}

/** Render a match score for voice/headline text. Null reads as a
 *  spoken "not enough data" rather than a fabricated "0%". */
function matchPhrase(overall: number | null): string {
  return overall == null ? 'not enough data to compare' : `${overall}% match`;
}

function composeMultiVoice(results: MultiReferenceComparison['results']): string {
  if (results.length === 0) return '';
  const lead = results[0];
  if (results.length === 1) {
    return `${matchPhrase(lead.comparison.overall_match)} to ${lead.label}. ${lead.comparison.takeaways[0] ?? ''}`.trim();
  }
  // Two-result case: lead with the highest match + add a contrast from
  // the next-best reference if it surfaces a different focus area.
  const contrast = results[1];
  const leadFocus = lead.comparison.metrics.find((m) => m.direction === 'worse')?.label.toLowerCase();
  const contrastFocus = contrast.comparison.metrics.find((m) => m.direction === 'worse')?.label.toLowerCase();
  const different = leadFocus && contrastFocus && leadFocus !== contrastFocus;
  if (different) {
    return `${matchPhrase(lead.comparison.overall_match)} to ${lead.label} — focus area: ${leadFocus}. ` +
      `Vs ${contrast.label}: ${matchPhrase(contrast.comparison.overall_match)} — they'd want ${contrastFocus}.`;
  }
  return `${matchPhrase(lead.comparison.overall_match)} to ${lead.label}. ` +
    `${matchPhrase(contrast.comparison.overall_match)} to ${contrast.label}. ` +
    `${lead.comparison.takeaways[0] ?? ''}`.trim();
}

// ─── 2026-05-22 — golferModel-aware annotation ──────────────────────────
//
// Threads the player's persistent miss pattern into the takeaways so
// the same metric reads differently for a chronic slicer vs a flusher.
// Caller passes the result of buildGolferModel(); we layer a short
// "this looks like your typical X" note onto the comparison.

export function annotateWithGolferModel(
  cmp: SwingComparison,
  golferSummary: { miss_direction: string; miss_type: string; is_confident: boolean },
): SwingComparison {
  if (!golferSummary.is_confident) return cmp;
  const knownFault = golferSummary.miss_type !== 'unknown' && golferSummary.miss_type !== 'varies';
  if (!knownFault) return cmp;
  // Layer in a takeaway when the dominant miss aligns with a worse
  // metric in the comparison.
  const worseLabels = cmp.metrics.filter((m) => m.direction === 'worse').map((m) => m.label.toLowerCase());
  const aligned =
    (golferSummary.miss_type === 'slice' && worseLabels.some((l) => l.includes('shoulder') || l.includes('weight'))) ||
    (golferSummary.miss_type === 'hook' && worseLabels.some((l) => l.includes('hip'))) ||
    (golferSummary.miss_type === 'thin' && worseLabels.some((l) => l.includes('spine'))) ||
    (golferSummary.miss_type === 'fat' && worseLabels.some((l) => l.includes('weight')));
  if (!aligned) return cmp;
  return {
    ...cmp,
    takeaways: [
      ...cmp.takeaways,
      `This is similar to your typical ${golferSummary.miss_type} pattern — focus area is consistent.`,
    ],
  };
}

// ─── Small helpers ───────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }
