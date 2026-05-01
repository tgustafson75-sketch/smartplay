import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Props = {
  holes: number | null;
  par: number | null;
  yards: number | null;
  rating: number | null;
  slope: number | null;
};

function val(n: number | null): string {
  if (n == null) return '—';
  return String(n);
}

/**
 * Five-stat strip in a single row: HOLES | PAR | YARDS | RATING | SLOPE.
 * Equal weight cells, monospace-feeling numerals on top, all-caps muted labels
 * below. Matches the legacy reference aesthetic — "—" for missing values
 * rather than zeros or blanks.
 */
export default function CourseStats({ holes, par, yards, rating, slope }: Props) {
  return (
    <View style={styles.row}>
      <Cell value={val(holes)} label="HOLES" />
      <Divider />
      <Cell value={val(par)} label="PAR" />
      <Divider />
      <Cell value={val(yards)} label="YARDS" />
      <Divider />
      <Cell value={rating != null ? rating.toFixed(1) : '—'} label="RATING" />
      <Divider />
      <Cell value={val(slope)} label="SLOPE" />
    </View>
  );
}

function Cell({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  cell: { flex: 1, alignItems: 'center' },
  value: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  label: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 4,
  },
  divider: { width: 1, height: 28, backgroundColor: '#1e3a28' },
});
