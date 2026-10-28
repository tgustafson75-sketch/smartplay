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
// 2026-10-05 — the arc is computed by ONE runner (the orchestrator's shot run); screens draw what it stored.
const runner = read('services/swing/orchestrator/shotDetail.ts');

describe('the arc computes without the Motion toggle', () => {
  it('the detector runs on the clip, not on a UI flag', () => {
    expect(sm).not.toContain('if (!showSkeleton || !clipUri) { setClubArcPoints(null); return; }');
    // SmartMotion draws the run's arc for the selected swing — no toggle in the way.
    expect(sm).toContain('if (!cageSession || !sh) { setClubArcPoints(null); return; }');
    expect(runner).not.toMatch(/showSkeleton|showTrace/);
  });

  it('the effect no longer depends on showSkeleton', () => {
    /**
     * 2026-09-14 — THIS PINNED THE WHOLE DEP LINE VERBATIM and broke the moment a legitimate
     * dependency was ADDED (`effectiveMode`, which the effect genuinely reads). What it cares about
     * is that the arc is not gated on a UI toggle, and that the deps that release it are present —
     * not that the array has exactly five entries in one order. Asserted as membership now, so it
     * survives the array growing and still fails if showSkeleton comes back.
     * [[reachable-not-just-wired]]
     */
    const deps = /\n\s*\}, \[([^\]]*)\]\);/g;
    const arrays = [...sm.matchAll(deps)].map((m) => m[1]);
    // 2026-10-05 — the effect draws the stored arc; it re-runs when the session (the run's write) or the
    // selected swing changes.
    const arcIdx = sm.indexOf('if (!cageSession || !sh) { setClubArcPoints(null); return; }');
    const arcDeps = arrays.find((a) => sm.indexOf(`}, [${a}]);`, arcIdx) === sm.indexOf('}, [', arcIdx));
    expect(arcDeps).toBeDefined();
    expect(arcDeps).not.toMatch(/\bshowSkeleton\b/);
    for (const d of ['cageSession', 'selectedSwing']) {
      expect(arcDeps).toContain(d);
    }
  });

  it('still keeps the ROI zoom that makes a distant clubhead detectable', () => {
    // On a clip shot from well back this is the difference between a clubhead and a 6-pixel smudge.
    expect(runner).toContain('bodyBounds: bodyBoundsFromPose(frames)');
  });

  it('still refuses to draw a guess — a validated arc or nothing', () => {
    expect(runner).toMatch(/arc\.points\.length >= 3\s*\?\s*arc\.points\.map/);
    // 2026-10-26 — the ≥3 rule (and today's-tracker-only) lives in overlayVisibility.drawableClubArc now.
    expect(sm).toContain('setClubArcPoints(drawableClubArc(cageSession, sh));');
  });
});

/**
 * 2026-10-26 — PARTLY INVERTED (Tim: "Tracing is still on by default, and off doesn't work"). "Mounts whenever an
 * arc was detected" and showTrace={shotConfirmed} drew the arc and the blue club with no way to turn them off —
 * the Motion chip only ever flipped the skeleton. The arc still renders WITHOUT the skeleton, but only from its own
 * Swing Trace chip. The rule is overlayLayers (behaviour: the-blue-club-is-measured-and-opt-in); these check wiring.
 */
describe('the arc renders without the skeleton — from its own chip', () => {
  it('the overlay mounts by the shared rule, not whenever an arc exists', () => {
    expect(sm).toContain('isReview && showResults && reviewLayers.mount ? (');
    expect(sm).not.toContain('(clubArcPoints != null && clubArcPoints.length >= 3)');
  });

  it('the skeleton stays bound to the toggle — it was defaulted off for a reason', () => {
    expect(sm).toContain('showSkeleton={reviewLayers.skeleton}');
  });

  it('the trace is its own chip: not the Motion toggle, and not on by itself for a confirmed strike', () => {
    expect(sm).not.toContain('showTrace={showSkeleton && shotConfirmed}');
    expect(sm).not.toContain('showTrace={shotConfirmed}');
    expect(sm).toContain('showTrace={reviewLayers.trace}');
    expect(sm).toContain('clubArc={reviewLayers.clubArc}');
  });

  it('still never traces a practice swing', () => {
    // 2026-10-27 (SB8) — the practice mark decides, as on the library (behaviour:
    // smartmotion-offers-swing-trace-on-every-counted-swing).
    expect(sm).toContain('const traceOffered = reviewTraceOffered(reviewShot);');
    expect(sm).toContain('shotConfirmed: traceOffered,');
  });
});

describe('a missing pose frame no longer takes the arc down with it', () => {
  it('the whole-overlay bail is conditional on there being nothing to draw', () => {
    expect(ov).not.toMatch(/\n  if \(!live\) return null;/);
    expect(ov).toContain('const canDrawTrace = showTrace && (traceSegments.length > 0 || clubDots.length > 0);');
    expect(ov).toContain('if (!live && !canDrawTrace) return null;');
  });

  it('every live-pose consumer tolerates a null frame', () => {
    // 2026-10-26 — the shaft no longer reads the wrists at all (a measured grip or no shaft: clubShaft).
    expect(ov).not.toContain("getKp(live, 'left_wrist')");
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
