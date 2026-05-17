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
import { useOffCourseStore } from '../../services/offCourseDetector';
import { useMovementModeStore } from '../../services/movementModeDetector';

export default function GpsQualityOverlay() {
  const insets = useSafeAreaInsets();
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const showDevOverlay = useSettingsStore(s => s.gpsQualityDebugOverlay ?? false);
  // Phase 405 wave 3 — extended diagnostics. The overlay now also
  // surfaces off-course state, movement mode, selected tee, and the
  // current hole so Tim can verify the whole Phase 405 ecosystem is
  // wired correctly during his Z Fold empirical pass. All reads are
  // O(1) lookups against in-memory Zustand state; no GPS-side cost.
  // 2026-05-16 BUGFIX — these were one combined selector returning a new
  // object literal each render. Zustand's internal useSyncExternalStore
  // saw the always-changing reference as a state change and rescheduled,
  // looping until React threw "Maximum update depth exceeded". That bug
  // was the actual cause of "post-permissions white screen" reports —
  // GpsQualityOverlay mounts globally at the app root, so the loop fires
  // before any tab renders. Split into primitive selectors so each
  // reads a stable value.
  const isOff = useOffCourseStore(s => s.isOffCourse);
  const yardsToNearestHole = useOffCourseStore(s => s.yardsToNearestHole);
  const movementMode = useMovementModeStore(s => s.mode);
  const movementSpeed = useMovementModeStore(s => s.avg_speed_mps);
  const selectedTee = useRoundStore(s => s.selectedTee);
  const currentHole = useRoundStore(s => s.currentHole);
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

  // Phase 405 wave 3 — second line of diagnostic state. Renders below
  // the GPS row so Tim sees the entire Phase 405 ecosystem at a glance.
  const moveStr =
    movementMode === 'unknown' ? '—' :
    movementMode === 'cart' ? `cart (${movementSpeed.toFixed(1)} m/s)` :
    movementMode === 'walking' ? `walk (${movementSpeed.toFixed(1)} m/s)` :
    'still';
  const offStr = isOff
    ? `OFF ${yardsToNearestHole ?? '?'}y`
    : yardsToNearestHole != null ? `~${yardsToNearestHole}y` : 'on';
  const teeStr = selectedTee === 'unspecified' ? '—' : selectedTee;

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View>
        <Text style={styles.text}>
          {accStr}  ·  {stats.mode}  ·  {ageStr}  ·  out:{stats.outliersDiscarded}
        </Text>
        <Text style={styles.textSub}>
          H{currentHole}  ·  {moveStr}  ·  {offStr}  ·  tee:{teeStr}
        </Text>
      </View>
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
  // Phase 405 wave 3 — second diagnostic row.
  textSub: {
    color: '#9ca3af',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },
});
