/**
 * 2026-10-15 (review) — the live scorecard and the saved record disagreed.
 *
 *  (4) vs-par: the card summed EVERY scored hole's strokes but only the KNOWN pars, and a par of 0
 *      counted as known. Three holes scored 5/5/5 with pars 4/4/unknown read +7 on the card; the store
 *      (getScoreVsPar, which builds the record) says +2.
 *  (5) avg putts divided by every scored hole instead of the holes with putts; GIR judged holes
 *      against a placeholder par 4 or a par of 0.
 * The card now computes all three through services/round/scoredRoundStats — the caddie's owner.
 */
import * as fs from 'fs';
import * as path from 'path';
import { puttStatsFrom, isGirHole, nineSplitFrom } from '../../services/round/scoredRoundStats';
type VsPar = (r: unknown, lo?: number, hi?: number) => { vs: number | null };
// Runtime lookup so this compiles (and fails on behaviour) against the pre-fix module.
const vsParFrom: VsPar = (r, lo, hi) => (require('../../services/round/scoredRoundStats') as { vsParFrom: VsPar }).vsParFrom(r, lo, hi);
import { useRoundStore } from '../../store/roundStore';

const pars: Record<number, number> = { 1: 4, 2: 4, 3: 0 };
const round = { scores: { 1: 5, 2: 5, 3: 5 }, putts: { 1: 2 }, parOf: (h: number) => pars[h] ?? null };

describe('the card computes what the record stores', () => {
  it('vs-par is per hole over known pars > 0, matching roundStore.getScoreVsPar', () => {
    expect(vsParFrom(round).vs).toBe(2);
    useRoundStore.setState({
      isRoundActive: true, scores: round.scores,
      courseHoles: [{ hole: 1, par: 4 }, { hole: 2, par: 4 }, { hole: 3, par: 0 }],
    } as never);
    expect(useRoundStore.getState().getScoreVsPar()).toBe(2);
  });

  it('no known par → null, not level', () => {
    expect(vsParFrom({ scores: { 1: 5 }, putts: {}, parOf: () => null }).vs).toBeNull();
    expect(vsParFrom({ scores: { 1: 5 }, putts: {}, parOf: () => 0 }).vs).toBeNull();
  });

  it('a nine split uses the same rule', () => {
    expect(nineSplitFrom(round, 1, 9).vs).toBe(2);
    expect(nineSplitFrom(round, 1, 9).strokes).toBe(15);
  });

  it('avg putts is over holes with a recorded count', () => {
    expect(puttStatsFrom(round).avg).toBe(2);
  });

  it('a par of 0 cannot be judged for GIR', () => {
    expect(isGirHole(4, 2, 0)).toBeNull();
  });

  it('the scorecard reads those owners instead of its own sums', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/scorecard.tsx'), 'utf8');
    expect(src).toMatch(/const vsPar = vsParFrom\(/);
    expect(src).toMatch(/const scoreVsPar: number \| null = vsPar\.vs;/);
    expect(src).toMatch(/const avgPutts = puttStatsFrom\(/);
    expect(src).toMatch(/isGirHole\(score as number, \(viewPutts as Record<number, number>\)\[hole\], knownParOf\(hole\)\)/);
    expect(src).not.toMatch(/totalScore - totalPar/);
  });
});
