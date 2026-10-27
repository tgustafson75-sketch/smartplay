/**
 * 2026-10-27 (SmartMotion review audit R2, R3, R4, R5, R10) — the review's small decisions, pulled out of
 * the 7,000-line screen so each one is one rule with a test instead of an inline expression nobody can run.
 */
import { getDrillEntry } from '../../data/drillCatalog';
import { isSwingDerived, isTruthGrade, type SwingMetricSet } from '../swingMetricsService';
import type { AcousticAnalysis } from '../acousticsAnalyzer';

// ── R4: the drill the review opens is the drill for the fault it headlines ─────────────────────────────

/** Fault ids that name no fault. */
const NOT_A_FAULT = new Set(['none', 'no_dominant_fault', 'inconclusive']);

/** The Drills button's route for the read on screen. */
export function drillRouteFor(analysis: { primary_fault?: string | null; detected_issue?: string | null } | null | undefined): string {
  // TOP FOCUS headlines primary_fault first (then detected_issue); the drill follows the same order, taking
  // the first that has a catalog drill. A fault with no drill page goes to the drill list, never a dead page.
  const id = [analysis?.primary_fault, analysis?.detected_issue]
    .find((f): f is string => typeof f === 'string' && !NOT_A_FAULT.has(f) && !!getDrillEntry(f));
  return id ? `/drills/${id}` : '/drills';
}

// ── R3: the SPEED · TEMPO card never calls an estimate measured ────────────────────────────────────────

export interface ReviewCardText { value: string | null; note: string }

/**
 * The SPEED · TEMPO summary card. Tempo leads when it was marked; then a speed read from THIS swing; then the
 * club + effort carry, which is an estimate and is always labelled one.
 */
export function speedTempoCard(input: {
  tempo: { ratio?: number | null; sequencingScore?: number | null } | null | undefined;
  metrics: SwingMetricSet;
  formatCarry: (yds: number) => string;
  transitionLabel: (score: number) => string;
}): ReviewCardText {
  const { tempo, metrics, formatCarry, transitionLabel } = input;
  // A speed read from THIS swing (pose / acoustic / watch). "Measured" only for a truth-grade sensor.
  const speedOf = (m: SwingMetricSet['club_speed']) => (m.value != null && isSwingDerived(m.source) ? m : null);
  const club = speedOf(metrics.club_speed);
  const ball = speedOf(metrics.ball_speed);
  const speed = club ?? ball;
  const speedWord = club ? 'Club speed' : 'Ball speed';
  // The carry is the club + effort estimate (or the player's typical for the club): never a read of the swing.
  const carryYds = metrics.carry_yards.value;
  const estCarry = carryYds != null ? `est. carry ${formatCarry(carryYds)} (${carryBasis(metrics.carry_yards.estimateNote)})` : null;
  const ratio = tempo?.ratio ?? null;
  if (ratio != null) {
    return {
      value: `${ratio.toFixed(1)}:1`,
      note: `Tempo${estCarry ? ` · ${estCarry}` : ''}${tempo?.sequencingScore != null ? ` · ${transitionLabel(tempo.sequencingScore)}` : ''}`,
    };
  }
  if (speed) {
    return {
      value: `${isTruthGrade(speed.source) ? '' : '~'}${speed.value} mph`,
      note: `${speedWord} ${isTruthGrade(speed.source) ? 'measured' : 'estimated from this swing'}; no readable tempo on this swing.`,
    };
  }
  if (carryYds != null) {
    return { value: `~${formatCarry(carryYds)}`, note: `No tempo or speed read from this swing · ${estCarry}` };
  }
  return { value: null, note: 'No speed or tempo measured from this swing.' };
}

/**
 * The carry the review's tiles show: the one carry (club + effort estimate, or the player's typical), always
 * flagged an estimate unless a truth-grade sensor gave it. Not gated on isSwingDerived: it is never a read of
 * the swing, and Tim's 08-07 rule is one carry on every surface, labelled for what it is.
 */
export function carryOnScreen(metrics: SwingMetricSet): { yds: number; estimate: boolean } | null {
  const v = metrics.carry_yards.value;
  return v != null ? { yds: v, estimate: !isTruthGrade(metrics.carry_yards.source) } : null;
}

function carryBasis(note: string | undefined): string {
  if (note === 'club + effort estimate') return 'club + effort';
  if (note === 'your typical for this club') return 'your typical for this club';
  return 'estimate';
}

// ── R2: the CONTACT card grades THIS swing's strike ────────────────────────────────────────────────────

/** One heard strike and the microphone's grade of it. */
export interface GradedStrike { impactMs: number; read: AcousticAnalysis }

/** The strike grade the swing on screen may show: the strike heard inside its own window. */
export function strikeReadForSwing(
  graded: readonly GradedStrike[],
  seg: { strikeMs: number; startMs: number; endMs: number } | null | undefined,
): AcousticAnalysis | null {
  if (!seg || graded.length === 0) return null;
  let best: GradedStrike | null = null;
  for (const g of graded) {
    if (g.impactMs < seg.startMs || g.impactMs > seg.endMs) continue;
    if (!best || Math.abs(g.impactMs - seg.strikeMs) < Math.abs(best.impactMs - seg.strikeMs)) best = g;
  }
  return best?.read ?? null;
}

// ── R5: a ball read is cached against the strike it was read from ──────────────────────────────────────

/** The cache key for a swing's ball departure / ball path read. */
export function ballReadKey(input: {
  swingIndex: number;
  strikeMs: number;
  ballArea: { x: number; y: number; r?: number } | null | undefined;
}): string {
  const b = input.ballArea;
  const ball = b ? `${b.x.toFixed(3)},${b.y.toFixed(3)},${(b.r ?? 0).toFixed(3)}` : 'none';
  return `${input.swingIndex}|${Math.round(input.strikeMs)}|${ball}`;
}

// ── R10: a capture with no swing found always offers "Analyze the swing at" ────────────────────────────

/** Whether the no-swing-found way out (analyze the moment the player scrubbed to) is offered. */
export function offerAnalyzeAtMoment(input: { noSwingFound: boolean; segmentCount: number; partialLineCount: number }): boolean {
  // The partial lines (a body verdict, the watch's tempo stand-in) are shown WITH the way out, not instead
  // of it: they are not a swing read, and the player still has to point at the swing.
  void input.partialLineCount;
  return input.noSwingFound && input.segmentCount <= 1;
}
