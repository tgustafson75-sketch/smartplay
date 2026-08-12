/**
 * 2026-08-12 (Tim) — "Continue on that club arc render path. I wanna see it. I keep saying
 * SmartMotion needs to be perfect, and this needs to be fixed."
 *
 * The clubhead arc — the feature he has asked about more than any other — was invisible by default,
 * for three stacked reasons, each individually defensible:
 *
 *   1. COMPUTE was gated on `showSkeleton`, the pose-skeleton toggle, which defaults OFF because
 *      interpolating a sparse pose over moving video looked laggy. So the arc only ever computed for
 *      someone who first tapped a chip labelled "Motion".
 *   2. RENDER only mounted SwingBodyOverlay when that same toggle was on AND pose frames existed.
 *   3. Even mounted, the overlay opened with a bare `if (!live) return null` — one missing pose frame
 *      and the WHOLE overlay vanished, arc included. Since interpolateFrame deliberately returns null
 *      outside the ±400ms pose window, the arc disappeared the moment playback ran past the analysed
 *      swing — and with the arc now drawing without a skeleton, `frames` can be empty legitimately.
 *
 * None of that has anything to do with clubhead detection. It needs the clip and the swing window,
 * and the pose frames it uses for ROI zoom are extracted whenever a review opens — not behind the
 * toggle — so decoupling costs no accuracy.
 *
 * The arc is still drawn BY SwingBodyOverlay rather than a parallel component: the de-spiking,
 * centripetal Catmull-Rom smoothing and speed-heat colouring live there and took several passes to
 * get right. A second implementation would drift. [[smartmotion-clubhead-trace-root-cause]]
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const sm = read('app/swinglab/smartmotion.tsx');
const ov = read('components/swinglab/SwingBodyOverlay.tsx');

describe('the arc computes without the Motion toggle', () => {
  it('the detector runs on the clip, not on a UI flag', () => {
    expect(sm).not.toContain('if (!showSkeleton || !clipUri) { setClubArcPoints(null); return; }');
    expect(sm).toContain('if (!clipUri) { setClubArcPoints(null); return; }');
  });

  it('the effect no longer depends on showSkeleton', () => {
    expect(sm).not.toContain('}, [showSkeleton, clipUri, segments, selectedSwing]);');
    expect(sm).toContain('}, [clipUri, segments, selectedSwing, poseFrames]);');
  });

  it('still keeps the ROI zoom that makes a distant clubhead detectable', () => {
    // On a clip shot from well back this is the difference between a clubhead and a 6-pixel smudge.
    expect(sm).toContain('bodyBounds: bodyBoundsFromPose(poseFrames)');
  });

  it('still refuses to draw a guess — a validated arc or nothing', () => {
    expect(sm).toContain('r && r.points.length >= 3 ? r.points.map');
  });
});

describe('the arc renders without the skeleton', () => {
  it('the overlay mounts when EITHER the skeleton or an arc is available', () => {
    expect(sm).toContain('(showSkeleton && poseFrames && poseFrames.length > 0) ||');
    expect(sm).toContain('(clubArcPoints != null && clubArcPoints.length >= 3)');
  });

  it('the skeleton stays bound to the toggle — it was defaulted off for a reason', () => {
    expect(sm).toContain('showSkeleton={!!(showSkeleton && poseFrames && poseFrames.length > 0)}');
  });

  it('the trace no longer inherits the toggle', () => {
    expect(sm).not.toContain('showTrace={showSkeleton && shotConfirmed}');
    expect(sm).toContain('showTrace={shotConfirmed}');
  });

  it('still only traces a CONFIRMED strike, never a practice swing', () => {
    // shotConfirmed = the camera saw the ball leave, or the contact read is a known strike.
    const src = sm.slice(sm.indexOf('const shotConfirmed = useMemo'));
    expect(src.slice(0, 400)).toContain('ballDeparture?.departed === true');
  });
});

describe('a missing pose frame no longer takes the arc down with it', () => {
  it('the whole-overlay bail is conditional on there being nothing to draw', () => {
    expect(ov).not.toMatch(/\n  if \(!live\) return null;/);
    expect(ov).toContain('const canDrawTrace = showTrace && (traceSegments.length > 0 || clubDots.length > 0);');
    expect(ov).toContain('if (!live && !canDrawTrace) return null;');
  });

  it('every live-pose consumer tolerates a null frame', () => {
    expect(ov).toContain("(live ? [getKp(live, 'left_wrist'), getKp(live, 'right_wrist')] : [])");
    expect(ov).toContain('{showSkeleton && live && (');
  });

  it('refuses the bbox fallback space for an arc — misregistered is worse than absent', () => {
    // The bbox is keypoint-derived; without pose there is no honest space to place club points in.
    expect(ov).toContain('if (!bbox) return null;');
  });

  it('draws the trace and the measured detection dots independently of the skeleton', () => {
    expect(ov).toContain('{showTrace && traceSegments.map(');
    expect(ov).toContain('{showTrace && clubDots.map(');
  });

  it('never falls back to the wrist path — clubhead or nothing', () => {
    // 2026-07-24, after ~20 reported false fixes: the wrist path loops around the torso and reads as
    // a broken clubhead trace. Tim's law is trace it correctly or not at all.
    expect(ov).toContain('if (!(aligned && clubArc && clubArc.length >= MIN_CLUB_POINTS)) {');
    expect(ov).toContain('return { pts: [], isClub: false };');
  });
});
