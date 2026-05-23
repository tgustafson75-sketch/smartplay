/**
 * 2026-05-22 — Junior swing side-by-side compare.
 *
 * Renders TWO JuniorSwingAnalysis records next to each other so the
 * golfer + coach + parent can see what's changed visually. Built for:
 *   - Latest vs N-back ("show me her swing from last week vs today")
 *   - Captain → teammate progress reviews ("compare these two reps")
 *
 * Defensive — when only one analysis is provided, renders that side
 * full-width with a "no comparison yet" hint on the other.
 *
 * Visual contract: each side uses the JuniorSwingResultCard in
 * `compact: false` mode + the diff between the two scores rendered
 * as a delta chip in a header strip. Tap either card to open detail
 * (caller passes onPressLeft / onPressRight).
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import JuniorSwingResultCard from './JuniorSwingResultCard';
import type { JuniorSwingAnalysis } from '../services/juniorSwingAnalyzer';

export interface JuniorSwingCompareProps {
  left: JuniorSwingAnalysis | null;
  right: JuniorSwingAnalysis | null;
  leftLabel?: string;
  rightLabel?: string;
  onPressLeft?: () => void;
  onPressRight?: () => void;
}

export default function JuniorSwingCompare({
  left, right,
  leftLabel = 'Earlier',
  rightLabel = 'Latest',
  onPressLeft, onPressRight,
}: JuniorSwingCompareProps) {
  const { colors } = useTheme();

  const delta = useMemo(() => {
    if (!left || !right) return null;
    const d = right.overallScore - left.overallScore;
    return {
      value: d,
      direction: Math.abs(d) < 3 ? 'same' as const : d > 0 ? 'up' as const : 'down' as const,
    };
  }, [left, right]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.summaryBar, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
        <Text style={[styles.summaryLabel, { color: colors.text_muted }]}>
          {leftLabel}
          <Text style={[styles.summaryArrow, { color: colors.text_primary }]}>{'  ⇄  '}</Text>
          {rightLabel}
        </Text>
        {delta && (
          <View
            style={[
              styles.deltaChip,
              {
                borderColor:
                  delta.direction === 'up' ? '#86efac' :
                  delta.direction === 'down' ? '#fbbf24' : '#cbd5e1',
                backgroundColor:
                  delta.direction === 'up' ? 'rgba(34,197,94,0.10)' :
                  delta.direction === 'down' ? 'rgba(251,191,36,0.10)' :
                  'rgba(148,163,184,0.10)',
              },
            ]}
          >
            <Text
              style={[
                styles.deltaText,
                {
                  color:
                    delta.direction === 'up' ? '#86efac' :
                    delta.direction === 'down' ? '#fbbf24' : '#cbd5e1',
                },
              ]}
            >
              {delta.direction === 'up' ? '↑ ' : delta.direction === 'down' ? '↓ ' : '→ '}
              {delta.value > 0 ? `+${delta.value}` : delta.value}
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.pane}>
          <Text style={[styles.paneLabel, { color: colors.text_muted }]}>{leftLabel.toUpperCase()}</Text>
          {left ? (
            <JuniorSwingResultCard analysis={left} onPress={onPressLeft} />
          ) : (
            <EmptyPane colors={colors} message="No earlier swing recorded yet." />
          )}
        </View>
        <View style={styles.pane}>
          <Text style={[styles.paneLabel, { color: colors.text_muted }]}>{rightLabel.toUpperCase()}</Text>
          {right ? (
            <JuniorSwingResultCard analysis={right} onPress={onPressRight} />
          ) : (
            <EmptyPane colors={colors} message="Record one to compare." />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function EmptyPane({
  colors, message,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  message: string;
}) {
  return (
    <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.emptyText, { color: colors.text_muted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  summaryArrow: { fontWeight: '900' },
  deltaChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  deltaText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },

  scroll: { gap: 12, paddingRight: 8 },
  pane: { width: 320, gap: 6 },
  paneLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },

  empty: {
    borderWidth: 1, borderRadius: 14, padding: 24, alignItems: 'center', justifyContent: 'center', minHeight: 140,
  },
  emptyText: { fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
});
