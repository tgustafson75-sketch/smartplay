/**
 * components/PrecisionView.tsx
 *
 * Single UI surface for the Precision Vision pipeline.
 * Composes: CourseMap + CaddieLine + YardageCard + CaddiePanel
 *
 * Receives a fully-resolved PrecisionEngineResult from the caller.
 * The tap handler captures pixel coordinates and forwards them to
 * onUpdateTarget so the parent can re-run runPrecisionEngine with a
 * new target point.
 *
 * Usage:
 *   <PrecisionView
 *     data={engineResult}
 *     holeData={COURSE_DB[courseIdx].holes[holeIdx]}
 *     onUpdateTarget={({ x, y }) => handleTargetUpdate(x, y)}
 *     onSpeak={(line) => speakJob(line)}
 *   />
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

import type { PrecisionEngineResult } from '../engine/precisionEngine';
import type { CourseHole } from '../data/courses';
import type { PlayerCoords } from '../engine/precisionEngine';

import CourseMap from './CourseMap';
import YardageCard from './YardageCard';
import CaddiePanel from './CaddiePanel';
import CaddieLine from './CaddieLine';
import type { Point } from './CaddieLine';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_HEIGHT = 260;

/**
 * Derive the tee canvas-pixel position.
 * Mirrors the bottom-centre tee marker drawn by HoleMapView.
 */
function teePxFromCanvas(canvasW: number): Point {
  return { x: canvasW / 2, y: MAP_HEIGHT * 0.82 };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PrecisionViewProps {
  /** Fully-resolved engine result — drives all sub-components */
  data: PrecisionEngineResult;
  /** CourseHole required by CourseMap for green / tee coords */
  holeData: CourseHole;
  /** Player GPS coords for the map player-dot */
  playerCoords?: PlayerCoords | null;
  /** GPS accuracy radius in metres */
  gpsAccuracy?: number | null;
  /**
   * Called when the player taps to move the target.
   * Receives canvas pixel coordinates — caller is responsible for
   * converting back to GPS and re-running the engine.
   */
  onUpdateTarget?: (point: Point) => void;
  /** Called when user taps "Hear Advice" */
  onSpeak?: (voiceLine: string) => void;
  /** Whether the voice system is currently speaking */
  isSpeaking?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PrecisionView({
  data,
  holeData,
  playerCoords,
  gpsAccuracy,
  onUpdateTarget,
  onSpeak,
  isSpeaking = false,
}: PrecisionViewProps) {
  const { width: screenW } = useWindowDimensions();
  const canvasW = screenW - 32; // 16 px padding each side

  // Tap-selected target in canvas pixels; defaults to upper-centre (green area)
  const [targetPx, setTargetPx] = useState<Point>({ x: canvasW / 2, y: MAP_HEIGHT * 0.22 });
  const teePx = teePxFromCanvas(canvasW);

  const handleTap = (locationX: number, locationY: number) => {
    const point: Point = { x: locationX, y: locationY };
    setTargetPx(point);
    onUpdateTarget?.(point);
  };

  return (
    <Pressable
      style={styles.root}
      onPress={(e) => {
        const { locationX, locationY } = e.nativeEvent;
        handleTap(locationX, locationY);
      }}
    >
      {/* ── Header label ──────────────────────────────────────────── */}
      <Text style={styles.header}>
        SMARTPLAY CADDIE · Precision View
      </Text>

      {/* ── Map + CaddieLine overlay ──────────────────────────────── */}
      <View style={[styles.mapContainer, { height: MAP_HEIGHT }]}>
        <CourseMap
          holeData={holeData}
          playerCoords={playerCoords}
          gpsAccuracy={gpsAccuracy}
          yards={{ front: null, middle: data.yardage, back: null }}
          height={MAP_HEIGHT}
        />

        <CaddieLine
          from={teePx}
          to={targetPx}
          width={canvasW}
          height={MAP_HEIGHT}
          missPattern={data.missPattern}
        />
      </View>

      {/* ── Yardage card ──────────────────────────────────────────── */}
      <View style={styles.section}>
        <YardageCard
          middle={data.yardage}
          playsLike={data.playsLike}
        />
      </View>

      {/* ── Caddie panel ──────────────────────────────────────────── */}
      <View style={styles.section}>
        <CaddiePanel
          decision={data}
          onSpeak={onSpeak}
          isSpeaking={isSpeaking}
        />
      </View>

      {/* ── Mode / source badges ───────────────────────────────────── */}
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{data.mode}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{data.sceneType.replace('_', ' ')}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0F0E',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 14,
  },
  header: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    color: '#8FA39B',
    fontSize: 12,
    letterSpacing: 1.2,
    zIndex: 10,
  },
  mapContainer: {
    width: '100%',
    marginTop: 56,
    overflow: 'hidden',
    borderRadius: 10,
  },
  section: {
    width: '100%',
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  badge: {
    backgroundColor: '#0d2818',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    color: '#4a7c5e',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
