/**
 * 2026-05-22 — AR Shot Trace Overlay (Pass 3: 3D via @react-three/fiber/native).
 *
 * True 3D scene rendered through expo-gl + three.js + @react-three/fiber's
 * native entrypoint. The camera lives at the player's origin looking
 * down the shot azimuth; the trajectory is a TubeGeometry built from a
 * CatmullRom curve through the FlightPoint sample set. Apex + landing
 * markers are spheres; the dispersion cone is a RingGeometry on the
 * ground plane; the animated ball is a sphere that travels along the
 * curve based on a t in [0..1] driven by useFrame.
 *
 * Sibling to ArShotTraceOverlay.tsx (SVG). The ArShotTrace.tsx parent
 * picks between them based on services/arRenderCapability.detectArCapability().
 * Props contract is identical so consumers don't have to know which
 * backend rendered the frame.
 *
 * Performance notes:
 *   - useFrame ticks the ball position; tube + markers are static once
 *     the trace lands so they cost zero per-frame after mount.
 *   - segments / radial-segments scale with quality tier. 'high' = 64/8;
 *     'balanced' = 40/6; 'battery_saver' = 20/4.
 *   - Lights kept minimal (ambient + 1 directional) — golf trajectories
 *     don't need shadows. Three.js shadow maps are the single biggest
 *     fps hit on mid-tier devices and are disabled here.
 *   - The camera respects the cameraPose prop. When provided, heading
 *     yaw is applied via three.js's camera.rotation so panning the
 *     phone visibly tracks the trajectory.
 *
 * Coordinate system (world):
 *   +x = lateral (right of shot azimuth)
 *   +y = altitude
 *   +z = downrange (away from player)
 *   Units: yards everywhere; altitude in yards too (FlightPoint
 *   altitude_ft / 3) to stay isotropic for the three.js camera.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import {
  subscribeActiveTrace,
  type ActiveTrace,
} from '../services/arShotTracer';
import type { FlightPoint } from '../utils/ballFlightPhysics';
import type {
  CameraPose,
  ArShotTraceOverlayProps,
  QualityTier,
} from './ArShotTraceOverlay';

const FT_PER_YD = 3;

interface QualityKnobs {
  tubularSegments: number;
  radialSegments: number;
  tubeRadius: number;
  ballRadius: number;
}

function knobs(q: QualityTier): QualityKnobs {
  if (q === 'high')          return { tubularSegments: 64, radialSegments: 8, tubeRadius: 0.5, ballRadius: 0.9 };
  if (q === 'battery_saver') return { tubularSegments: 20, radialSegments: 4, tubeRadius: 0.4, ballRadius: 0.7 };
  return { tubularSegments: 40, radialSegments: 6, tubeRadius: 0.45, ballRadius: 0.8 };
}

// ─── Public component ────────────────────────────────────────────────────

export default function ArShotTraceOverlay3D({
  width, height,
  fovDeg = 70, cameraPitchDeg = 5,
  cameraPose = null,
  quality = 'balanced',
  onBeat,
}: ArShotTraceOverlayProps) {
  const [trace, setTrace] = useState<ActiveTrace | null>(null);

  useEffect(() => {
    const unsub = subscribeActiveTrace(setTrace);
    return unsub;
  }, []);

  if (!trace || trace.flight.points.length === 0) {
    return null;
  }

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      <Canvas
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        camera={{ fov: fovDeg, near: 0.5, far: 5000, position: [0, 5, 0] }}
        // Transparent so the camera feed (or any parent background)
        // shows through. The Canvas's default GL clear color is opaque
        // black which would hide the camera passthrough.
        gl={{ alpha: true, antialias: quality !== 'battery_saver' }}
        // Disable shadows globally — biggest fps hit on mid-tier devices
        // and golf trajectories don't need them.
        shadows={false}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[10, 25, 10]} intensity={0.6} />
        <TraceScene
          trace={trace}
          cameraPose={cameraPose}
          cameraPitchDeg={cameraPitchDeg}
          quality={quality}
          onBeat={onBeat}
        />
      </Canvas>

      {/* HUD strip — outside the Canvas so its layout/text uses RN, not
          three.js. Mirrors the SVG overlay's HUD copy. */}
      <View style={styles.hudBar}>
        <Text style={styles.hudText} numberOfLines={1}>
          {(trace.club ?? 'shot').toUpperCase()} · {hudStatus(trace.status)} · {trace.confidence}% · 3D
        </Text>
      </View>

      {/* Carry + apex labels — rendered as RN Text instead of three.js
          billboards so they stay crisp at any resolution and don't burn
          the GPU on text geometry. Position is just static-corner overlay
          for Pass 3; Pass 4 can project the labels with three.js if AR
          camera-tracking demands it. */}
      <View style={styles.labelStack} pointerEvents="none">
        <Text style={styles.labelPrimary}>{trace.flight.carry_yd}y</Text>
        <Text style={styles.labelSecondary}>apex {trace.flight.apex_ft}ft</Text>
        {Math.abs(trace.flight.landing_lateral_yd) >= 6 && (
          <Text style={styles.labelSecondary}>
            {Math.abs(trace.flight.landing_lateral_yd)}y {trace.flight.landing_lateral_yd > 0 ? 'R' : 'L'}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Inner scene (runs inside <Canvas>) ──────────────────────────────────

interface TraceSceneProps {
  trace: ActiveTrace;
  cameraPose: CameraPose | null;
  cameraPitchDeg: number;
  quality: QualityTier;
  onBeat?: ArShotTraceOverlayProps['onBeat'];
}

function TraceScene({ trace, cameraPose, cameraPitchDeg, quality, onBeat }: TraceSceneProps) {
  const k = knobs(quality);
  const ballRef = useRef<THREE.Mesh>(null);
  const beatFiredRef = useRef<Set<'launch' | 'apex' | 'landing'>>(new Set());
  // Camera ref — apply yaw + pitch each frame so panning the phone
  // tracks the trajectory.
  const cameraGroupRef = useRef<THREE.Group>(null);

  // Build the trajectory curve once per trace.
  const curve = useMemo(() => buildCurve(trace.flight.points), [trace]);

  // Sample the curve into Vector3 segments for tube + landing positions.
  const tubeGeometry = useMemo(() => {
    if (!curve) return null;
    return new THREE.TubeGeometry(curve, k.tubularSegments, k.tubeRadius, k.radialSegments, false);
  }, [curve, k.tubularSegments, k.tubeRadius, k.radialSegments]);

  // Apex point (highest altitude) projected to world coords.
  const apexPoint = useMemo(() => {
    if (!trace.flight.points.length) return null;
    let best = trace.flight.points[0];
    for (const p of trace.flight.points) if (p.altitude_ft > best.altitude_ft) best = p;
    return pointToVec3(best);
  }, [trace]);

  const landingPoint = useMemo(() => {
    const last = trace.flight.points[trace.flight.points.length - 1];
    return last ? pointToVec3(last) : null;
  }, [trace]);

  // Dispersion ring sized in yards, anchored at landing on the ground plane.
  const dispersionYd = trace.flight.points[trace.flight.points.length - 1]?.downrange_yd
    ? Math.min(40, Math.max(8, trace.flight.carry_yd * 0.06))
    : 10;

  // Animation tick — drive ball position along the curve when status='flying'.
  useFrame(() => {
    // ─── Camera pose ─────────────────────────────────────────────────
    if (cameraGroupRef.current) {
      const yawDeg = cameraPose
        ? angleDelta(cameraPose.headingDeg, trace.azimuth_deg)
        : 0;
      const pitchDeg = cameraPose?.pitchDeg ?? cameraPitchDeg;
      cameraGroupRef.current.rotation.y = (yawDeg * Math.PI) / 180;
      cameraGroupRef.current.rotation.x = (-pitchDeg * Math.PI) / 180;
    }

    if (!curve || !ballRef.current) return;
    if (trace.status === 'predicted') {
      // Park the ball at start for the preview.
      const start = curve.getPoint(0);
      ballRef.current.position.copy(start);
      return;
    }
    const flightMs = trace.flight.flight_seconds * 1000;
    const elapsed = Date.now() - trace.started_at_ms;
    const t = flightMs > 0 ? Math.min(1, elapsed / flightMs) : 1;
    const pos = curve.getPoint(t);
    ballRef.current.position.copy(pos);

    // Voice-narration beats.
    if (onBeat && trace.status === 'flying') {
      fireBeats(t, trace, beatFiredRef.current, onBeat);
    }
  });

  return (
    <>
      {/* Camera group — wraps the implicit camera rotation. */}
      <group ref={cameraGroupRef} position={[0, 0, 0]} />

      {/* Trajectory tube. */}
      {tubeGeometry && (
        <mesh geometry={tubeGeometry}>
          <meshStandardMaterial
            color={trace.status === 'predicted' ? '#86efac' : '#22c55e'}
            emissive="#0f3a1d"
            emissiveIntensity={0.4}
            transparent
            opacity={trace.status === 'predicted' ? 0.55 : 0.9}
          />
        </mesh>
      )}

      {/* Apex marker — small glowing sphere. */}
      {apexPoint && (
        <mesh position={apexPoint}>
          <sphereGeometry args={[k.ballRadius * 0.9, 12, 12]} />
          <meshStandardMaterial color="#fef3c7" emissive="#fef3c7" emissiveIntensity={0.55} />
        </mesh>
      )}

      {/* Landing marker. */}
      {landingPoint && trace.status !== 'predicted' && (
        <mesh position={landingPoint}>
          <sphereGeometry args={[k.ballRadius, 14, 14]} />
          <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" emissiveIntensity={0.45} />
        </mesh>
      )}

      {/* Dispersion cone — flat ring on ground plane. */}
      {landingPoint && (
        <mesh position={[landingPoint.x, 0.05, landingPoint.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[dispersionYd * 0.85, dispersionYd, 32]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.18} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Animated ball head. */}
      {trace.status !== 'predicted' && (
        <mesh ref={ballRef}>
          <sphereGeometry args={[k.ballRadius, 14, 14]} />
          <meshStandardMaterial color="#ffffff" emissive="#22c55e" emissiveIntensity={0.7} />
        </mesh>
      )}
    </>
  );
}

// ─── Curve + projection helpers ──────────────────────────────────────────

function pointToVec3(p: FlightPoint): THREE.Vector3 {
  // World: x=lateral (yd), y=altitude (yd; ft→yd via /3), z=downrange (yd).
  // Negative z because three.js camera looks down -z by default; we want
  // the trajectory to extend AWAY from the camera = -z.
  return new THREE.Vector3(p.lateral_yd, p.altitude_ft / FT_PER_YD, -p.downrange_yd);
}

function buildCurve(points: FlightPoint[]): THREE.CatmullRomCurve3 | null {
  if (points.length < 2) return null;
  const vecs = points.map(pointToVec3);
  // CatmullRom gives a smooth interpolated path through the sample
  // points — keeps the trajectory from looking polygonal even with low
  // sample counts.
  const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.5);
  return curve;
}

// ─── Beat firing ─────────────────────────────────────────────────────────

function fireBeats(
  t: number,
  trace: ActiveTrace,
  fired: Set<'launch' | 'apex' | 'landing'>,
  onBeat: NonNullable<ArShotTraceOverlayProps['onBeat']>,
): void {
  if (!fired.has('launch') && t > 0.02) { fired.add('launch'); onBeat('launch', trace); }
  if (!fired.has('apex') && t > 0.45 && t < 0.6) { fired.add('apex'); onBeat('apex', trace); }
  if (!fired.has('landing') && t >= 0.98) { fired.add('landing'); onBeat('landing', trace); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function angleDelta(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

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
    borderColor: 'rgba(34, 197, 94, 0.55)',
  },
  hudText: {
    color: '#86efac',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  labelStack: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    alignItems: 'flex-end',
    gap: 2,
  },
  labelPrimary: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  labelSecondary: {
    color: '#fef3c7',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
