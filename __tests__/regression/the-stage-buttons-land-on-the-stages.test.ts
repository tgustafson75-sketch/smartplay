/**
 * 2026-10-16 (Tim, on Lily's driver clip 4075.mp4, down-the-line: "The other points of the swing, not
 * correct. It's not going to them correctly.") — the Address / Top / Impact / Finish buttons.
 *
 * Ground truth read off the clip's frames: address ~4.85s (takeaway ~4.95), top ~5.65, impact ~6.04,
 * finish ~6.55 (held to ~7.2s, then she lowers the club and stands). The fixture is the REAL wrist track
 * (MediaPipe pose_landmarker_full on the clip's 30fps frames), sampled the way the body read samples it.
 *
 * Two faults, both pinned here:
 *   1. deriveSwingAnchors took impact as the fastest gap between samples. On real wrists that was the
 *      follow-through or the club coming down after the finish: impact 6.38s / 6.95s, top 6.33s (the
 *      finish) — the "Lily standing after the swing" frame in Tim's screenshots.
 *   2. The chips trusted any label with positionSource 'strike' — but only P6 sits on the impact time;
 *      P1 / P4 / P10 are placed at fixed offsets from it (-2000 / -320 / +700ms).
 */
import fixture from '../fixtures/lily-4075-wrists.json';
import { deriveSwingAnchors, swingStageTimesMs, type MotionSample } from '../../services/swing/poseMotion';
import type { PoseFrame } from '../../services/poseAnalysisApi';

const track = fixture.samples as [number, number, number][];
const GT = fixture.groundTruthMs;
const at = (ms: number): MotionSample => {
  let best = track[0];
  for (const s of track) if (Math.abs(s[0] - ms) < Math.abs(best[0] - ms)) best = s;
  return { tMs: ms, x: best[1], y: best[2] };
};

/** poseAnalysisApi's windowed sampling: five fractions of the window, densified evenly to 20. */
function windowedTimes(s: number, e: number): number[] {
  const fr = [0.05, 0.25, 0.5, 0.65, 0.9].map((f) => s + (e - s) * f);
  const lo = Math.min(...fr), hi = Math.max(...fr);
  const out = [...fr];
  for (let i = 1; i <= 15; i++) out.push(lo + ((hi - lo) * i) / 16);
  return out.sort((a, b) => a - b).map(Math.round);
}
/** poseAnalysisApi's strike-anchored sampling: offsets around an impact time, 65% clustered on it. */
function strikeTimes(imp: number): { key?: PoseFrame['position']; t: number }[] {
  const anchors: { key: PoseFrame['position']; t: number }[] = [
    { key: 'P1_address', t: imp - 2000 }, { key: 'P2_takeaway', t: imp - 1200 }, { key: 'P4_top', t: imp - 320 },
    { key: 'P6_impact', t: imp }, { key: 'P10_finish', t: imp + 700 },
  ];
  const lo = imp - 2000, hi = imp + 700;
  const out: { key?: PoseFrame['position']; t: number }[] = [...anchors];
  const push = (t: number) => { if (t > lo && t < hi && out.every((p) => Math.abs(p.t - t) > 40)) out.push({ t: Math.round(t) }); };
  const cs = imp - 420, ce = imp + 260;
  for (let i = 1; i <= 10; i++) push(cs + ((ce - cs) * i) / 11);
  for (let i = 1; i <= 5; i++) push(lo + ((cs - lo) * i) / 6);
  return out.sort((a, b) => a.t - b.t);
}

const expectOnTheStages = (a: ReturnType<typeof deriveSwingAnchors>) => {
  expect(a).not.toBeNull();
  expect(Math.abs(a!.impactMs - GT.impact)).toBeLessThanOrEqual(120);
  expect(Math.abs(a!.topMs - GT.top)).toBeLessThanOrEqual(250);
  expect(a!.startMs).toBeGreaterThanOrEqual(4500);
  expect(a!.startMs).toBeLessThan(5300);
  // The finish is the held pose, never her standing after lowering the club (7.3s on).
  expect(a!.endMs).toBeGreaterThanOrEqual(6250);
  expect(a!.endMs).toBeLessThanOrEqual(7200);
};

describe("the anchors land on Lily's real swing", () => {
  // Windows the motion pass / locate hand the body read for this clip (peak ±, burst bounds, wide).
  for (const [s, e] of [[4240, 7540], [4300, 7800], [4800, 8100], [3500, 8800], [0, 8860]]) {
    it(`window ${s}-${e}ms`, () => {
      expectOnTheStages(deriveSwingAnchors(windowedTimes(s, e).map(at)));
    });
  }
  it('sampled around a located impact that was late (7.0s, the club coming down after the finish)', () => {
    expectOnTheStages(deriveSwingAnchors(strikeTimes(7000).map((p) => at(p.t))));
  });
  it('sampled around the right impact', () => {
    expectOnTheStages(deriveSwingAnchors(strikeTimes(6040).map((p) => at(p.t))));
  });
});

describe('the stage buttons seek to measured stages, not to offsets from a located impact', () => {
  const framesAround = (imp: number): PoseFrame[] => strikeTimes(imp).map(({ key, t }) => {
    const s = at(t);
    return {
      timestampMs: t,
      keypoints: [
        { name: 'left_wrist', x: s.x, y: s.y, score: 0.9 },
        { name: 'right_wrist', x: s.x, y: s.y, score: 0.9 },
      ],
      ...(key ? { position: key, positionSource: 'strike' as const } : {}),
    } as unknown as PoseFrame;
  });

  it('a late located impact does not drag Address / Top / Impact / Finish with it', () => {
    const chips = Object.fromEntries(swingStageTimesMs(framesAround(7000)).map((c) => [c.key, c.ms]));
    expect(Math.abs(chips.P6_impact - GT.impact)).toBeLessThanOrEqual(120);
    expect(Math.abs(chips.P4_top - GT.top)).toBeLessThanOrEqual(250);
    expect(chips.P10_finish).toBeLessThanOrEqual(7200);
    expect(chips.P1_address).toBeLessThan(5300);
  });

  it('a HEARD strike still times the Impact button', () => {
    const chips = Object.fromEntries(swingStageTimesMs(framesAround(6060), { heardStrike: true }).map((c) => [c.key, c.ms]));
    expect(chips.P6_impact).toBe(6060);
  });

  it('labels answer only where the motion gives nothing', () => {
    const still: PoseFrame[] = [
      { timestampMs: 100, position: 'P1_address', positionSource: 'estimated' },
      { timestampMs: 900, position: 'P4_top', positionSource: 'estimated' },
    ] as unknown as PoseFrame[];
    expect(swingStageTimesMs(still).map((c) => [c.key, c.ms])).toEqual([['P1_address', 100], ['P4_top', 900]]);
  });

  it('both review screens use this one rule', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const lib = fs.readFileSync(path.join(__dirname, '../../app/swinglab/swing/[swing_id].tsx'), 'utf8');
    const sm = fs.readFileSync(path.join(__dirname, '../../app/swinglab/smartmotion.tsx'), 'utf8');
    expect(lib).toMatch(/swingStageTimesMs\(poseFrames/);
    expect(sm).toMatch(/swingStageTimesMs\(poseFrames/);
    // SmartMotion's chips and ticks seek to those times, not to a raw label's timestamp.
    expect(sm).not.toMatch(/poseFrames\?\.find\(\(p\) => p\.position === pos\)/);
  });
});
