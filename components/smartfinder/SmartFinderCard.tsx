import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import GPSQuality from './GPSQuality';
import {
  getGreenYardagesSync,
  refreshFix,
  classifyAccuracy,
  getLastFix,
  type GreenYardages,
  type GPSQualityReading,
} from '../../services/smartFinderService';
import { useRoundStore } from '../../store/roundStore';

const REFRESH_MS = 4_000;

/**
 * Phase D-2 — Embedded SmartFinder card on Caddie home.
 *
 * Glanceable rangefinder summary: front/middle/back yardages to the green plus
 * hole number and a GPS-quality dot. Tap-to-expand opens the full-screen
 * SmartFinder route.
 *
 * Layout-protection: this component is rendered absolutely-positioned above the
 * existing data strip. It does NOT modify Kevin's avatar JSX or any other
 * Caddie-home layout element. Mike sees three numbers and a hole label without
 * tapping.
 *
 * Empty state: when course geometry lacks green coordinates (the typical case
 * upstream today), each yardage shows "—" rather than zero. The card stays
 * present so the layout doesn't jump when geometry arrives.
 */
export default function SmartFinderCard() {
  const router = useRouter();
  const currentHole = useRoundStore(s => s.currentHole);
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const [yards, setYards] = useState<GreenYardages>(() => getGreenYardagesSync(currentHole));
  const [gps, setGps] = useState<GPSQualityReading>(() =>
    classifyAccuracy(getLastFix()?.accuracy_m ?? null),
  );

  useEffect(() => {
    if (!isRoundActive) return;
    let cancelled = false;
    const tick = async () => {
      const fix = await refreshFix();
      if (cancelled) return;
      setGps(classifyAccuracy(fix?.accuracy_m ?? null));
      setYards(getGreenYardagesSync(currentHole));
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isRoundActive, currentHole]);

  if (!isRoundActive) return null;

  return (
    <TouchableOpacity
      onPress={() => router.push('/smartfinder' as never)}
      activeOpacity={0.85}
      style={styles.card}
    >
      <View style={styles.header}>
        <Text style={styles.holeLabel}>HOLE {yards.hole_number}</Text>
        <GPSQuality reading={gps} />
      </View>
      <View style={styles.row}>
        <Cell label="FRONT" value={yards.front} />
        <Divider />
        <Cell label="MIDDLE" value={yards.middle} value_emphasis />
        <Divider />
        <Cell label="BACK" value={yards.back} />
      </View>
      <Text style={styles.tapHint}>Tap for SmartFinder →</Text>
    </TouchableOpacity>
  );
}

function Cell({ label, value, value_emphasis }: { label: string; value: number | null; value_emphasis?: boolean }) {
  return (
    <View style={styles.cell}>
      <Text style={[styles.value, value_emphasis && styles.valueEmphasis]}>
        {value != null ? value : '—'}
      </Text>
      <Text style={styles.cellLabel}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(13, 36, 24, 0.92)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  holeLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cell: { flex: 1, alignItems: 'center' },
  value: { color: '#e8f5e9', fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  valueEmphasis: { color: '#ffffff', fontSize: 28 },
  cellLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: 2 },
  divider: { width: 1, height: 28, backgroundColor: '#1e3a28' },
  tapHint: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'right',
    marginTop: 6,
  },
});
