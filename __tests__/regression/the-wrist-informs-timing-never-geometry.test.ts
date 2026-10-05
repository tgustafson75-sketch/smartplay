/**
 * 2026-09-01 (adversarial audit; Tim's call: "timing only, never geometry").
 *
 * poseMotion.wristCentroid was baselined DO NOT WIRE — "the trace is clubhead-or-nothing and a wrist
 * fallback was deliberately removed; wiring this would reintroduce a fixed defect". That prohibition
 * is real and it stays. What it forbids is DRAWING a wrist path as if it were the clubhead.
 *
 * Deciding WHICH FOUR SECONDS the clubhead detector searches is a different thing. Impact is the
 * fastest moment of a swing, so the hand-speed peak is a measurement, and it is the only anchor
 * available when the network locate aborts — which Tim's log shows happening twice in one afternoon
 * (dead_host), dropping the analysis to a whole-clip fallback with no labelled positions at all.
 *
 * So the rule is narrowed rather than deleted, and enforced here instead of in a baseline comment:
 * the wrist may produce a TIME. It may never produce a POINT.
 */
import fs from 'fs';
import path from 'path';
import fixture from '../fixtures/locate-3870-wrists.json';
import { poseImpactFromFrames, clubArcAnchor, POSE_ANCHOR_TOLERANCE_MS } from '../../services/swing/clubPathWindow';
import { deriveSwingAnchors } from '../../services/swing/poseMotion';
import type { PoseFrame } from '../../services/poseAnalysisApi';

const root = path.join(__dirname, '..', '..');
const screen = fs.readFileSync(path.join(root, 'app/swinglab/swing/[swing_id].tsx'), 'utf8');

/**
 * 2026-10-04 (orchestrator phase 3) — the impact rule moved out of the screen into
 * services/swing/clubPathWindow.poseImpactFromFrames, the one every club-arc runner calls. Tested by
 * BEHAVIOUR now (the source shape it used to pin is gone), on Tim's real 3870 wrist samples.
 */
const frameAt = (tMs: number, x: number, y: number, extra: Partial<PoseFrame> = {}): PoseFrame => ({
  timestampMs: tMs,
  keypoints: [
    { name: 'left_wrist', x, y, score: 0.9 },
    { name: 'right_wrist', x, y, score: 0.9 },
  ],
  ...extra,
} as unknown as PoseFrame);
const tim = (fixture.samples as number[][]).map(([t, x, y]) => frameAt(t, x, y));

describe('the wrist may inform timing', () => {
  it('impact falls back to the motion-derived anchor when nothing is labelled', () => {
    const derived = deriveSwingAnchors((fixture.samples as number[][]).map(([t, x, y]) => ({ tMs: t, x, y })));
    expect(derived).not.toBeNull();
    expect(poseImpactFromFrames(tim)).toBe(derived!.impactMs);
  });

  it('and only after the labelled P6_impact frame is tried first', () => {
    const labelled = [...tim];
    labelled[3] = { ...labelled[3], position: 'P6_impact', positionSource: 'strike' } as PoseFrame;
    expect(poseImpactFromFrames(labelled)).toBe(labelled[3].timestampMs);
  });

  it("an 'estimated' label (a fraction of the window) is NOT an impact — the motion decides", () => {
    const estimated = [...tim];
    estimated[3] = { ...estimated[3], position: 'P6_impact', positionSource: 'estimated' } as PoseFrame;
    expect(poseImpactFromFrames(estimated)).toBe(poseImpactFromFrames(tim));
  });

  it('it produces NUMBERS of milliseconds, nothing else — and nothing from nothing', () => {
    expect(typeof poseImpactFromFrames(tim)).toBe('number');
    expect(poseImpactFromFrames([])).toBeNull();
    expect(poseImpactFromFrames(null)).toBeNull();
  });

  it('the screen uses that rule, and its chips still read the motion anchors', () => {
    // 2026-10-05 — the arc's impact anchor is decided by the one runner, through the shared rule.
    expect(fs.readFileSync(path.join(root, 'services/swing/clubPathWindow.ts'), 'utf8')).toMatch(/poseImpactMs: poseImpactFromFrames\(input\.frames\)/);
    expect(screen).toMatch(/return deriveSwingAnchors\(samples\);/);
    const memo = screen.slice(screen.indexOf('const motionAnchors'), screen.indexOf('const motionAnchors') + 1400);
    expect(memo).toMatch(/tMs: fr\.timestampMs, x: c\.x, y: c\.y/);
    expect(screen).toMatch(/motionAnchors\?\.topMs/);
  });
});

describe('the swing-position chips always find their points', () => {
  it('THE REPORT (Tim, on a coach app that gets this right): a chip no longer needs a LABEL', () => {
    // They used to render only for positions the pose pipeline had tagged, so on a swing it did not
    // tag — most of them, once the network locate aborts to a whole-clip fallback — the buttons were
    // missing or covered two of four stages.
    expect(screen).toMatch(/P1_address: motionAnchors\?\.startMs/);
    expect(screen).toMatch(/P4_top: motionAnchors\?\.topMs/);
    expect(screen).toMatch(/P6_impact: motionAnchors\?\.impactMs/);
    expect(screen).toMatch(/P10_finish: motionAnchors\?\.endMs/);
  });

  it('a LABELLED frame still wins — the pipeline’s own answer outranks the derivation', () => {
    const chips = screen.slice(screen.indexOf('const swingStageChips'), screen.indexOf('const swingStageChips') + 2600);
    expect(chips.indexOf('poseFrames.find')).toBeLessThan(chips.indexOf('derived[s.pos]'));
  });

  it('a stage with neither a label nor an anchor is omitted, never faked', () => {
    const chips = screen.slice(screen.indexOf('const swingStageChips'), screen.indexOf('const swingStageChips') + 2600);
    // 2026-10-04 — a measured label, else the motion-derived point, else an estimated label; else omitted.
    expect(chips).toMatch(/if \(labelIsMeasured\) return \{ label: s\.label, ms: f!\.timestampMs \};/);
    expect(chips).toMatch(/if \(typeof d === 'number' && Number\.isFinite\(d\)\) return \{ label: s\.label, ms: d \};/);
    expect(chips).toMatch(/return f && Number\.isFinite\(f\.timestampMs\) \? \{ label: s\.label, ms: f\.timestampMs \} : null;/);
    expect(chips).toMatch(/f\.positionSource !== 'estimated'/);
    expect(chips).toMatch(/\.filter\(\(c\): c is \{ label: string; ms: number \} => c != null\)/);
  });

  it('both consumers share ONE anchor computation, so they name the same instant', () => {
    expect(screen).toMatch(/const motionAnchors = useMemo\(/);
    expect((screen.match(/deriveSwingAnchors\(/g) ?? []).length).toBe(1);
  });
});

describe('the wrist may NEVER become geometry', () => {
  it('THE PROHIBITION: wrist data is used in exactly one place — the anchor derivation', () => {
    const uses = [...screen.matchAll(/wristCentroid\(/g)];
    expect(uses.length).toBe(1);
    const memoStart = screen.indexOf('const motionAnchors = useMemo(');
    const memoEnd = screen.indexOf('}, [poseFrames]);', memoStart);
    expect(memoStart).toBeGreaterThan(-1);
    expect(uses[0].index!).toBeGreaterThan(memoStart);
    expect(uses[0].index!).toBeLessThan(memoEnd);
  });

  it('the arc is never set from pose, wrist or motion data', () => {
    for (const m of screen.matchAll(/setClubArcPoints\(([^)]*)\)/g)) {
      expect(m[1]).not.toMatch(/wrist|pose|anchor|motion/i);
    }
  });

  it('the trace still comes from the clubhead detector, or from nothing', () => {
    expect(screen).toMatch(/detectClubPath/);
    expect(screen).toMatch(/setClubArcPoints\(null\)/); // it is allowed to show nothing
  });

  it('poseMotion itself exposes no drawing helper that could be mistaken for a trace', () => {
    const pm = fs.readFileSync(path.join(root, 'services/swing/poseMotion.ts'), 'utf8');
    expect(pm).not.toMatch(/export function .*(Path|Arc|Trace|Points)\s*\(/);
  });
});

describe('an anchor carries its own slack (sweep 2026-10-04)', () => {
  it('a heard strike keeps the graded tolerance; a pose impact gets the pose\'s', () => {
    const heard = clubArcAnchor({ detectionMethod: 'audio_transient', detectionOffsetSeconds: 7, frames: tim, rawStartMs: 0, rawEndMs: 14_496, heardToleranceMs: 0 });
    expect(heard).toEqual({ anchorMs: 7000, toleranceMs: 0 });
    const pose = clubArcAnchor({ detectionMethod: 'manual', detectionOffsetSeconds: 7, frames: tim, rawStartMs: 0, rawEndMs: 14_496, heardToleranceMs: 0 });
    expect(pose.anchorMs).toBe(poseImpactFromFrames(tim));
    expect(pose.toleranceMs).toBe(POSE_ANCHOR_TOLERANCE_MS);
    expect(clubArcAnchor({ frames: [], rawStartMs: 0, rawEndMs: 1000 })).toEqual({ anchorMs: null, toleranceMs: 0 });
  });
});

