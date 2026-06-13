/**
 * 2026-06-13 — Open Range quantifier (the "stop mashing" math).
 *
 * Tim + Tank: amateurs lose the mental game on the range — they hit 60 balls with
 * one club, catch 5 good ones, and walk to the 1st tee praying for one of the 5.
 * Blocked practice (same club, no target change) FEELS productive and transfers
 * worst; interleaved/varied practice transfers best. A range bucket can't tell you
 * any of this — but the phone analyzes every ball, so it CAN. This makes the waste
 * visible (a Top Tracer-style read for ranges that don't have one) and nudges
 * toward better practice.
 *
 * Pure / sync / offline-safe / never-throws (cnsShotRead discipline): the caller
 * passes per-swing reads in (each built from composeSmartTrace + the logged club +
 * tempo), this aggregates the session. HONESTY: it judges line ONLY on swings where
 * flight was actually seen, reports tempo REPEATABILITY (not a fabricated grade),
 * and never invents dispersion it couldn't measure. See memory:
 * practice-engine-smartmotion, smartmotion-metrics-honesty, overstrict-gate-lens.
 */

import type { TraceTier } from '../swing/smartTrace';

/** One analyzed ball in an open-range session. */
export interface RangeSwingSample {
  club: string | null;
  tier: TraceTier;
  /** Tempo ratio (backswing:downswing) when measured. */
  tempoRatio: number | null;
  /** Absolute degrees off the aim line — only when flight was seen (tier 'flight'). */
  divergenceDeg: number | null;
}

export interface ClubBreakdown {
  club: string;
  count: number;
  avgTempo: number | null;
}

export interface OpenRangeSummary {
  total: number;
  /** Swings where the ball's flight (departure direction) was actually seen. */
  flightSeen: number;
  /** Struck (acoustic strike) but flight not seen. */
  struckOnly: number;
  /** Neither flight nor a clear strike. */
  unread: number;
  /** Of the swings we could SEE, how many started on the aim line. */
  onLine: number;
  /** onLine / flightSeen, or null when we saw none. */
  onLinePct: number | null;
  /** Std-dev of start direction (deg) among seen flights — the honest spread. */
  startDirSpreadDeg: number | null;
  /** 0–1 tempo repeatability (1 = identical every swing); null without ≥2 samples. */
  tempoConsistency: number | null;
  byClub: ClubBreakdown[];
  /** Set when one club dominates a long session — the blocked-practice anti-pattern. */
  blockedPractice: { club: string; count: number; pct: number } | null;
  headline: string;
  insights: string[];
}

/** Within this many degrees of the aim line counts as "started on line" (mirrors
 *  ballTrace's STRAIGHT band, a touch looser for a beginner range read). */
const ON_LINE_DEG = 6;
/** A session this long dominated by one club triggers the blocked-practice nudge. */
const BLOCKED_MIN_SHOTS = 12;
const BLOCKED_DOMINANCE = 0.7;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function summarizeOpenRange(samples: RangeSwingSample[]): OpenRangeSummary {
  const safe = Array.isArray(samples) ? samples : [];
  const total = safe.length;

  const flights = safe.filter((s) => s.tier === 'flight');
  const flightSeen = flights.length;
  const struckOnly = safe.filter((s) => s.tier === 'contact').length;
  const unread = safe.filter((s) => s.tier === 'none').length;

  const divs = flights
    .map((s) => s.divergenceDeg)
    .filter((d): d is number => typeof d === 'number');
  const onLine = divs.filter((d) => Math.abs(d) <= ON_LINE_DEG).length;
  const onLinePct = flightSeen > 0 ? onLine / flightSeen : null;
  const startDirSpreadDeg = divs.length >= 2 ? Math.round(stddev(divs) * 10) / 10 : null;

  const tempos = safe.map((s) => s.tempoRatio).filter((t): t is number => typeof t === 'number' && t > 0);
  let tempoConsistency: number | null = null;
  if (tempos.length >= 2) {
    const m = mean(tempos);
    const cv = m > 0 ? stddev(tempos) / m : 0; // coefficient of variation
    tempoConsistency = Math.max(0, Math.min(1, 1 - cv)); // 1 = perfectly repeatable
  }

  // Per-club breakdown.
  const clubMap = new Map<string, { count: number; tempoSum: number; tempoN: number }>();
  for (const s of safe) {
    const club = s.club ?? 'Unknown';
    const cur = clubMap.get(club) ?? { count: 0, tempoSum: 0, tempoN: 0 };
    cur.count += 1;
    if (typeof s.tempoRatio === 'number' && s.tempoRatio > 0) { cur.tempoSum += s.tempoRatio; cur.tempoN += 1; }
    clubMap.set(club, cur);
  }
  const byClub: ClubBreakdown[] = Array.from(clubMap.entries())
    .map(([club, v]) => ({ club, count: v.count, avgTempo: v.tempoN > 0 ? Math.round((v.tempoSum / v.tempoN) * 10) / 10 : null }))
    .sort((a, b) => b.count - a.count);

  // Blocked-practice flag: one club dominating a long session.
  let blockedPractice: OpenRangeSummary['blockedPractice'] = null;
  const top = byClub[0];
  if (top && top.club !== 'Unknown' && total >= BLOCKED_MIN_SHOTS && top.count / total >= BLOCKED_DOMINANCE) {
    blockedPractice = { club: top.club, count: top.count, pct: Math.round((top.count / total) * 100) };
  }

  // Honest headline + insights.
  const headline = total === 0
    ? 'No balls logged yet this session.'
    : `${total} ball${total === 1 ? '' : 's'}` +
      (flightSeen > 0 ? ` · ${onLine}/${flightSeen} started on line` : ' · flight not seen') +
      (tempoConsistency != null ? ` · tempo ${Math.round(tempoConsistency * 100)}% repeatable` : '');

  const insights: string[] = [];
  if (blockedPractice) {
    insights.push(
      `${blockedPractice.count} of ${total} balls were your ${blockedPractice.club} (${blockedPractice.pct}%). ` +
      `Hitting one club on repeat feels productive but transfers worst — switch clubs and change targets to practice like you play.`,
    );
  }
  if (onLinePct != null && flightSeen >= 4 && onLinePct < 0.4) {
    insights.push(`Most started off your line (${onLine}/${flightSeen} on). Pick one target and commit to it each ball.`);
  }
  if (tempoConsistency != null && tempoConsistency < 0.85) {
    insights.push('Your tempo wandered swing to swing — a repeatable tempo is the fastest thing to tighten.');
  }
  if (unread > 0 && unread >= total * 0.5) {
    insights.push(`Couldn't see flight on ${unread} of ${total} — keep the ball in frame for a fuller read.`);
  }

  return {
    total,
    flightSeen,
    struckOnly,
    unread,
    onLine,
    onLinePct,
    startDirSpreadDeg,
    tempoConsistency,
    byClub,
    blockedPractice,
    headline,
    insights,
  };
}
