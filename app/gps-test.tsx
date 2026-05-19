/**
 * GPS Test Bench — owner-only diagnostic surface.
 *
 * The shipped GPS pipeline (gpsManager → smartFinderService → cockpit
 * data strip) has multiple layers of subscriptions, smoothing, outlier
 * rejection, and fallback. When yardages "feel wrong" on-course it's
 * impossible to tell from the cockpit alone whether GPS itself is bad,
 * the course geometry is missing, or something in the consumer chain
 * is stale.
 *
 * This screen short-circuits all of that. It shows:
 *   - Raw current fix (lat / lng / accuracy / speed / age)
 *   - A user-settable anchor coordinate
 *   - Live distance + bearing from current fix to anchor
 *
 * Workflow: open the screen, tap "Set anchor here". Walk away. The
 * distance should tick up in yards as you move. Walk back; it ticks
 * down. If the number doesn't change as you walk, GPS itself is the
 * problem (not course geometry, not the consumer chain).
 *
 * Reachable from Settings → Owner Tools → GPS Test Bench.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import {
  getLastFix as getGpsLastFix,
  getOneShotFix,
  subscribe as subscribeGps,
  type GpsFix,
} from '../services/gpsManager';
import { haversineYards } from '../utils/geoDistance';
import { startSyntheticRound, stopSimulatedWalk, isSimulatedActive, type MockRound } from '../services/simulatedGPS';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MOCK_ROUND: MockRound = require('../__mocks__/mockRound.json');

interface Anchor {
  lat: number;
  lng: number;
  setAt: number;
}

function formatAge(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const λ1 = toRad(from.lng);
  const λ2 = toRad(to.lng);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function compassLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx] ?? 'N';
}

export default function GpsTestScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [fix, setFix] = useState<GpsFix | null>(getGpsLastFix());
  const [tick, setTick] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [pulling, setPulling] = useState(false);

  // Subscribe to every accepted GPS fix from gpsManager. This is the
  // same subscription consumers like smartFinderService use, so what we
  // display here is exactly what the rest of the app receives.
  useEffect(() => {
    const unsub = subscribeGps((f) => {
      setFix(f);
      if (anchor) {
        const d = haversineYards(
          { lat: f.lat, lng: f.lng },
          { lat: anchor.lat, lng: anchor.lng },
        );
        setHistory((prev) => {
          const next = [...prev, Math.round(d)];
          return next.slice(-60);
        });
      }
    });
    return () => { unsub(); };
  }, [anchor]);

  // Tick every 1s so the "fix age" readout stays live even when no new
  // fix has arrived (helps detect a silently-dead watch).
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const onRefresh = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    try {
      const fresh = await getOneShotFix({ maxAgeMs: 0 });
      if (fresh) setFix(fresh);
      else Alert.alert('GPS unavailable', 'Could not pull a fresh fix. Step into open sky and try again.');
    } finally {
      setPulling(false);
    }
  }, [pulling]);

  const onSetAnchor = useCallback(() => {
    if (!fix) {
      Alert.alert('No fix', 'Wait for a GPS fix first, then set the anchor.');
      return;
    }
    setAnchor({ lat: fix.lat, lng: fix.lng, setAt: Date.now() });
    setHistory([0]);
  }, [fix]);

  const onClearAnchor = useCallback(() => {
    setAnchor(null);
    setHistory([]);
  }, []);

  const now = Date.now();
  const ageMs = fix ? now - fix.timestamp : null;
  const distYards = fix && anchor
    ? Math.round(haversineYards({ lat: fix.lat, lng: fix.lng }, { lat: anchor.lat, lng: anchor.lng }))
    : null;
  const brg = fix && anchor
    ? bearingDeg({ lat: fix.lat, lng: fix.lng }, { lat: anchor.lat, lng: anchor.lng })
    : null;
  const min = history.length > 0 ? Math.min(...history) : null;
  const max = history.length > 0 ? Math.max(...history) : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>GPS Test Bench</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.hint, { color: colors.text_muted }]}>
          Set the anchor at a known spot, then walk. Distance should tick up as you move away and down as you come back. If it never moves, GPS itself is the problem — not course geometry, not the consumer chain.
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>CURRENT FIX</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {fix == null ? (
            <Text style={[styles.empty, { color: colors.text_muted }]}>No fix yet. Tap Refresh.</Text>
          ) : (
            <>
              <Row label="Lat" value={fix.lat.toFixed(6)} colors={colors} />
              <Row label="Lng" value={fix.lng.toFixed(6)} colors={colors} />
              <Row
                label="Accuracy"
                value={fix.accuracy_m != null ? `±${fix.accuracy_m.toFixed(1)}m` : 'unknown'}
                colors={colors}
              />
              <Row
                label="Speed"
                value={fix.speed != null && fix.speed >= 0
                  ? `${(fix.speed * 2.237).toFixed(1)} mph`
                  : '—'}
                colors={colors}
              />
              <Row
                label="Age"
                value={ageMs != null ? formatAge(ageMs) : '—'}
                emphasis={ageMs != null && ageMs > 15_000 ? 'warn' : 'normal'}
                colors={colors}
              />
            </>
          )}
        </View>

        <TouchableOpacity
          onPress={onRefresh}
          disabled={pulling}
          style={[styles.btnPrimary, { backgroundColor: colors.accent, opacity: pulling ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Refresh GPS fix"
        >
          <Ionicons name="refresh" size={18} color="#000" style={{ marginRight: 6 }} />
          <Text style={styles.btnPrimaryText}>{pulling ? 'Pulling…' : 'Refresh GPS'}</Text>
        </TouchableOpacity>

        {/* 2026-05-17 — Synthetic round playback. Loads
            __mocks__/mockRound.json and feeds it through the existing
            simulatedGPS pipeline. Drives the same gpsManager →
            smartFinderService → holeDetection chain as real GPS so
            this validates the WHOLE pipeline, not just the math.
            Owner-only via this screen's existing gate. */}
        <TouchableOpacity
          onPress={() => {
            if (isSimulatedActive()) {
              stopSimulatedWalk();
              Alert.alert('Stopped', 'Synthetic round playback stopped.');
            } else {
              const id = startSyntheticRound(MOCK_ROUND);
              Alert.alert('Started', `Playing ${MOCK_ROUND.totalHoles}-hole synthetic round (${id}).\nWatch the live fix + DataStrip update.`);
            }
          }}
          style={[styles.btnPrimary, { backgroundColor: '#F5A623', marginTop: 12 }]}
          accessibilityRole="button"
          accessibilityLabel="Toggle synthetic round playback"
        >
          <Ionicons name="play-circle-outline" size={18} color="#000" style={{ marginRight: 6 }} />
          <Text style={styles.btnPrimaryText}>
            {isSimulatedActive() ? 'Stop Synthetic Round' : `Play ${MOCK_ROUND.totalHoles}-Hole Synthetic Round`}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 24 }]}>ANCHOR</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {anchor == null ? (
            <Text style={[styles.empty, { color: colors.text_muted }]}>No anchor set.</Text>
          ) : (
            <>
              <Row label="Anchor Lat" value={anchor.lat.toFixed(6)} colors={colors} />
              <Row label="Anchor Lng" value={anchor.lng.toFixed(6)} colors={colors} />
              <Row label="Set" value={formatAge(now - anchor.setAt) + ' ago'} colors={colors} />
            </>
          )}
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            onPress={onSetAnchor}
            style={[styles.btnSecondary, { borderColor: colors.accent, flex: 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Set anchor at current GPS position"
          >
            <Ionicons name="locate" size={16} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={[styles.btnSecondaryText, { color: colors.accent }]}>
              {anchor == null ? 'Set anchor here' : 'Reset to here'}
            </Text>
          </TouchableOpacity>
          {anchor != null && (
            <TouchableOpacity
              onPress={onClearAnchor}
              style={[styles.btnSecondary, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Clear anchor"
            >
              <Text style={[styles.btnSecondaryText, { color: colors.text_muted }]}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {anchor != null && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 24 }]}>DISTANCE TO ANCHOR</Text>
            <View style={[styles.card, styles.bigCard, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
              <Text style={[styles.bigYards, { color: colors.accent }]}>
                {distYards != null ? distYards : '—'}
                <Text style={[styles.bigYardsUnit, { color: colors.text_muted }]}> yds</Text>
              </Text>
              {brg != null && (
                <Text style={[styles.bearing, { color: colors.text_muted }]}>
                  Bearing {Math.round(brg)}° {compassLabel(brg)}
                </Text>
              )}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 16 }]}>
              SAMPLES ({history.length})
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Row label="Last 60 samples min" value={min != null ? `${min} yds` : '—'} colors={colors} />
              <Row label="Last 60 samples max" value={max != null ? `${max} yds` : '—'} colors={colors} />
              <Row
                label="Range"
                value={min != null && max != null ? `${max - min} yds` : '—'}
                emphasis={min != null && max != null && (max - min) >= 10 ? 'good' : 'normal'}
                colors={colors}
              />
              <Text style={[styles.bodyHint, { color: colors.text_muted }]}>
                If range stays under ~5 yards while you walk a long distance, fixes are NOT arriving. If range tracks your actual walking distance roughly, GPS is alive.
              </Text>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  emphasis = 'normal',
  colors,
}: {
  label: string;
  value: string;
  emphasis?: 'normal' | 'warn' | 'good';
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const valueColor =
    emphasis === 'warn' ? '#ef4444' :
    emphasis === 'good' ? colors.accent :
    colors.text_primary;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.text_muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  body: { padding: 16 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  bodyHint: { fontSize: 11, lineHeight: 16, marginTop: 8, fontStyle: 'italic' },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 8 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  bigCard: { alignItems: 'center', paddingVertical: 22 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { fontSize: 13, fontWeight: '600' },
  rowValue: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  empty: { fontSize: 13, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    marginTop: 12,
  },
  btnPrimaryText: { color: '#000', fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnSecondaryText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  bigYards: { fontSize: 56, fontWeight: '900', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  bigYardsUnit: { fontSize: 18, fontWeight: '700' },
  bearing: { fontSize: 13, fontWeight: '600', marginTop: 6 },
});
