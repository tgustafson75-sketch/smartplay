/**
 * 2026-10-27 (Phase SB7 — recheck E-R9-1 of the SB3/SB4 work).
 *
 * BODY_READ_VERSION only arrived on 10-26, and before shotDetail (10-05) a single-swing SmartMotion capture
 * kept swing 1's body read on the SESSION only — the shot has none of its own. SB6 held that session read to
 * today's version stamp, so every such capture from the trend's 8-week window gave tempo only: hips,
 * sequencing and the rest fell out of the earlier weeks, a body metric could drop under the 4-week floor, and
 * the dashboard card and the caddie's trend context lost it — while per-shot reads of the same age still
 * counted. The session read is now held to the per-shot rule: only a demoted swing 1 is dropped.
 */
import { collectSelfTrendSwings, type SwingLibrarySession } from '../../services/practice/selfSwingReads';
import { computeSwingMetricTrend } from '../../services/practice/swingMetricTrend';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 27);

// A pre-10-05 single-swing capture: the body read lives on the session, unstamped; the shot has none.
const oldCapture = (weeksAgo: number): SwingLibrarySession => ({
  date: now - weeksAgo * WEEK - 1000,
  club: '7 iron',
  biomechanics: { hipTurnDeg: 44, sequencingScore: 70 },
  tempo_result: { ratio: 3 },
  shots: [{ club: '7 iron', clipUri: 'file://a.mp4' }],
});

// A post-10-05 capture: swing 1's read is on the shot.
const newCapture = (weeksAgo: number): SwingLibrarySession => ({
  date: now - weeksAgo * WEEK - 1000,
  club: '7 iron',
  tempo_result: { ratio: 3 },
  shots: [{ club: '7 iron', clipUri: 'file://b.mp4', biomechanics: { hipTurnDeg: 45, sequencingScore: 72 } }],
});

describe('an old single-swing capture keeps its body in the trend', () => {
  it('takes an unstamped session read like an unstamped per-shot read', () => {
    const swings = collectSelfTrendSwings([oldCapture(6)]);
    expect(swings).toHaveLength(1);
    expect(swings[0].metrics.hipTurnDeg).toBe(44);
    expect(swings[0].metrics.sequencingScore).toBe(70);
  });

  it('keeps a body metric over the 4-week floor when half the weeks are pre-10-05 captures', () => {
    const sessions = [oldCapture(7), oldCapture(6), newCapture(2), newCapture(1)];
    const keys = computeSwingMetricTrend({ swings: collectSelfTrendSwings(sessions), nowMs: now }).trends.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(['hipTurnDeg', 'sequencingScore', 'tempoRatio']));
  });

  it('still drops it when swing 1 is a demoted practice swing', () => {
    const practice = oldCapture(6);
    practice.shots = [{ club: '7 iron', clipUri: 'file://a.mp4', practice: { reason: 'no_ball_seen' } } as never];
    const swings = collectSelfTrendSwings([practice]);
    expect(swings.map((s) => s.metrics.hipTurnDeg)).toEqual([null]);
    expect(swings.map((s) => s.metrics.tempoRatio)).toEqual([3]);
  });
});
