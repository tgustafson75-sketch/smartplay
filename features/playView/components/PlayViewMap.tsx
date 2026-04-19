/**
 * features/playView/components/PlayViewMap.tsx
 *
 * Full-width hole photograph with overlays:
 *   • GPS dot         — player's current position
 *   • Target marker   — tap-to-target (gold dot + distance badge)
 *   • Hazard list     — distances to water / bunkers / OB
 *   • Layup suggestion — recommended layup yardage
 *   • Distances badge  — front / center / back
 *   • Logo badge       — branding
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Image,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';
import type { ImagePosition }    from '../utils/mapPosition';
import type { RangefinderResult } from '../hooks/useRangefinder';
import type { PathPoint }         from '../data/holeMapping';
import type { Hazard }            from '../data/hazards';
import { pixelToGPS }             from '../engine/pixelToGPS';
import { isSignificantDistanceChange } from '../engine/ImageMapping';
import { getDistance }            from '../../palmsCourse/engine/DistanceEngine';
import { ShotArc }                from './ShotArc';
import { DispersionCone }         from './DispersionCone';
import type { PredictedMiss }     from '../../smartCaddie/engine/ShotPrediction';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  image:          ImageSourcePropType;
  playerDot:      ImagePosition;
  distances:      RangefinderResult;
  /** Fairway path points for pixel→GPS conversion */
  path:           PathPoint[];
  /** Current player GPS (from useSmoothedGPS or raw hook) */
  playerGPS:      { lat: number; lng: number };
  /** Hazards for this hole */
  hazards?:       Hazard[];
  /** Risk score from SmartCaddieEngine (0–100) */
  risk?:          number;
  /** Predicted miss direction from dispersion model */
  predictedMiss?: PredictedMiss;
}

// ─── Layup logic ─────────────────────────────────────────────────────────────

function suggestLayup(centerDistance: number): number | null {
  if (centerDistance > 240) return 150;
  if (centerDistance > 200) return 130;
  if (centerDistance > 160) return 120;
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlayViewMap({
  image,
  playerDot,
  distances,
  path,
  playerGPS,
  hazards = [],
  risk = 0,
  predictedMiss = 'center',
}: Props) {
  const [target,         setTarget]         = useState<{ x: number; y: number } | null>(null);
  const [smartVisionOn,  setSmartVisionOn]  = useState(false);
  const [imageLayout,    setImageLayout]    = useState({ width: 1000, height: 2000 });
  // Jitter guard — only update displayed distance when change > 1 yd
  const lastTargetDistRef = useRef<number | null>(null);
  const [stableTargetDist, setStableTargetDist] = useState<number | null>(null);

  // Pass image dimensions so pixelToGPS uses bilinear interpolation
  const targetGPS = target
    ? pixelToGPS(target, path, imageLayout.width, imageLayout.height)
    : null;

  const rawTargetDistance = targetGPS
    ? Math.round(getDistance(playerGPS.lat, playerGPS.lng, targetGPS.lat, targetGPS.lng))
    : null;

  // Apply jitter guard — only surface distance when it changes by > 1 yd
  if (rawTargetDistance !== null) {
    if (
      lastTargetDistRef.current === null ||
      isSignificantDistanceChange(lastTargetDistRef.current, rawTargetDistance)
    ) {
      lastTargetDistRef.current = rawTargetDistance;
      if (stableTargetDist !== rawTargetDistance) {
        setStableTargetDist(rawTargetDistance);
      }
    }
  } else if (stableTargetDist !== null) {
    lastTargetDistRef.current = null;
    setStableTargetDist(null);
  }

  // Line midpoint for distance label
  const labelPos = target && playerDot
    ? {
        x: (playerDot.x + target.x) / 2,
        y: (playerDot.y + target.y) / 2,
      }
    : null;

  // Hazard distances from player
  const hazardDistances = hazards.map((h) => ({
    ...h,
    distance: Math.round(getDistance(playerGPS.lat, playerGPS.lng, h.lat, h.lng)),
  }));

  const layup = suggestLayup(distances.center);

  // ── SmartVision: adjusted target for the predicted miss ────────────────────────
  // Counter the miss by adjusting the visual aim point laterally
  const smartTarget: { x: number; y: number } | null = target ? (() => {
    let x = target.x;
    if (predictedMiss === 'right') x -= 15;
    if (predictedMiss === 'left')  x += 15;
    return { x, y: target.y };
  })() : null;

  return (
    <View style={s.container}>
      <TouchableWithoutFeedback
        onPress={(event) => {
          const { locationX, locationY } = event.nativeEvent;
          setTarget({ x: locationX, y: locationY });
        }}
      >
        <View>
          <Image
            source={image}
            style={s.image}
            resizeMode="cover"
            onLayout={(e: LayoutChangeEvent) => {
              const { width, height } = e.nativeEvent.layout;
              setImageLayout({ width, height });
            }}
          />

          {/* ── GPS player dot ── */}
          <View
            pointerEvents="none"
            style={[s.dot, { left: playerDot.x - DOT_SIZE / 2, top: playerDot.y - DOT_SIZE / 2 }]}
          />

          {/* ── Tap target marker ── */}
          {target && (
            <View
              pointerEvents="none"
              style={[s.targetDot, { left: target.x - TARGET_SIZE / 2, top: target.y - TARGET_SIZE / 2 }]}
            />
          )}

          {/* ── SmartVision overlays ── */}
          {smartVisionOn && smartTarget && (
            <>
              <ShotArc
                start={playerDot}
                end={smartTarget}
                risk={risk}
              />
              <DispersionCone
                start={playerDot}
                end={smartTarget}
              />
            </>
          )}
        </View>
      </TouchableWithoutFeedback>

      {/* ── SmartVision toggle ── */}
      <TouchableOpacity
        onPress={() => setSmartVisionOn((v) => !v)}
        style={[
          s.smartVisionBtn,
          smartVisionOn && s.smartVisionBtnActive,
        ]}
      >
        <Text style={[
          s.smartVisionText,
          smartVisionOn && s.smartVisionTextActive,
        ]}>
          {smartVisionOn ? 'Hide SmartVision' : 'SmartVision'}
        </Text>
      </TouchableOpacity>

      {/* ── Logo badge ── */}
      <View style={s.logoBadge} pointerEvents="none">
        <Text style={s.logoText}>SMARTPLAY CADDIE</Text>
      </View>

      {/* ── Hazard distances ── */}
      {hazardDistances.length > 0 && (
        <View style={s.hazardList} pointerEvents="none">
          {hazardDistances.map((h, i) => (
            <Text key={i} style={s.hazardText}>
              {h.label}: {h.distance} yds
            </Text>
          ))}
        </View>
      )}

      {/* ── Distance label at shot-line midpoint ── */}
      {stableTargetDist !== null && labelPos && (
        <View
          pointerEvents="none"
          style={[s.lineMidLabel, { left: labelPos.x - 28, top: labelPos.y - 12 }]}
        >
          <Text style={s.lineMidText}>{stableTargetDist} yds</Text>
        </View>
      )}

      {/* ── Target distance badge ── */}
      {stableTargetDist !== null && (
        <View style={s.targetBadge} pointerEvents="none">
          <Text style={s.targetText}>Target: {stableTargetDist} yds</Text>
        </View>
      )}

      {/* ── Distance badge (F/C/B) ── */}
      <View style={s.distanceBadge} pointerEvents="none">
        <Text style={s.distanceText}>
          F: {distances.front}{'  '}C: {distances.center}{'  '}B: {distances.back}
        </Text>
      </View>

      {/* ── Layup suggestion ── */}
      {layup !== null && (
        <Text style={s.layupText} pointerEvents="none">
          Suggested Layup: {layup} yds
        </Text>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const DOT_SIZE    = 12;
const TARGET_SIZE = 12;

const s = StyleSheet.create({
  container: {
    position: 'relative',
    width:    '100%',
  },
  image: {
    width:        '100%',
    height:       420,
    borderRadius: 12,
  },
  dot: {
    position:        'absolute',
    width:           DOT_SIZE,
    height:          DOT_SIZE,
    borderRadius:    DOT_SIZE / 2,
    backgroundColor: '#00E0FF',
    borderWidth:     2,
    borderColor:     '#fff',
  },
  distanceBadge: {
    position:        'absolute',
    bottom:          10,
    left:            10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding:         10,
    borderRadius:    8,
  },
  distanceText: {
    color:    '#fff',
    fontSize: 14,
  },
  logoBadge: {
    position:          'absolute',
    top:               10,
    right:             10,
    backgroundColor:   'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical:   4,
    borderRadius:      6,
  },
  logoText: {
    color:      '#4ADE80',
    fontWeight: 'bold',
    fontSize:   12,
  },
  targetDot: {
    position:        'absolute',
    width:           TARGET_SIZE,
    height:          TARGET_SIZE,
    borderRadius:    TARGET_SIZE / 2,
    backgroundColor: '#FFD700',
    borderWidth:     2,
    borderColor:     '#fff',
  },
  targetBadge: {
    position:        'absolute',
    bottom:          80,
    left:            10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding:         8,
    borderRadius:    6,
  },
  targetText: {
    color:    '#FFD700',
    fontSize: 14,
    fontWeight: 'bold',
  },
  hazardList: {
    position: 'absolute',
    bottom:   120,
    left:     10,
  },
  hazardText: {
    color:     '#F87171',
    fontSize:  13,
    fontWeight: '600',
  },
  layupText: {
    position:  'absolute',
    bottom:    40,
    left:      10,
    color:     '#4ADE80',
    fontSize:  13,
    fontWeight: '600',
  },
  smartVisionBtn: {
    position:          'absolute',
    top:               10,
    left:              10,
    paddingHorizontal: 12,
    paddingVertical:   6,
    backgroundColor:   'rgba(0,0,0,0.55)',
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       '#4ADE80',
  },
  smartVisionBtnActive: {
    backgroundColor: 'rgba(74,222,128,0.18)',
  },
  smartVisionText: {
    color:      '#4ADE80',
    fontSize:   13,
    fontWeight: '600',
  },
  smartVisionTextActive: {
    color: '#fff',
  },
  lineMidLabel: {
    position:          'absolute',
    backgroundColor:   'rgba(0,0,0,0.72)',
    paddingHorizontal: 6,
    paddingVertical:   3,
    borderRadius:      5,
  },
  lineMidText: {
    color:      '#FFD700',
    fontSize:   12,
    fontWeight: '700',
  },
});
