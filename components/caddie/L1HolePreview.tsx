import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ImageBackground, StyleSheet, type ImageSourcePropType } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText, Path } from 'react-native-svg';
import { useRoundStore } from '../../store/roundStore';
import { getHoleGeometry, fetchCourseGeometry, type HoleGeometry } from '../../services/courseGeometryService';
import { refreshFix, getLastFix } from '../../services/smartFinderService';
import { haversineYards, projectToAxis } from '../../utils/geoDistance';

const REFRESH_MS = 4_000;
const W = 320;
const H = 300;

// Static require map for local-course hole images. The bundler needs literal
// require() calls, so this map is the registration site for any local-course
// asset packs (Palms today; Lakes/etc. drop in by adding entries below).
const PALMS_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../../assets/courses/palms/hole-01.jpg'),
  2:  require('../../assets/courses/palms/hole-02.jpg'),
  3:  require('../../assets/courses/palms/hole-03.jpg'),
  4:  require('../../assets/courses/palms/hole-04.jpg'),
  5:  require('../../assets/courses/palms/hole-05.jpg'),
  6:  require('../../assets/courses/palms/hole-06.jpg'),
  7:  require('../../assets/courses/palms/hole-07.jpg'),
  8:  require('../../assets/courses/palms/hole-08.jpg'),
  9:  require('../../assets/courses/palms/hole-09.jpg'),
  10: require('../../assets/courses/palms/hole-10.jpg'),
  11: require('../../assets/courses/palms/hole-11.jpg'),
  12: require('../../assets/courses/palms/hole-12.jpg'),
  13: require('../../assets/courses/palms/hole-13.jpg'),
  14: require('../../assets/courses/palms/hole-14.jpg'),
  15: require('../../assets/courses/palms/hole-15.jpg'),
  16: require('../../assets/courses/palms/hole-16.jpg'),
  17: require('../../assets/courses/palms/hole-17.jpg'),
  18: require('../../assets/courses/palms/hole-18.jpg'),
};

function localHoleImageFor(courseName: string | null, holeNumber: number): ImageSourcePropType | null {
  if (!courseName) return null;
  const c = courseName.toLowerCase();
  if (c.includes('palms')) return PALMS_HOLE_IMAGES[holeNumber] ?? null;
  // Lakes assets land here when they're added:
  // if (c.includes('lakes')) return LAKES_HOLE_IMAGES[holeNumber] ?? null;
  return null;
}

/**
 * L1 (Quiet) hole preview — a glanceable top-down sketch of the current hole
 * (tee at bottom, green at top, dashed centerline, player dot when GPS is
 * available). Sized for the L1 layout's logo+preview block above the
 * SmartFinder card. No tap interaction — purely informational.
 *
 * Falls back to a quiet "Hole geometry unavailable" placeholder when the
 * upstream lacks tee/green coordinates (the typical golfcourseapi case
 * today). Sizing is fixed so the L1 block doesn't reflow when geometry
 * resolves.
 */
type Props = {
  /** Tap handler — opens the full SmartVision tool for the current hole. */
  onOpenSmartVision?: () => void;
};

export default function L1HolePreview({ onOpenSmartVision }: Props) {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const activeCourse = useRoundStore(s => s.activeCourse);

  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!activeCourseId) { setGeometry(null); return; }
    const cached = getHoleGeometry(activeCourseId, currentHole);
    if (cached && !cancelled) setGeometry(cached);
    fetchCourseGeometry(activeCourseId).then(full => {
      if (cancelled) return;
      setGeometry(full?.holes.find(h => h.hole_number === currentHole) ?? null);
    });
    return () => { cancelled = true; };
  }, [activeCourseId, currentHole]);

  // Player dot refresh tick
  useEffect(() => {
    if (!isRoundActive) return;
    let cancelled = false;
    const tick = async () => {
      await refreshFix();
      if (!cancelled) setTick(t => t + 1);
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [isRoundActive]);

  // The preview is wrapped in a tappable that launches the full SmartVision
  // tool for the current hole. Body content varies by data availability.
  const SmartVisionTap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <TouchableOpacity
      onPress={onOpenSmartVision}
      activeOpacity={onOpenSmartVision ? 0.85 : 1}
      disabled={!onOpenSmartVision}
      accessibilityRole="button"
      accessibilityLabel="Open SmartVision for this hole"
    >
      {children}
      <View style={styles.svHint} pointerEvents="none">
        <Text style={styles.svHintText}>SMARTVISION ↗</Text>
      </View>
    </TouchableOpacity>
  );

  if (!isRoundActive) {
    return (
      <SmartVisionTap>
        <View style={[styles.wrap, styles.placeholder]}>
          <Text style={styles.placeholderText}>SMARTVISION</Text>
          <Text style={styles.placeholderSub}>Start a round to see the hole.</Text>
        </View>
      </SmartVisionTap>
    );
  }

  if (!geometry || !geometry.tee || !geometry.green) {
    // Fallback to local hole image when the upstream lacks GPS geometry —
    // for Palms today, for Lakes when those assets land.
    const localImg = localHoleImageFor(activeCourse, currentHole);
    if (localImg) {
      return (
        <SmartVisionTap>
          <ImageBackground source={localImg} style={styles.wrap} imageStyle={styles.imgRadius} resizeMode="cover">
            <View style={styles.imageOverlay}>
              <Text style={styles.imageHoleLabel}>HOLE {currentHole}</Text>
            </View>
          </ImageBackground>
        </SmartVisionTap>
      );
    }
    return (
      <SmartVisionTap>
        <View style={[styles.wrap, styles.placeholder]}>
          <Text style={styles.placeholderText}>HOLE {currentHole}</Text>
          <Text style={styles.placeholderSub}>Hole geometry unavailable.</Text>
        </View>
      </SmartVisionTap>
    );
  }

  const axisYards = haversineYards(geometry.tee, geometry.green);
  if (axisYards <= 0) {
    return (
      <View style={[styles.wrap, styles.placeholder]}>
        <Text style={styles.placeholderText}>HOLE {currentHole}</Text>
      </View>
    );
  }

  const fix = getLastFix();
  const playerProj = fix ? projectToAxis(fix.location, geometry.tee, geometry.green) : null;

  // Fit-to-canvas projection
  const pad = 18;
  const xRange = Math.max(60, (playerProj ? Math.abs(playerProj.x) * 2 : 0) + 60);
  const yRange = axisYards + 40;
  const xScale = (W - pad * 2) / xRange;
  const yScale = (H - pad * 2) / yRange;
  const project = (xYd: number, yYd: number) => ({
    sx: pad + (xYd + xRange / 2) * xScale,
    sy: H - pad - yYd * yScale,
  });
  const teePos = project(0, 0);
  const greenPos = project(0, axisYards);
  const playerPos = playerProj ? project(playerProj.x, playerProj.y) : null;

  return (
    <SmartVisionTap>
    <View style={styles.wrap}>
      <Svg width={W} height={H}>
        <Rect x={0} y={0} width={W} height={H} rx={10} fill="#0a1f12" />
        {/* Centerline */}
        <Line
          x1={teePos.sx} y1={teePos.sy} x2={greenPos.sx} y2={greenPos.sy}
          stroke="#1e3a28" strokeWidth={1} strokeDasharray="4 4"
        />
        {/* Tee */}
        <Circle cx={teePos.sx} cy={teePos.sy} r={4} fill="#6b7280" />
        <SvgText x={teePos.sx} y={teePos.sy + 13} fill="#9ca3af" fontSize={8} textAnchor="middle">TEE</SvgText>
        {/* Green */}
        <Circle cx={greenPos.sx} cy={greenPos.sy} r={7} fill="#003d20" stroke="#00C896" strokeWidth={1.2} />
        <SvgText x={greenPos.sx} y={greenPos.sy - 11} fill="#00C896" fontSize={8} textAnchor="middle">GREEN</SvgText>
        {/* Player */}
        {playerPos && (
          <>
            <Path
              d={`M ${playerPos.sx} ${playerPos.sy} L ${greenPos.sx} ${greenPos.sy}`}
              stroke="#F5A623" strokeWidth={1.2} strokeDasharray="3 3" opacity={0.6}
            />
            <Circle cx={playerPos.sx} cy={playerPos.sy} r={5} fill="#F5A623" stroke="#0a1f12" strokeWidth={1.5} />
          </>
        )}
        {/* Hole label corner */}
        <SvgText x={W - pad} y={pad + 2} fill="#6b7280" fontSize={9} fontWeight="800" textAnchor="end" letterSpacing={1}>
          HOLE {currentHole}
        </SvgText>
      </Svg>
    </View>
    </SmartVisionTap>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: W,
    height: H,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0a1f12',
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  placeholderText: { color: '#6b7280', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  placeholderSub: { color: '#4b5563', fontSize: 11, marginTop: 6, textAlign: 'center' },
  imgRadius: { borderRadius: 10 },
  imageOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  imageHoleLabel: { color: '#ffffff', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  svHint: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,200,150,0.18)',
    borderWidth: 1,
    borderColor: '#00C896',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  svHintText: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
});
