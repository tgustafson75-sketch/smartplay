/**
 * 2026-09-29 (Tim: "in a live round, need an option to show pace of play, which could show how user
 * plays in these conditions"). Nothing recorded hole times or computed pace before today.
 * services/paceOfPlay is the one owner: the optional round-bar line and the caddie's `pace` context
 * both read it. roundStore now stamps when each hole was first reached.
 */
jest.mock('../../services/roundPrefetch', () => ({ prefetchRoundData: jest.fn(async () => 0) }));

import fs from 'fs';
import path from 'path';
import {
  computeLivePace, paceHistory, paceLine, formatElapsed, paceContext,
  PACE_BENCHMARK_MIN_PER_HOLE, PACE_HISTORY_MIN_ROUNDS, paceLineForBrain,
} from '../../services/paceOfPlay';
import { useRoundStore } from '../../store/roundStore';

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 29, 15, 0);

describe('live pace', () => {
  it('no rate until a hole is complete — one hole in, a per-hole rate is noise', () => {
    const p = computeLivePace({ roundStartTime: T0, holeStartedAt: { 1: T0 }, currentHole: 1, firstHole: 1, lastHole: 18, now: T0 + 9 * MIN });
    expect(p?.minPerHole).toBeNull();
    expect(p?.projectedFinishAt).toBeNull();
    expect(formatElapsed(p!.elapsedMin)).toBe('0:09');
  });

  it('rate from the time it took to REACH the current hole, projected over what is left', () => {
    // 6 holes done in 90 minutes → 15 min/hole; on the 7th tee at T0+90.
    const p = computeLivePace({ roundStartTime: T0, holeStartedAt: { 1: T0, 7: T0 + 90 * MIN }, currentHole: 7, firstHole: 1, lastHole: 18, now: T0 + 95 * MIN })!;
    expect(p.holesCompleted).toBe(6);
    expect(p.minPerHole).toBeCloseTo(15, 5);
    expect(p.vsBenchmarkMin).toBeCloseTo((15 - PACE_BENCHMARK_MIN_PER_HOLE) * 6, 5);
    expect(p.projectedFinishAt).toBe(T0 + 90 * MIN + 12 * 15 * MIN);
    expect(paceLine(p, () => '7:30')).toBe('1:35 · 15.0 min/hole · done ~7:30');
  });

  it('is nine-hole and back-nine aware', () => {
    const back9 = computeLivePace({ roundStartTime: T0, holeStartedAt: { 10: T0, 13: T0 + 45 * MIN }, currentHole: 13, firstHole: 10, lastHole: 18, now: T0 + 46 * MIN })!;
    expect(back9.holesCompleted).toBe(3);
    expect(back9.holesInRound).toBe(9);
    expect(back9.projectedFinishAt).toBe(T0 + 45 * MIN + 6 * 15 * MIN);
  });

  it('nothing to say without a round start', () => {
    expect(computeLivePace({ roundStartTime: null, holeStartedAt: {}, currentHole: 3, firstHole: 1, lastHole: 18, now: T0 })).toBeNull();
  });
});

describe('how he scores when it drags — honest below the floor', () => {
  const r = (perHoleMin: number, vsPar: number) => ({ startedAt: T0, endedAt: T0 + perHoleMin * 18 * MIN, holesPlayed: 18, scoreVsPar: vsPar });
  it('says what it has and what it needs, never a bare null', () => {
    const h = paceHistory([r(18, 20)]);
    expect(h.slowVsParPerHole).toBeNull();
    expect(h.note).toMatch(/1 timed round so far \(1 slow, 0 at a normal pace\)/);
    expect(h.note).toMatch(new RegExp(`${PACE_HISTORY_MIN_ROUNDS} of each`));
  });
  it('compares once there are enough of each', () => {
    const h = paceHistory([r(18, 20), r(17, 18), r(13, 12), r(14, 14)]);
    expect(h.slowVsParPerHole).toBeCloseTo(19 / 18, 5);
    expect(h.normalVsParPerHole).toBeCloseTo(13 / 18, 5);
  });
  it('a round left open overnight is not a pace reading', () => {
    expect(paceHistory([r(120, 10)]).slowRounds).toBe(0);
  });
});

describe('the round records when each hole started', () => {
  it('startRound stamps the first hole; moving on stamps the next; a revisit keeps the first stamp', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 })) as never;
    useRoundStore.getState().startRound('Test', holes, { nineHoleMode: false, isCompetition: false, notes: '', goal: null, courseId: 't', courseLocation: null } as never);
    const s0 = useRoundStore.getState();
    expect(Object.keys(s0.holeStartedAt)).toEqual(['1']);
    useRoundStore.getState().setCurrentHole(2);
    const at2 = useRoundStore.getState().holeStartedAt[2];
    expect(typeof at2).toBe('number');
    // Played hole 2 for ten minutes, went back to fix hole 1's score, came forward: 2 keeps its stamp.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(at2 + 10 * MIN);
    try {
      useRoundStore.getState().setCurrentHole(1);
      useRoundStore.getState().setCurrentHole(2);
      expect(useRoundStore.getState().holeStartedAt[2]).toBe(at2);
    } finally { nowSpy.mockRestore(); }
  });

  it('THE BUG: a quick look ahead does not become the next hole\'s start', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 })) as never;
    let now = T0;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      useRoundStore.getState().startRound('Test', holes, { nineHoleMode: false, isCompetition: false, notes: '', goal: null, courseId: 't', courseLocation: null } as never);
      now += 5 * MIN; useRoundStore.getState().setCurrentHole(2);   // on the tee of 2
      now += 20_000;  useRoundStore.getState().setCurrentHole(3);   // peek at 3 with the arrow
      now += 20_000;  useRoundStore.getState().setCurrentHole(2);   // back to 2
      now += 12 * MIN; useRoundStore.getState().setCurrentHole(3);  // really arrive at 3
      expect(useRoundStore.getState().holeStartedAt[3]).toBe(now);
    } finally { nowSpy.mockRestore(); }
  });
});

describe('the caddie hears the same pace the bar shows', () => {
  it('paceContext is the live numbers + history, and null off-round', () => {
    const base = { roundStartTime: T0, holeStartedAt: { 1: T0, 7: T0 + 90 * MIN }, currentHole: 7, firstHole: 1, lastHole: 18, history: [], now: T0 + 95 * MIN };
    expect(paceContext({ ...base, isRoundActive: false })).toBeNull();
    const c = paceContext({ ...base, isRoundActive: true })!;
    expect(c.elapsed).toBe('1:35');
    expect(c.minPerHole).toBe(15);
  });
  it('the brain line renders it, and says nothing when there is nothing', () => {
    expect(paceLineForBrain(null)).toBe('');
    const line = paceLineForBrain({ elapsed: '1:35', holesCompleted: 6, minPerHole: 15, vsBenchmarkMin: 5, projectedFinish: '7:30', history: { note: '1 timed round so far' } });
    expect(line).toMatch(/Pace of play: 1:35 elapsed \| 15 min\/hole over 6 holes \| 5 min behind a 4:15 pace \| projected finish ~7:30 \| history: 1 timed round so far/);
  });
  it('the payload carries it and the tab reads the same owner', () => {
    const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code('services/caddieRequestBody.ts')).toMatch(/pace: safe\(\(\) => \{[\s\S]{0,200}?pace\.paceContext\(/);
    expect(code('app/(tabs)/caddie.tsx')).toMatch(/computeLivePace\(\{/);
    expect(code('app/(tabs)/caddie.tsx')).toMatch(/paceLine=\{paceLineText\}/);
    expect(code('api/kevin.ts')).toMatch(/\$\{paceLineForBrain\(pace\)\}/);
  });
});

describe('the round data view (the v2 cockpit, one tap away)', () => {
  const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('is a registered route that renders the cockpit with the ONE global mic', () => {
    const route = code('app/round/data.tsx');
    expect(route).toMatch(/<CockpitCaddieScreen/);
    expect(route).toMatch(/listeningSession'\)[^\n]*\)\.toggle\(\)/);
    expect(code('app/_layout.tsx')).toMatch(/name="round\/data"/);
  });
  it('the Caddie tab opens it, during a round only', () => {
    expect(code('app/(tabs)/caddie.tsx')).toMatch(/\{isRoundActive \? \(\s*<TouchableOpacity[\s\S]{0,600}?router\.push\('\/round\/data' as never\)/);
  });
});
