import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Rect, Text as SvgText, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useRoundStore } from '../store/roundStore';
import { useSmartFinderStore } from '../store/smartFinderStore';
import {
  refreshFix,
  classifyAccuracy,
  getLastFix,
  getGreenYardagesSync,
  type GreenYardages,
  type GPSQualityReading,
} from '../services/smartFinderService';
import { fetchCourseGeometry, getHoleGeometry, type HoleGeometry } from '../services/courseGeometryService';
import { haversineYards, projectToAxis } from '../utils/geoDistance';
import GPSQuality from '../components/smartfinder/GPSQuality';
import SmartFinderModeToggle from '../components/smartfinder/SmartFinderModeToggle';
import CourseDetailBanner from '../components/course/CourseDetailBanner';

const REFRESH_MS = 3_000;
const CANVAS_W_FRACTION = 0.92;

/**
 * Phase D-2 — Full-screen SmartFinder with three modes (Standard / Target / Map).
 *
 * Standard: large front/middle/back yardages to the green of the current hole.
 * Target:   tap any point on the hole overhead view to get yards to that point.
 * Map:      full hole map with player position, tee, green, and known landmarks.
 *
 * Mode preference is persisted via smartFinderStore. GPS-quality indicator
 * is shown in all modes.
 *
 * The legacy camera-AR rangefinder is preserved at app/smartfinder-camera.tsx
 * for future reactivation as a 4th "Camera" mode (1.x).
 */
export default function SmartFinder() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();
  const { width } = useWindowDimensions();

  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const setCurrentHole = useRoundStore(s => s.setCurrentHole);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const activeCourseId = useRoundStore(s => s.activeCourseId);

  const mode = useSmartFinderStore(s => s.mode);
  const setMode = useSmartFinderStore(s => s.setMode);

  const [yards, setYards] = useState<GreenYardages>(() => getGreenYardagesSync(currentHole));
  const [gps, setGps] = useState<GPSQualityReading>(() =>
    classifyAccuracy(getLastFix()?.accuracy_m ?? null),
  );
  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const fix = await refreshFix();
      if (cancelled) return;
      setGps(classifyAccuracy(fix?.accuracy_m ?? null));
      setYards(getGreenYardagesSync(currentHole));
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [currentHole]);

  useEffect(() => {
    let cancelled = false;
    if (!activeCourseId) {
      setGeometry(null);
      return;
    }
    const cached = getHoleGeometry(activeCourseId, currentHole);
    if (cached && !cancelled) setGeometry(cached);
    fetchCourseGeometry(activeCourseId).then(full => {
      if (cancelled) return;
      setGeometry(full?.holes.find(h => h.hole_number === currentHole) ?? null);
    });
    return () => { cancelled = true; };
  }, [activeCourseId, currentHole]);

  const playedHoles = useMemo(() => courseHoles.map(h => h.hole).sort((a, b) => a - b), [courseHoles]);
  const idx = playedHoles.indexOf(currentHole);
  const prevHole = idx > 0 ? playedHoles[idx - 1] : null;
  const nextHole = idx >= 0 && idx < playedHoles.length - 1 ? playedHoles[idx + 1] : null;

  return (
    <SafeAreaView style={styles.container}>
      <CourseDetailBanner />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>← Caddie</Text>
        </TouchableOpacity>
        <Text style={styles.title}>SmartFinder</Text>
        <View style={styles.headerBtn}>
          <GPSQuality reading={gps} showText />
        </View>
      </View>

      <SmartFinderModeToggle mode={mode} onChange={setMode} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {!isRoundActive ? (
          <Text style={styles.empty}>Start a round to see yardages.</Text>
        ) : mode === 'standard' ? (
          <StandardView yards={yards} />
        ) : mode === 'target' ? (
          <TargetView geometry={geometry} width={width * CANVAS_W_FRACTION} />
        ) : (
          <MapView geometry={geometry} yards={yards} width={width * CANVAS_W_FRACTION} />
        )}

        <View style={styles.holeNav}>
          <TouchableOpacity
            style={[styles.holeBtn, prevHole == null && styles.holeBtnDisabled]}
            disabled={prevHole == null}
            onPress={() => prevHole != null && setCurrentHole(prevHole)}
          >
            <Text style={[styles.holeBtnText, prevHole == null && styles.holeBtnTextDisabled]}>← Prev</Text>
          </TouchableOpacity>
          <Text style={styles.holeNavLabel}>HOLE {currentHole}</Text>
          <TouchableOpacity
            style={[styles.holeBtn, nextHole == null && styles.holeBtnDisabled]}
            disabled={nextHole == null}
            onPress={() => nextHole != null && setCurrentHole(nextHole)}
          >
            <Text style={[styles.holeBtnText, nextHole == null && styles.holeBtnTextDisabled]}>Next →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StandardView({ yards }: { yards: GreenYardages }) {
  const allMissing = yards.front == null && yards.middle == null && yards.back == null;
  return (
    <View style={styles.standardWrap}>
      <View style={styles.greenIcon}>
        <Text style={styles.greenIconText}>⛳</Text>
      </View>
      <View style={styles.standardRow}>
        <BigCell label="FRONT" value={yards.front} />
        <BigCell label="MIDDLE" value={yards.middle} emphasis />
        <BigCell label="BACK" value={yards.back} />
      </View>
      {allMissing && (
        <Text style={styles.empty}>Green coordinates aren&apos;t available for this hole.</Text>
      )}
    </View>
  );
}

function BigCell({ label, value, emphasis }: { label: string; value: number | null; emphasis?: boolean }) {
  return (
    <View style={styles.bigCell}>
      <Text style={[styles.bigValue, emphasis && styles.bigValueEmphasis]}>
        {value != null ? value : '—'}
      </Text>
      <Text style={styles.bigLabel}>{label}</Text>
    </View>
  );
}

function TargetView({ geometry, width }: { geometry: HoleGeometry | null; width: number }) {
  const [tap, setTap] = useState<{ xPx: number; yPx: number; yards: number } | null>(null);

  if (!geometry || !geometry.tee || !geometry.green) {
    return (
      <View style={styles.canvasWrap}>
        <Text style={styles.empty}>
          Course geometry isn&apos;t available for this hole. Tap targets need tee and green coordinates.
        </Text>
      </View>
    );
  }
  const fix = getLastFix();
  if (!fix) {
    return (
      <View style={styles.canvasWrap}>
        <Text style={styles.empty}>Waiting for GPS — make sure location permission is granted.</Text>
      </View>
    );
  }
  const axisYards = haversineYards(geometry.tee, geometry.green);
  if (axisYards <= 0) {
    return <View style={styles.canvasWrap}><Text style={styles.empty}>Hole geometry invalid.</Text></View>;
  }
  const playerProj = projectToAxis(fix.location, geometry.tee, geometry.green);
  const halfPad = 30;
  const xPad = 30;
  const xRange = Math.max(60, Math.abs(playerProj.x) * 2 + 60);
  const yRange = axisYards + 60;
  const canvasH = (width / xRange) * yRange;
  const scale = (width - xPad * 2) / xRange;
  const project = (xYd: number, yYd: number) => ({
    sx: xPad + (xYd + xRange / 2) * scale,
    sy: halfPad + (yRange - yYd - 30) * scale,
  });
  const teePos = project(0, 0);
  const greenPos = project(0, axisYards);
  const playerPos = project(playerProj.x, playerProj.y);

  const handlePress = (evt: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = evt.nativeEvent;
    const tappedYx = (locationX - xPad) / scale - xRange / 2;
    const tappedYy = (yRange - (locationY - halfPad) / scale) - 30;
    const dx = tappedYx - playerProj.x;
    const dy = tappedYy - playerProj.y;
    const yards = Math.round(Math.sqrt(dx * dx + dy * dy));
    setTap({ xPx: locationX, yPx: locationY, yards });
  };

  return (
    <View style={styles.canvasWrap}>
      <Text style={styles.canvasHint}>Tap anywhere on the hole to get yardage.</Text>
      <Svg width={width} height={canvasH + halfPad * 2} onPress={handlePress as never}>
        <Rect x={0} y={0} width={width} height={canvasH + halfPad * 2} fill="#0a1f12" rx={12} />
        <Line x1={teePos.sx} y1={teePos.sy} x2={greenPos.sx} y2={greenPos.sy} stroke="#1e3a28" strokeWidth={1} strokeDasharray="4 4" />
        <Circle cx={teePos.sx} cy={teePos.sy} r={6} fill="#6b7280" />
        <SvgText x={teePos.sx} y={teePos.sy + 18} fill="#9ca3af" fontSize={10} textAnchor="middle">TEE</SvgText>
        <Circle cx={greenPos.sx} cy={greenPos.sy} r={10} fill="#003d20" stroke="#00C896" strokeWidth={1.5} />
        <SvgText x={greenPos.sx} y={greenPos.sy - 14} fill="#00C896" fontSize={10} textAnchor="middle">GREEN</SvgText>
        <Circle cx={playerPos.sx} cy={playerPos.sy} r={7} fill="#F5A623" stroke="#0a1f12" strokeWidth={2} />
        <SvgText x={playerPos.sx} y={playerPos.sy + 22} fill="#F5A623" fontSize={9} textAnchor="middle" fontWeight="700">YOU</SvgText>
        {tap && (
          <>
            <Path d={`M ${playerPos.sx} ${playerPos.sy} L ${tap.xPx} ${tap.yPx}`} stroke="#ffffff" strokeWidth={1.5} strokeDasharray="3 3" />
            <Circle cx={tap.xPx} cy={tap.yPx} r={9} fill="#ffffff" stroke="#000000" strokeWidth={1.5} />
            <SvgText x={tap.xPx} y={tap.yPx + 4} fill="#000000" fontSize={11} fontWeight="900" textAnchor="middle">
              {tap.yards}
            </SvgText>
          </>
        )}
      </Svg>
      {tap && <Text style={styles.tapResult}>{tap.yards} yards to tap</Text>}
    </View>
  );
}

function MapView({ geometry, yards, width }: { geometry: HoleGeometry | null; yards: GreenYardages; width: number }) {
  if (!geometry || !geometry.tee || !geometry.green) {
    return (
      <View style={styles.canvasWrap}>
        <StandardView yards={yards} />
        <Text style={styles.empty}>Map view needs course geometry. Showing numbers above instead.</Text>
        {geometry && geometry.hazards.length > 0 && (
          <View style={styles.hazardList}>
            <Text style={styles.hazardHeading}>HAZARDS</Text>
            {geometry.hazards.map((h, i) => (
              <Text key={i} style={styles.hazardItem}>• {h.label}</Text>
            ))}
          </View>
        )}
      </View>
    );
  }
  return <TargetView geometry={geometry} width={width} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  headerBtn: { minWidth: 100 },
  headerBtnText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  scroll: { paddingTop: 12, paddingBottom: 32 },
  empty: { color: '#9ca3af', fontSize: 13, textAlign: 'center', paddingHorizontal: 24, marginVertical: 24 },
  standardWrap: { paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center' },
  greenIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#003d20',
    borderWidth: 1, borderColor: '#00C896',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  greenIconText: { fontSize: 20 },
  standardRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 18 },
  bigCell: { alignItems: 'center', minWidth: 80 },
  bigValue: { color: '#e8f5e9', fontSize: 36, fontWeight: '900', fontVariant: ['tabular-nums'] },
  bigValueEmphasis: { color: '#ffffff', fontSize: 56 },
  bigLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 4 },
  canvasWrap: { paddingHorizontal: 16, paddingTop: 12, alignItems: 'center' },
  canvasHint: { color: '#9ca3af', fontSize: 12, marginBottom: 8 },
  tapResult: { color: '#ffffff', fontSize: 16, fontWeight: '800', marginTop: 12 },
  hazardList: { marginTop: 24, alignSelf: 'stretch', paddingHorizontal: 16 },
  hazardHeading: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 8 },
  hazardItem: { color: '#9ca3af', fontSize: 13, lineHeight: 19 },
  holeNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 24,
  },
  holeBtn: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16,
    borderWidth: 1, borderColor: '#00C896',
  },
  holeBtnDisabled: { borderColor: '#1e3a28' },
  holeBtnText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  holeBtnTextDisabled: { color: '#374151' },
  holeNavLabel: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 1.2 },
});
