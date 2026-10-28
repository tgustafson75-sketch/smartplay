/**
 * 2026-10-27 (Phase SB7, recheck round 11).
 *
 * SB7 made a practice swing demoted AFTER its read show no fault on the library screen (swingFaultOnScreen).
 * Two places still showed it:
 *   SM-practice-fault: SmartMotion's review took its fault straight from the swing's read (`analysis`), so a
 *     swing found from the video (no heard strike, demotable) kept its Issue chip, Jump-to-issue tick, pause
 *     stop, caption and ring under the reel banner "PRACTICE SWING — NO BALL SEEN · COUNT IT".
 *   lib-practice-row-fault: the library reel row titled "Practice swing — no ball seen" still printed the read's
 *     observation (the fault) and its "See the moment" fault-frame thumbnail, whose modal named the fault.
 *
 * The run's real order, on the real store: the swing's read is stored first, then classifyPracticeSwings'
 * marks demote it (setShotPracticeMarks) and the read is kept. "Count it" brings everything back.
 */
import * as fs from 'fs';
import * as path from 'path';
import { useSwingSessionStore, type SwingSession } from '../../store/swingSessionStore';
import { faultMomentFor, reelRowFaultEvidence, reviewFaultOnScreen } from '../../services/swing/faultSpotlight';

const SID = 'motion_r11';
const read = {
  detected_issue: 'sway', primary_fault: 'sway', severity: 'significant', confidence: 'high',
  observation: 'The hips slide toward the target instead of turning.', fault_frame_index: 2,
  visual_reference_path: 'file:///fault_0.jpg',
};

function seed(): void {
  const shots = [0, 1].map((i) => ({
    id: `${SID}_shot_${i}`, clipUri: 'file:///clip.mp4', clipStartSeconds: i * 5, clipEndSeconds: i * 5 + 4,
    // A swing found from the video (peakDb 0): not 'audio_transient', so the set's read may demote it.
    detectionMethod: 'manual', perShotAnalysis: read, detected_issue_timestamps_sec: [i * 5 + 2],
  }));
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{ id: SID, source: 'live_capture', date: 1, club: '7i', shots, analysis_status: 'ok' } as unknown as SwingSession],
  });
}
const shot0 = () => useSwingSessionStore.getState().sessionHistory[0].shots[0];
const demote = () => useSwingSessionStore.getState().setShotPracticeMarks(SID, { [`${SID}_shot_0`]: { reason: 'no_ball_seen' } });
const countIt = () => useSwingSessionStore.getState().setPracticeSwingRestored(SID, `${SID}_shot_0`, true);

/** SmartMotion's review fault moment for swing 1 (window 0-4s), built exactly as the screen builds it. */
function smartMotionMoment(analysis: typeof read) {
  const faultId = reviewFaultOnScreen(analysis, shot0());
  const ts = shot0().detected_issue_timestamps_sec ?? [];
  const shotFault = shot0().perShotAnalysis?.primary_fault ?? shot0().perShotAnalysis?.detected_issue ?? null;
  return {
    faultId,
    moment: faultMomentFor({
      faultId, readTimestampsSec: !!faultId && shotFault === faultId && ts.length <= 2 ? ts : [],
      anchors: null, windowStartSec: 0, windowEndSec: 4,
    }),
  };
}

beforeEach(seed);

describe('SmartMotion review: a swing demoted after its read', () => {
  it('THE REPORT: swing 1\'s read lands, then the set\'s read demotes it — no fault, no Issue chip, no stop', () => {
    // `analysis` is set when swing 1's read lands, before the set's read settles.
    const analysis = read;
    expect(smartMotionMoment(analysis)).toEqual({ faultId: 'sway', moment: { sec: 2, source: 'read' } });
    demote();
    expect(shot0().perShotAnalysis?.primary_fault).toBe('sway');                     // the read is kept
    // Nothing on the screen clears `analysis`: the gate is the swing's mark.
    expect(smartMotionMoment(analysis)).toEqual({ faultId: null, moment: null });
  });

  it('"Count it" brings the fault, its moment and its stop back', () => {
    demote();
    countIt();
    expect(smartMotionMoment(read)).toEqual({ faultId: 'sway', moment: { sec: 2, source: 'read' } });
  });

  it('guard: a swing that is not practice shows its own fault', () => {
    expect(reviewFaultOnScreen(read, useSwingSessionStore.getState().sessionHistory[0].shots[1])).toBe('sway');
    expect(reviewFaultOnScreen({ ...read, primary_fault: null as never }, shot0())).toBe('sway');
    expect(reviewFaultOnScreen(null, shot0())).toBeNull();
  });
});

describe('library reel row: a swing demoted after its read', () => {
  it('THE REPORT: the row titled "Practice swing" prints no fault observation and offers no fault frame', () => {
    expect(reelRowFaultEvidence(shot0().perShotAnalysis, shot0())).toEqual({
      observation: read.observation, faultUri: 'file:///fault_0.jpg', detectedIssue: 'sway',
    });
    demote();
    expect(reelRowFaultEvidence(shot0().perShotAnalysis, shot0())).toEqual({ observation: '', faultUri: null, detectedIssue: null });
  });

  it('"Count it" brings the observation and the fault frame back (the read was kept)', () => {
    demote();
    countIt();
    expect(reelRowFaultEvidence(shot0().perShotAnalysis, shot0())).toEqual({
      observation: read.observation, faultUri: 'file:///fault_0.jpg', detectedIssue: 'sway',
    });
  });

  it('guard: a swing with no read shows nothing, without throwing', () => {
    expect(reelRowFaultEvidence(undefined, shot0())).toEqual({ observation: '', faultUri: null, detectedIssue: null });
  });
});

/**
 * The wiring half: neither screen can be mounted here (7k-line screens on the camera and the video player), so
 * this pins that each one takes its fault through the owner above and no longer reads it off the raw read.
 */
describe('both screens take the fault through the owner', () => {
  const src = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  it('SmartMotion: the review fault, the overlay ring and the TOP FOCUS card follow the practice mark', () => {
    const sm = src('app/swinglab/smartmotion.tsx');
    expect(sm).toMatch(/const reviewFaultId = reviewFaultOnScreen\(analysis, reviewShot\);/);
    expect(sm).not.toMatch(/faultJointsFor\(analysis\?\.primary_fault/);
    expect(sm).toMatch(/if \(!analysis \|\| reviewIsPractice\) return null;/);
  });
  it('library: the reel row\'s observation and fault frame come from reelRowFaultEvidence', () => {
    const lib = src('app/swinglab/swing/[swing_id].tsx');
    expect(lib).toMatch(/const \{ faultUri, observation, detectedIssue \} = reelRowFaultEvidence\(a, s\);/);
    expect(lib).not.toMatch(/const faultUri = a\?\.visual_reference_path/);
  });
});
