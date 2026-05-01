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
  none: '#6b7280',
};

const LABELS: Record<GPSQualityReading['level'], string> = {
  strong: 'GPS strong',
  moderate: 'GPS okay',
  weak: 'GPS weak',
  none: 'No GPS',
};

/**
 * Phase D-2 — GPS quality indicator.
 *
 * Embedded card mode: dot only.
 * Full-screen mode (showText): dot + level + accuracy in feet.
 *
 * Color thresholds: <5m = strong (green), 5–15m = moderate (yellow), >15m =
 * weak (red), missing = neutral gray.
 */
export default function GPSQuality({ reading, showText = false }: Props) {
  const color = COLORS[reading.level];
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {showText && (
        <Text style={[styles.text, { color }]}>
          {LABELS[reading.level]}
          {reading.accuracy_ft != null ? ` · ±${reading.accuracy_ft} ft` : ''}
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
