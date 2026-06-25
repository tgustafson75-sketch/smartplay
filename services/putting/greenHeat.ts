/**
 * 2026-06-25 — Green Heat model (Grint-style green read / heat map — HONEST v1).
 *
 * Tim's law + the no-deferred-placeholder rule gate this file: the heat map renders
 * ONLY real collected putt data. Until enough real putts exist, callers show an
 * honest "collecting putts…" state — NEVER a fabricated/illustrative heat map.
 *
 * THE REAL DATA SOURCE
 * --------------------
 * The reliable, actually-captured putt signal today is PUTTS-PER-HOLE:
 *   RoundRecord.putts: Record<holeNumber, number>
 * logged via the cockpit (caddie.tsx handleLogHole → roundStore.logPutts). Combined
 * with the hole par (and the existing honest GIR proxy: strokesToGreen = score − putts
 * ≤ par − 2), every scored hole tells us the putt count and whether the green was hit
 * in regulation. That is enough to honestly aggregate putting PERFORMANCE — make-rate
 * proxy by distance-class and a putts-per-hole heat — without any fabrication.
 *
 * We deliberately do NOT fake a 2D green-density heat. Positional putt data (ball
 * start/finish on the green) is NOT captured today: services/putting/puttRoll.ts +
 * store/greenRollStore.ts model it, but that pipeline needs the tripod watch-the-roll
 * CV which isn't wired yet (zero feeders). When/if greenRollStore accumulates real
 * rolls, mergeGreenRollSignal() folds the genuine break/make signal in — but it never
 * invents one.
 *
 * What we DO build (all from real putts-per-hole):
 *   - A "putting class" bucket per scored hole derived from par + GIR:
 *       • approachPutt  (GIR hit → first putt is a real lag/approach from on the green)
 *       • scramblePutt  (green missed → chip-and-putt territory, shorter first putt)
 *     and within each, the putts-per-hole distribution (1 / 2 / 3+).
 *   - A make-rate-style heat: % of holes in each class that were ONE-putt (the honest
 *     "you convert from here") vs three-putt+ (the leak).
 *
 * PURE, SYNC, never throws, no React/network/store imports beyond the type. The store
 * read happens in the hook layer; this file takes plain RoundRecord[] so it stays
 * unit-testable and the honesty boundary is auditable in one place.
 */

import type { RoundRecord, CourseHole } from '../../store/roundStore';
import type { GreenRoll } from '../../store/greenRollStore';

/** Minimum real scored-putt holes before the heat map renders at all. Below this we
 *  show the honest collecting state. ~2 nine-hole rounds of logged putts. */
export const GREEN_HEAT_MIN_HOLES = 18;

export type PuttClass = 'approachPutt' | 'scramblePutt';

export interface PuttBucketStat {
  /** Total scored holes that fell in this class with real putt data. */
  holes: number;
  /** Holes resolved in exactly one putt (the honest "make from here" proxy). */
  onePutt: number;
  /** Holes that took two putts. */
  twoPutt: number;
  /** Holes that took three or more putts (the three-putt leak). */
  threePlus: number;
  /** Mean putts/hole across this class. null when holes === 0. */
  avgPutts: number | null;
  /** onePutt / holes — the "conversion" heat value, 0..1. null when holes === 0. */
  onePuttRate: number | null;
  /** threePlus / holes — the leak heat value, 0..1. null when holes === 0. */
  threePuttRate: number | null;
}

export interface GreenHeatModel {
  /** Total scored holes with real putt data folded into the model. */
  totalHoles: number;
  /** True once totalHoles >= GREEN_HEAT_MIN_HOLES — only then should the heat render. */
  ready: boolean;
  /** Holes remaining until ready (0 when ready). Drives the collecting-state progress. */
  remaining: number;
  /** Per-class real aggregates. Always present; .holes may be 0 (render empty cell). */
  byClass: Record<PuttClass, PuttBucketStat>;
  /** Overall putts-per-hole distribution across every class (real). */
  overall: PuttBucketStat;
  /** Optional positional break signal IF (and only if) real green rolls exist.
   *  null today — greenRollStore has no feeders yet. Never fabricated. */
  rollSignal: GreenRollSignal | null;
}

export interface GreenRollSignal {
  /** Number of real measured rolls folded in. */
  rolls: number;
  /** Dominant break side across the measured rolls, or 'mixed' / 'straight'. */
  dominantBreak: GreenRoll['breakSide'] | 'mixed';
  /** Make-rate across the measured rolls, 0..1. */
  makeRate: number;
}

function emptyBucket(): PuttBucketStat {
  return {
    holes: 0,
    onePutt: 0,
    twoPutt: 0,
    threePlus: 0,
    avgPutts: null,
    onePuttRate: null,
    threePuttRate: null,
  };
}

function finalizeBucket(b: PuttBucketStat, puttsSum: number): PuttBucketStat {
  if (b.holes === 0) return b;
  return {
    ...b,
    avgPutts: Math.round((puttsSum / b.holes) * 100) / 100,
    onePuttRate: Math.round((b.onePutt / b.holes) * 100) / 100,
    threePuttRate: Math.round((b.threePlus / b.holes) * 100) / 100,
  };
}

/**
 * Build the honest green heat model from real round history.
 *
 * @param rounds       roundHistory (in-app + imported). Imported rounds carry putts
 *                     but no per-hole par/shots — they still contribute the putt count
 *                     to `overall`, and are classed as approachPutt only when par is
 *                     resolvable (handled below). No fabrication: a hole with no real
 *                     putt entry is skipped entirely.
 * @param holesByCourse optional lookup courseId → CourseHole[] so we can read par.
 *                     When a hole's par/GIR can't be resolved we still count the putt
 *                     in `overall` but cannot classify it (kept honest, not guessed).
 */
export function buildGreenHeatModel(
  rounds: RoundRecord[],
  holesByCourse?: Record<string, CourseHole[]>,
): GreenHeatModel {
  const byClass: Record<PuttClass, PuttBucketStat> = {
    approachPutt: emptyBucket(),
    scramblePutt: emptyBucket(),
  };
  const overall = emptyBucket();
  const classSum: Record<PuttClass, number> = { approachPutt: 0, scramblePutt: 0 };
  let overallSum = 0;

  for (const r of rounds ?? []) {
    const putts = r.putts ?? {};
    const scores = r.scores ?? {};
    const courseHoles = (r.courseId && holesByCourse?.[r.courseId]) || null;

    for (const [holeStr, puttCountRaw] of Object.entries(putts)) {
      const puttCount = Number(puttCountRaw);
      // Honesty: only real, sane putt entries. 0 or non-finite = no real data.
      if (!Number.isFinite(puttCount) || puttCount <= 0) continue;
      const hole = parseInt(holeStr, 10);

      overall.holes++;
      overallSum += puttCount;
      if (puttCount === 1) overall.onePutt++;
      else if (puttCount === 2) overall.twoPutt++;
      else overall.threePlus++;

      // Classify into approach (GIR) vs scramble (green missed) ONLY when par +
      // score are both real. Reuses the scorecard's honest GIR proxy:
      //   strokesToGreen = score − putts ≤ par − 2  ⇒  green hit in regulation.
      const score = Number(scores[hole]);
      const holeData = courseHoles?.find((h) => h.hole === hole);
      const par = holeData?.par;
      if (!Number.isFinite(score) || score <= 0 || !Number.isFinite(par as number)) {
        // Can't classify honestly — counted in overall, skipped per-class.
        continue;
      }
      const strokesToGreen = score - puttCount;
      const gir = strokesToGreen <= (par as number) - 2;
      const cls: PuttClass = gir ? 'approachPutt' : 'scramblePutt';

      const b = byClass[cls];
      b.holes++;
      classSum[cls] += puttCount;
      if (puttCount === 1) b.onePutt++;
      else if (puttCount === 2) b.twoPutt++;
      else b.threePlus++;
    }
  }

  const totalHoles = overall.holes;
  return {
    totalHoles,
    ready: totalHoles >= GREEN_HEAT_MIN_HOLES,
    remaining: Math.max(0, GREEN_HEAT_MIN_HOLES - totalHoles),
    byClass: {
      approachPutt: finalizeBucket(byClass.approachPutt, classSum.approachPutt),
      scramblePutt: finalizeBucket(byClass.scramblePutt, classSum.scramblePutt),
    },
    overall: finalizeBucket(overall, overallSum),
    rollSignal: null,
  };
}

/**
 * Fold REAL measured green-roll positional/break data into a heat model, IF any exists.
 * Today greenRollStore has zero feeders so `rolls` is empty and this is a no-op that
 * leaves rollSignal: null. When the tripod watch-the-roll CV lands and starts feeding
 * greenRollStore.logRoll, this surfaces the genuine break + make signal — never a
 * fabricated one (returns null when rolls is empty).
 */
export function mergeGreenRollSignal(
  model: GreenHeatModel,
  rolls: GreenRoll[],
): GreenHeatModel {
  if (!rolls || rolls.length === 0) return model;
  const broke = rolls.filter((r) => r.breakSide !== 'straight').map((r) => r.breakSide);
  let dominantBreak: GreenRollSignal['dominantBreak'] = 'straight';
  if (broke.length > 0) {
    const counts = new Map<GreenRoll['breakSide'], number>();
    for (const s of broke) counts.set(s, (counts.get(s) ?? 0) + 1);
    let best: GreenRoll['breakSide'] | null = null;
    let bestN = 0;
    for (const [s, n] of counts) if (n > bestN) { best = s; bestN = n; }
    dominantBreak = best != null && bestN > broke.length / 2 ? best : 'mixed';
  }
  const makeRate = rolls.filter((r) => r.made).length / rolls.length;
  return {
    ...model,
    rollSignal: {
      rolls: rolls.length,
      dominantBreak,
      makeRate: Math.round(makeRate * 100) / 100,
    },
  };
}

/** Color ramp for a 0..1 heat value where HIGHER = BETTER (one-putt conversion).
 *  Cool (low / cold) → warm green (high / hot). Honest legend lives with the viz. */
export function heatColorForRate(rate: number | null): string {
  if (rate == null) return '#2a2f3a'; // no data — neutral slate, never a fake color
  const r = Math.max(0, Math.min(1, rate));
  // 0 → muted blue-slate, 0.5 → amber, 1 → app-bright green.
  if (r < 0.5) {
    // slate → amber
    const t = r / 0.5;
    return lerpColor([0x3b, 0x82, 0xc5], [0xf5, 0x9e, 0x0b], t);
  }
  // amber → green
  const t = (r - 0.5) / 0.5;
  return lerpColor([0xf5, 0x9e, 0x0b], [0x22, 0xc5, 0x5e], t);
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const ch = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(ch(0))}${hex(ch(1))}${hex(ch(2))}`;
}
