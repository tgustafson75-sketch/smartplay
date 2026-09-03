/**
 * 2026-07-07 (Tim — SwingSim, "a real motion sim game... Road to the Masters feel").
 *
 * The pure outcome engine (docs/motion-sim-game-spec.md). GAME, not analysis — badged
 * SIM everywhere and never leaks into real stats — but parameterized by REAL personal
 * data: your learned club carries, your CNS miss tendency, and the rep quality the
 * IndoorRepDetector actually measured. The skill IS real rhythm: tempo close to 3:1
 * with a smooth transition flushes it; a snatched rep with your slice tendency slices.
 *
 * Pure + deterministic (rng injected) so it sim-tests.
 */

import type { IndoorRep } from './indoorSwing';

export interface SimShotInput {
  /** The player's REAL carry for the chosen club (yards). */
  clubCarry: number;
  /** The measured rep (null = whiffed read → heavily penalized but playable). */
  rep: IndoorRep | null;
  /** CNS dominant-miss lateral bias: -1 = hooks left, +1 = slices right, 0 = neutral. */
  missBias: number;
  rng?: () => number;
}

export interface SimShotOutcome {
  carryYds: number;
  /** Lateral offset in yards; negative = left of the line. */
  lateralYds: number;
  /** 0..1 — how pure the rep was (drives commentary + colors). */
  quality: number;
  flushed: boolean;
}

/** Rep quality from what was actually measured: tempo closeness to 3:1 + transition. */
export function repQuality(rep: IndoorRep | null, benchmark = 3.0): number {
  if (!rep) return 0.2;
  const tempoErr = Math.min(1, Math.abs(rep.tempoRatio - benchmark) / benchmark);
  const tempoScore = 1 - tempoErr; // 1 at benchmark, →0 as it drifts a full benchmark away
  const transScore = rep.transition === 'smooth' ? 1 : rep.transition === 'quick' ? 0.7 : 0.35;
  return Math.max(0.05, Math.min(1, tempoScore * 0.6 + transScore * 0.4));
}

export function simShot(input: SimShotInput): SimShotOutcome {
  const rng = input.rng ?? Math.random;
  const q = repQuality(input.rep);
  const flushed = q >= 0.85;
  // Carry: 55% floor even on a poor rep (you still hit it), scaling to full at q=1,
  // with noise that GROWS as quality falls (a flushed rep is repeatable).
  const noise = (rng() * 2 - 1) * input.clubCarry * 0.06 * (1.25 - q);
  const carryYds = Math.max(5, Math.round(input.clubCarry * (0.55 + 0.45 * q) + noise));
  // Direction: your real tendency, expressed hardest when the rep is worst; plus
  // symmetric noise. A neutral player with a pure rep starts it on the line.
  const biasYds = input.missBias * (1 - q) * 26;
  const lateralNoise = (rng() * 2 - 1) * 14 * (1.15 - q);
  const lateralYds = Math.round((biasYds + lateralNoise) * 10) / 10;
  return { carryYds, lateralYds, quality: q, flushed };
}

/**
 * 2026-09-03 (pre-release audit) — WHERE THE BALL ACTUALLY STOPPED.
 *
 * Both callers computed the new distance to the pin as `remaining - carry` and used the lateral
 * offset only to choose a lie. That is a one-dimensional golf course. A 150-yard shot from 150 out
 * that finished 20 yards right was recorded as ZERO yards from the pin — the on-device SwingSim then
 * handed the player a two-foot putt for having blocked it into the right rough, and lieFor's
 * `remainingYds <= 0` branch would even call it holed.
 *
 * That single line was the birdie engine: every offline approach converted into a tap-in. A
 * "mid-to-high handicapper" averaged 72.6 over 20 seeded rounds and went under par in 8 of them.
 *
 * The pin is a POINT, so the distance to it is the hypotenuse: how far short or long you finished,
 * against how far offline. Shared here rather than written twice, because the two callers drifting
 * is how this survived in one of them. [[two-owners-is-the-root-cause]]
 */
export function restingDistanceYds(remainingBeforeYds: number, carryYds: number, lateralYds: number): number {
  // Signed along-track error: positive = short of the pin, negative = past it. Either way the
  // distance BACK to the pin is its magnitude, combined with how far offline the ball sits.
  const along = remainingBeforeYds - carryYds;
  return Math.hypot(along, lateralYds);
}

/**
 * 2026-09-03 — YARDS TO PUTT FEET, in one place, because the three copies did not agree.
 *
 * A yard is THREE feet. The two harnesses had it right (`remaining * 3`, and `/ YDS_PER_FT` where
 * YDS_PER_FT = 1/3). The SHIPPED on-device screen — app/swinglab/simround — used `* 1.6`, so every
 * putt in SwingSim was reported at roughly HALF its true length. A thirty-foot putt came up as
 * sixteen, which reads as makeable, and the engine then holed it far more often than it should.
 *
 * It also added `Math.abs(out.lateralYds)` — a YARDS value — onto that FEET value. That was a crude
 * stand-in from when `newRemaining` ignored lateral entirely; once restingDistanceYds started
 * folding lateral into the hypotenuse this morning, the same line began double-counting it. A fix
 * upstream turned an approximation into a compounding error, which is the argument for one owner
 * rather than three: the harnesses were never going to catch a bug that only existed on the screen.
 * [[two-owners-is-the-root-cause]]
 */
export const FEET_PER_YARD = 3;

/** Distance-to-pin in yards → the putt length in feet. Floored at a tap-in, never zero. */
export function puttFeetFrom(remainingYards: number): number {
  const y = Number.isFinite(remainingYards) ? Math.max(0, remainingYards) : 0;
  return Math.max(1, Math.round(y * FEET_PER_YARD));
}

export type SimLie = 'tee' | 'fairway' | 'rough' | 'trees' | 'green' | 'holed';

/** Corridor lie model: how far offline you are when the ball stops. */
export function lieFor(lateralAbsYds: number, remainingYds: number): SimLie {
  if (remainingYds <= 0) return 'holed';
  if (remainingYds <= 18 && lateralAbsYds < 16) return 'green';
  if (lateralAbsYds < 13) return 'fairway';
  if (lateralAbsYds < 26) return 'rough';
  return 'trees';
}

/** Lie penalty applied to the NEXT shot's effective carry. */
export function liePenalty(lie: SimLie): number {
  return lie === 'rough' ? 0.88 : lie === 'trees' ? 0.68 : 1;
}

export interface SimPuttInput {
  distanceFt: number;
  rep: IndoorRep | null;
  rng?: () => number;
}

export interface SimPuttOutcome {
  holed: boolean;
  /** Feet remaining when missed (0 when holed). */
  remainingFt: number;
  quality: number;
}

/**
 * 2026-09-03 (pre-release audit) — REAL MAKE RATES, because the old curve was wrong in SHAPE.
 *
 * Make probability was `1.05 - distanceFt / 26` — a straight line. Real putting is not linear, and a
 * line fitted to hole out at ~27ft is wrong at BOTH ends at once:
 *
 *        3ft      10ft     20ft
 *   old  77-85%   55-61%   23-26%
 *   tour    96%      40%      15%
 *   15hcp   93%      25%       9%
 *
 * Tap-ins missed a quarter of the time while twenty-footers dropped like a tour card. Those errors
 * point opposite ways, so the TOTAL looked defensible while every individual putt felt wrong — and
 * they netted out to a "mid-to-high handicapper" averaging 72.6 over 20 seeded rounds, under par in
 * 8 of them, best 64. That is not a golfer, and a player who shoots 64 in a sim stops believing it.
 *
 * Two anchored curves from real data — a tour card and a ~15 handicap — interpolated on distance and
 * blended by the quality of the stroke actually measured. A pure rep putts like a pro, a scrappy one
 * putts like a weekend player, and nobody misses a two-footer a quarter of the time. Nothing here is
 * a guess dressed as a constant: each anchor is a published make rate. [[illustration-data-points]]
 *
 * This is still a GAME (badged SIM, never leaks into real stats) — but a game whose numbers a golfer
 * recognises is the whole difference between Road to the Masters and a slot machine.
 */
const PUTT_MAKE_TOUR: readonly (readonly [number, number])[] = [
  [2, 0.99], [3, 0.96], [4, 0.88], [5, 0.77], [6, 0.70], [8, 0.50],
  [10, 0.40], [12, 0.31], [15, 0.23], [20, 0.15], [25, 0.10], [30, 0.07], [40, 0.04], [60, 0.02],
];
const PUTT_MAKE_AMATEUR: readonly (readonly [number, number])[] = [
  [2, 0.98], [3, 0.93], [4, 0.79], [5, 0.65], [6, 0.55], [8, 0.36],
  [10, 0.25], [12, 0.19], [15, 0.13], [20, 0.09], [25, 0.06], [30, 0.04], [40, 0.02], [60, 0.01],
];

/** Linear interpolation across an anchored make-rate table; flat outside its ends. */
function makeRateAt(table: readonly (readonly [number, number])[], ft: number): number {
  if (ft <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (ft >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [d0, p0] = table[i - 1];
    const [d1, p1] = table[i];
    if (ft <= d1) return p0 + ((p1 - p0) * (ft - d0)) / (d1 - d0);
  }
  return last[1];
}

export function simPutt(input: SimPuttInput): SimPuttOutcome {
  const rng = input.rng ?? Math.random;
  const q = repQuality(input.rep, 2.0);
  // Decel into the ball is the classic miss — big make-probability hit.
  const decelPenalty = input.rep?.throughStroke === 'decelerating' ? 0.55 : 1;
  const ft = Math.max(0, input.distanceFt);
  // The stroke decides WHICH golfer you are on this putt, rather than scaling one generic curve.
  const p = Math.max(
    0.01,
    Math.min(0.99, (makeRateAt(PUTT_MAKE_AMATEUR, ft) + (makeRateAt(PUTT_MAKE_TOUR, ft) - makeRateAt(PUTT_MAKE_AMATEUR, ft)) * q) * decelPenalty),
  );
  if (rng() < p) return { holed: true, remainingFt: 0, quality: q };
  /**
   * The comeback. The old leave was distanceFt * (0.12 … 0.34), which put a missed twenty-footer
   * 4-6ft away — long enough that harder putting alone would have replaced phantom birdies with
   * phantom three-putts. Real lag leaves about 5% of the distance plus a foot or so, so a missed
   * twenty-footer sits ~2-3ft and a missed forty-footer ~4-5ft. Rounded to a foot, floored at 1.
   */
  const leave = Math.max(1, Math.round(ft * (0.05 + (1 - q) * 0.10) + rng() * 1.5));
  return { holed: false, remainingFt: leave, quality: q };
}

/** Map the CNS dominant-miss string to a lateral bias (-1 hook … +1 slice). */
export function missBiasFor(dominantMiss: string | null | undefined): number {
  const m = (dominantMiss ?? '').toLowerCase();
  if (!m) return 0;
  if (/slice|over_the_top|outside_in|open|fade/.test(m)) return 1;
  if (/hook|inside_out|closed|draw/.test(m)) return -1;
  return 0;
}

/**
 * 2026-07-08 (SwingSim ladder — family match). Generate a BELIEVABLE per-hole scorecard
 * for a simulated opponent from their handicap, so you can race a family member (or a
 * target handicap) hole-by-hole with the same ghost machinery. Not a real round — a
 * fair, handicap-shaped opponent. Pure; rng injected.
 */
export function simOpponentScorecard(
  holes: { hole: number; par: number }[],
  handicap: number,
  rng: () => number = Math.random,
): Record<number, number> {
  const perHole = Math.max(0, handicap) / 18; // avg strokes over par per hole
  const spread = 1.1 + Math.max(0, handicap) / 34; // higher handicap = streakier
  const out: Record<number, number> = {};
  for (const h of holes) {
    const noise = (rng() * 2 - 1) * spread;
    // Occasional blow-up hole, more likely for higher handicaps.
    const blowUp = rng() < Math.min(0.18, 0.04 + handicap / 260) ? 1 + Math.round(rng() * 2) : 0;
    let s = Math.round(h.par + perHole + noise) + blowUp;
    s = Math.max(1, Math.min(h.par + 5, s));
    out[h.hole] = s;
  }
  return out;
}

export function scoreName(strokes: number, par: number): string {
  const d = strokes - par;
  if (strokes === 1) return 'ACE';
  if (d <= -3) return 'ALBATROSS';
  if (d === -2) return 'EAGLE';
  if (d === -1) return 'BIRDIE';
  if (d === 0) return 'PAR';
  if (d === 1) return 'BOGEY';
  if (d === 2) return 'DOUBLE';
  return `+${d}`;
}
