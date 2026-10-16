/**
 * 2026-10-15 (review) — roundStore.getHoleStats returned `putts: s.putts[hole] ?? 0`.
 *
 * Every hole scored without a putt count read as a ZERO-putt hole, and four readers took it at face
 * value: the caddie payload ("0 putts/hole", three-putts never counted), the play profile's putts per
 * round, and endRound → caddie memory, which rolled the zeros into each hole's puttsAvg /
 * threePuttRate PERMANENTLY — so the caddie said "you average 0 putts here" and never warned about a
 * green he three-putts.
 */
import { useRoundStore } from '../../store/roundStore';
import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';
// Looked up at runtime so this file still compiles (and FAILS on behaviour) against the pre-fix store.
const resetPollutedPuttAggregates = (players: unknown) =>
  (require('../../store/caddieMemoryStore') as Record<string, (p: unknown) => void>).resetPollutedPuttAggregates(players);
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));

function playThreeHoles() {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Putt GC', card as never, {
    nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'putt-gc',
  } as never);
  const r = useRoundStore.getState();
  r.logScore(1, 6);
  r.logPutts(1, 3);   // the one hole he answered — a three-putt
  r.logScore(2, 4);   // no putts entered
  r.logScore(3, 5);   // no putts entered
}

describe('an unentered putt count is unknown, not zero', () => {
  beforeEach(playThreeHoles);

  it('getHoleStats reports null putts for a hole with no answer', () => {
    const stats = useRoundStore.getState().getHoleStats();
    expect(stats.find((h) => h.hole === 1)?.putts).toBe(3);
    expect(stats.find((h) => h.hole === 2)?.putts).toBeNull();
    expect(stats.find((h) => h.hole === 3)?.putts).toBeNull();
  });

  it('the caddie payload averages putts over the answered holes only', () => {
    const rs = buildCaddieRequestBody({ message: 'x', language: 'en' }).roundStats as Record<string, unknown>;
    expect(rs.holesPlayed).toBe(3);
    expect(rs.puttsPerHole).toBe(3);         // not 1 (3 putts ÷ 3 holes)
    expect(rs.threePutts).toBe(1);
    const last = rs.lastThreeHoles as { hole: number; putts: number | null }[];
    expect(last.find((h) => h.hole === 2)?.putts).toBeNull();
  });

  it('endRound does not teach caddie memory a zero-putt hole', () => {
    useCaddieMemoryStore.setState({ players: {} } as never);
    useRoundStore.getState().endRound();
    const course = useCaddieMemoryStore.getState().getPlayer().courses['putt-gc'];
    expect(course).toBeDefined();
    expect(course.holes[2].puttsAvg).toBeNull();
    expect(course.holes[2].threePuttRate).toBeNull();
    expect(course.holes[1].puttsAvg).toBe(3);
    expect(course.holes[1].threePuttRate).toBe(1);
  });
});

describe('caddie memory already polluted by zeros is reset, not trusted', () => {
  it('the v3 migration clears putting aggregates and keeps everything else', () => {
    const players = {
      me: { courses: { c: { holes: { 4: { hole: 4, played: 6, scoringAvg: 4.8, puttsAvg: 0.67, threePuttRate: 0, girRate: 0.5, fairwayRate: null } } } } },
    } as never;
    resetPollutedPuttAggregates(players);
    const h = (players as { me: { courses: { c: { holes: Record<number, Record<string, unknown>> } } } }).me.courses.c.holes[4];
    expect(h.puttsAvg).toBeNull();
    expect(h.threePuttRate).toBeNull();
    expect(h.scoringAvg).toBe(4.8);
    expect(h.girRate).toBe(0.5);
  });

  it('after a reset the putts average counts only rounds that reported putts', () => {
    useCaddieMemoryStore.setState({ players: {} } as never);
    const rec = (putts: number | null) => useCaddieMemoryStore.getState().recordRoundEnd({
      round_id: `r${Math.random()}`, course_id: 'c2', course_name: 'C2', nowMs: 1,
      holes: [{ hole: 1, par: 4, score: 5, putts }],
    });
    rec(null); rec(null); rec(2); rec(3);
    const h = useCaddieMemoryStore.getState().getPlayer().courses['c2'].holes[1];
    expect(h.puttsAvg).toBe(2.5);   // (2 + 3) / 2 — not weighted by the two visits with no answer
  });
});
