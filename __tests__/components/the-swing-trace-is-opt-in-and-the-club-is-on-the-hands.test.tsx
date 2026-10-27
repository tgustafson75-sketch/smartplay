/**
 * 2026-10-26 — two of Tim's reports, one renderer (components/swinglab/SwingBodyOverlay):
 *   "Tracing is still on by default, and off doesn't work."
 *   "The blue club line stays with the arc, not the golfer's hands."
 *
 * The overlay is RENDERED here (react-native-svg as host elements) and what it draws is asserted: no source
 * text is read. Every case below failed on the code before the fix:
 *   - the defaults were showSkeleton = showTrace = true, so a mount that named neither drew the arc + club;
 *   - the clubhead was clamped to the arc's first/last point outside the arc, and glided across gaps;
 *   - the shaft ran to the interpolated wrists, so an arc with no measured grip still drew a shaft.
 */
import React from 'react';
import { render as rtlRender } from '@testing-library/react-native';

jest.mock('react-native-svg', () => {
  const R = require('react');
  const host = (name: string) => (p: Record<string, unknown>) => R.createElement(name, p, p.children as never);
  return { __esModule: true, default: host('Svg'), Svg: host('Svg'), Path: host('Path'), Line: host('Line'), Circle: host('Circle'), G: host('G') };
});

import SwingBodyOverlay from '../../components/swinglab/SwingBodyOverlay';
import type { PoseFrame } from '../../services/poseAnalysisApi';

const BLUE = '#4EA8FF';
const FW = 1080, FH = 1920;

/** Pose every 135ms over 0..2700ms (the sparse body read), wrists moving straight up from y .6 to .3. */
function poseFrames(): PoseFrame[] {
  const out: PoseFrame[] = [];
  for (let t = 0; t <= 2700; t += 135) {
    const wy = 0.6 - 0.3 * (t / 2700);
    const kp = (name: string, x: number, y: number) => ({ name, x, y, score: 0.95 });
    out.push({
      position: 'P1', timestampMs: t, frameW: FW, frameH: FH,
      keypoints: [
        kp('left_shoulder', 0.45, 0.35), kp('right_shoulder', 0.55, 0.35),
        kp('left_wrist', 0.5, wy), kp('right_wrist', 0.5, wy),
        kp('left_hip', 0.46, 0.55), kp('right_hip', 0.54, 0.55),
      ],
    } as unknown as PoseFrame);
  }
  return out;
}

/** 12 detections, 900..1500ms (≈55ms apart), head sweeping (.7,.2) → (.3,.8). */
function arc(withGrip: boolean, gapAt?: number) {
  const pts: { x: number; y: number; tMs: number; gx?: number; gy?: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const tMs = 900 + Math.round((600 * k) / 11);
    if (gapAt != null && tMs > gapAt - 110 && tMs < gapAt + 110) continue;
    const p: (typeof pts)[number] = { x: 0.7 - 0.4 * (k / 11), y: 0.2 + 0.6 * (k / 11), tMs };
    if (withGrip) { p.gx = 0.42; p.gy = 0.5; }
    pts.push(p);
  }
  return pts;
}

type Root = ReturnType<typeof rtlRender>['UNSAFE_root'];
type Node = ReturnType<Root['findAll']>[number];
function render(props: Partial<React.ComponentProps<typeof SwingBodyOverlay>>): Root {
  return rtlRender(<SwingBodyOverlay frames={poseFrames()} currentTimeMs={1200} videoW={FW} videoH={FH} {...props} />).UNSAFE_root;
}
const all = (r: Root, type: string): Node[] => r.findAll((n: Node) => n.type === type);
const blueShaft = (r: Root) => all(r, 'Line').filter((n) => n.props.stroke === BLUE);
const blueHead = (r: Root) => all(r, 'Circle').filter((n) => n.props.fill === BLUE);
const traceSegs = (r: Root) => all(r, 'Path');

describe('the swing trace is the player\'s to turn on', () => {
  it('a mount that names no layer draws no arc, no head and no club — even with a stored arc and pose', () => {
    const r = render({ clubArc: arc(true) });
    expect(traceSegs(r)).toHaveLength(0);
    expect(blueShaft(r)).toHaveLength(0);
    expect(blueHead(r)).toHaveLength(0);
  });

  it('the skeleton alone never brings the club with it (off means off)', () => {
    const r = render({ showSkeleton: true, clubArc: arc(true) });
    expect(all(r, 'Line').length).toBeGreaterThan(0);          // the skeleton is there
    expect(blueShaft(r)).toHaveLength(0);
    expect(blueHead(r)).toHaveLength(0);
    expect(traceSegs(r)).toHaveLength(0);
  });

  it('turned on, the arc draws', () => {
    const r = render({ showTrace: true, clubArc: arc(true) });
    expect(traceSegs(r).length).toBeGreaterThan(0);
  });
});

describe('the blue club is only where the club was seen', () => {
  it('before the first detection (address) there is no club — it is not pinned to the arc\'s first point', () => {
    const r = render({ showTrace: true, clubArc: arc(true), currentTimeMs: 200 });
    expect(blueShaft(r)).toHaveLength(0);
    expect(blueHead(r)).toHaveLength(0);
    expect(traceSegs(r).length).toBeGreaterThan(0);           // the arc itself still draws in full
  });

  it('after the last detection (finish) there is no club — not pinned to the last point either', () => {
    const r = render({ showTrace: true, clubArc: arc(true), currentTimeMs: 1600 });
    expect(blueShaft(r)).toHaveLength(0);
    expect(blueHead(r)).toHaveLength(0);
  });

  it('inside a stretch the tracker did not see, the head does not glide across it', () => {
    const r = render({ showTrace: true, clubArc: arc(true, 1200), currentTimeMs: 1200 });
    expect(blueHead(r)).toHaveLength(0);
    expect(blueShaft(r)).toHaveLength(0);
  });

  it('an arc with no measured grip (every arc stored before today) draws the head dot only — no shaft to the wrists', () => {
    const r = render({ showTrace: true, clubArc: arc(false), currentTimeMs: 1200 });
    expect(blueHead(r)).toHaveLength(1);
    expect(blueShaft(r)).toHaveLength(0);
  });

  it('with a measured grip, the shaft runs from THAT grip, not from the interpolated wrists', () => {
    const r = render({ showTrace: true, clubArc: arc(true), currentTimeMs: 1200 });
    const [shaft] = blueShaft(r);
    expect(shaft).toBeDefined();
    expect(shaft.props.x1).toBeCloseTo(0.42 * FW, 3);
    expect(shaft.props.y1).toBeCloseTo(0.5 * FH, 3);
    // the wrists at 1200ms are at (.5, ~.467) — not where the shaft starts
    expect(Math.abs(shaft.props.x1 - 0.5 * FW)).toBeGreaterThan(50);
    expect(blueHead(r)).toHaveLength(1);
  });
});
