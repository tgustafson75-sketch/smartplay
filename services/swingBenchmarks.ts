/**
 * 2026-06-25 — PRO-POSE / BENCHMARK BANK.
 *
 * The MEASURED companion to the "plays-like-a-pro" KNOWLEDGE layer
 * (services/knowledgeBase/modules/proExemplars.ts). proExemplars is the WORDS
 * — a pro's signature move, the feel, the drill. THIS file is the NUMBERS — the
 * tour-standard reference RANGES the swingComparisonEngine grades a real read
 * against, and the bridge that ties each benchmark metric back to the matching
 * exemplar's feel + drill.
 *
 * ── THE HONESTY LINE (Tim's law — the #1 gate for this file) ──────────────
 * We do NOT have real captured pose data of named pros. So this bank holds NO
 * "Rory's actual pose" — NOTHING here is a fabricated named-pro capture. What
 * it holds are TOUR-STANDARD REFERENCE RANGES drawn from published teaching /
 * tour-typical values (Yale 3:1 tempo study, TPI X-factor work, tour hip/
 * shoulder-turn norms). Every range is framed as a directional "tour benchmark",
 * never a precise "you're X° off [pro]". The comparison hedges — "looks like",
 * "tends toward", "vs the tour benchmark (directional)" — per the app's honesty
 * bar.
 *
 * Concretely:
 *   - A profile is a RANGE ({ low, ideal, high }) per metric, not a single
 *     fake-precise pro number. We grade "are you inside the tour band?", not
 *     "how many degrees from Rory?".
 *   - `framing` on every profile is the honest label the UI/voice must use.
 *   - `exemplarId` links each metric to a real proExemplars entry so the
 *     result can carry the FEEL + DRILL that closes the gap (Els/Couples tempo,
 *     Rose full-coil, Hogan centeredness, etc.).
 *
 * ── SERVER-HOSTABLE (Tier-2 future) ───────────────────────────────────────
 * The bank is shaped so a future server payload (Supabase tail) keyed by club
 * category can REPLACE or AUGMENT the in-bundle profiles when real pro-pose
 * data is captured — without touching the engine. `BENCHMARK_BANK_VERSION` +
 * `BenchmarkBankPayload` define that contract; `setBenchmarkOverride()` lets a
 * loaded payload swap profiles at runtime, and `getBenchmarkProfile()` is the
 * single read the engine goes through (in-bundle now, server-overridable later).
 * We ship the curated in-bundle profiles NOW (small, honest); the server tail
 * is purely additive.
 *
 * Pure data + pure helpers — no React, no Node. Importable client AND server.
 */

import type { SwingBiomechanics } from './poseAnalysisApi';

// ─── Club category (the honest keying axis) ─────────────────────────────
//
// A driver swing is longer / fuller than an iron, which is fuller than a
// wedge — that's the one club-dependence that's honest to model at the
// directional level we read. We DON'T pretend per-club precision we can't
// see; we shift the turn/tilt bands a touch fuller for driver, a touch more
// compact for wedge, and leave tempo on the shared 3:1 (it holds across the
// bag). 'default' is the all-clubs fallback when the club is unknown.
export type BenchmarkClubCategory = 'driver' | 'iron' | 'wedge' | 'default';

/** Map a free-text club name / chip to a benchmark category. Conservative:
 *  anything we can't confidently bucket falls to 'default' (no fabricated
 *  precision). */
export function clubCategoryFor(club?: string | null): BenchmarkClubCategory {
  if (!club) return 'default';
  const c = club.toLowerCase();
  if (/driver|\bdvr\b|1[\s-]?wood|\bd\b/.test(c)) return 'driver';
  if (/wedge|\b[pgsla]w\b|lob|sand|gap|\bpw\b|\bsw\b|\blw\b|\bgw\b/.test(c)) return 'wedge';
  if (/iron|hybrid|\b\d+i\b|\b[3-9]\b|wood|\d+[\s-]?wood/.test(c)) return 'iron';
  return 'default';
}

// ─── Benchmark range + profile shapes ───────────────────────────────────

/** A directional tour-standard RANGE for one metric. `ideal` is the center
 *  of the tour band; `low`/`high` bound the "inside the benchmark" zone. A
 *  read inside [low, high] reads as "tour-standard"; outside, the engine
 *  points it directionally toward `ideal` (never "X° off a named pro"). */
export interface BenchmarkRange {
  low: number;
  ideal: number;
  high: number;
}

/** The metrics we can read directionally from pose + the tempo engine. Keys
 *  mirror SwingBiomechanics so the engine maps 1:1. tempoRatio is carried
 *  here so the bank stays the single tour-benchmark source (3:1) consistent
 *  with services/smartTempo.ts — even though tempo isn't a SwingBiomechanics
 *  field. */
export type BenchmarkMetricKey =
  | 'hipTurnDeg'
  | 'shoulderTurnDeg'
  | 'shoulderTiltDeg'
  | 'weightShiftPct'
  | 'spineAngleDeltaDeg'
  | 'headDriftPxNorm'
  | 'hipSlideRatio'
  | 'sequencingScore'
  | 'tempoRatio';

export interface BenchmarkMetric {
  key: BenchmarkMetricKey;
  /** The tour-standard directional range. */
  range: BenchmarkRange;
  /** Real proExemplars id whose FEEL + DRILL closes a gap on this metric.
   *  Lets the comparison result carry "vs tour benchmark → here's the
   *  Els/Couples feel + the drill" instead of a bare number. */
  exemplarId: string;
  /** One honest, hedged line for when the read is OUTSIDE the band. Never
   *  a "you're X° off [pro]" claim. */
  benchmarkNote: string;
}

export interface BenchmarkProfile {
  club: BenchmarkClubCategory;
  /** The honesty framing the UI/voice MUST lead with for this profile. */
  framing: string;
  metrics: BenchmarkMetric[];
  /** Where this profile came from — 'in_bundle' (curated, shipped now) or
   *  'server' (a future real-pro-pose Tier-2 payload). Surfaced so the UI
   *  can be transparent about the source. */
  origin: 'in_bundle' | 'server';
}

// ─── The honest framing strings (one place, reused) ─────────────────────

export const BENCHMARK_FRAMING =
  'vs the tour benchmark (directional) — a tour-standard range, not a measured comparison to a named pro';

const FULL_SWING_FRAMING =
  'Compared to the tour benchmark range (directional). These are tour-typical ranges from published teaching, not a captured pro swing.';

// ─── Curated in-bundle profiles ─────────────────────────────────────────
//
// Anchors (published / tour-typical, NOT a measured pro capture):
//   • hip turn ~45°, shoulder turn ~90° at the top, X-factor (separation)
//     ~45° — TPI / tour norms.
//   • shoulder TILT ~30° at the top (lead-shoulder dip) — spine-angle
//     preservation marker.
//   • weight shift ~80% to the lead side by impact — tour-typical.
//   • spine-angle change small (~0-6°), head drift small, hip rotate >> slide,
//     sequencing high (hips lead) — established "centered, sequenced" markers.
//   • tempo 3:1 (Yale study, Tour Tempo) — shared across the bag.
//
// Driver runs a hair fuller (longer swing); wedge a hair more compact. Tempo
// stays 3:1 for every club (it holds bag-wide). All RANGES, all directional.

function fullSwingMetrics(opts: {
  turnBias: number;      // shift applied to turn/tilt bands (driver +, wedge -)
}): BenchmarkMetric[] {
  const b = opts.turnBias;
  return [
    {
      key: 'tempoRatio',
      range: { low: 2.7, ideal: 3.0, high: 3.3 },
      exemplarId: 'pro.tempo.syrup',
      benchmarkNote: 'Tour rhythm tends toward a smooth ~3:1 backswing-to-downswing.',
    },
    {
      key: 'shoulderTurnDeg',
      range: { low: 85 + b, ideal: 92 + b, high: 100 + b },
      exemplarId: 'pro.turn.full-coil',
      benchmarkNote: 'Tour backswings tend toward a full ~90° shoulder coil with the back to the target.',
    },
    {
      key: 'hipTurnDeg',
      range: { low: 38 + b * 0.5, ideal: 45 + b * 0.5, high: 52 + b * 0.5 },
      exemplarId: 'pro.turn.full-coil',
      benchmarkNote: 'A tour-typical hip turn sits near ~45° — enough to coil, not so much you lose separation.',
    },
    {
      key: 'shoulderTiltDeg',
      range: { low: 24, ideal: 30, high: 38 },
      exemplarId: 'pro.takeaway.one-piece',
      benchmarkNote: 'A ~30° tilt at the top tends to preserve spine angle; flat shoulders look like an over-the-top pattern.',
    },
    {
      key: 'weightShiftPct',
      range: { low: 72, ideal: 82, high: 92 },
      exemplarId: 'pro.compression.body-leads',
      benchmarkNote: 'Tour players tend to get ~80%+ onto the lead side by impact — the body delivering the strike.',
    },
    {
      key: 'sequencingScore',
      range: { low: 65, ideal: 80, high: 100 },
      exemplarId: 'pro.transition.patience',
      benchmarkNote: 'A tour kinematic sequence tends to let the hips lead the downswing — patience at the top shallows the club.',
    },
    {
      key: 'spineAngleDeltaDeg',
      range: { low: 0, ideal: 3, high: 7 },
      exemplarId: 'pro.centered.steady-head',
      benchmarkNote: 'A centered swing tends to hold spine angle through impact — small change reads steady.',
    },
    {
      key: 'headDriftPxNorm',
      range: { low: 0, ideal: 0.015, high: 0.04 },
      exemplarId: 'pro.centered.steady-head',
      benchmarkNote: 'Tour swings tend to rotate around a stable center — the head stays roughly over the ball.',
    },
    {
      key: 'hipSlideRatio',
      range: { low: 0, ideal: 0.5, high: 0.85 },
      exemplarId: 'pro.centered.steady-head',
      benchmarkNote: 'Rotating more than sliding (low ratio) tends to keep the low point repeatable.',
    },
  ];
}

function profile(club: BenchmarkClubCategory, turnBias: number): BenchmarkProfile {
  return {
    club,
    framing: FULL_SWING_FRAMING,
    metrics: fullSwingMetrics({ turnBias }),
    origin: 'in_bundle',
  };
}

/** In-bundle curated bank, keyed by club category. Driver fuller (+5),
 *  iron neutral, wedge a touch more compact (-5). All directional ranges. */
const IN_BUNDLE_BANK: Record<BenchmarkClubCategory, BenchmarkProfile> = {
  driver:  profile('driver', 5),
  iron:    profile('iron', 0),
  wedge:   profile('wedge', -5),
  default: profile('default', 0),
};

// ─── Server-hostable contract (Tier-2 future) ───────────────────────────

/** Bumped whenever the in-bundle ranges change so a server payload can
 *  declare compatibility. */
export const BENCHMARK_BANK_VERSION = 1;

/** The shape a future server payload (Supabase tail) would deliver to swap
 *  in real captured pro-pose-derived ranges. Keyed by club category; the
 *  client validates `version` then calls setBenchmarkOverride(). Purely
 *  additive — the in-bundle bank is always the fallback. */
export interface BenchmarkBankPayload {
  version: number;
  /** ISO timestamp of when the server bank was generated. */
  generatedAt?: string;
  profiles: Partial<Record<BenchmarkClubCategory, BenchmarkProfile>>;
}

// Runtime override slot. Null until a server payload is loaded + accepted.
let serverOverride: Partial<Record<BenchmarkClubCategory, BenchmarkProfile>> | null = null;

/**
 * Accept a server payload (future real-pro-pose tail). Validates the version
 * and that each profile carries metrics; ignores anything malformed so a bad
 * payload can NEVER blank the in-bundle bank. Returns the number of profiles
 * accepted. Marks accepted profiles origin:'server' for UI transparency.
 */
export function setBenchmarkOverride(payload: BenchmarkBankPayload | null): number {
  if (payload == null) { serverOverride = null; return 0; }
  if (payload.version !== BENCHMARK_BANK_VERSION) return 0;
  const accepted: Partial<Record<BenchmarkClubCategory, BenchmarkProfile>> = {};
  let n = 0;
  for (const key of Object.keys(payload.profiles) as BenchmarkClubCategory[]) {
    const p = payload.profiles[key];
    if (p && Array.isArray(p.metrics) && p.metrics.length > 0) {
      accepted[key] = { ...p, club: key, origin: 'server' };
      n++;
    }
  }
  serverOverride = n > 0 ? accepted : null;
  return n;
}

/** The single read the engine goes through. Server override wins when
 *  present for the club; otherwise the curated in-bundle profile; 'default'
 *  is the ultimate fallback. */
export function getBenchmarkProfile(club: BenchmarkClubCategory = 'default'): BenchmarkProfile {
  return (
    serverOverride?.[club] ??
    serverOverride?.default ??
    IN_BUNDLE_BANK[club] ??
    IN_BUNDLE_BANK.default
  );
}

/** Lookup one metric within a club's profile. */
export function getBenchmarkMetric(
  key: BenchmarkMetricKey,
  club: BenchmarkClubCategory = 'default',
): BenchmarkMetric | null {
  const prof = getBenchmarkProfile(club);
  return prof.metrics.find((m) => m.key === key) ?? null;
}

// ─── Engine bridge: range → a single reference biomech (back-compat) ────
//
// The existing swingComparisonEngine grades current-vs-a-single-reference.
// To keep every existing consumer byte-stable we expose the profile's
// `ideal` values as a SwingBiomechanics so the engine can drop the richer
// bank in where TOUR_MEDIAN lived — the per-metric RANGE + exemplar ride
// alongside via getBenchmarkMetric for the honest framing + feel/drill.

export function benchmarkIdealBiomech(club: BenchmarkClubCategory = 'default'): SwingBiomechanics {
  const prof = getBenchmarkProfile(club);
  const ideal = (k: BenchmarkMetricKey): number | null => {
    const m = prof.metrics.find((x) => x.key === k);
    return m ? m.range.ideal : null;
  };
  return {
    hipTurnDeg: ideal('hipTurnDeg'),
    shoulderTurnDeg: ideal('shoulderTurnDeg'),
    shoulderTiltDeg: ideal('shoulderTiltDeg'),
    weightShiftPct: ideal('weightShiftPct'),
    spineAngleDeltaDeg: ideal('spineAngleDeltaDeg'),
    headDriftPxNorm: ideal('headDriftPxNorm'),
    hipSlideRatio: ideal('hipSlideRatio'),
    sequencingScore: ideal('sequencingScore'),
    frames: [],
    verdicts: {
      hipTurn: null, shoulderTurn: null, weightShift: null,
      posture: null, shoulderTilt: null, sequencing: null,
    },
  };
}

/** Is a read inside the tour benchmark band for this metric? Used by the
 *  engine to say "tour-standard" vs nudge directionally toward ideal. */
export function withinBenchmark(
  key: BenchmarkMetricKey,
  value: number,
  club: BenchmarkClubCategory = 'default',
): boolean {
  const m = getBenchmarkMetric(key, club);
  if (!m) return false;
  return value >= m.range.low && value <= m.range.high;
}
