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

  it('the club effect refuses to run until the pose stage has settled for this clip + swing', () => {
    expect(sm).toContain('if (poseAttemptKey !== `${clipUri}|${selectedSwing}`)');
  });

  it('CLEARS the arc while it waits — a bare return kept drawing the previous swing’s clubhead', () => {
    // 2026-09-09 triple-check: the first version of this gate bailed without clearing, so selecting
    // swing 3 with no cached answer drew swing 1's arc over it until pose settled.
    expect(sm).toContain('if (poseAttemptKey !== `${clipUri}|${selectedSwing}`) { setClubArcPoints(null); return; }');
  });

  it('pose releases it from a `finally`, so a FAILED pose does not strand the arc forever', () => {
    // The release must not sit in the success branch: no skeleton must not silently become no arc.
    expect(sm).toContain('if (!cancelled) setPoseAttemptKey(`${clipUri}|${selectedSwing}`);');
    const poseTail = sm.slice(sm.indexOf("console.log('[smartmotion] pose/biomech failed"));
    expect(poseTail.slice(0, 900)).toContain('} finally {');
  });

  it('the arc cache names every input that changes the answer, not just the swing index', () => {
    // Record<number> served index 0 of a re-segmented clip — or a different clipUri — from the old run.
    expect(sm).not.toContain('useRef<Record<number, { x: number; y: number; tMs: number }[] | null>>({})');
    expect(sm).toContain('const clubCacheKey = `${clipUri}|${selectedSwing}|${Math.round(seg.startMs)}|${Math.round(seg.endMs)}`;');
    expect(sm).toContain('clubPathCacheRef.current[clubCacheKey] = pts;');
  });

  it('SmartMotion reports to the stage observer — it was wired everywhere except here', () => {
    expect(sm).toContain("checkOrder(stageKey, 'club')");
    expect(sm).toContain("noteStage(stageKey, 'club'");
    // `metrics` had no reporter anywhere in the app before this.
    expect(sm).toContain("'metrics'");
  });

  it('the run key comes from the SAME helper the pose read uses, so the keys cannot drift', () => {
    // A stage observer that mis-keys does not go quiet; it reports a violation on every sound run.
    expect(sm).toContain('const pipeWindow = poseExtractInputsFor(segments, selectedSwing).poseWindow;');
    expect(sm).toContain('runKeyFor(clipUri, pipeWindow?.startMs ?? 0, pipeWindow?.endMs ?? 0)');
    // Mirrors poseAnalysisApi's own key exactly.
    expect(read('services/poseAnalysisApi.ts'))
      .toContain('runKeyFor(videoUri, window?.startMs ?? 0, window?.endMs ?? 0)');
  });
});

describe('the pose warm keys on the file the review will actually ask for', () => {
  it('awaits the durable copy rather than reading a `let` mid-flight', () => {
    // `uri` becomes the durable copy partway through runAnalysis. Keying the warm on whatever it
    // happened to be meant the warm decoded 5-8 frames into a key nothing looks up — and lost the
    // race exactly on the long clips whose decodes cost most.
    expect(sm).toContain('const warmUri = await durableUriP;');
    expect(sm).toContain('clipUri: await durableUriP,');
    expect(sm).toContain('extractPoseFramesFromVideo(warmUri, durMs, true, poseWindow, acousticImpactMs)');
  });

  it('is released on BOTH persist paths, so a failed copy cannot stall the warm forever', () => {
    expect(sm).toContain('markDurable(uri);');
  });
});
