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

export function simPutt(input: SimPuttInput): SimPuttOutcome {
  const rng = input.rng ?? Math.random;
  const q = repQuality(input.rep, 2.0);
  // Decel into the ball is the classic miss — big make-probability hit.
  const decelPenalty = input.rep?.throughStroke === 'decelerating' ? 0.55 : 1;
  const base = Math.max(0.04, Math.min(0.97, 1.05 - input.distanceFt / 26));
  const p = Math.max(0.03, Math.min(0.97, base * (0.55 + 0.45 * q) * decelPenalty));
  if (rng() < p) return { holed: true, remainingFt: 0, quality: q };
  // Miss leaves a comeback scaled by distance + (lack of) quality.
  const leave = Math.max(1, Math.round(input.distanceFt * (0.12 + (1 - q) * 0.22) + rng() * 2));
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
