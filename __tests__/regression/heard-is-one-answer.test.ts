/**
 * 2026-10-16 (re-review of S1g) — the review screens decided "heard strike" from detectionMethod alone,
 * while the body read (shotDetail) also required its impact to BE the heard offset. A cage shot with a
 * heard strike, then "Analyze this moment" (setShotClipBoundaries stores the scrubbed moment as
 * locatedImpactSec): the body read trusted the hands; the Impact button still trusted the strike label.
 * One helper now answers for all three.
 */
import fs from 'fs';
import path from 'path';
import { shotImpactHeard, impactIsHeard } from '../../services/swing/orchestrator/shotDetail';
import type { SwingShot } from '../../store/swingSessionStore';
import { swingStageTimesMs } from '../../services/swing/poseMotion';
import type { PoseFrame } from '../../services/poseAnalysisApi';

const shot = (o: Partial<SwingShot>) => ({ id: 's', clipUri: 'file://x.mp4', clipStartSeconds: 4, clipEndSeconds: 8, ...o }) as SwingShot;

describe('is the impact a heard strike', () => {
  it('a heard cage shot: yes', () => {
    expect(shotImpactHeard(shot({ detectionMethod: 'audio_transient', detectionOffsetSeconds: 6.04 }))).toBe(true);
  });
  it('the same shot after "Analyze this moment" moved its impact: no', () => {
    expect(shotImpactHeard(shot({ detectionMethod: 'audio_transient', detectionOffsetSeconds: 6.04, locatedImpactSec: 6.6 }))).toBe(false);
  });
  it('a located impact that IS the heard one (within 50ms): yes', () => {
    expect(shotImpactHeard(shot({ detectionMethod: 'audio_transient', detectionOffsetSeconds: 6.04, locatedImpactSec: 6.07 }))).toBe(true);
  });
  it('no microphone: no', () => {
    expect(shotImpactHeard(shot({ detectionMethod: 'manual', detectionOffsetSeconds: 6.04 }))).toBe(false);
    expect(impactIsHeard({ detectionMethod: 'audio_transient', detectionOffsetSeconds: 6.04 }, null)).toBe(false);
  });
});

describe('when a heard Impact and a motion Top cross, the heard Impact stays', () => {
  it('the Top it contradicts is the one left out', () => {
    const f = (t: number, extra: Partial<PoseFrame> = {}) => ({ timestampMs: t, keypoints: [], ...extra }) as unknown as PoseFrame;
    const frames = [f(100), f(1050, { position: 'P6_impact', positionSource: 'strike' }), f(1600)];
    const chips = swingStageTimesMs(frames, { heardStrike: true, anchors: { startMs: 100, topMs: 1100, impactMs: 1180, endMs: 1600 } });
    expect(chips.map((c) => [c.key, c.ms])).toEqual([['P1_address', 100], ['P6_impact', 1050], ['P10_finish', 1600]]);
  });
});

describe('the body read and both review screens ask the same question', () => {
  const root = path.join(__dirname, '..', '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  it('shotDetail', () => expect(read('services/swing/orchestrator/shotDetail.ts')).toMatch(/const impactHeard = impactIsHeard\(shot, impactMs\);/));
  it('the swing library', () => {
    const sd = read('app/swinglab/swing/[swing_id].tsx');
    expect(sd).toMatch(/const heardStrike = shotImpactHeard\(shot\);/);
    expect(sd).not.toMatch(/heardStrike = shot\?\.detectionMethod === 'audio_transient'/);
  });
  it('SmartMotion', () => {
    const sm = read('app/swinglab/smartmotion.tsx');
    expect(sm).toMatch(/const reviewHeardStrike = shotImpactHeard\(cageSession\?\.shots\[selectedSwing\]\);/);
    expect(sm).not.toMatch(/reviewHeardStrike = cageSession\?\.shots\[selectedSwing\]\?\.detectionMethod === 'audio_transient'/);
  });
});
