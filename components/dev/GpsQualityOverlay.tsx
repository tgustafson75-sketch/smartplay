/**
 * Phase 107 — GPS quality debug overlay.
 *
 * Mounts at the app root (alongside BatteryPrompt and CaddieSuggestionCard)
 * and renders a small badge in the top-left corner during a round, showing:
 *   - Current accuracy in meters
 *   - GPS mode (active / walking / stationary)
 *   - Color-coded: green <5m, yellow 5-10m, red >10m
 *   - Outlier discard counter (running total this session)
 *
 * Visible only when:
 *   - A round is active (so it's not noise on Caddie home pre-round)
 *   - The user has the dev overlay enabled (settings flag, default false
 *     so non-Tim users never see it)
 *
 * No persistence; pure runtime read of getGpsStats().
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getGpsStats } from '../../services/gpsManager';

export default function GpsQualityOverlay() {
  const insets = useSafeAreaInsets();
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const showDevOverlay = useSettingsStore(s => s.gpsQualityDebugOverlay ?? false);
  const [tick, setTick] = useState(0);

  // Repaint every second while visible.
  useEffect(() => {
    if (!isRoundActive || !showDevOverlay) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRoundActive, showDevOverlay]);

  if (!isRoundActive || !showDevOverlay) return null;

  const stats = getGpsStats();
  const acc = stats.lastFix?.accuracy_m ?? null;
  const color =
    acc == null ? '#6b7280' :
    acc < 5     ? '#10b981' :
    acc < 10    ? '#f59e0b' :
                  '#ef4444';
  const accStr = acc == null ? '— m' : `${acc.toFixed(1)} m`;
  const ageMs = stats.lastFix ? (Date.now() - stats.lastFix.timestamp) : null;
  const ageStr = ageMs == null ? '—' : `${Math.round(ageMs / 1000)}s`;

  // tick referenced so React keeps re-rendering on the interval.
  void tick;

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.text}>
        {accStr}  ·  {stats.mode}  ·  {ageStr}  ·  out:{stats.outliersDiscarded}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 999,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  text: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
});
