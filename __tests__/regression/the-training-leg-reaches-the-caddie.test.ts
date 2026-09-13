import * as fs from 'fs';
import * as path from 'path';
import { computeWorkoutPerformance } from '../../services/practice/workoutPerformance';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * 2026-09-12 — THE FOURTH COACH HAD NO EVIDENCE.
 *
 * The day-one concept is four vantage points. Three of them got theirs in this sweep: the course
 * read, the measured swing, the emotional pattern. The TRAINING leg had `workoutPerformance` pairing
 * logged workouts against scoring for weeks, with the dashboard as its only importer — drawn,
 * correct, unaskable. The same shape as everything else found here.
 */
const WEEK = 7 * 24 * 60 * 60 * 1000;
const now = 1_700_000_000_000;
// Six weekly buckets, oldest first. Workouts land by date; rounds by endedAt.
const wk = (weeksAgo: number) => now - weeksAgo * WEEK + 1000;

describe('the training leg reaches the caddie', () => {
  const perf = (workoutsPerWeek: number[], scores: number[]) => computeWorkoutPerformance({
    workouts: workoutsPerWeek.flatMap((n, i) =>
      Array.from({ length: n }, () => ({ date: wk(6 - i), durationMin: 45 }))),
    rounds: scores.map((s, i) => ({ endedAt: wk(6 - Math.floor(i * 6 / scores.length)), scoreVsPar: s })),
    nowMs: now,
  });

  it('says nothing until both sides have enough', () => {
    const p = perf([1, 0, 0, 0, 0, 0], [5]);
    expect(p.hasEnough).toBe(false);
    expect(p.connection).toBeNull();
  });

  /** The direction is EXPORTED, so the chart and the caddie read one computation. */
  it('exports the measured direction once enough exists', () => {
    const p = perf([0, 0, 1, 3, 3, 3], [9, 8, 7, 5, 4, 3]);
    expect(p.hasEnough).toBe(true);
    expect(p.connection).not.toBeNull();
    expect(p.connection!.trainingUp).toBe(true);
    expect(p.connection!.trainingLate).toBeGreaterThan(p.connection!.trainingEarly);
    expect(p.connection!.scoreImproving).toBe(true);
  });

  /** A half-point deadband either side, so one round cannot declare a direction. */
  it('holds steady inside the deadband', () => {
    const p = perf([2, 2, 2, 2, 2, 2], [5, 5, 5, 5, 5, 5]);
    expect(p.connection!.scoreImproving).toBe(false);
    expect(p.connection!.scoreWorse).toBe(false);
  });

  /** headline and connection must agree — that is the whole point of exporting it. */
  it('the headline is built FROM the connection, not beside it', () => {
    const src = strip(read('services/practice/workoutPerformance.ts'));
    expect(src).toMatch(/const \{ trainingUp, scoreImproving, scoreWorse \} = connection;/);
    expect(src).toMatch(/if \(!connection\) \{/);
  });

  it('rides the one payload builder and reaches the brain', () => {
    const body = strip(read('services/caddieRequestBody.ts'));
    expect(body).toMatch(/trainingImpactBlock: safe\(/);
    expect(body).toMatch(/computeWorkoutPerformance/);
    const k = strip(read('api/kevin.ts'));
    expect(k).toMatch(/trainingImpactBlock = null,/);
    expect(k).toMatch(/capOrNull\(trainingImpactBlock, \d+\)/);
    expect(k).toMatch(/\$\{_trainingImpact \? `\\n\$\{_trainingImpact\}` : ''\}/);
  });

  /** Cached, so the ratchet had to be told deliberately. */
  it('is registered as a cached interpolation', () => {
    expect(read('scripts/simulations/run-sim.ts')).toMatch(/'_trainingImpact'/);
  });

  /**
   * It sends the measured DIRECTION, never the card's headline — that string is UI copy addressed to
   * the player, and handing it over makes the caddie read the card back instead of talking about it.
   */
  it('sends the facts, not the dashboard copy', () => {
    const body = strip(read('services/caddieRequestBody.ts'));
    // Anchor FIRST. Slicing from an indexOf of -1 returns the whole file, and a `not.toMatch` over a
    // block that does not exist passes for the wrong reason — it did exactly that in the break-test,
    // staying green with the block reverted away entirely. [[break-test-every-guard-you-write]]
    const at = body.indexOf('trainingImpactBlock: safe(');
    expect(at).toBeGreaterThan(-1);
    const fn = body.slice(at, body.indexOf('}, null),', at));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).not.toMatch(/\.headline/);
  });

  /**
   * THE CARRIED HALF IS STATED, NOT SILENTLY DROPPED. workoutSwingImpact (training → STRIKE) is the
   * other half of this question. Its session mapping lives inline in the dashboard, so wiring it from
   * the payload builder would create a second owner of "which swings are graded" — the exact defect
   * this sweep keeps fixing. It needs the selfSwingReads treatment first.
   */
  it('does not copy the strike mapping into a second owner', () => {
    const body = strip(read('services/caddieRequestBody.ts'));
    // Same anchoring point: this only means something while the training block is actually present.
    expect(body).toMatch(/trainingImpactBlock: safe\(/);
    expect(body).not.toMatch(/computeWorkoutSwingImpact/);
    expect(body).not.toMatch(/contact_read/);
  });
});
