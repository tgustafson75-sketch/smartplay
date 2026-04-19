/**
 * utils/playsLikeEngine.ts
 *
 * Converts raw GPS yardage into an adjusted "plays like" distance.
 *
 * Adjustments (in order, additive):
 *   1. Wind      — headwind adds yards, tailwind subtracts
 *   2. Elevation — uphill adds yards, downhill subtracts
 *   3. Lie       — rough / bunker add yards (matches caddieEngine LIE_PENALTY baseline)
 *
 * Design decisions:
 *   - Pure functions, no imports, < 1 ms, deterministic
 *   - Raw yardage is NEVER mutated — always returned alongside adjusted
 *   - Math is intentionally simple (pro-caddie rule-of-thumb, not ballistic physics)
 *   - Temperature / altitude omitted for v1 (placeholder comment below)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type WindDirection = 'head' | 'tail' | 'cross';
export type PlaysLikeLie  = 'fairway' | 'rough' | 'bunker' | 'tee';

export interface PlaysLikeInput {
  /** Raw GPS / hole yardage to the target (middle, front, or back) */
  rawYardage: number;
  /** Wind speed in mph (0 = no wind) */
  windSpeed?: number;
  /** Direction relative to the shot line */
  windDirection?: WindDirection;
  /**
   * Positive = uphill (plays longer), negative = downhill (plays shorter).
   * Units: feet of elevation change over the shot distance.
   * Rule of thumb: every 10 ft up ≈ +1 yard.
   */
  elevationChange?: number;
  /** Current lie */
  lie?: PlaysLikeLie;
}

export interface PlaysLikeBreakdown {
  /** Input yardage — never changed */
  rawYardage: number;
  /** Final adjusted yardage (rounded to nearest yard) */
  playsLikeYardage: number;
  /** Yards added / removed by wind (negative = tailwind help) */
  windAdjustment: number;
  /** Yards added / removed by elevation */
  elevationAdjustment: number;
  /** Yards added by lie penalty */
  lieAdjustment: number;
  /** Short human-readable summary of the biggest factor */
  primaryFactor: string;
  /** One-line description for display (e.g. "Plays Like: 162 (+12 into wind)") */
  displayLabel: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Wind multipliers (yards added per mph).
 * Headwind: 1 yard per mph is the PGA Tour caddie rule of thumb.
 * We use 0.75 as a conservative split (accounts for partial headwinds, club loft).
 * Cross-wind has negligible yardage effect but affects aim — 0 yards added.
 */
const WIND_FACTOR: Record<WindDirection, number> = {
  head:  0.75,  // + per mph
  tail: -0.5,   // - per mph (tailwind helps less than headwind hurts)
  cross:  0,    // yardage neutral; aim adjustment handled by caddieEngine
};

/**
 * Lie penalty (yards added to required carry).
 * Matches the LIE_PENALTY in caddieEngine so both systems are consistent.
 * Tee / fairway = 0 (clean contact assumed).
 */
const LIE_YARDS: Record<PlaysLikeLie, number> = {
  tee:     0,
  fairway: 0,
  rough:   5,   // spec says +5
  bunker:  10,  // spec says +10
};

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * computePlaysLike — main entry point.
 *
 * All adjustments are additive and signed:
 *   playsLikeYardage = raw + wind + elevation + lie
 *
 * Temperature (v1 placeholder):
 *   Cold air is denser → ball flies shorter (~1% per 10°F below 70°F).
 *   Hot air is thinner → ball flies slightly farther.
 *   Implementation deferred; add `temperature?: number` to input when ready.
 */
export function computePlaysLike(input: PlaysLikeInput): PlaysLikeBreakdown {
  const {
    rawYardage,
    windSpeed      = 0,
    windDirection  = 'cross',
    elevationChange = 0,
    lie              = 'fairway',
  } = input;

  // ── Wind ──────────────────────────────────────────────────────────────────
  const windAdj = Math.round(windSpeed * WIND_FACTOR[windDirection]);

  // ── Elevation ─────────────────────────────────────────────────────────────
  // Every 10 feet of elevation change ≈ 1 yard of carry adjustment
  const elevAdj = Math.round(elevationChange / 10);

  // ── Lie ───────────────────────────────────────────────────────────────────
  const lieAdj = LIE_YARDS[lie] ?? 0;

  // ── Total ─────────────────────────────────────────────────────────────────
  const total = rawYardage + windAdj + elevAdj + lieAdj;
  const playsLikeYardage = Math.max(1, total);

  // ── Primary factor label ──────────────────────────────────────────────────
  const factors: Array<[number, string]> = ([
    [Math.abs(windAdj),  windDirection === 'head' ? 'into wind' : windDirection === 'tail' ? 'downwind' : 'crosswind'],
    [Math.abs(elevAdj),  elevationChange > 0 ? 'uphill' : 'downhill'],
    [lieAdj,             lie === 'rough' ? 'rough lie' : lie === 'bunker' ? 'bunker lie' : ''],
  ] as Array<[number, string]>).filter(([mag, label]) => mag > 0 && label !== '');

  factors.sort((a, b) => b[0] - a[0]);
  const primaryFactor = factors[0]?.[1] ?? 'no adjustment';

  // ── Display label ─────────────────────────────────────────────────────────
  const diff   = playsLikeYardage - rawYardage;
  const sign   = diff > 0 ? '+' : '';
  const suffix = diff !== 0 ? ` (${sign}${diff} · ${primaryFactor})` : '';
  const displayLabel = `Plays Like: ${playsLikeYardage}${suffix}`;

  return {
    rawYardage,
    playsLikeYardage,
    windAdjustment:      windAdj,
    elevationAdjustment: elevAdj,
    lieAdjustment:       lieAdj,
    primaryFactor,
    displayLabel,
  };
}

/**
 * Quick helper — returns just the adjusted yardage.
 * Use when you only need the number (e.g. for club selection).
 */
export function getPlaysLikeYardage(input: PlaysLikeInput): number {
  return computePlaysLike(input).playsLikeYardage;
}
