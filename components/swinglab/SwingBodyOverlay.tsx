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
};

/** Minimum detected clubhead points before we draw the club arc (vs the wrist proxy). */
const MIN_CLUB_POINTS = 4;

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
      const blended: Keypoint[] = a.keypoints.map(ka => {
        const kb = b.keypoints.find(p => p.name === ka.name);
        if (!kb) return ka;
        return {
          name: ka.name,
          x: ka.x + (kb.x - ka.x) * t,
          y: ka.y + (kb.y - ka.y) * t,
          score: Math.min(ka.score, kb.score),
        };
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
}: Props) {
  const hotSet = useMemo(() => new Set(faultJoints ?? []), [faultJoints]);
  const hotColor = faultSevere ? FAULT_HOT_SEVERE : FAULT_HOT_COLOR;
  const live = useMemo(() => interpolateFrame(frames, currentTimeMs), [frames, currentTimeMs]);
  const bbox = useMemo(() => computeBBox(frames), [frames]);

  // Aligned path: when we know the true frame dimensions, draw in frame-pixel
  // space so the overlay maps onto the body exactly like the video.
  const aligned = useMemo(() => {
    const dimFrame = frames.find(f => (f.frameW ?? 0) > 0 && (f.frameH ?? 0) > 0);
    if (!dimFrame) return null;
    const fw = dimFrame.frameW as number;
    const fh = dimFrame.frameH as number;
    const normalized = coordsAreNormalized(frames);
    return {
      fw, fh,
      // Scale factor to take coords into frame-pixel space.
      sx: normalized ? fw : 1,
      sy: normalized ? fh : 1,
    };
  }, [frames]);

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
  const traceSegments = useMemo(() => {
    const sx = aligned ? aligned.sx : 1;
    const sy = aligned ? aligned.sy : 1;
    let P: { x: number; y: number; t: number }[];
    if (aligned && clubArc && clubArc.length >= MIN_CLUB_POINTS) {
      P = clubArc.map(p => ({ x: p.x * sx, y: p.y * sy, t: p.tMs }));
    } else {
      const sorted = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
      const traceName = sorted.some(f => getKp(f, 'right_wrist')) ? 'right_wrist' : 'left_wrist';
      const raw = sorted
        .map(f => ({ k: getKp(f, traceName), t: f.timestampMs }))
        .filter((r): r is { k: Keypoint; t: number } => r.k != null);
      if (raw.length < 2) return [];
      P = raw.map(r => ({ x: r.k.x * sx, y: r.k.y * sy, t: r.t }));
    }
    // 2026-07-08 (Tim — white screen in swing replay) — a single non-finite coord in the
    // path `d` string makes react-native-svg's native parser THROW → white screen. Drop any
    // non-finite point before we build the spline so a bad frame can never crash the replay.
    P = P.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.t));
    if (P.length < 2) return [];
    // Per-segment speed (px/ms), normalized min→max across the swing → heat color.
    const speeds: number[] = [];
    for (let i = 0; i < P.length - 1; i++) {
      const dist = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y);
      const dt = Math.max(1, P[i + 1].t - P[i].t);
      speeds.push(dist / dt);
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
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      const d = `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
      const norm = span > 1e-6 ? (speeds[i] - minS) / span : 0.5;
      segs.push({ d, color: speedHeatColor(norm) });
    }
    return segs;
  }, [frames, aligned, clubArc]);

  // Real detected clubhead positions to dot on the arc (only when drawing the club
  // path) — these are the actual per-frame detections, so the user sees the truth.
  const clubDots = useMemo(() => {
    if (!useClub || !clubArc) return [];
    const sx = aligned ? aligned.sx : 1;
    const sy = aligned ? aligned.sy : 1;
    return clubArc
      .map(p => ({ x: p.x * sx, y: p.y * sy }))
      .filter(d => Number.isFinite(d.x) && Number.isFinite(d.y)); // never emit a NaN <Circle> → white screen
  }, [useClub, clubArc, aligned]);

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
      </Svg>
    </View>
  );
}
