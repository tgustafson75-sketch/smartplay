/**
 * 2026-10-27 — SEAM REVIEW of SB3c. The trace's HEAD is the cleaned arc (cleanArc drops a spike — a frame where
 * the tracker took the leg or a shadow for the head — and the 80ms gap rule then bridges the 66ms hole at
 * 30fps), but the GRIP samples were the raw ones, the spike's included: the grip measured from the bogus head
 * was interpolated against the real one, so the shaft swung off the hands for that stretch. A grip counts only
 * where its head was kept (services/swing/clubShaft).
 *
 * (Harness copied from the-swing-trace-is-opt-in-and-the-club-is-on-the-hands.)
 * Original header follows for the harness:
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


/** 30fps detections 900..1527ms, head sweeping (.7,.2) → (.3,.8), grip measured at (.42,.5); frame k=10 is a
 *  mis-detection: head on the far side of the frame, and the grip the tracker measured from it there too. */
function spikedArc() {
  const pts: { x: number; y: number; tMs: number; gx: number; gy: number }[] = [];
  for (let k = 0; k < 20; k++) {
    const tMs = 900 + 33 * k;
    if (k === 10) { pts.push({ x: 0.97, y: 0.04, tMs, gx: 0.93, gy: 0.08 }); continue; }
    pts.push({ x: 0.7 - 0.4 * (k / 19), y: 0.2 + 0.6 * (k / 19), tMs, gx: 0.42, gy: 0.5 });
  }
  return pts;
}

describe('the blue shaft runs from the grip of a head the trace kept', () => {
  it('next to a rejected head, the shaft still starts on the measured hands — not pulled toward the bogus grip', () => {
    const at = 900 + 33 * 10 + 15;   // between the spike and the next real detection
    const r = render({ showTrace: true, clubArc: spikedArc(), currentTimeMs: at });
    expect(blueHead(r)).toHaveLength(1);             // the head is bridged across the one dropped frame
    const [shaft] = blueShaft(r);
    expect(shaft).toBeDefined();
    expect(Math.abs(shaft.props.x1 - 0.42 * FW)).toBeLessThan(5);
    expect(Math.abs(shaft.props.y1 - 0.5 * FH)).toBeLessThan(5);
  });
  it('guard: away from the spike the shaft is on the grip too', () => {
    const r = render({ showTrace: true, clubArc: spikedArc(), currentTimeMs: 900 + 33 * 3 + 10 });
    const [shaft] = blueShaft(r);
    expect(shaft.props.x1).toBeCloseTo(0.42 * FW, 3);
  });
});
