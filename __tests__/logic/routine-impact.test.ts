/**
 * 2026-08-24 (Tim — "it would be great if the user knows if shots are verifiably better when doing
 * their routine").
 *
 * Every app tells a golfer to have a pre-shot routine. None shows them their own evidence. The
 * signal cost nothing new: services/shotDetectionService has always measured how long the player
 * stood still over the ball (it must — stillness is what identifies a shot), and threw it away.
 *
 * These cases exist for the HONESTY, which is most of the file: self-relative rather than a
 * universal number of seconds, quiet until both ends carry enough graded shots, a null result
 * reported as a null result, and ungraded strikes excluded from both ends rather than counted as
 * misses.
 */
import { routineImpact, MIN_PER_GROUP, MEANINGFUL_DELTA_PCT } from '../../services/practice/routineImpact';

/** n shots at `dwellSec` over the ball, `cleanCount` of them struck clean. */
const shots = (n: number, dwellSec: number, cleanCount: number) =>
  Array.from({ length: n }, (_, i) => ({
    pre_shot_dwell_ms: dwellSec * 1000 + i,       // +i keeps the sort stable and the terciles clean
    feel: i < cleanCount ? 'flush' : 'thin',
  }));

describe('does the routine actually show up in the strike', () => {
  it('stays QUIET until there are enough timed, graded shots — and says how short it is', () => {
    const r = routineImpact(shots(10, 12, 5));
    expect(r.status).toBe('quiet');
    if (r.status === 'quiet') expect(r.reason).toMatch(/of \d+ timed shots/);
  });

  it('reports the difference when the slow third strikes it better', () => {
    const r = routineImpact([...shots(15, 3, 3), ...shots(15, 8, 8), ...shots(15, 14, 13)]);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.unhurriedPct).toBeGreaterThan(r.rushedPct);
    expect(r.deltaPct).toBeGreaterThan(0);
    expect(r.line).toMatch(/take your time/i);
  });

  it('says plainly when the routine is NOT showing up — a null result is a result', () => {
    const r = routineImpact([...shots(15, 3, 9), ...shots(15, 8, 9), ...shots(15, 14, 9)]);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(Math.abs(r.deltaPct)).toBeLessThan(MEANINGFUL_DELTA_PCT);
    expect(r.line).toMatch(/no real difference/i);
  });

  it('is honest when the player is BETTER stepping up quick', () => {
    const r = routineImpact([...shots(15, 3, 14), ...shots(15, 8, 8), ...shots(15, 14, 3)]);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.deltaPct).toBeLessThan(0);
    expect(r.line).toMatch(/quick/i);
  });

  it('is SELF-RELATIVE — a fast player and a slow player both get an answer', () => {
    const fast = routineImpact([...shots(15, 1, 3), ...shots(15, 2, 8), ...shots(15, 4, 13)]);
    const slow = routineImpact([...shots(15, 20, 3), ...shots(15, 35, 8), ...shots(15, 50, 13)]);
    expect(fast.status).toBe('ready');
    expect(slow.status).toBe('ready');
    // Neither is judged against a universal "correct" number of seconds over the ball.
    if (fast.status === 'ready' && slow.status === 'ready') {
      expect(fast.deltaPct).toBeGreaterThan(0);
      expect(slow.deltaPct).toBeGreaterThan(0);
    }
  });

  it('EXCLUDES ungraded strikes from both ends instead of counting them as misses', () => {
    const graded = [...shots(15, 3, 3), ...shots(15, 8, 8), ...shots(15, 14, 13)];
    const withUngraded = [...graded, ...Array.from({ length: 30 }, (_, i) => ({ pre_shot_dwell_ms: 9000 + i, feel: null }))];
    const a = routineImpact(graded);
    const b = routineImpact(withUngraded);
    expect(a.status).toBe('ready');
    expect(b.status).toBe('ready');
    if (a.status === 'ready' && b.status === 'ready') {
      expect(b.unhurriedPct).toBe(a.unhurriedPct);   // the ungraded shots changed nothing
      expect(b.rushedPct).toBe(a.rushedPct);
    }
  });

  it('ignores shots with no measured dwell — a manually logged shot cannot be judged', () => {
    const r = routineImpact([...shots(15, 3, 3), ...shots(15, 8, 8), ...shots(15, 14, 13),
      ...Array.from({ length: 40 }, () => ({ pre_shot_dwell_ms: null, feel: 'flush' }))]);
    expect(r.status).toBe('ready');
    if (r.status === 'ready') expect(r.unhurriedShots).toBe(15);
  });

  it('each end carries at least the minimum it promised', () => {
    const r = routineImpact([...shots(15, 3, 3), ...shots(15, 8, 8), ...shots(15, 14, 13)]);
    if (r.status !== 'ready') throw new Error('expected ready');
    expect(r.unhurriedShots).toBeGreaterThanOrEqual(MIN_PER_GROUP);
    expect(r.rushedShots).toBeGreaterThanOrEqual(MIN_PER_GROUP);
  });

  it('never throws on junk', () => {
    expect(() => routineImpact([])).not.toThrow();
    expect(() => routineImpact(null as never)).not.toThrow();
    expect(() => routineImpact([{ pre_shot_dwell_ms: NaN, feel: 'flush' }])).not.toThrow();
    expect(routineImpact([]).status).toBe('quiet');
  });
});
