/**
 * 2026-05-22 — AR Shot Trace Overlay (Pass 1: SVG projection).
 *
 * Renders the active ShotTrace from services/arShotTracer.ts as an SVG
 * layer over whatever parent view it's mounted on (typically expo-
 * camera's <CameraView>). Pure-JS pinhole projection — no expo-gl /
 * three.js dependency. 60fps target on mid-tier phones via:
 *   - useEffect-driven RAF loop with adaptive frame skip
 *   - Memoized projected points per render frame
 *   - SVG count capped per quality tier (default 24 segments)
 *   - Trail decay rendered as a single Path, not per-point Circles
 *
 * Pass 2 (deferred): swap to expo-gl + three.js for true 3D perspective
 * + glow shaders + instanced trajectory mesh. Contract here stays so
 * the swap is a component-level change with no caller modification.
 *
 * Camera-pose model (Pass 1):
 *   - Camera centered on the player's start position, looking down the
 *     shot azimuth, pitched up by `cameraPitchDeg` (default 5°).
 *   - World coords (downrange, lateral, altitude) are rotated into
 *     camera frame, then pinhole-projected by `fovDeg`.
 *   - This deliberately ignores actual phone IMU heading. Pass 2 wires
 *     real heading + pitch from DeviceMotion so the trace tracks as
 *     the player pans the camera.
 *
 * Defensive: no active trace → renders nothing (collapsed to null).
 * Trace with zero points → renders nothing. Insufficient quality →
 * shows a thin dashed line + landing label only (graceful degradation).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Path, Circle, Text as SvgText, Defs, LinearGradient, Stop,
} from 'react-native-svg';
import {
  subscribeActiveTrace, type ActiveTrace,
} from '../services/arShotTracer';
import type { FlightPoint } from '../utils/ballFlightPhysics';

export type QualityTier = 'high' | 'balanced' | 'battery_saver';

export interface CameraPose {
  /** Compass heading in degrees (0=N, 90=E). */
  headingDeg: number;
  /** Pitch in degrees. Negative = camera looking down, positive = up. */
  pitchDeg: number;
}

export interface ArShotTraceOverlayProps {
  width: number;
  height: number;
  /** Horizontal field of view in degrees. iPhone main camera ~70°. */
  fovDeg?: number;
  /** Upward camera pitch in degrees — used ONLY when cameraPose is
   *  not supplied (static fallback). Slight positive helps frame the
   *  apex without losing the landing zone. */
  cameraPitchDeg?: number;
  /** 2026-05-22 — Pass 2: live device pose from hooks/useDeviceCameraPose.
   *  When supplied, projection uses the real phone heading + pitch so
   *  the trace tracks as the player pans the camera around. The
   *  trajectory rotates relative to (cameraPose.headingDeg − trace
   *  azimuth) so when the camera faces target, downrange = into screen. */
  cameraPose?: CameraPose | null;
  /** Quality tier — caller may downgrade based on device thermal /
   *  battery state. 'battery_saver' caps at 12 points + no trail. */
  quality?: QualityTier;
  /** Optional callback fired when the animated ball passes each
   *  voice-narration beat (launch / apex / landing). Caller wires this
   *  to voiceService.speak. */
  onBeat?: (beat: 'launch' | 'apex' | 'landing', trace: ActiveTrace) => void;
}

const PROJECTION_NEAR_Z = 2; // yards — ignore points closer than this

// ─── Public component ────────────────────────────────────────────────────

export default function ArShotTraceOverlay({
  width, height,
  fovDeg = 70, cameraPitchDeg = 5,
  cameraPose = null,
  quality = 'balanced',
  onBeat,
}: ArShotTraceOverlayProps) {
  const [trace, setTrace] = useState<ActiveTrace | null>(null);
  const [t, setT] = useState(0);   // normalized 0..1 along flight
  const beatFiredRef = useRef<Set<'launch' | 'apex' | 'landing'>>(new Set());

  // Subscribe to active trace from the service. Auto-cleanup on unmount.
  useEffect(() => {
    const unsub = subscribeActiveTrace(next => {
      setTrace(next);
      setT(0);
      beatFiredRef.current.clear();
    });
    return unsub;
  }, []);

  // ─── Animation clock — frame-skip aware ────────────────────────────
  // We update `t` along the flight when status === 'flying'. For
  // 'predicted' (pre-shot preview) and 'landed' (post-shot replay) we
  // hold t=1 so the full path renders statically.
  useEffect(() => {
    if (!trace) return;
    if (trace.status !== 'flying') { setT(1); return; }
    const flightMs = trace.flight.flight_seconds * 1000;
    if (flightMs <= 0) { setT(1); return; }
    let raf: number | null = null;
    let cancelled = false;
    const start = trace.started_at_ms;
    // Frame budget: 30fps in balanced, 45fps in high, 15fps in battery saver.
    const frameMs = quality === 'high' ? 22 : quality === 'battery_saver' ? 66 : 33;
    let lastFrame = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      if (now - lastFrame < frameMs) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;
      const elapsed = Date.now() - start;
      const nextT = Math.min(1, elapsed / flightMs);
      setT(nextT);
      if (onBeat) fireBeats(nextT, trace, beatFiredRef.current, onBeat);
      if (nextT < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; if (raf != null) cancelAnimationFrame(raf); };
  }, [trace, quality, onBeat]);

  // ─── Projection (memoized per trace + container size + quality) ────
  // 2026-05-22 — Pass 2: when cameraPose supplied, use real heading/pitch
  // so trace tracks panning. Otherwise fall back to static cameraPitchDeg.
  const effectivePitch = cameraPose?.pitchDeg ?? cameraPitchDeg;
  const cameraHeading = cameraPose?.headingDeg ?? null;
  const projected = useMemo(() => {
    if (!trace || trace.flight.points.length === 0) return null;
    return projectFlight(trace, width, height, fovDeg, effectivePitch, cameraHeading, quality);
  }, [trace, width, height, fovDeg, effectivePitch, cameraHeading, quality]);

  if (!trace || !projected) return null;

  const visiblePoints = projected.points;
  const headIdx = Math.min(visiblePoints.length - 1, Math.floor(t * (visiblePoints.length - 1)));
  const headPoint = visiblePoints[headIdx];
  const pathD = buildPath(visiblePoints, headIdx, trace.status);
  const trailD = quality === 'battery_saver' ? null : buildTrailPath(visiblePoints, headIdx);
  const dispersionR = projected.dispersionRadiusPx;
  const landing = projected.landing;
  const apex = projected.apex;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="trace-gradient" x1="0%" y1="100%" x2="0%" y2="0%">
            <Stop offset="0%" stopColor="#22c55e" stopOpacity={0.9} />
            <Stop offset="100%" stopColor="#86efac" stopOpacity={0.8} />
          </LinearGradient>
        </Defs>

        {landing && (
          <Circle
            cx={landing.x}
            cy={landing.y}
            r={dispersionR}
            fill="rgba(34, 197, 94, 0.10)"
            stroke="rgba(34, 197, 94, 0.45)"
            strokeWidth={1}
            strokeDasharray="4,3"
          />
        )}

        <Path
          d={pathD}
          stroke="url(#trace-gradient)"
          strokeWidth={trace.status === 'predicted' ? 2 : 3}
          fill="none"
          strokeDasharray={trace.status === 'predicted' ? '8,5' : undefined}
          strokeLinecap="round"
        />

        {trailD && (
          <Path
            d={trailD}
            stroke="#fef3c7"
            strokeWidth={2}
            fill="none"
            opacity={0.7}
            strokeLinecap="round"
          />
        )}

        {trace.status !== 'predicted' && headPoint && (
          <>
            <Circle cx={headPoint.x} cy={headPoint.y} r={6}
              fill="#ffffff" stroke="#22c55e" strokeWidth={2} />
            <Circle cx={headPoint.x} cy={headPoint.y} r={11}
              fill="none" stroke="rgba(34, 197, 94, 0.45)" strokeWidth={1.5} />
          </>
        )}

        {landing && trace.status !== 'predicted' && (
          <Circle cx={landing.x} cy={landing.y} r={5}
            fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />
        )}

        {apex && (
          <>
            <SvgText x={apex.x + 8} y={apex.y - 8}
              fill="none" stroke="rgba(0,0,0,0.75)" strokeWidth={3}
              fontSize={12} fontWeight="800">
              ~{trace.flight.apex_ft}ft
            </SvgText>
            <SvgText x={apex.x + 8} y={apex.y - 8}
              fill="#fef3c7" fontSize={12} fontWeight="800">
              ~{trace.flight.apex_ft}ft
            </SvgText>
          </>
        )}

        {landing && (
          <>
            <SvgText x={landing.x + 10} y={landing.y + 6}
              fill="none" stroke="rgba(0,0,0,0.75)" strokeWidth={3}
              fontSize={13} fontWeight="900">
              ~{trace.flight.carry_yd}y
            </SvgText>
            <SvgText x={landing.x + 10} y={landing.y + 6}
              fill="#ffffff" fontSize={13} fontWeight="900">
              ~{trace.flight.carry_yd}y
            </SvgText>
          </>
        )}
      </Svg>

      <View style={styles.hudBar}>
        <Text style={styles.hudText} numberOfLines={1}>
          {(trace.club ?? 'shot').toUpperCase()} · {hudStatus(trace.status)} · {trace.confidence}%
        </Text>
      </View>
    </View>
  );
}

// ─── Projection internals ────────────────────────────────────────────────

interface ProjectedPoint { x: number; y: number; z: number }
interface ProjectedTrace {
  points: ProjectedPoint[];
  apex: ProjectedPoint | null;
  landing: ProjectedPoint | null;
  dispersionRadiusPx: number;
}

function projectFlight(
  trace: ActiveTrace, w: number, h: number,
  fovDeg: number, cameraPitchDeg: number,
  cameraHeadingDeg: number | null,
  quality: QualityTier,
): ProjectedTrace | null {
  const fovRad = (fovDeg * Math.PI) / 180;
  const fx = (w / 2) / Math.tan(fovRad / 2);
  const fyVal = fx;
  const cx = w / 2;
  const cy = h / 2;
  const pitchRad = (cameraPitchDeg * Math.PI) / 180;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);

  // Pass 2 — heading offset.
  // When cameraHeadingDeg is supplied, we yaw the world's "downrange"
  // axis by (cameraHeading − traceAzimuth) so the trace rotates as the
  // player pans. When null, behave as before (forward = camera-facing).
  const yawDeg = cameraHeadingDeg != null
    ? angleDelta(cameraHeadingDeg, trace.azimuth_deg)
    : 0;
  const yawRad = (yawDeg * Math.PI) / 180;
  const cosY = Math.cos(yawRad);
  const sinY = Math.sin(yawRad);

  const maxPoints = quality === 'high' ? 32 : quality === 'battery_saver' ? 12 : 24;
  const stride = Math.max(1, Math.floor(trace.flight.points.length / maxPoints));

  const projected: ProjectedPoint[] = [];
  let apex: ProjectedPoint | null = null;
  let apexAlt = -Infinity;
  for (let i = 0; i < trace.flight.points.length; i += stride) {
    const p = trace.flight.points[i];
    const proj = projectPoint(p, fx, fyVal, cx, cy, cosP, sinP, cosY, sinY);
    if (proj) {
      projected.push(proj);
      if (p.altitude_ft > apexAlt) { apexAlt = p.altitude_ft; apex = proj; }
    }
  }
  const landingFlight = trace.flight.points[trace.flight.points.length - 1];
  const landing = landingFlight
    ? projectPoint(landingFlight, fx, fyVal, cx, cy, cosP, sinP, cosY, sinY)
    : null;
  if (landing && projected.length > 0) {
    projected[projected.length - 1] = landing;
  }
  const dispersionRadiusPx = landingFlight
    ? Math.max(8, Math.min(64, (trace.flight.carry_yd > 0
        ? (15 * fx) / Math.max(PROJECTION_NEAR_Z, landingFlight.downrange_yd)
        : 16)))
    : 16;
  return { points: projected, apex, landing, dispersionRadiusPx };
}

function projectPoint(
  p: FlightPoint, fx: number, fy: number, cx: number, cy: number,
  cosP: number, sinP: number, cosY: number, sinY: number,
): ProjectedPoint | null {
  // World axes: x=downrange, y=lateral (right+), z=up (ft → yd via /3).
  // Pass 2 — yaw rotation: when player pans the camera, the trace's
  // downrange axis rotates relative to the camera frame. Apply yaw first
  // (rotation around the up axis), THEN pitch (rotation around lateral).
  const xWorld = p.lateral_yd;
  const zWorld = p.downrange_yd;
  const xCam0 = xWorld * cosY - zWorld * sinY;
  const zCam0 = xWorld * sinY + zWorld * cosY;
  const yWorld = p.altitude_ft / 3;
  const xCam = xCam0;
  const yCam = -zCam0 * sinP + yWorld * cosP;
  const zCam = zCam0 * cosP + yWorld * sinP;
  if (zCam < PROJECTION_NEAR_Z) return null;
  const x = cx + (xCam * fx) / zCam;
  const y = cy - (yCam * fy) / zCam;
  return { x, y, z: zCam };
}

/** Smallest signed angle delta in degrees. */
function angleDelta(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

// ─── Path string builders ────────────────────────────────────────────────

function buildPath(points: ProjectedPoint[], headIdx: number, status: ActiveTrace['status']): string {
  if (points.length === 0) return '';
  const upTo = status === 'flying' ? Math.max(1, headIdx + 1) : points.length;
  const slice = points.slice(0, upTo);
  return slice
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}

function buildTrailPath(points: ProjectedPoint[], headIdx: number): string {
  const start = Math.max(0, headIdx - 6);
  const slice = points.slice(start, headIdx + 1);
  if (slice.length < 2) return '';
  return slice
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}

// ─── Beat firing for voice narration ─────────────────────────────────────

function fireBeats(
  t: number, trace: ActiveTrace, fired: Set<'launch' | 'apex' | 'landing'>,
  onBeat: NonNullable<ArShotTraceOverlayProps['onBeat']>,
): void {
  if (!fired.has('launch') && t > 0.02) { fired.add('launch'); onBeat('launch', trace); }
  if (!fired.has('apex') && t > 0.45 && t < 0.6) { fired.add('apex'); onBeat('apex', trace); }
  if (!fired.has('landing') && t >= 0.98) { fired.add('landing'); onBeat('landing', trace); }
}

// ─── HUD helpers ─────────────────────────────────────────────────────────

function hudStatus(s: ActiveTrace['status']): string {
  switch (s) {
    case 'predicted': return 'PREVIEW';
    case 'flying':    return 'TRACKING';
    case 'landed':    return 'LANDED';
    case 'cleared':   return 'CLEAR';
  }
}

const styles = StyleSheet.create({
  hudBar: {
    position: 'absolute',
    top: 14,
    left: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.45)',
  },
  hudText: {
    color: '#86efac',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
});
