/**
 * 2026-10-27 (Phase SB6 — recheck R4-1 of the SB3/SB4 work).
 *
 * Tim opens a swing saved before 10-26 and does not tap Re-analyze. Swing 1 is shown, Body / Trace / Issue
 * off. SB4x made its stored body read unread (an older build stored it), so nothing is drawn from it — and
 * the fault moment lost its anchors with it. Swing 1 with everything off asks for nothing (the library is
 * manual), and a legacy swing's stored fault time is missing or the fabricated array (>2 entries, dropped).
 * So the moment was null: no Issue chip, no seek-bar marks, no fault pause, no Fault-moment card — until he
 * scrolled far below the video and tapped "Read it again".
 *
 * Now the moment is timed by the older read's frames (anchors only — nothing drawn, nothing named) until
 * today's read lands (shotDetail.shownSwingTimingFrames, the library screen's motionAnchors).
 */
import fs from 'fs';
import path from 'path';
import { anchorsFromPoseFrames } from '../../services/swing/poseMotion';
import { faultMomentFor, swingFaultOnScreen } from '../../services/swing/faultSpotlight';
import * as shotDetail from '../../services/swing/orchestrator/shotDetail';

const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/** A swing's wrists: address low, the top, back down at impact, up again at the finish (image y grows down). */
const kp = (name: string, y: number) => ({ name, x: 0.5, y, score: 0.9 });
const Y = [0.7, 0.7, 0.7, 0.68, 0.6, 0.5, 0.4, 0.3, 0.22, 0.2, 0.25, 0.4, 0.55, 0.7, 0.72, 0.6, 0.45, 0.3, 0.25, 0.25];
const FRAMES = Y.map((y, i) => ({ timestampMs: 5000 + i * 100, keypoints: [kp('left_wrist', y), kp('right_wrist', y)] }));
const OLD_READ = { frames: FRAMES, angle: 'down_the_line' };
const HEADLINE = { issue_id: 'early_extension', primary_fault: 'early_extension', severity: 'moderate', detected_in_shots: [] };

/** A single-swing upload from before 10-26: no per-swing read, no usable fault time, an unstamped body read. */
const legacy = (over: Record<string, unknown> = {}) => ({
  id: 'old', source: 'uploaded_video', analysis_status: 'ok', club: '7i', primary_issue: HEADLINE, biomechanics: OLD_READ,
  shots: [{ id: 'old_shot_0', club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: 5, clipEndSeconds: 7, detected_issue_timestamps_sec: [5.1, 5.6, 6.1, 6.6] }],
  ...over,
}) as never;

/** The library screen's fault moment for swing 1 (its faultMoment memo, fed the frames it times by). */
function swing1Moment(session: ReturnType<typeof legacy>, frames: readonly unknown[]) {
  const s = session as unknown as { primary_issue: typeof HEADLINE; shots: { id: string; detected_issue_timestamps_sec: number[] }[] };
  const shot = s.shots[0];
  const fault = swingFaultOnScreen(0, s.primary_issue, null, shot).faultId;
  const ts = shot.detected_issue_timestamps_sec;
  return faultMomentFor({
    faultId: fault,
    readTimestampsSec: ts.length <= 2 ? ts : [],   // the legacy fabricated array is dropped
    anchors: anchorsFromPoseFrames(frames as never),
    windowStartSec: 5,
    windowEndSec: 7,
  });
}

describe('an old swing 1 keeps its fault moment before it is read again', () => {
  it('THE REPORT: the older read is not drawn — and still times the fault (Issue chip, marks, pause)', () => {
    const s = legacy();
    expect(shotDetail.shownShotBiomech(s, 0)).toBeNull();                      // nothing drawn from it (SB4x)
    expect(swing1Moment(s, shotDetail.shownShotBiomech(s, 0)?.frames ?? [])).toBeNull();   // what SB4x left
    const frames = shotDetail.shownSwingTimingFrames(s, 0);
    expect(frames).toHaveLength(FRAMES.length);
    const m = swing1Moment(s, frames);
    expect(m).not.toBeNull();
    expect(m!.source).toBe('phase');
    expect(m!.sec).toBeGreaterThan(5);
    expect(m!.sec).toBeLessThan(7);
  });

  it('today\'s read, once it lands, is what times it', () => {
    const today = { frames: FRAMES.slice(2), angle: 'down_the_line' };
    const s = legacy({ biomechanics: today, analysis_version: 1 });
    expect(shotDetail.shownSwingTimingFrames(s, 0)).toBe(today.frames);
  });

  it('a swing never read by any build has nothing to time by', () => {
    const s = legacy({ biomechanics: undefined });
    expect(shotDetail.shownSwingTimingFrames(s, 0)).toEqual([]);
  });

  it('the library screen times the moment by those frames, not only by the drawn read', () => {
    const sd = code('app/swinglab/swing/[swing_id].tsx');
    expect(sd).toMatch(/activeBiomech \? poseFrames : shownSwingTimingFrames\(session, selectedShotIdx\)/);
    expect(sd).toMatch(/const motionAnchors = useMemo\(\(\) => anchorsFromPoseFrames\(timingFrames\), \[timingFrames\]\);/);
    expect(sd).toMatch(/faultMomentFor\(\{[\s\S]{0,400}anchors: motionAnchors,/);
  });
});
