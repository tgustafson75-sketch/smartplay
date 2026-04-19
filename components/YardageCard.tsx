/**
 * components/YardageCard.tsx
 *
 * Front / middle / back yardage display with plays-like adjusted yardage.
 * Extends the existing YardageDisplay pattern to show wind/lie adjustments.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface YardageCardProps {
  front?: number | null;
  middle?: number | null;
  back?: number | null;
  /** Plays-like adjusted yardage (wind + elevation + lie) */
  playsLike?: number | null;
  /** Show a staleness indicator when GPS is weak */
  weak?: boolean;
}

export default function YardageCard({
  front,
  middle,
  back,
  playsLike,
  weak = false,
}: YardageCardProps) {
  const midColor = weak ? '#fcd34d' : '#A7F3D0';
  const dimColor = weak ? '#f59e0b' : '#9ca3af';

  const fmt = (v: number | null | undefined) => (v != null ? String(Math.round(v)) : '--');

  const hasAdjustment = playsLike != null && middle != null && Math.round(playsLike) !== Math.round(middle);

  return (
    <View style={styles.container}>
      {/* F / M / B row */}
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={[styles.label, { color: dimColor }]}>F</Text>
          <Text style={[styles.dim, { color: dimColor }]}>{fmt(front)}</Text>
        </View>

        <View style={styles.col}>
          <Text style={[styles.label, { color: midColor }]}>M</Text>
          <Text style={[styles.hero, { color: midColor }]}>{fmt(middle)}</Text>
        </View>

        <View style={styles.col}>
          <Text style={[styles.label, { color: dimColor }]}>B</Text>
          <Text style={[styles.dim, { color: dimColor }]}>{fmt(back)}</Text>
        </View>
      </View>

      {/* Plays-like row (only shown if adjusted) */}
      {hasAdjustment && (
        <View style={styles.playsLikeRow}>
          <Text style={styles.playsLikeLabel}>Plays like </Text>
          <Text style={styles.playsLikeValue}>{fmt(playsLike)}</Text>
          <Text style={styles.playsLikeLabel}> yds</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 24,
    alignItems: 'flex-end',
  },
  col: {
    alignItems: 'center',
    gap: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hero: {
    fontSize: 42,
    fontWeight: '900',
    lineHeight: 46,
  },
  dim: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  playsLikeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  playsLikeLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  playsLikeValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f59e0b',
  },
});
