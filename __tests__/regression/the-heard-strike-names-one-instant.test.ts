/**
 * 2026-10-16 (adversarial review of S1d) — computeBiomechanics' phaseFrame overruled a 'strike' P6
 * label more than 150ms from the hands' impact, while swingStageTimesMs gave a HEARD strike priority for
 * the Impact button: the button and the impact numbers named different instants. A heard strike is
 * frame-exact; when the hands' read misses it by more than 150ms, the hands' read is wrong, and both the
 * buttons and the body read fall back to the labels. A LOCATED strike still yields to the motion read.
 */
import fs from 'fs';
import path from 'path';
import fixture from '../fixtures/lily-4075-pose.json';
import { computeBiomechanicsFromFrames, type PoseFrame, type Keypoint } from '../../services/poseAnalysisApi';
import { anchorsFromPoseFrames, swingStageTimesMs, trustHeardStrike } from '../../services/swing/poseMotion';

const rows = fixture.frames as number[][];
const joints = fixture.joints as string[];
const frameAt = (ms: number, position?: PoseFrame['position']): PoseFrame => {
  let best = rows[0];
  for (const r of rows) if (Math.abs(r[0] - ms) < Math.abs(best[0] - ms)) best = r;
  const keypoints: Keypoint[] = joints.map((name, i) => ({ name, x: best[1 + i * 3], y: best[2 + i * 3], score: best[3 + i * 3] }));
  return { timestampMs: ms, keypoints, ...(position ? { position, positionSource: 'strike' as const } : {}) } as PoseFrame;
};
/** Strike-anchored sampling around `imp`, as poseAnalysisApi samples. */
function strike(imp: number): PoseFrame[] {
  const keys: [PoseFrame['position'], number][] = [['P1_address', -2000], ['P2_takeaway', -1200], ['P4_top', -320], ['P6_impact', 0], ['P10_finish', 700]];
  const out = keys.map(([k, d]) => frameAt(imp + d, k));
  for (let i = 1; i <= 10; i++) out.push(frameAt(Math.round(imp - 420 + (680 * i) / 11)));
  for (let i = 1; i <= 5; i++) out.push(frameAt(Math.round(imp - 2000 + (1580 * i) / 6)));
  return out.sort((a, b) => a.timestampMs - b.timestampMs);
}

const IMP = 6300;   // a strike 260ms from where Lily's hands say impact is (~6.04s)
const frames = strike(IMP);

describe('trustHeardStrike', () => {
  const a = anchorsFromPoseFrames(frames)!;
  it('the hands put impact elsewhere', () => expect(Math.abs(a.impactMs - IMP)).toBeGreaterThan(150));
  it('a heard strike that disagrees: the motion read is not used', () => expect(trustHeardStrike(frames, a, true)).toBeNull());
  it('a located strike that disagrees: the motion read stands', () => expect(trustHeardStrike(frames, a, false)).toBe(a));
  it('a heard strike that agrees: the motion read stands', () => {
    const near = strike(a.impactMs + 60);
    const an = anchorsFromPoseFrames(near)!;
    expect(trustHeardStrike(near, an, true)).toBe(an);
  });
});

describe('the Impact button and the impact numbers name one instant', () => {
  it('heard + disagreeing: every stage button seeks to its label', () => {
    const chips = Object.fromEntries(swingStageTimesMs(frames, { heardStrike: true }).map((c) => [c.key, c.ms]));
    expect(chips).toEqual({ P1_address: IMP - 2000, P4_top: IMP - 320, P6_impact: IMP, P10_finish: IMP + 700 });
  });

  it('heard + disagreeing: the body read uses the labelled phases too', () => {
    // Reference: the same frames with the wrists removed (no motion read possible → labels only).
    const noWrists = frames.map((f) => ({ ...f, keypoints: f.keypoints.filter((k) => !/wrist/.test(k.name ?? "")) }));
    const heard = computeBiomechanicsFromFrames(frames, 'face_on', 'right', true);
    const labels = computeBiomechanicsFromFrames(noWrists, 'face_on', 'right', true);
    const located = computeBiomechanicsFromFrames(frames, 'face_on', 'right', false);
    expect(heard.spineAngleDeltaDeg).toBe(labels.spineAngleDeltaDeg);
    expect(located.spineAngleDeltaDeg).not.toBe(labels.spineAngleDeltaDeg);
  });

  it('the swing run tells the body read whether its impact was heard', () => {
    const sd = fs.readFileSync(path.join(__dirname, '../../services/swing/orchestrator/shotDetail.ts'), 'utf8');
    expect(sd).toMatch(/const impactHeard = impactMs != null && shot\.detectionMethod === 'audio_transient'/);
    expect(sd).toMatch(/0, \(\) => signal\.aborted,[^\n]*\n\s*impactHeard,/);
  });
});
