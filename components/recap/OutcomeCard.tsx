/**
 * 2026-06-04 — Per-hole outcome card. Replaces PlannedVsOutcomeCard
 * after HolePlan removal. Renders just the actual shots, sequence-
 * tagged tee/approach/pin, with a verdict color based on
 * shot.direction/feel.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { HoleComparison, MatchedShot } from '../../types/plan';

interface Props {
  comparison: HoleComparison;
}

const MARKER_LABEL: Record<MatchedShot['plan_marker'], string> = {
  tee: 'Tee',
  approach: 'Approach',
  pin: 'To pin',
};

const RESULT_LABEL: Record<MatchedShot['result'], string> = {
  on_target: 'on target',
  missed_left: 'left',
  missed_right: 'right',
  long: 'long',
  short: 'short',
  unclassified: 'tracked',
};

function resultColor(r: MatchedShot['result']): string {
  if (r === 'on_target') return '#00C896';
  if (r === 'unclassified') return '#94a3b8';
  return '#f59e0b';
}

export default function OutcomeCard({ comparison }: Props) {
  if (comparison.matched_shots.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>OUTCOME</Text>
      <View style={styles.rows}>
        {comparison.matched_shots.map((m, i) => {
          const shot = m.actual_shot;
          const actualClub = shot.club ?? '—';
          const dir = shot.direction ?? null;
          const outcome = shot.outcome ?? null;

          return (
            <View key={i} style={styles.row}>
              <View style={styles.markerCol}>
                <Text style={styles.markerLabel}>{MARKER_LABEL[m.plan_marker]}</Text>
                <Text style={styles.shotIdx}>Shot {i + 1}</Text>
              </View>
              <View style={styles.col}>
                <Text style={styles.colHead}>ACTUAL</Text>
                <Text style={styles.colValue}>
                  {actualClub}
                  {dir ? ' · ' + dir : ''}
                </Text>
                {outcome && outcome !== 'clean' ? (
                  <Text style={styles.outcomeText}>{outcome}</Text>
                ) : null}
              </View>
              <View style={styles.verdictCol}>
                <Text style={[styles.verdict, { color: resultColor(m.result) }]}>
                  {RESULT_LABEL[m.result]}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0d2418',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    marginTop: 12,
    marginHorizontal: 12,
  },
  title: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 10 },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e3a28',
    gap: 8,
  },
  markerCol: { width: 70 },
  markerLabel: { color: '#f8fafc', fontSize: 13, fontWeight: '700' },
  shotIdx: { color: '#64748b', fontSize: 11, marginTop: 2 },
  col: { flex: 1 },
  colHead: { color: '#64748b', fontSize: 9, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
  colValue: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  outcomeText: { color: '#f59e0b', fontSize: 11, marginTop: 2 },
  verdictCol: { width: 70, alignItems: 'flex-end' },
  verdict: { fontSize: 12, fontWeight: '700' },
});
