/**
 * SwingBodyOverlay — renders a skeleton + swing-arc trace on top of the
 * swing video player using keypoints already computed by the pose pipeline
 * (services/poseAnalysisApi.ts → analyzeSwingFromVideo).
 *
 * Inputs:
 *   - frames: the 5 sampled positions (P1 address … P10 finish), each with
 *     keypoints. Already stored on the session via setSessionBiomechanics.
 *   - currentTimeMs: the playback position. We interpolate the skeleton
 *     between the two frames bracketing the current time.
 *   - showTrace: when true, draws a smooth path through the lead wrist
 *     across all frames — the canonical "swing arc" view used by every
 *     pro swing-review app.
 *
 * Coordinate handling — two paths:
 *   1. ALIGNED (preferred): when frames carry frameW/frameH (captured from
 *      the source thumbnail), we draw in true frame-pixel space — viewBox =
 *      "0 0 frameW frameH" with preserveAspectRatio matched to the video's
 *      resizeMode ("meet" for CONTAIN, "slice" for COVER). The SVG then
 *      letterboxes/crops EXACTLY like the video, so shoulders/hips/ankles
 *      land on the body. Normalized (0–1) coords are scaled up to frame
 *      pixels; pixel-absolute coords are used as-is.
 *   2. FALLBACK (old swings w/o dims): bbox-fit viewBox — self-fits to the
 *      keypoint bounding box. Keeps the skeleton roughly on the body but
 *      can drift since absolute position + frame aspect are unknown.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Line, Circle, G } from 'react-native-svg';
import type { PoseFrame, Keypoint } from '../../services/poseAnalysisApi';
import { cleanArc, catmullRomBezier, catmullRomPoint, type ArcPoint } from '../../services/swing/smoothArc';

const SKELETON_EDGES: [string, string][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

const MIN_KP_SCORE = 0.2;

// 2026-07-06 (Tim: "if the turn is wrong or the hips don't move, it needs to
// go orange or red, kinda like GolfFix, so you see the AREA of error") —
// map each diagnosable fault to the joints whose skeleton region renders hot.
// Derived from the fault's biomechanical home, not fabricated per-frame error
// detection: the ANALYSIS names the fault; this paints WHERE that fault lives.
export const FAULT_REGION_JOINTS: Record<string, string[]> = {
  over_the_top:          ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  swing_path_outside_in: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  swing_path_inside_out: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  plane_too_flat:        ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  plane_too_steep:       ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  attack_angle_steep:    ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  attack_angle_shallow:  ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  casting:               ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  club_face_open:        ['left_wrist', 'right_wrist'],
  club_face_closed:      ['left_wrist', 'right_wrist'],
  chicken_wing:          ['left_elbow', 'left_wrist', 'right_elbow', 'right_wrist'],
  early_extension:       ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
  sway:                  ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
  reverse_pivot:         ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
  spine_angle_loss:      ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'],
  head_movement:         ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'],
  // 2026-08-09 (elite fault engine) — arm + finish faults.
  lead_arm_bent:         ['left_shoulder', 'left_elbow', 'left_wrist', 'right_shoulder', 'right_elbow', 'right_wrist'],
  poor_finish:           ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
};

/** Joints to paint hot for a fault id (primary_fault or canonical issue_id).
 *  Empty array = no highlight (unknown/none/inconclusive). */
export function faultJointsFor(faultId: string | null | undefined): string[] {
  if (!faultId) return [];
  return FAULT_REGION_JOINTS[faultId] ?? [];
}

const FAULT_HOT_COLOR = '#FF6B2C'; // orange — the error region
const FAULT_HOT_SEVERE = '#EF4444'; // red — significant severity

type Props = {
  frames: PoseFrame[];
  currentTimeMs: number;
  showSkeleton?: boolean;
  showTrace?: boolean;
  /** Must match the underlying <Video> resizeMode so the overlay
   *  letterboxes/crops identically. 'contain' = letterbox (meet),
   *  'cover' = crop (slice). Defaults to 'contain'. */
  resizeMode?: 'contain' | 'cover';
  /** 2026-07-06 — joints in the diagnosed fault's region render hot
   *  (orange / red when severe) so the error AREA reads at a glance.
   *  Empty/absent = all-green skeleton exactly as before. */
  faultJoints?: string[];
  faultSevere?: boolean;
  /** 2026-07-07 (Tim — real clubhead swing arc) — the DETECTED clubhead positions
   *  (full-frame normalized, from services/swing/clubPath → /api/club-path), in time
   *  order. When present with enough points, the swing trace is drawn through the REAL
   *  clubhead path (with a dot at each detected position) instead of the wrist proxy.
   *  Absent/too-few → the honest hand/tempo trace, exactly as before. */
  clubArc?: { x: number; y: number; tMs: number }[] | null;
  /** 2026-08-10 (Tim — "haven't seen the club trace in a week") — the video's true pixel size. Used as
   *  the ALIGNED-space fallback so the clubhead arc (full-frame normalized) still renders when the pose
   *  frames don't carry frameW/frameH (skeleton falls back to bbox; the club needs a frame to map into).
   *  Only used when pose coords are normalized (both skeleton + club then share this full-frame space). */
  videoW?: number | null;
  videoH?: number | null;
};

/** Minimum detected clubhead points before we draw the club arc (vs the wrist proxy). */
// 2026-08-06 (Tim — blue club never shows): 4→3 to match the loosened detection gate (services/swing/
// clubPath.ts + api/club-path.ts). A 3-point partial sweep still renders a real club instead of nothing.
const MIN_CLUB_POINTS = 3;

/** Detect whether keypoint coords are normalized 0–1 vs pixel-absolute by
 *  the largest coordinate seen. Pixel coords are in the 100s; normalized
 *  stay ≤ ~1, so a 1.5 threshold separates them robustly. */
function coordsAreNormalized(frames: PoseFrame[]): boolean {
  let maxCoord = 0;
  for (const f of frames) {
    for (const k of f.keypoints) {
      if (k.score < MIN_KP_SCORE) continue;
      if (Math.abs(k.x) > maxCoord) maxCoord = Math.abs(k.x);
      if (Math.abs(k.y) > maxCoord) maxCoord = Math.abs(k.y);
    }
  }
  return maxCoord <= 1.5;
}

function getKp(frame: PoseFrame, name: string): Keypoint | null {
  const k = frame.keypoints.find(p => p.name === name);
  if (!k || k.score < MIN_KP_SCORE) return null;
  return k;
}

// 2026-07-02 (Tim's tempo-heat-map vision) — map a normalized swing speed [0..1] to the tempo
// heat color: 0 = smooth (green #22c55e) → 0.5 (amber #eab308) → 1 = fast (red #ef4444). Matches the
// SWING TEMPO gradient bar (slow/smooth/fast) so the arc reads as WHERE the swing runs hot.
function speedHeatColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
  let r: number, g: number, b: number;
  if (c < 0.5) {
    const k = c / 0.5;
    r = lerp(0x22, 0xea, k); g = lerp(0xc5, 0xb3, k); b = lerp(0x5e, 0x08, k);
  } else {
    const k = (c - 0.5) / 0.5;
    r = lerp(0xea, 0xef, k); g = lerp(0xb3, 0x44, k); b = lerp(0x08, 0x44, k);
  }
  return `rgb(${r},${g},${b})`;
}

function interpolateFrame(frames: PoseFrame[], timeMs: number): PoseFrame | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];
  const sorted = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
  if (timeMs <= sorted[0].timestampMs) return sorted[0];
  if (timeMs >= sorted[sorted.length - 1].timestampMs) return sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (timeMs >= a.timestampMs && timeMs <= b.timestampMs) {
      const span = b.timestampMs - a.timestampMs;
      const t = span > 0 ? (timeMs - a.timestampMs) / span : 0;
      // 2026-08-06 (Tim — mechanics "super tight", "the skeleton slides robotically"). Smooth the skeleton
      // between sparse anchors with CATMULL-ROM (through the neighboring frames) instead of a straight
      // chord, so the body — and the grip end of the blue shaft — tracks the real motion between anchors
      // instead of sliding in a straight line. Endpoints clamp (degrade to ~linear).
      const p0 = sorted[i - 1] ?? a;
      const p3 = sorted[i + 2] ?? b;
      const blended: Keypoint[] = a.keypoints.map(ka => {
        const kb = b.keypoints.find(p => p.name === ka.name);
        if (!kb) return ka;
        const k0 = p0.keypoints.find(p => p.name === ka.name) ?? ka;
        const k3 = p3.keypoints.find(p => p.name === ka.name) ?? kb;
        // 2026-08-06 (analysis audit) — CENTRIPETAL eval (was uniform CR, which overshoots the true top of
        // the swing between sparse anchors — flinging the joint above the real position). Same curve family
        // as the drawn trace, so the grip end of the blue shaft stays consistent with the clubhead marker.
        const pt = catmullRomPoint(
          { x: k0.x, y: k0.y, t: 0 }, { x: ka.x, y: ka.y, t: 0 },
          { x: kb.x, y: kb.y, t: 0 }, { x: k3.x, y: k3.y, t: 0 }, t,
        );
        return { name: ka.name, x: pt.x, y: pt.y, score: Math.min(ka.score, kb.score) };
      });
      return { timestampMs: timeMs, keypoints: blended };
    }
  }
  return sorted[sorted.length - 1];
}

function computeBBox(frames: PoseFrame[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of frames) {
    for (const k of f.keypoints) {
      if (k.score < MIN_KP_SCORE) continue;
      if (k.x < minX) minX = k.x;
      if (k.y < minY) minY = k.y;
      if (k.x > maxX) maxX = k.x;
      if (k.y > maxY) maxY = k.y;
    }
  }
  if (!isFinite(minX) || !isFinite(minY)) return null;
  const pad = Math.max((maxX - minX) * 0.15, (maxY - minY) * 0.15, 0.05);
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export default function SwingBodyOverlay({
  frames,
  currentTimeMs,
  showSkeleton = true,
  showTrace = true,
  resizeMode = 'contain',
  faultJoints,
  faultSevere = false,
  clubArc,
  videoW,
  videoH,
}: Props) {
  const hotSet = useMemo(() => new Set(faultJoints ?? []), [faultJoints]);
  const hotColor = faultSevere ? FAULT_HOT_SEVERE : FAULT_HOT_COLOR;
  const live = useMemo(() => interpolateFrame(frames, currentTimeMs), [frames, currentTimeMs]);
  const bbox = useMemo(() => computeBBox(frames), [frames]);

  // Aligned path: when we know the true frame dimensions, draw in frame-pixel
  // space so the overlay maps onto the body exactly like the video.
  const aligned = useMemo(() => {
    const dimFrame = frames.find(f => (f.frameW ?? 0) > 0 && (f.frameH ?? 0) > 0);
    const normalized = coordsAreNormalized(frames);
    let fw: number, fh: number;
    if (dimFrame) {
      fw = dimFrame.frameW as number;
      fh = dimFrame.frameH as number;
    } else if (normalized && (videoW ?? 0) > 0 && (videoH ?? 0) > 0) {
      // 2026-08-10 — no per-frame dims, but the pose coords are normalized 0..1 and we know the video's
      // true size: use it as the full-frame space so BOTH skeleton and the clubhead arc draw aligned
      // (was: skeleton bbox-fit, club silently dropped — the "no trace for a week" bug).
      fw = videoW as number;
      fh = videoH as number;
    } else {
      return null;
    }
    return {
      fw, fh,
      // Scale factor to take coords into frame-pixel space.
      sx: normalized ? fw : 1,
      sy: normalized ? fh : 1,
    };
  }, [frames, videoW, videoH]);

  // 2026-07-02 (Tim's mockup vision) — the swing trace as a TEMPO HEAT MAP: a smooth Catmull-Rom
  // spline through the lead-wrist path, split into per-segment colored strokes where color = the
  // wrist SPEED at that part of the swing (green = smooth, amber → red = fast). This surfaces WHERE
  // the swing is smooth vs rushing (the downswing runs hot), tying the arc to tempo. Real signal
  // (wrist px/ms), not fabricated. (Clubhead-radius tracking + densified slow-mo detail are the next
  // layer — see the note to Tim; for now the arc follows the wrist, the only pose-derived point.)
  // 2026-07-07 (Tim — real clubhead arc) — draw the trace through the DETECTED clubhead
  // path when we have enough real points; else fall back to the wrist proxy. Same heat
  // coloring (speed between points), same aligned frame space. `useClub` also drives the
  // per-detection dots below so the user sees the REAL detected clubhead positions.
  // Club path REQUIRES aligned frame space: club points are full-frame normalized, so
  // in the legacy bbox-fallback space (no frameW/frameH) they can't be placed honestly —
  // keep the wrist trace there instead of drawing a misregistered club arc.
  const useClub = !!(aligned && clubArc && clubArc.length >= MIN_CLUB_POINTS);

  // 2026-07-18 (Tim — "swing tracing needs to be a SMOOTH arc that follows the clubhead, not a
  // glitchy bouncing line; average it out") — build the trace points ONCE, then CLEAN them
  // (drop mis-detection spikes + moving-average the jitter) so both the line and the dots draw
  // from the same smoothed, de-spiked path. The raw detections are untouched upstream (the
  // "seen in N of M" honesty count still reflects reality); this is a faithful render of a
  // continuous clubhead sweep, not a fabricated curve.
  const tracePts = useMemo<{ pts: ArcPoint[]; isClub: boolean }>(() => {
    // 2026-07-24 (Tim — "SmartMotion STILL following hands not clubhead... 20 times... false fixes").
    // ROOT CAUSE: this used to fall back to the LEAD-WRIST path whenever the clubhead wasn't
    // detected. The wrist path loops tightly around the torso — it looks like a broken clubhead
    // trace, and no amount of tuning the wrist proxy ever made it "the clubhead". Per Tim's law
    // ("trace it correctly or not at all"), the swing trace now draws ONLY through the REAL detected
    // clubhead arc. No clubhead detection → NO trace (skeleton only). We never draw the hand path.
    if (!(aligned && clubArc && clubArc.length >= MIN_CLUB_POINTS)) {
      return { pts: [], isClub: false };
    }
    // clubArc points are full-frame normalized (0..1) → scale by frame dims (audit SM2).
    const raw: ArcPoint[] = clubArc.map(p => ({ x: p.x * aligned.fw, y: p.y * aligned.fh, t: p.tMs }));
    // cleanArc guards non-finite (a NaN in the `d` string throws in native SVG → white screen),
    // rejects spikes, and averages the jitter.
    return { pts: cleanArc(raw), isClub: true };
  }, [aligned, clubArc]);

  const traceSegments = useMemo(() => {
    const P = tracePts.pts;
    if (P.length < 2) return [];
    // Per-segment speed (px/ms), normalized min→max across the swing → heat color.
    const speeds: number[] = [];
    for (let i = 0; i < P.length - 1; i++) {
      const d = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y);
      const dt = Math.max(1, P[i + 1].t - P[i].t);
      speeds.push(d / dt);
    }
    const maxS = Math.max(...speeds);
    const minS = Math.min(...speeds);
    const span = maxS - minS;
    const segs: { d: string; color: string }[] = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] ?? P[i];
      const p1 = P[i];
      const p2 = P[i + 1];
      const p3 = P[i + 2] ?? P[i + 1];
      // CENTRIPETAL Catmull-Rom control points — no overshoot / loops / cusps (the glitch).
      const { cp1x, cp1y, cp2x, cp2y } = catmullRomBezier(p0, p1, p2, p3);
      const d = `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
      const norm = span > 1e-6 ? (speeds[i] - minS) / span : 0.5;
      segs.push({ d, color: speedHeatColor(norm) });
    }
    return segs;
  }, [tracePts]);

  // Dots at the CLEANED clubhead points (spikes removed) so the measured markers sit ON the
  // smoothed arc instead of scattering off it — reads as "measured, then followed smoothly".
  const clubDots = useMemo(() => {
    if (!useClub || !tracePts.isClub) return [];
    return tracePts.pts.filter(d => Number.isFinite(d.x) && Number.isFinite(d.y));
  }, [useClub, tracePts]);

  // 2026-07-27 (Tim — "line the club shaft and head as a jointed body part, blue for clarity") — the
  // clubhead position at the CURRENT frame, interpolated along the cleaned club arc (already in frame-
  // pixel space). Paired with the grip (wrist midpoint) below to draw a blue shaft + head that extends
  // the skeleton into the club. Only when we have a REAL detected clubhead path (useClub) → honest.
  const clubTip = useMemo(() => {
    const P = tracePts.pts;
    if (!useClub || P.length < 2) return null;
    const t = currentTimeMs;
    if (t <= P[0].t) return { x: P[0].x, y: P[0].y };
    if (t >= P[P.length - 1].t) return { x: P[P.length - 1].x, y: P[P.length - 1].y };
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      if (t >= a.t && t <= b.t) {
        const s = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        // 2026-08-06 (Tim — "the club shows but doesn't line up with the actual club"). Interpolate the
        // head along a smooth CATMULL-ROM curve through the neighboring arc points instead of a straight
        // CHORD between two sparse detections. A chord cuts across the real sweep, so mid-swing the head
        // sat inside/off the true arc; the spline follows the curve so the blue head tracks the real
        // clubhead between detections. Endpoints clamp to the segment (degrades to ~linear at the ends).
        const p0 = P[i - 1] ?? a, p3 = P[i + 2] ?? b;
        // 2026-08-06 (analysis audit) — evaluate the SAME centripetal Catmull-Rom Bézier the trace draws
        // (catmullRomPoint) instead of a UNIFORM CR eval. Uniform traced a different curve than the drawn
        // (centripetal) line AND overshot the reversal, so the blue head floated off its own arc. Now the
        // marker sits exactly on the rendered trace.
        return catmullRomPoint(p0, a, b, p3, s);
      }
    }
    return { x: P[P.length - 1].x, y: P[P.length - 1].y };
  }, [useClub, tracePts, currentTimeMs]);

  if (!live) return null;
  // Aligned mode draws in true frame space and matches the video resizeMode;
  // fallback self-fits to the keypoint bbox.
  let sx = 1, sy = 1, vb: string, par: string, strokeBase: number;
  if (aligned) {
    sx = aligned.sx; sy = aligned.sy;
    vb = `0 0 ${aligned.fw} ${aligned.fh}`;
    par = resizeMode === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
    strokeBase = Math.max(aligned.fw, aligned.fh);
  } else {
    if (!bbox) return null;
    vb = `${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`;
    par = 'xMidYMid meet';
    strokeBase = Math.max(bbox.w, bbox.h);
  }
  // Stroke widths derived from the draw space so the overlay stays readable.
  // 2026-06-29 (Tim) — thinner, cleaner skeleton to match the brand/marketing look
  // (fine neon-green lines, not heavy strokes).
  const sw = strokeBase * 0.008;
  // 2026-06-15 (Tim) — joint dots were too big and overlapped; smaller so the
  // skeleton reads cleanly (joints sit on the lines, not blobs over them).
  const dotR = strokeBase * 0.008;

  // 2026-07-27 (Tim) — the BLUE club: a shaft from the grip (wrist midpoint) to the live clubhead + a
  // blue clubhead dot, drawn ON TOP so it reads as the club extending off the hands. Only when a real
  // clubhead path is detected (useClub) and we have both endpoints this frame — honest, never faked.
  const CLUB_BLUE = '#4EA8FF';
  const gripKps = [getKp(live, 'left_wrist'), getKp(live, 'right_wrist')].filter(Boolean) as Keypoint[];
  const grip = gripKps.length
    ? { x: (gripKps.reduce((s, k) => s + k.x, 0) / gripKps.length) * sx, y: (gripKps.reduce((s, k) => s + k.y, 0) / gripKps.length) * sy }
    : null;
  const showClub = useClub && !!clubTip && !!grip
    && Number.isFinite(grip.x) && Number.isFinite(grip.y)
    && Number.isFinite(clubTip.x) && Number.isFinite(clubTip.y)
    && (showSkeleton || showTrace);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={vb} preserveAspectRatio={par}>
        {showTrace && traceSegments.map((seg, i) => (
          <Path
            key={`trace-${i}`}
            d={seg.d}
            stroke={seg.color}
            strokeWidth={sw * 0.9}
            strokeOpacity={0.9}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {/* Real detected clubhead positions — a dot at each actual detection so the
            arc reads as MEASURED (not a synthetic curve). Only shown for the club path. */}
        {showTrace && clubDots.map((d, i) => (
          <Circle key={`club-${i}`} cx={d.x} cy={d.y} r={sw * 1.1} fill="#FFFFFF" fillOpacity={0.95} stroke="#88F700" strokeWidth={sw * 0.4} />
        ))}
        {showSkeleton && (
          <G>
            {SKELETON_EDGES.map(([a, b]) => {
              const ka = getKp(live, a);
              const kb = getKp(live, b);
              if (!ka || !kb) return null;
              // Edge renders hot when BOTH endpoints sit in the fault region —
              // paints the region's segments, not stray connectors into it.
              const hot = hotSet.has(a) && hotSet.has(b);
              const x1 = ka.x * sx, y1 = ka.y * sy, x2 = kb.x * sx, y2 = kb.y * sy;
              if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return null;
              return (
                <Line
                  key={`${a}-${b}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={hot ? hotColor : '#88F700'}
                  strokeWidth={hot ? sw * 1.25 : sw}
                  strokeOpacity={0.9}
                  strokeLinecap="round"
                />
              );
            })}
            {live.keypoints.map((k, i) => {
              if (k.score < MIN_KP_SCORE) return null;
              const cx = k.x * sx, cy = k.y * sy;
              if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
              const hot = k.name != null && hotSet.has(k.name);
              return (
                <Circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={hot ? dotR * 1.2 : dotR}
                  fill="#ffffff"
                  stroke={hot ? hotColor : '#88F700'}
                  strokeWidth={sw * 0.6}
                />
              );
            })}
          </G>
        )}
        {/* Blue club — shaft (grip → clubhead) + clubhead dot. Drawn last so it sits on top of the
            skeleton, reading as the club jointed off the hands. Only when a real clubhead is detected. */}
        {showClub && grip && clubTip && (
          <G>
            <Line
              x1={grip.x} y1={grip.y} x2={clubTip.x} y2={clubTip.y}
              stroke={CLUB_BLUE}
              strokeWidth={sw * 1.15}
              strokeOpacity={0.95}
              strokeLinecap="round"
            />
            <Circle cx={clubTip.x} cy={clubTip.y} r={dotR * 1.7} fill={CLUB_BLUE} fillOpacity={0.95} stroke="#ffffff" strokeWidth={sw * 0.4} />
          </G>
        )}
      </Svg>
    </View>
  );
}
