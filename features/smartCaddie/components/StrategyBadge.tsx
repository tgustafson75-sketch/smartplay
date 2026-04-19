/**
 * features/smartCaddie/components/StrategyBadge.tsx
 *
 * Small pill badge that shows the current caddie strategy label
 * and a risk-colour indicator.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { PlayStrategy } from '../utils/decisionRules';

interface Props {
  strategy: PlayStrategy;
  label: string;
  riskLevel: number;      // 1–5
  hazardWarning?: boolean;
}

const STRATEGY_COLORS: Record<PlayStrategy, { bg: string; text: string; border: string }> = {
  safe:       { bg: '#1a3a2a', text: '#4ade80', border: '#4ade80' },
  normal:     { bg: '#1a2a3a', text: '#60a5fa', border: '#60a5fa' },
  aggressive: { bg: '#3a1a1a', text: '#f87171', border: '#f87171' },
};

const STRATEGY_ICONS: Record<PlayStrategy, string> = {
  safe:       '🛡',
  normal:     '🎯',
  aggressive: '⚡',
};

export function StrategyBadge({ strategy, label, riskLevel, hazardWarning }: Props) {
  const colors = STRATEGY_COLORS[strategy];

  return (
    <View style={[styles.pill, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={styles.icon}>{STRATEGY_ICONS[strategy]}</Text>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      {hazardWarning && (
        <Text style={styles.warning}>⚠</Text>
      )}
      <View style={styles.riskDots}>
        {Array.from({ length: 5 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i < riskLevel ? colors.border : '#333' },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection:  'row',
    alignItems:     'center',
    alignSelf:      'flex-start',
    paddingHorizontal: 10,
    paddingVertical:    5,
    borderRadius:   20,
    borderWidth:    1,
    gap:            6,
  },
  icon: {
    fontSize: 13,
  },
  label: {
    fontSize:   13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  warning: {
    fontSize: 13,
  },
  riskDots: {
    flexDirection: 'row',
    gap: 3,
    marginLeft: 2,
  },
  dot: {
    width:        5,
    height:       5,
    borderRadius: 3,
  },
});
