/**
 * 2026-10-27 (Phase SB6 — recheck E-R7-1 of the SB3/SB4 work).
 *
 * Tim uploads a clip that opens with a practice swing, then hits balls. The read demotes swing 1, but the
 * run's body read still reads the first swing with a clip — the practice swing — and stores it as the
 * SESSION read. Only the shown swing is read on an upload, so swings 2+ usually have no read of their own,
 * and collectSelfTrendSwings fell back to that session read: the practice swing's hip slide and sequencing
 * entered the trend the dashboard draws and the caddie quotes, under swing lists that say it is not his.
 * That fallback also took a read an older build stored, which every screen already refuses to show.
 */
import { collectSelfTrendSwings } from '../../services/practice/selfSwingReads';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';

const practiceRead = { hipTurnDeg: 31, hipSlideRatio: 0.9, sequencingScore: 12 };
const upload = (over: Record<string, unknown> = {}) => ({
  date: Date.now(),
  club: '7 iron',
  analysis_version: BODY_READ_VERSION,
  biomechanics: practiceRead,                            // swing 1's skeleton, written by the run's body read
  shots: [
    { club: '7 iron', clipUri: 'file://a.mp4', practice: { reason: 'no_ball_seen' as const }, biomechanics: practiceRead },
    { club: '7 iron', clipUri: 'file://a.mp4' },          // never paged to: no read of its own
    { club: '7 iron', clipUri: 'file://a.mp4' },
  ],
  ...over,
});

describe('a practice swing never speaks for the body-metric trend', () => {
  it('drops the session read when swing 1 is a demoted practice swing', () => {
    expect(collectSelfTrendSwings([upload()])).toHaveLength(0);
  });

  it('keeps the session tempo, without the practice swing body', () => {
    const swings = collectSelfTrendSwings([upload({ tempo_result: { ratio: 3 } })]);
    expect(swings).toHaveLength(1);
    expect(swings[0].metrics.tempoRatio).toBe(3);
    expect(swings[0].metrics.hipSlideRatio).toBeNull();
    expect(swings[0].metrics.sequencingScore).toBeNull();
  });

  it('uses the session read once the player restores swing 1', () => {
    const restored = upload();
    restored.shots[0] = { ...restored.shots[0], practice: { reason: 'no_ball_seen', restoredByUser: true } as never };
    const swings = collectSelfTrendSwings([restored]);
    expect(swings.map((s) => s.metrics.hipSlideRatio)).toEqual([0.9]);
  });

  it('never takes a session read an older build stored', () => {
    const counted = { shots: [{ club: '7 iron', clipUri: 'file://a.mp4' }] };
    expect(collectSelfTrendSwings([upload({ ...counted, analysis_version: undefined })])).toHaveLength(0);
    expect(collectSelfTrendSwings([upload({ ...counted, analysis_version: BODY_READ_VERSION - 1 })])).toHaveLength(0);
    expect(collectSelfTrendSwings([upload(counted)]).map((s) => s.metrics.hipTurnDeg)).toEqual([31]);
  });
});
