import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useSwingSessionStore, OTHER_PLAYER_ID } from '../../store/swingSessionStore';
import { collectSelfTrendSwings } from '../../services/practice/selfSwingReads';

/**
 * 2026-09-12 (Tim — the day-one concept) — "if you wanna talk to your swing coach… I open the app
 * to talk about my swing or feel, which is where feel as a dynamic came from, and I don't think
 * it's wired in elementally like that, where it's supposed to go through a filter and go, well,
 * yes, that's how it feels. Does that have a quantifiable repeatable element to it?"
 *
 * It was not. NOT ONE biomech value reached the brain: the payload's entire swing half was
 * `recentCageSessions` (date, club, a shot COUNT) and two prose fields. The swing library has
 * stored per-shot biomech all along, services/swingBenchmarks holds the tour reference bands, and
 * services/practice/swingMetricTrend grades one against the other — with app/(tabs)/dashboard.tsx
 * as its only reader. A swing coach you can talk to, who could not see the swing.
 */

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Five weeks of readable range sessions — enough for the trend's four-weeks-with-data bar. */
const setUpFiveWeeksOfReads = (hipByWeek = [52, 49, 44, 40, 37]) => {
  const now = Date.now();
  useSwingSessionStore.setState({
    sessionHistory: hipByWeek.map((hip, i) => ({
      id: `s${i}`,
      date: now - (hipByWeek.length - 1 - i) * WEEK,
      club: '7 iron',
      tempo_result: { ratio: 2.6 },
      shots: [{ club: '7 iron', biomechanics: { hipTurnDeg: hip, shoulderTurnDeg: 88, weightShiftPct: 74 } }],
    })),
  } as never);
  return now;
};

describe('the caddie can see the measured swing', () => {
  it('sends the reading, the tour-band verdict and the direction', () => {
    setUpFiveWeeksOfReads();
    const block = buildCaddieRequestBody({ message: 'my hips feel stuck', language: 'en' })
      .measuredSwingBlock as string | null;
    expect(typeof block).toBe('string');
    expect(block).toMatch(/THEIR MEASURED SWING/);
    expect(block).toMatch(/latest read/);
    expect(block).toMatch(/tour band/);
    expect(block).toMatch(/improving|regressing|steady/);
  });

  /**
   * The raw number rides along with the grade on purpose. "Outside the band" is a verdict; a
   * reading he can check is a fact he can argue with, and a player who cannot check you learns to
   * distrust the number.
   */
  it('carries a real reading, not just a grade', () => {
    setUpFiveWeeksOfReads();
    const block = buildCaddieRequestBody({ message: 'x', language: 'en' }).measuredSwingBlock as string;
    expect(block).toMatch(/latest read \d/);
  });

  /** swingMetricTrend marks its framing mandatory for any surface that renders this. */
  it('carries the mandatory tour-band framing', () => {
    setUpFiveWeeksOfReads();
    const block = buildCaddieRequestBody({ message: 'x', language: 'en' }).measuredSwingBlock as string;
    expect(block.toLowerCase()).toMatch(/tour/);
    expect(block).toMatch(/^THEIR MEASURED SWING \(private; .+\):/);
  });

  it('stays null rather than grading a swing that was never captured', () => {
    useSwingSessionStore.setState({ sessionHistory: [] } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).measuredSwingBlock).toBeNull();
  });

  it('stays null while there are too few weeks to call a direction', () => {
    const now = Date.now();
    useSwingSessionStore.setState({
      sessionHistory: [
        { id: 'a', date: now, club: '7 iron', shots: [{ club: '7 iron', biomechanics: { hipTurnDeg: 44 } }] },
      ],
    } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).measuredSwingBlock).toBeNull();
  });
});

describe('one owner of which measured swings are his', () => {
  /**
   * In Family/Coach mode a student's swings land in this same history. Drawing their hip turn as
   * the owner's regression would be worse than showing nothing at all — so the filter that
   * protected the dashboard graph had to travel with the assembly, not be left behind in it.
   */
  it('never reads another golfer\'s swings as the owner\'s', () => {
    const now = Date.now();
    const swings = collectSelfTrendSwings([
      // null player_id is a legacy session and resolves to the account holder BY DESIGN, so that
      // no existing swing moves out of his library. Only an explicitly-tagged golfer is excluded.
      { date: now, player_id: null, club: '7 iron', shots: [{ club: '7 iron', biomechanics: { hipTurnDeg: 44 } }] },
      { date: now, player_id: OTHER_PLAYER_ID, club: '7 iron', shots: [{ club: '7 iron', biomechanics: { hipTurnDeg: 61 } }] },
    ]);
    expect(swings).toHaveLength(1);
    expect(swings[0].metrics.hipTurnDeg).toBe(44);
  });

  it('prefers per-shot reads over the session summary, and carries tempo onto each', () => {
    const now = Date.now();
    const swings = collectSelfTrendSwings([{
      date: now,
      club: '7 iron',
      tempo_result: { ratio: 3.1 },
      biomechanics: { hipTurnDeg: 99 },
      shots: [
        { club: '7 iron', biomechanics: { hipTurnDeg: 44 } },
        { club: '7 iron', biomechanics: { hipTurnDeg: 46 } },
      ],
    }]);
    expect(swings.map((s) => s.metrics.hipTurnDeg)).toEqual([44, 46]);
    // The session-level 99 must not speak for two measured balls.
    expect(swings.every((s) => s.metrics.tempoRatio === 3.1)).toBe(true);
  });

  it('falls back to the session read when no shot could be graded', () => {
    const now = Date.now();
    const swings = collectSelfTrendSwings([{
      date: now, club: 'driver', biomechanics: { hipTurnDeg: 50 }, shots: [{ club: 'driver', biomechanics: null }],
    }]);
    expect(swings).toHaveLength(1);
    expect(swings[0].metrics.hipTurnDeg).toBe(50);
  });

  it('contributes nothing for a session with nothing readable in it', () => {
    expect(collectSelfTrendSwings([{ date: Date.now(), club: '7 iron' }])).toHaveLength(0);
  });
});
