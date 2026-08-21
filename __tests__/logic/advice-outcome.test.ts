/**
 * The caddie learning whether its OWN advice was right.
 *
 * 2026-08-21. The intelligence loop was severed here: advice was recorded, the outcome was recorded,
 * the two were paired — and the only consumer in the app computed an adherence RATE for a post-round
 * recap. That measures whether the player OBEYED, not whether the call was GOOD.
 *
 * The tests that matter most below are the exclusions. A caddie that learns from mis-hit shots will
 * drift toward recommending clubs that flatter a player's misses, which is the opposite of the job.
 */
import { adviceOutcomes, describeAdviceOutcome, describeAdviceCalibration, type AdviceShot } from '../../services/adviceOutcome';

const norm = (s: string | null | undefined) => (s ? s.toLowerCase().trim() : null);
const bag = (yds: Record<string, number>) => (club: string) => yds[club] ?? null;

const clean = (over: Partial<AdviceShot> = {}) => ({
  club: '7 iron', kevin_rec_club: '7 iron', kevin_adhered: true,
  feel: 'flush' as const, direction: 'straight' as const, gps_distance_yards: 150, ...over,
});

describe('only shots that actually tested the DECISION count', () => {
  it('ignores a shot the caddie never called', () => {
    const r = adviceOutcomes([clean({ kevin_rec_club: null, kevin_adhered: null })], bag({}), norm);
    expect(r).toEqual([]);
  });

  it('ignores a shot where the player played a DIFFERENT club', () => {
    // A different decision was executed, so it tests nothing about the caddie's call.
    const r = adviceOutcomes([clean({ kevin_adhered: false, club: '8 iron' })], bag({}), norm);
    expect(r).toEqual([]);
  });

  it('IGNORES MIS-HITS — the single most important exclusion here', () => {
    // A chunked 7-iron says nothing about whether 7-iron was right. Counting it would teach the
    // caddie to club up for bad strikes, i.e. to chase outcomes instead of judging decisions.
    const mishits = (['fat', 'thin', 'topped', 'heel', 'toe'] as const)
      .map(feel => clean({ feel, gps_distance_yards: 120 }));
    expect(adviceOutcomes(mishits, bag({ '7 iron': 150 }), norm)).toEqual([]);
  });

  it('collapses club vocabularies so evidence is not split across rows', () => {
    const r = adviceOutcomes(
      [clean({ kevin_rec_club: '7 Iron' }), clean({ kevin_rec_club: '7 iron' }),
       clean({ kevin_rec_club: '7 IRON' }), clean({ kevin_rec_club: '7 iron' })],
      bag({ '7 iron': 150 }), norm);
    expect(r).toHaveLength(1);
    expect(r[0].n).toBe(4);
  });
});

describe('calibration — the caddie discovers its own distance error', () => {
  const shortShots = Array.from({ length: 5 }, () => clean({ gps_distance_yards: 138 }));

  it('detects that it has been under-clubbing this player', () => {
    const [o] = adviceOutcomes(shortShots, bag({ '7 iron': 150 }), norm);
    expect(o.playedYds).toBe(138);
    expect(o.expectedYds).toBe(150);
    expect(o.deltaYds).toBe(-12);
    expect(describeAdviceOutcome(o)).toMatch(/SHORTER.*under-clubbing/);
  });

  it('says NOTHING when the call is already right', () => {
    const onTarget = Array.from({ length: 5 }, () => clean({ gps_distance_yards: 149 }));
    const [o] = adviceOutcomes(onTarget, bag({ '7 iron': 150 }), norm);
    expect(o.deltaYds).toBe(-1);
    expect(describeAdviceOutcome(o)).toBeNull();
  });

  it('stays silent below the evidence bar, however lopsided the sample looks', () => {
    const three = Array.from({ length: 3 }, () => clean({ gps_distance_yards: 130 }));
    const [o] = adviceOutcomes(three, bag({ '7 iron': 150 }), norm);
    expect(o.n).toBe(3);
    expect(describeAdviceOutcome(o)).toBeNull();
  });

  it('reports an aim error on shots that were struck WELL', () => {
    const leftMisses = Array.from({ length: 5 }, () => clean({ direction: 'left', gps_distance_yards: 150 }));
    const [o] = adviceOutcomes(leftMisses, bag({ '7 iron': 150 }), norm);
    expect(o.missSide).toBe('left');
    expect(describeAdviceOutcome(o)).toMatch(/finish left/);
  });
});

describe('the line is addressed to the caddie, never as blame at the player', () => {
  it('phrases distance error as the caddie\'s club selection', () => {
    const [o] = adviceOutcomes(Array.from({ length: 5 }, () => clean({ gps_distance_yards: 138 })), bag({ '7 iron': 150 }), norm);
    const line = describeAdviceOutcome(o)!;
    expect(line).toMatch(/you have been under-clubbing him/);
    // Never framed as the player failing to reach.
    expect(line).not.toMatch(/he comes up short|you came up short/i);
  });

  it('emits nothing at all rather than filler when nothing is established', () => {
    expect(describeAdviceCalibration([])).toEqual([]);
    const weak = adviceOutcomes([clean(), clean()], bag({ '7 iron': 150 }), norm);
    expect(describeAdviceCalibration(weak)).toEqual([]);
  });
});
