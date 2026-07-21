/**
 * 2026-05-24 — Dev screen: green-center ground truth survey tool.
 *
 * On-foot workflow:
 *   1. Walk to the center of the green.
 *   2. Tap "I'm Here" — captures the current GPS fix as the truth coord.
 *   3. If GPS reads soft (>5m accuracy), wait or take a second fix.
 *   4. Tap "Save Truth" — persists to AsyncStorage via courseTruth.ts.
 *
 * Spec called for a Mapbox satellite map with draggable markers. That
 * needs react-native-maps (native dep, not currently installed in this
 * repo) so the visual map + drag is deferred to the next EAS Build —
 * shipping with the BT media-button worktree. The OTA-safe core here
 * still delivers the high-value workflow: physical presence + GPS
 * snapshot is more accurate than dragging a pin on a map anyway, and
 * gets you walking Menifee Lakes tonight.
 *
 * Route: /dev/CourseTruth?courseId=...&hole=N  (file-based, auto-discovered)
 *   Not wired into any production menu — accessed via deep link or the
 *   /api-debug.tsx style developer routing.
 *
 * No backend. AsyncStorage only. Cloud sync of survey data is a
 * separate roadmap item (alongside the swing-library cloud-backup
 * memory).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getOneShotFix } from '../../services/gpsManager';
import {
  getCourseTruthEntry,
  setCourseTruth,
  clearCourseTruth,
  type LatLng,
} from '../../services/courseTruth';
import { useRoundStore } from '../../store/roundStore';

const GPS_POLL_MS = 1500;

type GpsState = { lat: number; lng: number; accuracy_m: number | null; at: number } | null;

export default function CourseTruthScreen() {
  const params = useLocalSearchParams<{ courseId?: string; hole?: string }>();
  const courseId = String(params.courseId ?? '').trim() || 'unknown';
  const hole = Math.max(1, Math.min(18, parseInt(String(params.hole ?? '1'), 10) || 1));

  const [gps, setGps] = useState<GpsState>(null);
  const [saved, setSaved] = useState<LatLng | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [truth, setTruth] = useState<LatLng | null>(null);

  // Manual lat/lng entry as the drag-substitute until the satellite
  // map ships. Lets a user nudge the truth coord with sub-meter
  // precision via keyboard if needed.
  const [manualLat, setManualLat] = useState<string>('');
  const [manualLng, setManualLng] = useState<string>('');

  // Read the courseHoles entry for this hole (the existing API-sourced
  // coord — combined golfcourseapi/golfbert/internal). Surfaces the
  // current "best guess" alongside the surveyed truth so the
  // surveyor can see how far off the cached data was.
  const courseHoles = useRoundStore((s) => s.courseHoles);
  const apiCoord = (() => {
    const row = courseHoles.find((h) => h.hole === hole);
    if (!row) return null;
    return { lat: row.middleLat, lng: row.middleLng };
  })();

  // Live GPS polling. Each poll is a getOneShotFix call with a
  // freshness window so the OS-cached fix is taken when locked,
  // and a fresh fix is forced when stale.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const fix = await getOneShotFix({ maxAgeMs: 2_000 });
      if (cancelled || !fix) return;
      setGps({
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: typeof fix.accuracy_m === 'number' ? fix.accuracy_m : null,
        at: Date.now(),
      });
    };
    void tick();
    pollRef.current = setInterval(tick, GPS_POLL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Load any prior saved truth for this hole when courseId/hole changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const e = await getCourseTruthEntry(courseId, hole);
      if (cancelled) return;
      if (e) {
        setSaved({ lat: e.lat, lng: e.lng });
        setSavedAt(e.savedAt);
        setTruth({ lat: e.lat, lng: e.lng });
        setManualLat(e.lat.toFixed(7));
        setManualLng(e.lng.toFixed(7));
      } else {
        setSaved(null);
        setSavedAt(null);
        setTruth(null);
        setManualLat('');
        setManualLng('');
      }
    })();
    return () => { cancelled = true; };
  }, [courseId, hole]);

  const snapToGps = useCallback(() => {
    if (!gps) return;
    const next = { lat: gps.lat, lng: gps.lng };
    setTruth(next);
    setManualLat(next.lat.toFixed(7));
    setManualLng(next.lng.toFixed(7));
  }, [gps]);

  const applyManual = useCallback(() => {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    setTruth({ lat, lng });
  }, [manualLat, manualLng]);

  const save = useCallback(async () => {
    if (!truth) return;
    await setCourseTruth(courseId, hole, truth);
    setSaved(truth);
    setSavedAt(Date.now());
  }, [truth, courseId, hole]);

  const clear = useCallback(async () => {
    await clearCourseTruth(courseId, hole);
    setSaved(null);
    setSavedAt(null);
    setTruth(null);
    setManualLat('');
    setManualLng('');
  }, [courseId, hole]);

  // Yardage diff vs courseHoles row, sanity-check for how off the
  // cached API data was. Haversine without importing the util to
  // keep this file dependency-light.
  const yardageDiff = (() => {
    if (!apiCoord || !saved) return null;
    const R = 6371_000; // meters
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(saved.lat - apiCoord.lat);
    const dLng = toRad(saved.lng - apiCoord.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(apiCoord.lat)) * Math.cos(toRad(saved.lat)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const meters = R * c;
    return Math.round(meters * 1.09361); // yards
  })();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Ionicons name="flag" size={22} color="#00C896" />
          <Text style={styles.title}>Course Truth</Text>
          <Text style={styles.subtitle}>
            {courseId} · Hole {hole}
          </Text>
          <Text style={styles.note}>
            Walk to the center of the green, tap I&apos;m Here, then Save.
          </Text>
        </View>

        <Section label="GPS (live)">
          <CoordRow
            color="#F5A623"
            label="You are here"
            lat={gps?.lat ?? null}
            lng={gps?.lng ?? null}
            extra={gps?.accuracy_m != null ? `±${gps.accuracy_m.toFixed(1)}m` : null}
          />
        </Section>

        <Section label="Cached (courseHoles)">
          <CoordRow
            color="#E74C3C"
            label="API middle"
            lat={apiCoord?.lat ?? null}
            lng={apiCoord?.lng ?? null}
            extra={null}
          />
        </Section>

        <Section label="Saved truth">
          <CoordRow
            color="#00C896"
            label="True center"
            lat={saved?.lat ?? null}
            lng={saved?.lng ?? null}
            extra={savedAt ? `${Math.round((Date.now() - savedAt) / 60_000)}m ago` : null}
          />
          {yardageDiff != null && (
            <Text style={styles.diff}>
              Δ vs cached: {yardageDiff} yds
            </Text>
          )}
        </Section>

        <Section label="Working truth (unsaved)">
          <CoordRow
            color="#3498DB"
            label="Pending"
            lat={truth?.lat ?? null}
            lng={truth?.lng ?? null}
            extra={null}
          />
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput}
              placeholder="Lat"
              placeholderTextColor="#6b7280"
              keyboardType="numbers-and-punctuation"
              value={manualLat}
              onChangeText={setManualLat}
            />
            <TextInput
              style={styles.manualInput}
              placeholder="Lng"
              placeholderTextColor="#6b7280"
              keyboardType="numbers-and-punctuation"
              value={manualLng}
              onChangeText={setManualLng}
            />
            <TouchableOpacity style={styles.applyBtn} onPress={applyManual}>
              <Text style={styles.applyBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </Section>

        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F5A623' }]} onPress={snapToGps} disabled={!gps}>
          <Ionicons name="navigate" size={18} color="#0d1a0d" />
          <Text style={styles.actionText}>I&apos;m Here</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#00C896' }]} onPress={save} disabled={!truth}>
          <Ionicons name="save" size={18} color="#0d1a0d" />
          <Text style={styles.actionText}>Save Truth</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1a1a1a', borderColor: '#444', borderWidth: 1 }]} onPress={clear} disabled={!saved}>
          <Ionicons name="trash" size={16} color="#ef4444" />
          <Text style={[styles.actionText, { color: '#ef4444' }]}>Clear Saved</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Map drag pending react-native-maps (ships with next EAS Build).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function CoordRow({
  color, label, lat, lng, extra,
}: { color: string; label: string; lat: number | null; lng: number | null; extra: string | null }) {
  const hasCoord = lat != null && lng != null;
  return (
    <View style={styles.coordRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.coordLabel}>{label}</Text>
        <Text style={styles.coordValue}>
          {hasCoord ? `${lat!.toFixed(7)}, ${lng!.toFixed(7)}` : '—'}
        </Text>
      </View>
      {extra && <Text style={styles.coordExtra}>{extra}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  scroll: { padding: 18, gap: 14 },
  header: { alignItems: 'center', gap: 6, marginBottom: 6 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  note: { color: '#6b7280', fontSize: 12, textAlign: 'center', paddingHorizontal: 14, marginTop: 4 },
  section: {
    backgroundColor: '#0d1a0d',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  sectionLabel: { color: '#6b7280', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  coordRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  coordLabel: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  coordValue: { color: '#9ca3af', fontSize: 12, fontFamily: 'monospace', marginTop: 2 },
  coordExtra: { color: '#F5A623', fontSize: 11, fontWeight: '800' },
  diff: { color: '#F5A623', fontSize: 12, fontWeight: '700', marginTop: 4 },
  manualRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  manualInput: {
    flex: 1,
    backgroundColor: '#020503',
    color: '#ffffff',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  applyBtn: {
    backgroundColor: '#3498DB',
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 8,
  },
  applyBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 6,
  },
  actionText: { color: '#0d1a0d', fontSize: 14, fontWeight: '900' },
  footnote: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 14 },
});
