/**
 * Cockpit Mode — StepperPair
 *
 * Three cards in a row: HOLE / SHOTS / PUTTS, each with −/value/+
 * steppers. Wires directly to Pro's `useRoundStore` so values stay
 * in sync with the scorecard tab.
 *
 * Non-developer note: pressing + or − writes to the same round store
 * the scorecard reads. So whether the user updates a score here on the
 * cockpit screen or on the scorecard tab, both stay consistent.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';

export interface StepperPairProps {
  holeNumber: number;
  par: number;
  shots: number | undefined;
  putts: number | undefined;
  totalHoles?: number;
  onChangeHole: (next: number) => void;
  onChangeShots: (next: number) => void;
  onChangePutts: (next: number) => void;
}

export function StepperPair({
  holeNumber,
  par,
  shots,
  putts,
  totalHoles = 18,
  onChangeHole,
  onChangeShots,
  onChangePutts,
}: StepperPairProps) {
  const { colors } = useTheme();

  // Score-to-par label below the SHOTS cell. Birdie/Par/Bogey/etc.
  // colored to match the meaning.
  const diff = typeof shots === 'number' ? shots - par : null;
  const diffLabel =
    diff == null   ? 'Par'
    : diff < -1    ? 'Eagle'
    : diff === -1  ? 'Birdie'
    : diff === 0   ? 'Par'
    : diff === 1   ? 'Bogey'
    : diff === 2   ? 'Double'
    : `+${diff}`;
  const diffColor =
    diff == null  ? colors.text_muted
    : diff < 0    ? colors.accent
    : diff === 0  ? colors.text_primary
    : colors.error;

  const puttsLabel =
    typeof putts === 'number'
      ? `${putts}-putt${putts === 1 ? '' : 's'}`
      : '—';

  return (
    <View style={styles.row}>
      <Cell
        label="HOLE"
        value={String(holeNumber)}
        sub={`Par ${par}`}
        colors={colors}
        onMinus={() => onChangeHole(Math.max(1, holeNumber - 1))}
        onPlus={() => onChangeHole(Math.min(totalHoles, holeNumber + 1))}
      />
      <Cell
        label="SHOTS"
        value={typeof shots === 'number' ? String(shots) : '—'}
        sub={diffLabel}
        subColor={diffColor}
        colors={colors}
        onMinus={() => onChangeShots(Math.max(0, (shots ?? 0) - 1))}
        onPlus={() => onChangeShots((shots ?? 0) + 1)}
      />
      <Cell
        label="PUTTS"
        value={typeof putts === 'number' ? String(putts) : '—'}
        sub={puttsLabel}
        colors={colors}
        onMinus={() => onChangePutts(Math.max(0, (putts ?? 0) - 1))}
        onPlus={() => onChangePutts((putts ?? 0) + 1)}
      />
    </View>
  );
}

interface CellProps {
  label: string;
  value: string;
  sub: string;
  subColor?: string;
  colors: ReturnType<typeof useTheme>['colors'];
  onMinus: () => void;
  onPlus: () => void;
}

function Cell({ label, value, sub, subColor, colors, onMinus, onPlus }: CellProps) {
  return (
    <View style={[styles.cell, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      <Text style={[styles.cellLabel, { color: colors.text_muted }]} numberOfLines={1}>{label}</Text>
      <View style={styles.cellRow}>
        <Pressable
          onPress={onMinus}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          style={[styles.btn, { backgroundColor: colors.accent_muted }]}
        >
          <Ionicons name="remove" size={18} color={colors.accent} />
        </Pressable>
        <Text
          style={[styles.cellValue, { color: colors.text_primary }]}
          adjustsFontSizeToFit
          numberOfLines={1}
          minimumFontScale={0.7}
        >
          {value}
        </Text>
        <Pressable
          onPress={onPlus}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
          style={[styles.btn, { backgroundColor: colors.accent_muted }]}
        >
          <Ionicons name="add" size={18} color={colors.accent} />
        </Pressable>
      </View>
      <Text style={[styles.cellSub, { color: subColor ?? colors.text_muted }]} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  cell: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 4,
  },
  cellLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  cellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cellValue: {
    fontSize: 28,
    fontWeight: '800',
    minWidth: 32,
    textAlign: 'center',
  },
  btn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSub: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default StepperPair;
