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

  // Pre-beta — pre-round, render the same scope card with the hole 1
  // label + dashes so the layout never disappears between Caddie home
  // entry and round start. GPS dot reads 'none' (orange-ish) which
  // matches the legacy 'GPS off' state honestly.

  return (
    <TouchableOpacity
      onPress={() => router.push('/smartfinder' as never)}
      activeOpacity={0.85}
      style={styles.card}
    >
      {/* Rangefinder-scope styling — yellow corner ticks + glowing border. */}
      <View pointerEvents="none" style={[styles.tick, styles.tickTL]} />
      <View pointerEvents="none" style={[styles.tick, styles.tickTR]} />
      <View pointerEvents="none" style={[styles.tick, styles.tickBL]} />
      <View pointerEvents="none" style={[styles.tick, styles.tickBR]} />

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
      {/* Sim-report gap 1 — when GPS is solid but the course's green
          coords aren't loaded, dashes alone leave the player guessing.
          Honest hint explains WHY and offers the tap-to-target alternative. */}
      {isRoundActive && yards.middle == null && gps.level !== 'none' ? (
        <Text style={styles.emptyHint}>
          Course doesn&apos;t have green coords — tap to drop a target instead.
        </Text>
      ) : (
        <Text style={styles.tapHint}>Tap for SmartFinder →</Text>
      )}
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
    borderWidth: 1.5,
    borderColor: '#F5A623',
    paddingHorizontal: 14,
    paddingVertical: 10,
    // Glow — render as shadow on iOS, elevation tint on Android. The yellow
    // shadow on a dark Caddie-home background reads as a subtle scope glow.
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 10,
    elevation: 8,
  },
  tick: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderColor: '#F5A623',
  },
  tickTL: { top: 4, left: 4, borderTopWidth: 2, borderLeftWidth: 2 },
  tickTR: { top: 4, right: 4, borderTopWidth: 2, borderRightWidth: 2 },
  tickBL: { bottom: 4, left: 4, borderBottomWidth: 2, borderLeftWidth: 2 },
  tickBR: { bottom: 4, right: 4, borderBottomWidth: 2, borderRightWidth: 2 },
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
  emptyHint: {
    color: '#9ca3af',
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
});
