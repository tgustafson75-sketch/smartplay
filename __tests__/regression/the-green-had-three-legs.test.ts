/**
 * 2026-09-13 (Tim) — "unify Green logic and everything green related according to course play, GPS, and
 * putting practice. This is another example of scatter when unified engine of truth is the design."
 *
 * He was right, and the scatter was in two specific places.
 *
 * 1. THE SAME FLOOR, TWICE, WITH NO WIRE. `greenHeat.GREEN_HEAT_MIN_HOLES = 9` and
 *    `puttingRead.MIN_PUTT_HOLES = 9` both meant "enough putting holes before we say anything about how
 *    this player putts", both read the SAME raw input (`RoundRecord.putts`), and neither referenced the
 *    other. Tune one and the card renders its heat while the hole plan still calls the read 'forming',
 *    or the reverse. puttingRead owns it now — the floor is a fact about the player's record, and that
 *    is where the rest of the putting scale already lives.
 *
 * 2. THE MEASURED RECORD REACHED A CARD AND NEVER THE CADDIE. The three legs met nowhere:
 *      · COURSE PLAY  services/yardageResolver owns front/middle/back (unified 2026-09-10)
 *      · GPS          smartfinder writes a read to greenReadStore; the payload carries priorGreenRead
 *      · PRACTICE     greenHeat reached GreenHeatCard / PuttReadLine / useGreenHeat and stopped there
 *    So the caddie could recall what a green looked like last time and had no idea the player
 *    three-putts from distance. Asked "how's my putting" he answered from `puttStatsFrom` — one round's
 *    putt count, from the same raw input.
 *
 * A READ and a ROLL stay separate on purpose: a read is a prediction before the stroke, a roll is a CV
 * observation of what the ball did. Merging them to give `rollSignal` a feeder would fabricate. It stays
 * null and honest.
 */
import fs from 'fs';
import path from 'path';
import { MIN_PUTT_HOLES as FLOOR_FROM_READ } from '../../services/puttingRead';
import {
  MIN_PUTT_HOLES as FLOOR_FROM_HEAT,
  buildGreenHeatModel,
  buildPuttingRecordBlock,
} from '../../services/putting/greenHeat';
import { greenHeatInput } from '../../services/putting/greenHeatInput';
import type { RoundRecord } from '../../store/roundStore';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/** n scored holes, each `putts` putts, reached in regulation (score = par, so strokesToGreen = par-putts). */
const round = (n: number, putts: number, id = 'r1'): RoundRecord => {
  const scores: Record<number, number> = {};
  const p: Record<number, number> = {};
  for (let h = 1; h <= n; h++) { scores[h] = 4; p[h] = putts; }
  return { id, courseId: 'c1', scores, putts: p } as unknown as RoundRecord;
};
// CourseHole's field is `hole`, not `hole_number` — the first draft of this fixture used the
// wrong name, every class came back empty, and that is what exposed the null-block defect above.
const HOLES = [...Array(18)].map((_, i) => ({ hole: i + 1, par: 4 })) as never;

describe('the putting floor has one owner', () => {
  it('greenHeat and puttingRead read the SAME constant, not the same number twice', () => {
    expect(FLOOR_FROM_HEAT).toBe(FLOOR_FROM_READ);
    // ...and it is a re-export, not a copy: no second declaration may exist.
    expect(code('services/putting/greenHeat.ts')).not.toMatch(/export const (?:GREEN_HEAT_MIN_HOLES|MIN_PUTT_HOLES)\s*=/);
    expect(code('services/putting/greenHeat.ts')).toMatch(/from '\.\.\/puttingRead'/);
  });

  it('the old surface-specific name is gone everywhere', () => {
    for (const f of ['services/putting/greenHeat.ts', 'components/GreenHeatCard.tsx', 'hooks/useGreenHeat.ts']) {
      expect(code(f)).not.toMatch(/GREEN_HEAT_MIN_HOLES/);
    }
  });

  it('the card gates on that one floor', () => {
    expect(code('components/GreenHeatCard.tsx')).toMatch(/MIN_PUTT_HOLES/);
  });
});

describe('what feeds the model has one owner too', () => {
  it('the hook and the payload both call the shared assembler', () => {
    expect(code('hooks/useGreenHeat.ts')).toMatch(/greenHeatInput\(/);
    expect(code('services/caddieRequestBody.ts')).toMatch(/greenHeatInput\(/);
  });

  it('neither of them re-implements the sim filter or the live-round record', () => {
    // These were the real judgements living inside the hook. A second copy is how the card and the
    // caddie would come to disagree about which rounds count.
    for (const f of ['hooks/useGreenHeat.ts', 'services/caddieRequestBody.ts']) {
      expect(code(f)).not.toMatch(/id: '__live__'/);
    }
    expect(code('services/putting/greenHeatInput.ts')).toMatch(/id: '__live__'/);
  });

  it('simulated rounds never feed the green record', () => {
    const sim = { ...round(18, 2, 'sim'), simulated: true } as unknown as RoundRecord;
    const { rounds } = greenHeatInput({
      roundHistory: [sim], activeCourseId: 'c1', courseHoles: HOLES,
      scores: {}, putts: {}, isRoundActive: false, isSimRound: false,
    });
    expect(rounds).toEqual([]);
  });

  it('the live round folds in only once it has a real logged putt', () => {
    const base = {
      roundHistory: [], activeCourseId: 'c1', courseHoles: HOLES,
      scores: { 1: 4 }, isRoundActive: true, isSimRound: false,
    };
    expect(greenHeatInput({ ...base, putts: {} }).rounds).toEqual([]);
    expect(greenHeatInput({ ...base, putts: { 1: 2 } }).rounds).toHaveLength(1);
  });

  it('a sim round in progress never folds in either', () => {
    const { rounds } = greenHeatInput({
      roundHistory: [], activeCourseId: 'c1', courseHoles: HOLES,
      scores: { 1: 4 }, putts: { 1: 2 }, isRoundActive: true, isSimRound: true,
    });
    expect(rounds).toEqual([]);
  });
});

describe('the measured record reaches the caddie', () => {
  it('says nothing below the shared floor — a class with two holes is noise', () => {
    const thin = buildGreenHeatModel([round(FLOOR_FROM_READ - 1, 2)], { c1: HOLES });
    expect(thin.ready).toBe(false);
    expect(buildPuttingRecordBlock(thin)).toBeNull();
  });

  it('reports putts per hole by how he reached the green, once there is enough', () => {
    const model = buildGreenHeatModel([round(18, 2)], { c1: HOLES });
    expect(model.ready).toBe(true);
    const block = buildPuttingRecordBlock(model)!;
    expect(block).toMatch(/HIS PUTTING RECORD/);
    expect(block).toMatch(/putts\/hole over \d+ holes?/);
    expect(block).toMatch(/2\.00 putts per hole across 18 scored holes/);
  });

  it('still reports the overall record when par cannot be resolved', () => {
    /**
     * The model classifies approach-vs-scramble only where it can read par, and holesByCourse carries
     * the live course only — so rounds elsewhere count toward `overall` and nothing else. An early
     * return on "no class rows" made the block null for exactly those players. Found by probing the
     * real model rather than trusting this test's first fixture.
     */
    const noPar = buildGreenHeatModel([round(18, 2)], {});
    expect(noPar.byClass.approachPutt.holes).toBe(0);
    const block = buildPuttingRecordBlock(noPar)!;
    expect(block).toMatch(/2\.00 putts per hole across 18 scored holes/);
  });

  it('never lets a career rate be quoted at the putt in front of him', () => {
    const block = buildPuttingRecordBlock(buildGreenHeatModel([round(18, 3)], { c1: HOLES }))!;
    expect(block).toMatch(/RECORD, not a read of the green in front of him/);
    expect(block).toMatch(/never quote it as what this putt will do/);
  });

  it('rides the one payload builder and the brain reads it', () => {
    const body = code('services/caddieRequestBody.ts');
    expect(body).toMatch(/puttingRecordBlock: safe\(/);
    expect(body).toMatch(/buildPuttingRecordBlock\(/);
    const k = code('api/kevin.ts');
    expect(k).toMatch(/puttingRecordBlock = null,/);
    expect(k).toMatch(/_puttingRecord: string \| null = capOrNull\(puttingRecordBlock/);
    expect(k).toMatch(/\$\{_puttingRecord \? /);
  });

  it('is a registered cached interpolation, so the ratchet was answered not bypassed', () => {
    expect(code('scripts/simulations/run-sim.ts')).toMatch(/'_puttingRecord',/);
  });
});

describe('a read and a roll stay different facts', () => {
  it('the roll signal is not fed from the green read', () => {
    const heat = code('services/putting/greenHeat.ts');
    expect(heat).not.toMatch(/greenReadStore/);
  });

  it('the roll signal is null while nothing observes a roll — never fabricated', () => {
    const model = buildGreenHeatModel([round(18, 2)], { c1: HOLES });
    expect(model.rollSignal).toBeNull();
  });

  it('the caddie still gets the READ leg separately', () => {
    expect(code('services/caddieRequestBody.ts')).toMatch(/priorGreenRead: safe\(/);
    expect(code('services/caddieRequestBody.ts')).toMatch(/greenReadStore/);
  });
});
