import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { GPSQualityReading } from '../../services/smartFinderService';

type Props = {
  reading: GPSQualityReading;
  showText?: boolean;
};

const COLORS: Record<GPSQualityReading['level'], string> = {
  strong: '#00C896',
  moderate: '#F5A623',
  weak: '#ef4444',
  // 2026-05-27 — Fix ET: stale fix renders amber + pulsing-ish style
  // so the user reads it as "wait, recalibrating" not "broken."
  stale:    '#F5A623',
  none: '#6b7280',
};

// 2026-05-27 — Fix ET: patience-keeping copy. Old labels (esp. 'No GPS')
// read as broken. New copy frames it honestly — GPS is working ON
// getting your position; the user should hold for a beat. Specific
// per state so the message matches reality:
//   strong   → confident, brief
//   moderate → working, slight hedge
//   weak     → real signal but soft — "moving makes this harder"
//   stale    → "fix is old, give it a sec to update"
//   none     → "getting your position…" (NOT "no GPS" — that reads
//              like the app failed instead of "the app is patiently
//              trying")
const LABELS: Record<GPSQualityReading['level'], string> = {
  strong: 'GPS locked',
  moderate: 'GPS settling',
  weak: 'GPS soft · hold still',
  stale: 'GPS stale · refreshing',
  none: 'Finding you…',
};

/**
 * Phase D-2 — GPS quality indicator.
 *
 * Embedded card mode: dot only.
 * Full-screen mode (showText): dot + level + accuracy in feet.
 *
 * Color thresholds: <5m = strong (green), 5–15m = moderate (yellow), >15m =
 * weak (red), stale fix = amber, missing = neutral gray.
 *
 * 2026-05-27 — Fix ET: copy is patience-keeping. "No GPS" sounds
 * broken; "Finding you…" sounds like the app is working. Same applies
 * to other levels.
 */
export default function GPSQuality({ reading, showText = false }: Props) {
  const color = COLORS[reading.level];
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {showText && (
        <Text style={[styles.text, { color }]}>
          {LABELS[reading.level]}
          {reading.accuracy_ft != null && (reading.level === 'strong' || reading.level === 'moderate')
            ? ` · ±${reading.accuracy_ft} ft`
            : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
});
