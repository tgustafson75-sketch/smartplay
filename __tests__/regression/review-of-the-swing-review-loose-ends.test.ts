/**
 * 2026-10-16 — loose ends from the adversarial review of S1a-S1d.
 *   - a comparison that matches on nothing was still SPOKEN / TOASTED as "0% match" on direct compares;
 *   - the stage buttons, taken from mixed sources, could put Top after Impact;
 *   - the FAULT MOMENT pill's fallback could seek outside the swing on screen;
 *   - the "Analyzing the swing at 0:07" toast still printed absolute clip time;
 *   - the width gate compared x against y in separately normalised coordinates, so a LANDSCAPE clip read
 *     0.56x too narrow and a face-on golfer lost sway / weight reads.
 */
import fs from 'fs';
import path from 'path';
import { comparisonHeadline, compareSwings } from '../../services/swingComparisonEngine';
import { swingStageTimesMs } from '../../services/swing/poseMotion';
import { computeBiomechanicsFromFrames, type PoseFrame, type Keypoint } from '../../services/poseAnalysisApi';
import type { PoseEstimate } from '../../services/poseEstimator';

const root = path.join(__dirname, '..', '..');
const sd = fs.readFileSync(path.join(root, 'app/swinglab/swing/[swing_id].tsx'), 'utf8');
const lib = fs.readFileSync(path.join(root, 'app/swinglab/library.tsx'), 'utf8');

describe('a comparison that matches on nothing is said in words, never "0% match"', () => {
  it('the headline', () => {
    expect(comparisonHeadline({ overall_match: 0, takeaways: ['Focus: posture.'] }, 'Tour-median driver')).toBe('No close match to Tour-median driver. Focus: posture.');
    expect(comparisonHeadline({ overall_match: 64, takeaways: [] }, 'X')).toBe('64% match to X.');
    expect(comparisonHeadline({ overall_match: null, takeaways: [] }, 'X')).toBe('Not enough data to compare to X yet.');
  });
  it('the spoken summary', () => {
    const est = (bio: Record<string, unknown>) => ({
      source: 'video', confidence: 80, frames: [], swingVerdict: null, reason: 't', age_band: 'adult', mirrored: false,
      joint_confidence: { hip: 0.9, shoulder: 0.9, knee: 0.7, wrist: 0.7, ankle: 0.7, head: 0.7 }, partial_view: false,
      biomechanics: { hipTurnDeg: null, shoulderTurnDeg: null, weightShiftPct: null, spineAngleDeltaDeg: null, headDriftPxNorm: null,
        hipSlideRatio: null, frames: [], verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null }, ...bio },
    }) as unknown as PoseEstimate;
    const r = compareSwings({ current: est({ spineAngleDeltaDeg: 40, headDriftPxNorm: 0.9 }), reference: est({ spineAngleDeltaDeg: 2, headDriftPxNorm: 0.01 }), kind: 'self_vs_self', club: 'Driver' });
    expect(r.overall_match).toBe(0);
    expect(r.voice_summary).not.toMatch(/\b0% match/);
  });
  it('every direct-compare headline goes through it', () => {
    expect((sd.match(/engineMod\.comparisonHeadline\(result, /g) ?? []).length).toBe(2);
    expect(lib).toMatch(/engineMod\.comparisonHeadline\(result, ref\.label\)/);
    expect(sd).not.toMatch(/`\$\{result\.overall_match\}% match/);
    expect(lib).not.toMatch(/`\$\{result\.overall_match\}% match/);
  });
});

describe('the stage buttons are an order', () => {
  it('a heard Impact before the motion Top never shows Top after Impact', () => {
    const f = (t: number, extra: Partial<PoseFrame> = {}) => ({ timestampMs: t, keypoints: [], ...extra }) as unknown as PoseFrame;
    const frames = [f(100), f(1050, { position: 'P6_impact', positionSource: 'strike' }), f(1600)];
    const chips = swingStageTimesMs(frames, { heardStrike: true, anchors: { startMs: 100, topMs: 1100, impactMs: 1180, endMs: 1600 } });
    for (let i = 1; i < chips.length; i++) expect(chips[i].ms).toBeGreaterThan(chips[i - 1].ms);
  });
});

describe('every time and seek on the swing screen stays on the swing', () => {
  it('the Analyze-at toast reads the swing clock', () => {
    expect(sd).toMatch(/show\(`Analyzing the swing at \$\{swingClock\(center, winStartSec\)\}…`\)/);
  });
  it('the FAULT MOMENT fallback only offers times inside the window', () => {
    expect(sd).toMatch(/\.filter\(\(t\) => Number\.isFinite\(t\) && t >= winStartSec - 0\.05 && t <= winEndSec\)/);
  });
});

describe('the width gate reads true proportions', () => {
  const NAMES = ['nose', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
  /** The coverage test's face-on golfer; `xs` squeezes x the way a landscape frame normalises it. */
  function frame(position: PoseFrame['position'], t: number, turn: number, shift: number, xs: number, fw: number, fh: number): PoseFrame {
    const X = (x: number) => 0.5 + (x - 0.5) * xs;
    const cx = 0.5 + shift * 0.06;
    const halfSh = 0.11 * Math.cos(turn * Math.PI / 180);
    const halfHip = 0.11 * 0.73 * Math.cos(turn * 0.6 * Math.PI / 180);
    const kp: Record<string, [number, number]> = {
      nose: [cx, 0.18], left_shoulder: [cx - halfSh, 0.30], right_shoulder: [cx + halfSh, 0.30 - turn * 0.0008],
      left_elbow: [cx - halfSh - 0.03, 0.42], right_elbow: [cx + halfSh + 0.03, 0.42],
      left_wrist: [cx - halfSh - 0.02, 0.50], right_wrist: [cx + halfSh + 0.02, 0.50],
      left_hip: [cx - halfHip, 0.55], right_hip: [cx + halfHip, 0.55], left_knee: [cx - halfHip, 0.72], right_knee: [cx + halfHip, 0.72],
      left_ankle: [0.42, 0.92], right_ankle: [0.58, 0.92],
    };
    const keypoints: Keypoint[] = NAMES.map((n) => ({ name: n, x: X(kp[n][0]), y: kp[n][1], score: 0.95 }));
    return { timestampMs: t, position, keypoints, frameW: fw, frameH: fh };
  }
  const swing = (xs: number, fw: number, fh: number): PoseFrame[] => [
    frame('P1_address', 0, 0, 0, xs, fw, fh), frame('P2_takeaway', 300, 25, -0.2, xs, fw, fh), frame('P4_top', 800, 85, -0.5, xs, fw, fh),
    frame('P6_impact', 1100, 35, 0.7, xs, fw, fh), frame('P10_finish', 1600, 100, 1.0, xs, fw, fh),
  ];
  it('portrait: the face-on golfer keeps sway and weight', () => {
    const b = computeBiomechanicsFromFrames(swing(1, 1080, 1920), 'face_on', 'right');
    expect(b.weightShiftPct).not.toBeNull();
    expect(b.swayNorm ?? null).not.toBeNull();
  });
  it('landscape: the same golfer, x normalised by a 16:9 width, keeps them too', () => {
    const b = computeBiomechanicsFromFrames(swing(1080 / 1920, 1920, 1080), 'face_on', 'right');
    expect(b.weightShiftPct).not.toBeNull();
    expect(b.swayNorm ?? null).not.toBeNull();
  });
});
