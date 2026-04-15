import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as Location from 'expo-location';
import Slider from '@react-native-community/slider';
import * as WebBrowser from 'expo-web-browser';
import { speak } from '../services/voiceService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function RangefinderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    yardage?: string; hole?: string;
    frontLat?: string; frontLng?: string;
    middleLat?: string; middleLng?: string;
    backLat?: string; backLng?: string;
  }>();
  const baseYardage = parseInt(params.yardage ?? '0', 10) || null;
  const holeCoords = {
    front:  params.frontLat  && params.frontLng  ? { lat: parseFloat(params.frontLat),  lng: parseFloat(params.frontLng)  } : null,
    middle: params.middleLat && params.middleLng ? { lat: parseFloat(params.middleLat), lng: parseFloat(params.middleLng) } : null,
    back:   params.backLat   && params.backLng   ? { lat: parseFloat(params.backLat),   lng: parseFloat(params.backLng)   } : null,
  };

  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();

  const cameraRef = useRef<CameraView>(null);

  const [zoom, setZoom] = useState(0);
  const [zoomDisplay, setZoomDisplay] = useState(1.0);
  const [lockedYards, setLockedYards] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const flashOpacity = useRef(new Animated.Value(0)).current;

  // GPS state
  const [gpsCoords, setGpsCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'off' | 'searching' | 'good' | 'weak'>('off');
  const locationSub = useRef<Location.LocationSubscription | null>(null);

  // Haversine — accurate to ±1 yd at golf distances
  const haversineYards = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const meters = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(meters * 1.09361);
  }, []);

  // Start GPS watch on mount, clean up on unmount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      setGpsStatus('searching');
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 2000 },
        (loc) => {
          if (cancelled) return;
          setGpsCoords(loc.coords);
          const acc = loc.coords.accuracy ?? 999;
          setGpsStatus(acc <= 8 ? 'good' : acc <= 20 ? 'weak' : 'searching');
        }
      );
    })();
    return () => {
      cancelled = true;
      locationSub.current?.remove();
    };
  }, []);

  // Live GPS distances to front / middle / back
  const gpsDistances = gpsCoords ? {
    front:  holeCoords.front  ? haversineYards(gpsCoords.latitude, gpsCoords.longitude, holeCoords.front.lat,  holeCoords.front.lng)  : null,
    middle: holeCoords.middle ? haversineYards(gpsCoords.latitude, gpsCoords.longitude, holeCoords.middle.lat, holeCoords.middle.lng) : null,
    back:   holeCoords.back   ? haversineYards(gpsCoords.latitude, gpsCoords.longitude, holeCoords.back.lat,   holeCoords.back.lng)  : null,
  } : null;

  const displayYards = lockedYards ?? gpsDistances?.middle ?? baseYardage;
  const frontBackDisplay = {
    front: gpsDistances?.front ?? (displayYards != null ? Math.max(0, displayYards - 7) : null),
    middle: gpsDistances?.middle ?? displayYards,
    back: gpsDistances?.back ?? (displayYards != null ? displayYards + 7 : null),
  };

  const handleZoomChange = useCallback((val: number) => {
    // Slider 1–8x display → camera zoom 0–0.9
    // Capped at 0.9 to avoid device crashes at max zoom
    const cameraZoom = Math.min(((val - 1) / 7) * 0.9, 0.9);
    setZoom(cameraZoom);
    setZoomDisplay(val);
  }, []);

  const takePicture = useCallback(async () => {
    if (capturing || Platform.OS === 'web') return;
    setCapturing(true);
    try {
      // Ensure media library permission
      let perm = mediaPermission;
      if (!perm?.granted) {
        perm = await requestMediaPermission();
      }
      if (!perm?.granted) {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 2500);
        setCapturing(false);
        return;
      }

      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.92,
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error('No URI');

      // Flash feedback
      flashOpacity.setValue(0.85);
      Animated.timing(flashOpacity, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();

      setSaveStatus('saving');
      await MediaLibrary.saveToLibraryAsync(photo.uri);
      setSaveStatus('saved');
      void speak('Photo saved.');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } finally {
      setCapturing(false);
    }
  }, [capturing, mediaPermission, requestMediaPermission, flashOpacity]);

  const triggerLock = useCallback(() => {
    if (!displayYards) return;
    setLockedYards(displayYards);
    // Flash feedback
    flashOpacity.setValue(0.7);
    Animated.timing(flashOpacity, {
      toValue: 0,
      duration: 350,
      useNativeDriver: true,
    }).start();
    void speak(`${displayYards} yards`);
  }, [displayYards, flashOpacity]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const openHoleZoom = useCallback(async () => {
    const target = holeCoords.middle ?? holeCoords.front ?? holeCoords.back ?? (gpsCoords
      ? { lat: gpsCoords.latitude, lng: gpsCoords.longitude }
      : null);

    if (!target) {
      void speak('Satellite hole view is unavailable right now.');
      return;
    }

    const earthUrl = `https://earth.google.com/web/search/${target.lat},${target.lng}`;
    const mapsUrl = `https://www.google.com/maps/@?api=1&map_action=map&basemap=satellite&center=${target.lat},${target.lng}&zoom=20`;

    try {
      void speak('Opening hole zoom.');
      await WebBrowser.openBrowserAsync(earthUrl);
    } catch {
      await WebBrowser.openBrowserAsync(mapsUrl);
    }
  }, [gpsCoords, holeCoords.back, holeCoords.front, holeCoords.middle]);

  // ── Permission gate ──────────────────────────────────────────────────
  if (!permission) return <View style={styles.bg} />;

  if (!permission.granted) {
    return (
      <View style={[styles.bg, styles.center]}>
        <Text style={styles.permText}>Camera access required for rangefinder</Text>
        <Pressable onPress={requestPermission} style={styles.permBtn}>
          <Text style={styles.permBtnText}>Allow Camera</Text>
        </Pressable>
        <Pressable onPress={handleBack} style={[styles.permBtn, { marginTop: 12, backgroundColor: '#333' }]}>
          <Text style={styles.permBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  // ── Main rangefinder view ────────────────────────────────────────────
  return (
    <View style={styles.bg}>
      {/* Full-screen camera */}
      {Platform.OS !== 'web' ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          zoom={zoom}
        />
      ) : (
        // Web fallback — dark background
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111' }]} />
      )}

      {/* Flash overlay on lock */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#FFE600', opacity: flashOpacity }]}
        pointerEvents="none"
      />

      {/* Tap-anywhere lock target (behind all other UI) */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={triggerLock}
      />

      {/* ── Crosshair ── */}
      <View style={styles.crosshairContainer} pointerEvents="none">
        {/* Corner brackets */}
        <CornerBrackets size={52} />
        {/* Center dot */}
        <View style={styles.centerDot} />
      </View>

      {/* ── Yardage HUD ── */}
      <View style={[styles.yardageHud, { top: 60 + insets.top }]} pointerEvents="none">
        {lockedYards ? (
          <View style={styles.lockedBadge}>
            <Text style={styles.lockedLabel}>🔒 LOCKED</Text>
            <Text style={styles.lockedYards}>{lockedYards} yds</Text>
          </View>
        ) : gpsDistances?.middle ? (
          <View style={styles.liveYardageBadge}>
            {/* Front / Middle / Back row */}
            {(frontBackDisplay.front != null || frontBackDisplay.middle != null || frontBackDisplay.back != null) && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginBottom: 4, gap: 12 }}>
                {frontBackDisplay.front != null && <Text style={styles.fmbLabel}>F {frontBackDisplay.front}</Text>}
                {frontBackDisplay.middle != null && <Text style={styles.fmbLabel}>M {frontBackDisplay.middle}</Text>}
                {frontBackDisplay.back  != null && <Text style={styles.fmbLabel}>B {frontBackDisplay.back}</Text>}
              </View>
            )}
            <Text style={styles.liveYards}>{frontBackDisplay.middle} yds</Text>
            <Text style={[styles.fmbLabel, { textAlign: 'center', marginTop: 2, opacity: 0.7 }]}>to middle</Text>
            <Text style={{ color: gpsStatus === 'good' ? '#4ade80' : gpsStatus === 'weak' ? '#fbbf24' : '#9ca3af', fontSize: 10, marginTop: 4 }}>
              {gpsStatus === 'good' ? '● GPS' : gpsStatus === 'weak' ? '● GPS (weak)' : '○ Locating...'}
            </Text>
          </View>
        ) : displayYards ? (
          <View style={styles.liveYardageBadge}>
            <Text style={styles.liveYards}>{displayYards} yds</Text>
            {gpsStatus === 'searching' && (
              <Text style={{ color: '#9ca3af', fontSize: 10, marginTop: 4 }}>○ Locating GPS...</Text>
            )}
          </View>
        ) : null}
      </View>

      {/* ── Tap hint ── */}
      {!lockedYards && (
        <View style={[styles.tapHint, { bottom: 80 + insets.bottom }]} pointerEvents="none">
          <Text style={styles.tapHintText}>TAP ANYWHERE TO LOCK</Text>
        </View>
      )}

      {/* ── Unlock button (shown when locked) ── */}
      {lockedYards && (
        <Pressable
          style={[styles.unlockBtn, { bottom: 72 + insets.bottom }]}
          onPress={() => setLockedYards(null)}
        >
          <Text style={styles.unlockText}>🔓 Unlock</Text>
        </Pressable>
      )}

      {/* ── Zoom slider ── */}
      <View style={[styles.zoomPanel, { top: insets.top + 120 }]}>
        <Text style={styles.zoomLabel}>{zoomDisplay.toFixed(1)}x</Text>
        <View style={styles.zoomRow}>
          <Pressable onPress={() => handleZoomChange(Math.max(1, zoomDisplay - 0.5))} style={styles.zoomStepBtn}>
            <Text style={styles.zoomStepText}>−</Text>
          </Pressable>
          <Slider
            style={{ width: 150, height: 40 }}
            minimumValue={1}
            maximumValue={8}
            step={0.1}
            value={zoomDisplay}
            onValueChange={handleZoomChange}
            minimumTrackTintColor="#FFE600"
            maximumTrackTintColor="rgba(255,255,255,0.2)"
            thumbTintColor="#FFE600"
          />
          <Pressable onPress={() => handleZoomChange(Math.min(8, zoomDisplay + 0.5))} style={styles.zoomStepBtn}>
            <Text style={styles.zoomStepText}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.zoomSub}>ZOOM</Text>
      </View>

      {/* ── Capture / shutter button ── */}
      <View style={[styles.shutterRow, { bottom: insets.bottom + 32 }]}>
        {/* Save status badge */}
        {saveStatus !== 'idle' && (
          <View style={styles.saveStatusBadge}>
            {saveStatus === 'saving' && <ActivityIndicator size="small" color="#FFE600" />}
            <Text style={styles.saveStatusText}>
              {saveStatus === 'saving' ? ' Saving...' : saveStatus === 'saved' ? '✓ Saved to Photos' : '✗ Could not save'}
            </Text>
          </View>
        )}
        <Pressable
          onPress={takePicture}
          disabled={capturing || Platform.OS === 'web'}
          style={({ pressed }) => [
            styles.shutterBtn,
            { opacity: (capturing || Platform.OS === 'web') ? 0.4 : pressed ? 0.75 : 1 },
          ]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
      </View>

      {/* ── Top bar ── */}
      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <Text style={styles.topTitle}>🔭 RANGEFINDER</Text>
        <View style={styles.topBarActions}>
          <Pressable onPress={openHoleZoom} style={[styles.backBtn, styles.earthBtn]}>
            <Text style={styles.earthBtnText}>🌎</Text>
          </Pressable>
          <Pressable
            onPress={() => setFlash((f) => !f)}
            style={[styles.backBtn, { backgroundColor: flash ? 'rgba(255,230,0,0.25)' : 'rgba(0,0,0,0.45)' }]}
          >
            <Text style={{ fontSize: 18 }}>{flash ? '⚡' : '🔦'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Corner bracket component ─────────────────────────────────────────────────
function CornerBrackets({ size }: { size: number }) {
  const bw = 3;
  const color = '#FFE600';
  const glow = { shadowColor: '#FFE600', shadowOpacity: 0.9, shadowRadius: 8 };
  return (
    <>
      {/* Top-left */}
      <View style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -(size + 8) }, { translateY: -(size + 8) }] }}>
        <View style={{ width: size, height: bw, backgroundColor: color, ...glow }} />
        <View style={{ width: bw, height: size, backgroundColor: color, marginTop: -bw, ...glow }} />
      </View>
      {/* Top-right */}
      <View style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: 8 }, { translateY: -(size + 8) }] }}>
        <View style={{ width: size, height: bw, backgroundColor: color, alignSelf: 'flex-end', ...glow }} />
        <View style={{ width: bw, height: size, backgroundColor: color, alignSelf: 'flex-end', marginTop: -bw, ...glow }} />
      </View>
      {/* Bottom-left */}
      <View style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -(size + 8) }, { translateY: 8 }] }}>
        <View style={{ width: bw, height: size, backgroundColor: color, ...glow }} />
        <View style={{ width: size, height: bw, backgroundColor: color, marginTop: -bw, ...glow }} />
      </View>
      {/* Bottom-right */}
      <View style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: 8 }, { translateY: 8 }] }}>
        <View style={{ width: bw, height: size, backgroundColor: color, alignSelf: 'flex-end', ...glow }} />
        <View style={{ width: size, height: bw, backgroundColor: color, alignSelf: 'flex-end', marginTop: -bw, ...glow }} />
      </View>
    </>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  permText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 8,
  },
  permBtn: {
    backgroundColor: '#2e7d32',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  earthBtn: {
    minWidth: 50,
  },
  earthBtnText: {
    color: '#A7F3D0',
    fontSize: 18,
  },
  // Crosshair
  crosshairContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFE600',
    shadowColor: '#FFE600',
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 4,
  },
  // Yardage
  yardageHud: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  liveYardageBadge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.4)',
  },
  liveYards: {
    color: '#A7F3D0',
    fontSize: 32,
    fontFamily: 'Outfit_800ExtraBold',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  fmbLabel: {
    color: '#A7F3D0',
    fontSize: 11,
    fontFamily: 'Outfit_600SemiBold',
    letterSpacing: 0.5,
    opacity: 0.85,
  },
  lockedBadge: {
    backgroundColor: 'rgba(255,230,0,0.18)',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: '#FFE600',
    alignItems: 'center',
  },
  lockedLabel: {
    color: '#FFE600',
    fontSize: 11,
    fontFamily: 'Outfit_700Bold',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  lockedYards: {
    color: '#FFE600',
    fontSize: 36,
    fontFamily: 'Outfit_800ExtraBold',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  // Tap hint
  tapHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  tapHintText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontFamily: 'Outfit_600SemiBold',
    letterSpacing: 2,
  },
  // Unlock
  unlockBtn: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  unlockText: {
    color: '#fff',
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 14,
  },
  // Zoom
  zoomPanel: {
    position: 'absolute',
    right: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  zoomStepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomStepText: {
    color: '#FFE600',
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    lineHeight: 22,
  },
  zoomLabel: {
    color: '#FFE600',
    fontSize: 12,
    fontFamily: 'Outfit_700Bold',
  },
  zoomSub: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontFamily: 'Outfit_600SemiBold',
    letterSpacing: 1,
  },
  // Top bar
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'Outfit_700Bold',
    lineHeight: 26,
  },
  topTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontFamily: 'Outfit_700Bold',
    letterSpacing: 1.5,
  },
  // Shutter / capture
  shutterRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
  },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
  },
  saveStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 6,
  },
  saveStatusText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Outfit_600SemiBold',
  },
});
