/**
 * rangefinder.tsx — Advanced Rangefinder
 * THREE MODES: STANDARD (camera + HUD) | TARGET (drag crosshair) | MAP (SVG hole layout + pinch/pan)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated as RNAnimated,
  Platform, ActivityIndicator, useWindowDimensions, PanResponder,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as Location from 'expo-location';
import Slider from '@react-native-community/slider';
import { speakJob, PRIORITY as ENGINE_PRIORITY } from '../services/VoiceEngine';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoundStore } from '../store/roundStore';
import Svg, { Circle, Line as SvgLine, Rect, Text as SvgText } from 'react-native-svg';
import TargetingOverlay from '../components/TargetingOverlay';

// Types
type Mode = 'STANDARD' | 'TARGET' | 'MAP';
interface LatLng { lat: number; lng: number }

// Haversine
function haversineYards(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.09361);
}

const CLUB_YARDS: Record<string, number> = {
  Driver: 230, '3 Wood': 215, '5 Wood': 200, '4 Iron': 175, '5 Iron': 165,
  '6 Iron': 155, '7 Iron': 145, '8 Iron': 135, '9 Iron': 125, PW: 115, GW: 100, SW: 85, LW: 70,
};
function bestClub(yards: number): string {
  let best = 'PW', diff = Infinity;
  for (const [c, d] of Object.entries(CLUB_YARDS)) {
    if (Math.abs(d - yards) < diff) { best = c; diff = Math.abs(d - yards); }
  }
  return best;
}

export default function RangefinderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const params = useLocalSearchParams<{
    yardage?: string; hole?: string;
    frontLat?: string; frontLng?: string;
    middleLat?: string; middleLng?: string;
    backLat?: string; backLng?: string;
  }>();

  const currentHole = useRoundStore((s) => s.currentHole);
  const currentPar  = useRoundStore((s) => s.currentPar);
  const scores      = useRoundStore((s) => s.scores);

  const baseYardage = parseInt(params.yardage ?? '0', 10) || null;
  const paramHole   = parseInt(params.hole ?? '0', 10)    || currentHole;
  const holeCoords = {
    front:  params.frontLat  && params.frontLng  ? { lat: parseFloat(params.frontLat),  lng: parseFloat(params.frontLng)  } : null,
    middle: params.middleLat && params.middleLng ? { lat: parseFloat(params.middleLat), lng: parseFloat(params.middleLng) } : null,
    back:   params.backLat   && params.backLng   ? { lat: parseFloat(params.backLat),   lng: parseFloat(params.backLng)   } : null,
  };

  const [mode, setMode]             = useState<Mode>('STANDARD');
  const [permission, requestPermission]       = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [zoom, setZoom]             = useState(0);
  const [zoomDisplay, setZoomDisplay] = useState(1.0);
  const [flash, setFlash]           = useState(false);
  const [capturing, setCapturing]   = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const flashOpacity = useRef(new RNAnimated.Value(0)).current;

  // GPS
  const [gpsCoords, setGpsCoords]   = useState<Location.LocationObjectCoords | null>(null);
  const [gpsStatus, setGpsStatus]   = useState<'off'|'searching'|'good'|'weak'>('off');
  const locationSub  = useRef<Location.LocationSubscription | null>(null);
  const lastGpsRef   = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      setGpsStatus('searching');
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2, timeInterval: 3000 },
        (loc) => {
          if (cancelled) return;
          const { latitude: lat, longitude: lng, accuracy } = loc.coords;
          if (lastGpsRef.current && haversineYards(lastGpsRef.current.lat, lastGpsRef.current.lng, lat, lng) < 2) return;
          lastGpsRef.current = { lat, lng };
          setGpsCoords(loc.coords);
          const acc = accuracy ?? 999;
          setGpsStatus(acc <= 8 ? 'good' : acc <= 20 ? 'weak' : 'searching');
        }
      );
    })();
    return () => { cancelled = true; locationSub.current?.remove(); };
  }, []);

  const gpsDistances = gpsCoords ? {
    front:  holeCoords.front  ? haversineYards(gpsCoords.latitude, gpsCoords.longitude, holeCoords.front.lat,  holeCoords.front.lng)  : null,
    middle: holeCoords.middle ? haversineYards(gpsCoords.latitude, gpsCoords.longitude, holeCoords.middle.lat, holeCoords.middle.lng) : null,
    back:   holeCoords.back   ? haversineYards(gpsCoords.latitude, gpsCoords.longitude, holeCoords.back.lat,   holeCoords.back.lng)   : null,
  } : null;

  const displayYards  = gpsDistances?.middle ?? baseYardage;
  const frontDisplay  = gpsDistances?.front  ?? (displayYards != null ? Math.max(1, displayYards - 7) : null);
  const middleDisplay = gpsDistances?.middle ?? displayYards;
  const backDisplay   = gpsDistances?.back   ?? (displayYards != null ? displayYards + 7 : null);

  // Target mode
  const [targetYards, setTargetYards]   = useState<number | null>(null);
  const lastSpokenTargetRef             = useRef<number | null>(null);

  const handleTargetDistance = useCallback((yards: number | null) => {
    setTargetYards(yards);
    if (yards == null) return;
    const prev = lastSpokenTargetRef.current;
    if (prev == null || Math.abs(yards - prev) >= 10) {
      lastSpokenTargetRef.current = yards;
      void speakJob(`${yards} to target. ${bestClub(yards)}.`, ENGINE_PRIORITY.AMBIENT);
    }
  }, []);

  useEffect(() => {
    setTargetYards(null);
    lastSpokenTargetRef.current = null;
    if (middleDisplay) void speakJob(`Hole ${paramHole}. ${middleDisplay} yards.`, ENGINE_PRIORITY.STRATEGY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramHole]);

  const [lockedYards, setLockedYards] = useState<number | null>(null);
  const triggerLock = useCallback(() => {
    const y = targetYards ?? displayYards;
    if (!y) return;
    setLockedYards(y);
    flashOpacity.setValue(0.7);
    RNAnimated.timing(flashOpacity, { toValue: 0, duration: 350, useNativeDriver: true }).start();
    void speakJob(`${y} yards`, ENGINE_PRIORITY.AMBIENT);
  }, [targetYards, displayYards, flashOpacity]);

  const handleZoomChange = useCallback((val: number) => {
    setZoom(Math.min(((val - 1) / 7) * 0.9, 0.9));
    setZoomDisplay(val);
  }, []);

  const takePicture = useCallback(async () => {
    if (capturing || Platform.OS === 'web') return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.92 });
      if (!photo?.uri) throw new Error('No URI');
      flashOpacity.setValue(0.85);
      RNAnimated.timing(flashOpacity, { toValue: 0, duration: 280, useNativeDriver: true }).start();
      setSaveStatus('saving');
      try { await MediaLibrary.saveToLibraryAsync(photo.uri); } catch {}
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus('idle'), 2500); }
    finally { setCapturing(false); }
  }, [capturing, flashOpacity]);

  // Score to par
  const scoredHoles = scores.filter((s) => s > 0).length;
  const scoreToPar  = scoredHoles > 0
    ? scores.slice(0, scoredHoles).reduce((a, b) => a + b, 0) - scoredHoles * currentPar : null;

  // Map mode pan/pinch
  const [mapScale, setMapScale]   = useState(1);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const mapScaleRef   = useRef(1);
  const mapOffsetRef  = useRef({ x: 0, y: 0 });
  const pinchDist0    = useRef<number | null>(null);
  const pinchScale0   = useRef(1);
  const panStart      = useRef({ x: 0, y: 0 });
  const panOffset0    = useRef({ x: 0, y: 0 });

  const mapPanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: (evt) => {
      const t = evt.nativeEvent.touches;
      if (t.length === 2) {
        const dx = t[1].pageX - t[0].pageX, dy = t[1].pageY - t[0].pageY;
        pinchDist0.current  = Math.sqrt(dx * dx + dy * dy);
        pinchScale0.current = mapScaleRef.current;
      } else {
        panStart.current    = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
        panOffset0.current  = { ...mapOffsetRef.current };
      }
    },
    onPanResponderMove: (evt) => {
      const t = evt.nativeEvent.touches;
      if (t.length === 2 && pinchDist0.current != null) {
        const dx = t[1].pageX - t[0].pageX, dy = t[1].pageY - t[0].pageY;
        const d  = Math.sqrt(dx * dx + dy * dy);
        const ns = Math.min(5, Math.max(0.8, pinchScale0.current * (d / pinchDist0.current)));
        mapScaleRef.current = ns;
        setMapScale(ns);
      } else if (t.length === 1) {
        const nx = panOffset0.current.x + (evt.nativeEvent.pageX - panStart.current.x);
        const ny = panOffset0.current.y + (evt.nativeEvent.pageY - panStart.current.y);
        mapOffsetRef.current = { x: nx, y: ny };
        setMapOffset({ x: nx, y: ny });
      }
    },
    onPanResponderRelease: () => { pinchDist0.current = null; },
  })).current;

  if (!permission) return <View style={sl.bg} />;
  if (!permission.granted) return (
    <View style={[sl.bg, sl.center]}>
      <Text style={sl.permText}>Camera access required for rangefinder</Text>
      <Pressable onPress={requestPermission} style={sl.permBtn}><Text style={sl.permBtnText}>Allow Camera</Text></Pressable>
      <Pressable onPress={() => router.back()} style={[sl.permBtn, { marginTop: 12, backgroundColor: '#333' }]}><Text style={sl.permBtnText}>Go Back</Text></Pressable>
    </View>
  );

  const userCoords: LatLng | null = gpsCoords ? { lat: gpsCoords.latitude, lng: gpsCoords.longitude } : null;
  const vspLabel = scoreToPar == null ? '' : scoreToPar === 0 ? 'E' : scoreToPar > 0 ? `+${scoreToPar}` : `${scoreToPar}`;
  const vspColor = scoreToPar == null ? '#9CA3AF' : scoreToPar < 0 ? '#4ade80' : scoreToPar === 0 ? '#A7F3D0' : '#f87171';
  const gpsColor = gpsStatus === 'good' ? '#4ade80' : gpsStatus === 'weak' ? '#fbbf24' : '#9ca3af';
  const activeYards = targetYards ?? lockedYards ?? displayYards;

  return (
    <View style={sl.bg}>
      {/* Background */}
      {mode !== 'MAP' ? (
        Platform.OS !== 'web'
          ? <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" zoom={zoom} />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111' }]} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0a2a14' }]}>
          <HoleMapSvg width={screenW} height={screenH} holeCoords={holeCoords} userCoords={userCoords} scale={mapScale} offset={mapOffset} />
        </View>
      )}

      {/* TARGET dim overlay */}
      {mode === 'TARGET' && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} pointerEvents="none" />}

      {/* Flash */}
      <RNAnimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFE600', opacity: flashOpacity }]} pointerEvents="none" />

      {/* Map touch handler */}
      {mode === 'MAP' && <View style={StyleSheet.absoluteFill} {...mapPanResponder.panHandlers} />}

      {/* Targeting overlay */}
      {mode === 'TARGET' && (
        <TargetingOverlay
          userCoords={userCoords}
          greenCoords={holeCoords}
          gpsDistances={gpsDistances}
          baseYardage={baseYardage}
          onTargetDistance={handleTargetDistance}
        />
      )}

      {/* Standard tap-to-lock */}
      {mode === 'STANDARD' && !lockedYards && <Pressable style={StyleSheet.absoluteFill} onPress={triggerLock} />}
      {mode === 'STANDARD' && <CrosshairFixed />}

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <View style={[sl.topBar, { top: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={sl.backBtn}>
          <Text style={sl.backBtnText}>←</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={sl.topMeta}>
            {'HOLE '}<Text style={sl.topMetaNum}>{paramHole}</Text>
            {'  PAR '}<Text style={sl.topMetaNum}>{currentPar}</Text>
            {vspLabel !== '' && <Text style={[sl.topVsp, { color: vspColor }]}>{'  '}{vspLabel}</Text>}
          </Text>
          <Text style={[sl.gpsStatus, { color: gpsColor }]}>
            {gpsStatus === 'good' ? '● GPS' : gpsStatus === 'searching' ? '○ Locating...' : gpsStatus === 'weak' ? '◑ GPS (weak)' : '○ GPS off'}
          </Text>
        </View>
        {mode === 'STANDARD' && (
          <Pressable onPress={() => setFlash((f) => !f)} style={[sl.backBtn, { backgroundColor: flash ? 'rgba(255,230,0,0.25)' : 'rgba(0,0,0,0.45)' }]}>
            <Text style={{ fontSize: 18 }}>{flash ? '⚡' : '🔦'}</Text>
          </Pressable>
        )}
      </View>

      {/* ── MODE SWITCHER ────────────────────────────────────────────────── */}
      <View style={[sl.modeSwitcher, { top: insets.top + 64 }]}>
        {(['STANDARD', 'TARGET', 'MAP'] as Mode[]).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[sl.modeBtn, mode === m && sl.modeBtnActive]}>
            <Text style={[sl.modeBtnText, mode === m && sl.modeBtnTextActive]}>
              {m === 'STANDARD' ? '📷' : m === 'TARGET' ? '⊕' : '🗺️'} {m}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── BOTTOM HUD ───────────────────────────────────────────────────── */}
      <View style={[sl.hudBottom, { bottom: insets.bottom + (mode === 'STANDARD' ? 108 : 10) }]} pointerEvents="none">
        {/* Locked */}
        {lockedYards && mode === 'STANDARD' ? (
          <View style={sl.lockedRow}>
            <Text style={sl.lockedLabel}>🔒 LOCKED</Text>
            <Text style={sl.lockedYards}>{lockedYards}</Text>
            <Text style={{ color: '#A7F3D0', fontSize: 12, fontWeight: '700' }}>yds</Text>
          </View>
        ) : (
          <View style={sl.fmbRow}>
            {frontDisplay  != null && <FMBCell label="F" value={frontDisplay} />}
            {middleDisplay != null && <FMBCell label="M" value={middleDisplay} hero />}
            {backDisplay   != null && <FMBCell label="B" value={backDisplay} />}
          </View>
        )}
        {/* To target */}
        {mode === 'TARGET' && targetYards != null && (
          <View style={sl.targetRow}>
            <Text style={sl.targetLabel}>⊕  TO TARGET</Text>
            <Text style={sl.targetYards}>{targetYards}</Text>
            <Text style={sl.targetUnit}>yds</Text>
          </View>
        )}
        {/* Caddie tip */}
        {activeYards != null && (
          <Text style={sl.caddieTip}>{bestClub(activeYards)} · {activeYards <= 100 ? 'focus on landing zone' : 'commit to the shot'}</Text>
        )}
      </View>

      {/* ── UNLOCK button ───────────────────────────────────────────────── */}
      {lockedYards && mode === 'STANDARD' && (
        <Pressable style={[sl.unlockBtn, { bottom: insets.bottom + 108 }]} onPress={() => setLockedYards(null)}>
          <Text style={sl.unlockText}>🔓 Unlock</Text>
        </Pressable>
      )}

      {/* ── QUICK BUTTONS ──────────────────────────────────────────────── */}
      <View style={[sl.quickBtns, { bottom: insets.bottom + (mode === 'STANDARD' ? 52 : 4) }]}>
        {mode === 'TARGET' && (
          <Pressable style={sl.quickBtn} onPress={() => { setTargetYards(null); void speakJob(`${middleDisplay ?? ''} yards`, ENGINE_PRIORITY.AMBIENT); }}>
            <Text style={sl.quickBtnText}>⊕ Centre Pin</Text>
          </Pressable>
        )}
        <Pressable style={sl.quickBtn} onPress={() => { setGpsStatus('searching'); }}>
          <Text style={sl.quickBtnText}>📍 My Position</Text>
        </Pressable>
        {mode === 'MAP' && (
          <Pressable style={sl.quickBtn} onPress={() => { setMapScale(1); setMapOffset({ x: 0, y: 0 }); mapScaleRef.current = 1; mapOffsetRef.current = { x: 0, y: 0 }; }}>
            <Text style={sl.quickBtnText}>🗾 Hole View</Text>
          </Pressable>
        )}
      </View>

      {/* ── ZOOM SLIDER ─────────────────────────────────────────────────── */}
      {mode === 'STANDARD' && (
        <View style={[sl.zoomPanel, { top: insets.top + 120 }]}>
          <Text style={sl.zoomLabel}>{zoomDisplay.toFixed(1)}x</Text>
          <View style={sl.zoomRow}>
            <Pressable onPress={() => handleZoomChange(Math.max(1, zoomDisplay - 0.5))} style={sl.zoomStepBtn}><Text style={sl.zoomStepTxt}>−</Text></Pressable>
            <Slider style={{ width: 120, height: 36 }} minimumValue={1} maximumValue={8} step={0.1} value={zoomDisplay}
              onValueChange={handleZoomChange} minimumTrackTintColor="#FFE600" maximumTrackTintColor="rgba(255,255,255,0.2)" thumbTintColor="#FFE600" />
            <Pressable onPress={() => handleZoomChange(Math.min(8, zoomDisplay + 0.5))} style={sl.zoomStepBtn}><Text style={sl.zoomStepTxt}>+</Text></Pressable>
          </View>
          <Text style={sl.zoomSub}>ZOOM</Text>
        </View>
      )}

      {/* ── SHUTTER ─────────────────────────────────────────────────────── */}
      {mode === 'STANDARD' && (
        <View style={[sl.shutterRow, { bottom: insets.bottom + 24 }]}>
          {saveStatus !== 'idle' && (
            <View style={sl.saveStatusBadge}>
              {saveStatus === 'saving' && <ActivityIndicator size="small" color="#FFE600" />}
              <Text style={sl.saveStatusText}>{saveStatus === 'saving' ? ' Saving...' : saveStatus === 'saved' ? '✓ Saved' : '✗ Error'}</Text>
            </View>
          )}
          <Pressable onPress={takePicture} disabled={capturing || Platform.OS === 'web'}
            style={({ pressed }) => [sl.shutterBtn, { opacity: (capturing || Platform.OS === 'web') ? 0.4 : pressed ? 0.75 : 1 }]}>
            <View style={sl.shutterInner} />
          </Pressable>
        </View>
      )}

      {/* Map hint */}
      {mode === 'MAP' && (
        <View style={[sl.mapHint, { top: insets.top + 56 }]} pointerEvents="none">
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Pinch to zoom · Drag to pan</Text>
        </View>
      )}
    </View>
  );
}

// Fixed crosshair (STANDARD)
function CrosshairFixed() {
  const { width, height } = useWindowDimensions();
  const cx = width / 2, cy = height / 2, sz = 56, bw = 3, col = '#FFE600';
  const gw = { shadowColor: '#FFE600', shadowOpacity: 0.9, shadowRadius: 8 };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{ position: 'absolute', left: cx - sz, top: cy, width: sz * 2, height: 1.5, backgroundColor: 'rgba(255,230,0,0.4)' }} />
      <View style={{ position: 'absolute', left: cx, top: cy - sz, width: 1.5, height: sz * 2, backgroundColor: 'rgba(255,230,0,0.4)' }} />
      <View style={{ position: 'absolute', left: cx - sz, top: cy - sz, width: 20, height: bw, backgroundColor: col, ...gw }} />
      <View style={{ position: 'absolute', left: cx - sz, top: cy - sz, width: bw, height: 20, backgroundColor: col, ...gw }} />
      <View style={{ position: 'absolute', left: cx + sz - 20, top: cy - sz, width: 20, height: bw, backgroundColor: col, ...gw }} />
      <View style={{ position: 'absolute', left: cx + sz - bw, top: cy - sz, width: bw, height: 20, backgroundColor: col, ...gw }} />
      <View style={{ position: 'absolute', left: cx - sz, top: cy + sz - bw, width: 20, height: bw, backgroundColor: col, ...gw }} />
      <View style={{ position: 'absolute', left: cx - sz, top: cy + sz - 20, width: bw, height: 20, backgroundColor: col, ...gw }} />
      <View style={{ position: 'absolute', left: cx + sz - 20, top: cy + sz - bw, width: 20, height: bw, backgroundColor: col, ...gw }} />
      <View style={{ position: 'absolute', left: cx + sz - bw, top: cy + sz - 20, width: bw, height: 20, backgroundColor: col, ...gw }} />
      <View style={{ position: 'absolute', left: cx - 4, top: cy - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: col, shadowColor: col, shadowOpacity: 1, shadowRadius: 6 }} />
    </View>
  );
}

// SVG hole map (MAP mode)
function HoleMapSvg({ width, height, holeCoords, userCoords, scale, offset }:
  { width: number; height: number; holeCoords: { front: LatLng|null; middle: LatLng|null; back: LatLng|null }; userCoords: LatLng|null; scale: number; offset: { x: number; y: number } }) {
  const anchor = holeCoords.middle ?? holeCoords.front ?? holeCoords.back;
  if (!anchor) return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: '#4a7c5e', fontSize: 14 }}>No hole coordinates available</Text>
    </View>
  );
  const cx = width / 2 + offset.x, cy = height / 2 + offset.y;
  const PPY = 1.8 * scale;
  const anchorCoord = anchor; // narrowed above — reassign so closure captures non-null binding
  function proj(c: LatLng) {
    const dy = (c.lat - anchorCoord.lat) * 111000 * 1.09361;
    const dx = (c.lng - anchorCoord.lng) * 111000 * Math.cos(anchorCoord.lat * Math.PI / 180) * 1.09361;
    return { x: cx + dx * PPY, y: cy - dy * PPY };
  }
  const mp = holeCoords.middle ? proj(holeCoords.middle) : { x: cx, y: cy };
  const fp = holeCoords.front  ? proj(holeCoords.front)  : { x: cx, y: cy + 12 * PPY };
  const bp = holeCoords.back   ? proj(holeCoords.back)   : { x: cx, y: cy - 12 * PPY };
  const up = userCoords ? proj(userCoords) : null;
  return (
    <Svg width={width} height={height}>
      <Rect x={cx - 28 * scale} y={up?.y ?? cy + 60} width={56 * scale}
        height={Math.max(0, mp.y - (up?.y ?? cy + 60))} fill="rgba(34,85,34,0.55)" rx={10} />
      <Circle cx={mp.x} cy={mp.y} r={22 * scale} fill="rgba(34,120,34,0.9)" stroke="#A7F3D0" strokeWidth={1.5} />
      <Circle cx={fp.x} cy={fp.y} r={6 * scale}  fill="#3b82f6" stroke="#fff" strokeWidth={1} />
      <Circle cx={bp.x} cy={bp.y} r={6 * scale}  fill="#ef4444" stroke="#fff" strokeWidth={1} />
      <Circle cx={mp.x} cy={mp.y} r={5 * scale}  fill="#FFE600" stroke="#fff" strokeWidth={1.5} />
      <SvgText x={fp.x} y={fp.y - 10} fill="#93c5fd" fontSize={10} textAnchor="middle">F</SvgText>
      <SvgText x={mp.x} y={mp.y - 27} fill="#A7F3D0" fontSize={11} textAnchor="middle" fontWeight="bold">M</SvgText>
      <SvgText x={bp.x} y={bp.y - 10} fill="#fca5a5" fontSize={10} textAnchor="middle">B</SvgText>
      {up && <>
        <Circle cx={up.x} cy={up.y} r={10 * scale} fill="rgba(59,130,246,0.3)" stroke="#3b82f6" strokeWidth={2} />
        <Circle cx={up.x} cy={up.y} r={4  * scale} fill="#3b82f6" />
        <SvgText x={up.x} y={up.y + 18} fill="#93c5fd" fontSize={9} textAnchor="middle">YOU</SvgText>
        <SvgLine x1={up.x} y1={up.y} x2={mp.x} y2={mp.y} stroke="rgba(167,243,208,0.4)" strokeWidth={1.5} strokeDasharray="6,4" />
      </>}
    </Svg>
  );
}

// F/M/B cell
function FMBCell({ label, value, hero }: { label: string; value: number; hero?: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={{ color: hero ? '#A7F3D0' : 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700', letterSpacing: 1.3 }}>{label}</Text>
      <Text style={hero
        ? { color: '#A7F3D0', fontSize: 30, fontWeight: '900', textShadowColor: 'rgba(167,243,208,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 }
        : { color: 'rgba(255,255,255,0.7)', fontSize: 18, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const sl = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  center: { justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 32 },
  permText:    { color: '#fff', fontSize: 18, textAlign: 'center', marginBottom: 8 },
  permBtn:     { backgroundColor: '#2e7d32', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  topBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.55)', gap: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  backBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  topMeta: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  topMetaNum: { color: '#fff', fontSize: 14, fontWeight: '900' },
  topVsp: { fontSize: 12, fontWeight: '900' },
  gpsStatus: { fontSize: 10, fontWeight: '700', marginTop: 1 },
  modeSwitcher: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6, paddingHorizontal: 16 },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  modeBtnActive: { backgroundColor: 'rgba(46,125,50,0.85)', borderColor: '#4ade80' },
  modeBtnText: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700' },
  modeBtnTextActive: { color: '#fff' },
  hudBottom: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.62)', paddingHorizontal: 24, paddingTop: 14, paddingBottom: 18, gap: 10 },
  fmbRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' },
  lockedRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline', gap: 8 },
  lockedLabel: { color: '#FFE600', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  lockedYards: { color: '#FFE600', fontSize: 34, fontWeight: '900', textShadowColor: 'rgba(255,230,0,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  targetRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6 },
  targetLabel: { color: '#FFE600', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  targetYards: { color: '#FFE600', fontSize: 24, fontWeight: '900', textShadowColor: 'rgba(255,230,0,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  targetUnit: { color: 'rgba(255,230,0,0.7)', fontSize: 12, fontWeight: '700' },
  caddieTip: { color: 'rgba(167,243,208,0.85)', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  quickBtns: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  quickBtn: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  quickBtnText: { color: '#A7F3D0', fontSize: 12, fontWeight: '700' },
  zoomPanel: { position: 'absolute', right: 12, alignItems: 'center', gap: 4 },
  zoomLabel: { color: '#FFE600', fontSize: 12, fontWeight: '800' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  zoomStepBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  zoomStepTxt: { color: '#FFE600', fontSize: 18, fontWeight: '700' },
  zoomSub: { color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  shutterRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 10 },
  shutterBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 3, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  saveStatusBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, gap: 6 },
  saveStatusText: { color: '#FFE600', fontSize: 13, fontWeight: '700' },
  unlockBtn: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#FFE600' },
  unlockText: { color: '#FFE600', fontSize: 14, fontWeight: '700' },
  mapHint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
