import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import {
  computeDistance,
  buildLock,
  confidenceMargin,
} from '../services/rangefinder';
import { useSettingsStore } from '../store/settingsStore';
import type { RangefinderLock } from '../types/smartfinder';

const MOCK_DISTANCES = [
  { label: '50 yds (near)', tap_y: 0.62, pitch: -16 },
  { label: '100 yds (mid)', tap_y: 0.55, pitch: -9 },
  { label: '150 yds (far)',  tap_y: 0.52, pitch: -6 },
  { label: '200 yds (long)', tap_y: 0.51, pitch: -4.5 },
  { label: '250 yds (edge)', tap_y: 0.505, pitch: -3.5 },
  { label: 'Too flat — low confidence', tap_y: 0.5, pitch: -1 },
];

export default function SmartFinderDebug() {
  const router = useRouter();
  const { distance_unit } = useSettingsStore();

  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [pitch, setPitch] = useState<number>(0);
  const [lock, setLock] = useState<RangefinderLock | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);

  // Live sensor feed
  useEffect(() => {
    DeviceMotion.setUpdateInterval(300);
    const sub = DeviceMotion.addListener(data => {
      if (data.rotation) {
        const p = ((data.rotation.beta ?? 0) * 180) / Math.PI;
        const a = ((data.rotation.alpha ?? 0) * 180) / Math.PI;
        setPitch(parseFloat(p.toFixed(1)));
        setHeading(parseFloat((((a % 360) + 360) % 360).toFixed(1)));
      }
    });
    return () => sub.remove();
  }, []);

  const refreshGps = async () => {
    setGpsBusy(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location denied', 'Grant location permission in Settings.');
      setGpsBusy(false);
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 10 });
    } catch {
      Alert.alert('GPS error', 'Could not get position.');
    }
    setGpsBusy(false);
  };

  const mockLock = (tap_y: number, mockPitch: number) => {
    const pos = gps ?? { lat: 34.0522, lng: -118.2437, accuracy: 5 };
    const result = computeDistance({
      user_position: pos,
      compass_heading: heading,
      tap_y_normalized: tap_y,
      device_pitch_degrees: mockPitch,
    });
    const newLock = buildLock(
      { user_position: pos, compass_heading: heading, tap_y_normalized: tap_y, device_pitch_degrees: mockPitch },
      result,
    );
    setLock(newLock);
  };

  const displayDist = lock
    ? (distance_unit === 'meters' ? lock.distance_meters : lock.distance_yards)
    : null;
  const displayUnit = distance_unit === 'meters' ? 'm' : 'yds';

  const getLockConfidence = (l: RangefinderLock) => {
    const r = computeDistance({
      user_position: l.user_position,
      compass_heading: l.compass_heading,
      tap_y_normalized: l.tap_y_normalized,
      device_pitch_degrees: pitchForLock(l),
    });
    return r.confidence;
  };

  const pitchForLock = (l: RangefinderLock) => {
    // reconstruct pitch from distance_yards using reverse trig for display
    const distM = l.distance_yards * 0.9144;
    const pitchRad = Math.atan2(1.6, distM);
    return -(pitchRad * 180) / Math.PI;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SmartFinder Debug</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* ── Live Sensors ── */}
        <Text style={styles.sectionTitle}>Live Sensors</Text>
        <View style={styles.card}>
          <View style={styles.sensorRow}>
            <Text style={styles.sensorLabel}>Heading</Text>
            <Text style={styles.sensorValue}>{heading}°</Text>
          </View>
          <View style={styles.sensorRow}>
            <Text style={styles.sensorLabel}>Pitch</Text>
            <Text style={styles.sensorValue}>{pitch}°</Text>
          </View>
          {gps ? (
            <>
              <View style={styles.sensorRow}>
                <Text style={styles.sensorLabel}>Lat / Lng</Text>
                <Text style={styles.sensorValue}>{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</Text>
              </View>
              <View style={styles.sensorRow}>
                <Text style={styles.sensorLabel}>GPS Accuracy</Text>
                <Text style={styles.sensorValue}>±{gps.accuracy.toFixed(1)} m</Text>
              </View>
            </>
          ) : (
            <Text style={styles.noGps}>GPS not fetched</Text>
          )}
          <TouchableOpacity style={styles.btn} onPress={refreshGps} disabled={gpsBusy}>
            <Text style={styles.btnText}>{gpsBusy ? 'Fetching...' : 'Refresh GPS'}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Mock Locks ── */}
        <Text style={styles.sectionTitle}>Mock Locks</Text>
        <Text style={styles.sectionSub}>Tap to simulate a lock at various distances (bypasses camera)</Text>
        {MOCK_DISTANCES.map(m => (
          <TouchableOpacity key={m.label} style={styles.mockCard} onPress={() => mockLock(m.tap_y, m.pitch)}>
            <Text style={styles.mockLabel}>{m.label}</Text>
            <Text style={styles.mockSub}>tap_y={m.tap_y} pitch={m.pitch}°</Text>
          </TouchableOpacity>
        ))}

        {/* ── Current Lock ── */}
        {lock && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Active Lock</Text>
            <View style={styles.lockCard}>
              <Text style={styles.lockDist}>{displayDist} {displayUnit}</Text>
              <View style={styles.lockRow}>
                <Text style={styles.lockLabel}>Confidence</Text>
                <Text style={[styles.lockValue, {
                  color: getLockConfidence(lock) === 'high' ? '#00C896' :
                         getLockConfidence(lock) === 'medium' ? '#F5A623' : '#ef4444',
                }]}>
                  {getLockConfidence(lock)} (±{confidenceMargin(getLockConfidence(lock))} {displayUnit})
                </Text>
              </View>
              <View style={styles.lockRow}>
                <Text style={styles.lockLabel}>Heading</Text>
                <Text style={styles.lockValue}>{lock.compass_heading.toFixed(1)}°</Text>
              </View>
              <View style={styles.lockRow}>
                <Text style={styles.lockLabel}>Target GPS</Text>
                <Text style={styles.lockValue}>
                  {lock.target_position.lat.toFixed(5)}, {lock.target_position.lng.toFixed(5)}
                </Text>
              </View>
              <View style={styles.lockRow}>
                <Text style={styles.lockLabel}>Tap Y norm.</Text>
                <Text style={styles.lockValue}>{lock.tap_y_normalized.toFixed(3)}</Text>
              </View>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#1a0505', borderColor: '#ef4444' }]} onPress={() => setLock(null)}>
                <Text style={[styles.btnText, { color: '#ef4444' }]}>Clear Lock</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e3a28',
  },
  backBtn: { width: 60 },
  backBtnText: { color: '#00C896', fontSize: 17 },
  headerTitle: { flex: 1, color: '#e8f5e9', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  scroll: { flex: 1 },
  content: { padding: 16 },
  sectionTitle: { color: '#e8f5e9', fontSize: 13, fontWeight: '700', marginBottom: 6, letterSpacing: 0.5 },
  sectionSub: { color: '#4b5563', fontSize: 11, marginBottom: 10, fontStyle: 'italic' },
  card: {
    backgroundColor: '#0a1e12', borderRadius: 10, borderWidth: 1,
    borderColor: '#1e3a28', padding: 14, marginBottom: 14, gap: 8,
  },
  sensorRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  sensorLabel: { color: '#6b7280', fontSize: 12 },
  sensorValue: { color: '#e8f5e9', fontSize: 12, fontWeight: '600' },
  noGps: { color: '#4b5563', fontSize: 12, fontStyle: 'italic' },
  btn: {
    marginTop: 6, backgroundColor: '#003d20', borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#00C896',
  },
  btnText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  mockCard: {
    backgroundColor: '#0a1e12', borderRadius: 8, borderWidth: 1,
    borderColor: '#1e3a28', padding: 12, marginBottom: 8,
  },
  mockLabel: { color: '#e8f5e9', fontSize: 13, fontWeight: '600' },
  mockSub: { color: '#4b5563', fontSize: 11, marginTop: 2 },
  lockCard: {
    backgroundColor: '#0a1e12', borderRadius: 10, borderWidth: 1,
    borderColor: '#00C89644', padding: 14, gap: 8,
  },
  lockDist: { color: '#00C896', fontSize: 40, fontWeight: '900' },
  lockRow: { flexDirection: 'row', justifyContent: 'space-between' },
  lockLabel: { color: '#6b7280', fontSize: 12 },
  lockValue: { color: '#e8f5e9', fontSize: 12, fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 8 },
});
