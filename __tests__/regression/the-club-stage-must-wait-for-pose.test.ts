/**
 * 2026-09-09 (Tim: "triple check SmartMotion… gated correctly and efficiently to give clean fast
 * accurate complete reads") — THE ARC HE HAS NEVER SEEN WAS AN ORDERING BUG.
 *
 * `analysisPipeline.STAGE_DEPS` says `club: ['pose', 'frame']`. On SmartMotion the club effect ran
 * FIRST — not intermittently, always:
 *
 *   - the pose effect returns unless `phase === 'review' && videoDurationMs != null`;
 *   - `runAnalysis` sets `videoDurationMs = null` on entry and only calls `setPhase('review')` at its
 *     very end;
 *   - the club effect needed nothing but `clipUri` + `segments`, both set during 'analyzing'.
 *
 * So club could not lose that race. `bodyBoundsFromPose(null)` is null, so every first read asked the
 * model to find a clubhead in a downscaled FULL FRAME — the six-pixels-across case that
 * `roiFromBodyBounds` was written on 08-10 to fix. The empty answer was then cached under a bare
 * swing index, and the re-run that `poseFrames` triggers took the cache hit. The zoom shipped, was
 * unit-tested (club-path-zoom-roi), was wired, and never ran on a swing recorded on this screen.
 *
 * `club-arc-render-path` asserted the ARGUMENT was present. That is all a wire test can prove: that
 * the wire exists, never that a signal flows down it. These assert the signal.
 *
 * [[orphans-are-live-bugs-not-dead-code]] [[no-half-fixes-enforce-every-surface]]
 */
import fs from 'fs';
import path from 'path';
import { STAGE_DEPS } from '../../services/swing/analysisPipeline';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const sm = read('app/swinglab/smartmotion.tsx');

describe('the club stage waits for pose', () => {
  it('the graph still says club depends on pose (the premise of this whole file)', () => {
    expect(STAGE_DEPS.club).toContain('pose');
  });

  /**
   * 2026-10-05 — the club stage is no longer an effect that has to remember to wait: it is the 'arc'
   * stage of the orchestrator's shot run (services/swing/orchestrator/shotDetail), ORDERED after the
   * 'pose' stage by the engine and refused unless the body read produced frames to aim with. Every
   * screen draws what that one runner stored.
   */
  const runner = read('services/swing/orchestrator/shotDetail.ts');

  it('the club stage runs after pose — by the engine — and only with pose frames to aim with', () => {
    expect(runner).toMatch(/id: 'arc',\s*after: \['pose'\],/);
    expect(runner).toMatch(/return !!bio\?\.frames\?\.length;/);
    expect(runner).toMatch(/bodyBounds: bodyBoundsFromPose\(frames\),\s*poseFrames: frames,/);
  });

  it('a FAILED pose does not strand the arc: `after` (any outcome), not `deps` (success only)', () => {
    const arc = runner.slice(runner.indexOf("id: 'arc',"), runner.indexOf("id: 'arc',") + 120);
    expect(arc).not.toMatch(/deps:/);
  });

  it('switching swing never draws the previous swing’s clubhead', () => {
    // SmartMotion draws the SELECTED shot's stored arc, or nothing.
    expect(sm).toContain('const sh = cageSession?.shots[selectedSwing];');
    expect(sm).toContain('if (!cageSession || !sh) { setClubArcPoints(null); return; }');
    expect(sm).toContain('setClubArcPoints(pts && pts.length >= 3 ?');
  });

  it('the answer is remembered per clip + window, never a bare swing index', () => {
    expect(runner).toMatch(/`\$\{s\.id\}\|\$\{shot\.id\}\|\$\{shot\.clipUri\}\|\$\{shot\.clipStartSeconds \?\? ''\}\|\$\{shot\.clipEndSeconds \?\? ''\}`/);
  });

  it('the arc reports its anchor and result into the run\'s trace', () => {
    expect(runner).toMatch(/traceStep\('arc anchor'/);
    expect(runner).toMatch(/addAppEvent\('club_arc'/);
  });
});

/**
 * 2026-10-05 — the pose WARM is gone with the second pose pass it fed. The decode it raced for is now
 * simply ordered: the shot run's pose stage waits for the swing's read to finish decoding.
 */
describe('no pose decode races the read', () => {
  const runner = read('services/swing/orchestrator/shotDetail.ts');
  it('the body read waits for the read', () => {
    expect(runner).toMatch(/await whenStageSettled\(swingRunKey\(input\.sessionId\), 'read', signal\);/);
  });
  it('SmartMotion has no pose extraction of its own any more', () => {
    expect(sm).not.toMatch(/extractPoseFramesFromVideo\(/);
    expect(sm).not.toMatch(/durableUriP/);
  });
});
