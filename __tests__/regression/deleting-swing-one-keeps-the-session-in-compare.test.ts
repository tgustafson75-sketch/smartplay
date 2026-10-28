/**
 * 2026-10-27 (Phase SB7, recheck round 11 "E-R10-2") — deleting swing 1 cleared the session's body read (R9:
 * it was swing 1's), and nothing wrote it back when swing 2 already held today's read of its own: the shot run
 * writes the session read only from its pose stage, which does not run for a swing that has one. So
 * sessionBodyRead stayed null — the swing page's Compare said "No biomechanics on this swing yet" under a full
 * body read, and the session dropped out of every other swing's reference list until a Re-analyze.
 *
 * Now the new first swing's own current read (and its arc) come up to the session when swing 1 goes. Driven
 * through the real store and the real readers (shotDetail.sessionBodyRead / sessionsToCompare / shownShotBiomech).
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { sessionBodyRead, sessionsToCompare, shownShotBiomech } from '../../services/swing/orchestrator/shotDetail';
import { BODY_READ_VERSION, CLUB_ARC_VERSION } from '../../services/swing/analysisVersion';

const SID = 'set_r11';
const bodyOf = (t: number) => ({ frames: [{ timestampMs: t, keypoints: [] }], angle: 'down_the_line', metric_confidence: {} });
const ONE = bodyOf(1000);
const TWO = bodyOf(5000);
const ARC_TWO = [{ x: 0.1, y: 0.1, tMs: 1 }, { x: 0.2, y: 0.2, tMs: 2 }, { x: 0.3, y: 0.3, tMs: 3 }];
const s = () => useSwingSessionStore.getState().sessionHistory.find((x) => x.id === SID)!;

/** Swing 1's read is on the session; swing 2 was opened, so it holds `two` (and its arc) on the shot. */
function seed(two: Record<string, unknown>): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [
      {
        id: SID, source: 'live_capture', analysis_status: 'ok', club: '7i', date: 2,
        biomechanics: ONE, analysis_version: BODY_READ_VERSION,
        club_arc: [{ x: 0.5, y: 0.5, tMs: 1 }, { x: 0.6, y: 0.6, tMs: 2 }, { x: 0.7, y: 0.7, tMs: 3 }],
        club_arc_source: 'tracker', club_arc_version: CLUB_ARC_VERSION,
        shots: [
          { id: 'sh0', club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: 0, clipEndSeconds: 3 },
          { id: 'sh1', club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: 4, clipEndSeconds: 7, ...two },
          { id: 'sh2', club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: 8, clipEndSeconds: 11 },
        ],
      },
      { id: 'other', source: 'live_capture', club: '7i', date: 1, biomechanics: ONE, analysis_version: BODY_READ_VERSION, shots: [] },
    ] as never,
  });
}

describe('deleting swing 1 when swing 2 holds its own read', () => {
  it('THE REPORT: the session stays in Compare with swing 2\'s read, and its arc comes up with it', () => {
    seed({ biomechanics: TWO, analysis_version: BODY_READ_VERSION, club_arc: ARC_TWO, club_arc_source: 'tracker', club_arc_version: CLUB_ARC_VERSION });
    useSwingSessionStore.getState().deleteShot(SID, 'sh0');
    expect(shownShotBiomech(s(), 0)).toBe(TWO);                       // what the screen draws
    expect(sessionBodyRead(s())).toBe(TWO);                            // what Compare reads — the same swing
    expect(sessionsToCompare(useSwingSessionStore.getState().sessionHistory, 'other').map((x) => x.id)).toEqual([SID]);
    expect(s().club_arc).toEqual(ARC_TWO);
    expect(s().club_arc_version).toBe(CLUB_ARC_VERSION);
    expect(s().fault_frame_uri ?? null).toBeNull();                    // swing 1's fault frame still goes (R9)
  });

  it('guard: a swing 2 with no read of its own brings nothing up — swing 1\'s read is not left behind (R9)', () => {
    seed({});
    useSwingSessionStore.getState().deleteShot(SID, 'sh0');
    expect(sessionBodyRead(s())).toBeNull();
    expect(s().club_arc).toBeUndefined();
  });

  it('guard: an older build\'s read on swing 2 is unread, so it is not promoted', () => {
    seed({ biomechanics: TWO, analysis_version: BODY_READ_VERSION - 1 });
    useSwingSessionStore.getState().deleteShot(SID, 'sh0');
    expect(sessionBodyRead(s())).toBeNull();
    expect(s().biomechanics).toBeUndefined();
  });

  it('guard: deleting a later swing leaves the session read swing 1\'s', () => {
    seed({ biomechanics: TWO, analysis_version: BODY_READ_VERSION });
    useSwingSessionStore.getState().deleteShot(SID, 'sh1');
    expect(sessionBodyRead(s())).toBe(ONE);
  });
});
