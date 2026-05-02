import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import KevinBadge from '../components/KevinBadge';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSmartFinderStore } from '../store/smartFinderStore';
import {
  computeDistance,
  buildLock,
  confidenceMargin,
} from '../services/rangefinder';
import type { RangefinderLock } from '../types/smartfinder';

const LOCK_DURATION_MS = 30_000;

export default function SmartFinder() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: _W, height: H } = useWindowDimensions();

  const { distance_unit } = useSettingsStore();
  const { subscription_status: _subscription_status } = usePlayerProfileStore();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationGranted, setLocationGranted] = useState(false);
  const [lock, setLock] = useState<RangefinderLock | null>(null);
  const [countdown, setCountdown] = useState(0);

  // Sensor refs — updated continuously, read only on tap
  const headingRef = useRef(0);
  const pitchRef = useRef(-10); // sensible default: slightly downward

  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Request location permission on mount ─
  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setLocationGranted(status === 'granted');
    });
  }, []);

  // ── Subscribe to DeviceMotion for pitch + heading ─
  useEffect(() => {
    DeviceMotion.setUpdateInterval(200);
    const sub = DeviceMotion.addListener(data => {
      if (data.rotation) {
        const pitchDeg = ((data.rotation.beta ?? 0) * 180) / Math.PI;
        pitchRef.current = pitchDeg;
        const alphaDeg = ((data.rotation.alpha ?? 0) * 180) / Math.PI;
        headingRef.current = ((alphaDeg % 360) + 360) % 360;
      }
    });
    return () => sub.remove();
  }, []);

  // ── Auto-clear lock after 30s ─────────────
  const clearLock = useCallback(() => {
    setLock(null);
    setCountdown(0);
    useSmartFinderStore.getState().clearLock();
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    lockTimerRef.current = null;
    countdownRef.current = null;
  }, []);

  // ── Tap handler ───────────────────────────
  const handleTap = useCallback(async (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!locationGranted) {
      Alert.alert(
        'Location needed',
        'SmartFinder uses your GPS position to calculate distance. Please grant location access in Settings.',
      );
      return;
    }

    let position: Location.LocationObject;
    try {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch {
      Alert.alert('GPS unavailable', 'Could not get your position. Try moving to open sky.');
      return;
    }

    const tapY = event.nativeEvent.locationY;
    const tapYNorm = Math.max(0, Math.min(1, tapY / H));

    const result = computeDistance({
      user_position: {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy ?? 10,
      },
      compass_heading: headingRef.current,
      tap_y_normalized: tapYNorm,
      device_pitch_degrees: pitchRef.current,
    });

    const newLock = buildLock(
      {
        user_position: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy ?? 10,
        },
        compass_heading: headingRef.current,
        tap_y_normalized: tapYNorm,
        device_pitch_degrees: pitchRef.current,
      },
      result,
    );

    setLock(newLock);
    useSmartFinderStore.getState().setLock(newLock);
    setCountdown(30);

    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    lockTimerRef.current = setTimeout(clearLock, LOCK_DURATION_MS);

    let remaining = 30;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    }, 1000);
  }, [locationGranted, H, clearLock]);

  useEffect(() => () => {
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  // ── Permission gates ──────────────────────
  if (!cameraPermission) {
    return <View style={styles.container} />;
  }

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionBox}>
          <Text style={styles.permTitle}>Camera Access</Text>
          <Text style={styles.permText}>
            SmartFinder uses the camera to aim at your target. Your camera feed never leaves your device.
          </Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestCameraPermission}>
            <Text style={styles.permBtnText}>Allow Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Display values
  const displayDist = lock
    ? (distance_unit === 'meters' ? lock.distance_meters : lock.distance_yards)
    : null;
  const displayUnit = distance_unit === 'meters' ? 'm' : 'yds';
  const margin = lock ? confidenceMargin(
    computeDistance({
      user_position: lock.user_position,
      compass_heading: lock.compass_heading,
      tap_y_normalized: lock.tap_y_normalized,
      device_pitch_degrees: pitchRef.current,
    }).confidence,
  ) : 0;

  const confidenceColor = lock
    ? (lock.distance_yards >= 50 && lock.distance_yards <= 250 ? '#00C896' :
       lock.distance_yards >= 10 && lock.distance_yards <= 400 ? '#F5A623' : '#ef4444')
    : '#6b7280';

  return (
    <View style={styles.container}>
      {/* Full-screen camera */}
      <TouchableOpacity
        activeOpacity={1}
        style={StyleSheet.absoluteFill}
        onPress={handleTap}
      >
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
        />
      </TouchableOpacity>

      {/* Reticle */}
      <View style={styles.reticleContainer} pointerEvents="none">
        <View style={styles.reticleH} />
        <View style={styles.reticleV} />
        <View style={styles.reticleCircle} />
      </View>

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <KevinBadge />
        <View style={styles.topCenter}>
          <Text style={styles.topTitle}>SmartFinder</Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Instruction / GPS warning */}
      {!locationGranted && (
        <View style={[styles.warningBanner, { top: insets.top + 56 }]} pointerEvents="none">
          <Text style={styles.warningText}>⚠ Location access needed for distance</Text>
        </View>
      )}

      {/* Bottom overlay */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 16 }]}>
        {lock ? (
          <>
            <View style={styles.distanceRow}>
              <Text style={[styles.distanceNumber, { color: confidenceColor }]}>
                {displayDist}
              </Text>
              <Text style={styles.distanceUnit}>{displayUnit}</Text>
            </View>
            <Text style={styles.marginText}>± {margin} {displayUnit}</Text>
            <View style={styles.lockFooter}>
              <Text style={styles.countdownText}>Clears in {countdown}s</Text>
              <TouchableOpacity style={styles.clearBtn} onPress={clearLock}>
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={styles.instructionText}>Aim at target · Tap anywhere to lock distance</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  topCenter: { flex: 1, alignItems: 'center' },
  topTitle: { color: '#ffffff', fontSize: 14, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },

  warningBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(245,166,35,0.85)',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  warningText: { color: '#000', fontSize: 12, fontWeight: '700' },

  reticleContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleH: {
    position: 'absolute',
    width: 28,
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  reticleV: {
    position: 'absolute',
    width: 1.5,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  reticleCircle: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
  },

  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(6,15,9,0.82)',
    paddingTop: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  instructionText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    textAlign: 'center',
    paddingBottom: 8,
  },
  distanceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  distanceNumber: { fontSize: 72, fontWeight: '900', lineHeight: 76 },
  distanceUnit: { color: '#9ca3af', fontSize: 22, fontWeight: '600', paddingBottom: 10 },
  marginText: { color: '#6b7280', fontSize: 13, marginTop: 2 },
  lockFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 12 },
  countdownText: { color: '#6b7280', fontSize: 13 },
  clearBtn: {
    borderWidth: 1, borderColor: '#ef4444', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  clearBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '700' },

  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  permTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  permText: { color: '#9ca3af', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 28 },
  permBtn: { backgroundColor: '#00C896', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  permBtnText: { color: '#060f09', fontSize: 16, fontWeight: '800' },
  backLink: { marginTop: 20 },
  backLinkText: { color: '#6b7280', fontSize: 14 },
});
