/**
 * Scenario harness — owner-gated runner UI.
 *
 * Lists every Scenario from services/harness/scenarios.ts with a per-row
 * Run button + a Run All. Surfaces PASS / FAIL / SKIP inline; failed
 * checks expand into the row body so the failing assertion + detail are
 * readable on-device without scrolling to a console.
 *
 * Owner-gated — non-owners visiting the URL directly land on a polite
 * placeholder. The harness writes test state into real Zustand stores
 * (with explicit teardowns), so leaving this exposed to end users would
 * pollute their library / round state.
 *
 * Wire-up: route registered automatically via expo-router (file lives in
 * /app). No tab entry — open via /harness URL or a Settings owner-tools
 * link.
 *
 * 2026-05-24 — Built per the harness expansion sketch.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';
import { ALL_SCENARIOS, type Scenario, type ScenarioCategory } from '../services/harness/scenarios';
import type { ScenarioReport } from '../services/harness/assert';

type RowState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: ScenarioReport };

const CATEGORY_ORDER: ScenarioCategory[] = ['critical', 'high', 'nice'];
const CATEGORY_LABEL: Record<ScenarioCategory, string> = {
  critical: 'CRITICAL',
  high: 'HIGH-VALUE',
  nice: 'NICE-TO-HAVE',
};

const STATUS_COLOR: Record<'pass' | 'fail' | 'skip', string> = {
  pass: '#00C896',
  fail: '#ef4444',
  skip: '#9ca3af',
};

export default function HarnessScreen() {
  const router = useRouter();
  const ownerEmail = usePlayerProfileStore(s => s.email);
  const isOwner = useMemo(() => isOwnerEmail(ownerEmail), [ownerEmail]);

  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);

  const runOne = async (s: Scenario) => {
    setStates(prev => ({ ...prev, [s.id]: { kind: 'running' } }));
    const report = await s.run();
    setStates(prev => ({ ...prev, [s.id]: { kind: 'done', report } }));
    return report;
  };

  const runAll = async () => {
    setRunning(true);
    console.log('[harness] === Run All begin ===');
    for (const s of ALL_SCENARIOS) {
      await runOne(s);
    }
    console.log('[harness] === Run All done ===');
    setRunning(false);
  };

  const summary = useMemo(() => {
    let pass = 0, fail = 0, skip = 0;
    let total = 0;
    let totalMs = 0;
    Object.values(states).forEach(rs => {
      if (rs.kind === 'done') {
        total++;
        totalMs += rs.report.durationMs;
        if (rs.report.status === 'pass') pass++;
        else if (rs.report.status === 'fail') fail++;
        else skip++;
      }
    });
    return { pass, fail, skip, total, totalMs };
  }, [states]);

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Scenario Harness</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.lockedBody}>
          <Text style={styles.lockedText}>
            This surface is owner-only. The scenario harness runs synthetic state through real stores;
            it isn’t intended for end-user surfaces.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Scenario Harness</Text>
        <TouchableOpacity
          onPress={runAll}
          disabled={running}
          style={[styles.runAllBtn, running && { opacity: 0.5 }]}
        >
          <Text style={styles.runAllText}>{running ? 'Running…' : 'Run All'}</Text>
        </TouchableOpacity>
      </View>

      {summary.total > 0 && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {summary.pass} pass · {summary.fail} fail · {summary.skip} skip
            {'   '}({(summary.totalMs / 1000).toFixed(1)}s)
          </Text>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 80 }}>
        {CATEGORY_ORDER.map(cat => {
          const rows = ALL_SCENARIOS.filter(s => s.category === cat);
          return (
            <View key={cat}>
              <Text style={styles.sectionLabel}>{CATEGORY_LABEL[cat]}</Text>
              {rows.map(s => {
                const state = states[s.id] ?? { kind: 'idle' };
                return <Row key={s.id} scenario={s} state={state} onRun={() => runOne(s)} />;
              })}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ scenario, state, onRun }: { scenario: Scenario; state: RowState; onRun: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const status: 'pass' | 'fail' | 'skip' | null =
    state.kind === 'done' ? state.report.status : null;
  const failedChecks =
    state.kind === 'done' ? state.report.checks.filter(c => c.status === 'fail') : [];
  const errored = state.kind === 'done' ? state.report.error : undefined;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.runBtn}
        onPress={onRun}
        disabled={state.kind === 'running'}
      >
        {state.kind === 'running'
          ? <ActivityIndicator size="small" color="#00C896" />
          : <Text style={styles.runText}>Run</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.rowBody} activeOpacity={0.7} onPress={() => setExpanded(e => !e)}>
        <Text style={styles.rowId}>{scenario.id}</Text>
        <Text style={styles.rowTitle} numberOfLines={2}>{scenario.title}</Text>
        {state.kind === 'done' && (
          <View style={styles.rowStatusBlock}>
            <Text style={[styles.rowStatus, { color: STATUS_COLOR[state.report.status] }]}>
              {state.report.status.toUpperCase()}
            </Text>
            <Text style={styles.rowDuration}>{state.report.durationMs}ms</Text>
          </View>
        )}
      </TouchableOpacity>

      {state.kind === 'done' && (expanded || status === 'fail') && (
        <View style={styles.detail}>
          {errored && (
            <Text style={styles.errorText}>THROW · {errored}</Text>
          )}
          {state.report.checks.map((c, i) => (
            <View key={i} style={styles.checkRow}>
              <Text style={[styles.checkStatus, { color: STATUS_COLOR[c.status] }]}>
                {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '·'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkLabel}>{c.label}</Text>
                {c.detail && <Text style={styles.checkDetail}>↳ {c.detail}</Text>}
              </View>
            </View>
          ))}
          {failedChecks.length === 0 && state.report.checks.length === 0 && !errored && (
            <Text style={styles.checkDetail}>No asserts ran.</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  back: { color: '#00C896', fontSize: 16, width: 60 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  runAllBtn: {
    backgroundColor: '#00C896',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  runAllText: { color: '#060f09', fontWeight: '700', fontSize: 13 },
  summaryRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#0d2418',
  },
  summaryText: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  sectionLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: {
    marginHorizontal: 12,
    marginVertical: 4,
    backgroundColor: '#0d2418',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  runBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    backgroundColor: '#143d2a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 52,
    alignItems: 'center',
  },
  runText: { color: '#00C896', fontWeight: '700', fontSize: 12 },
  rowBody: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 78,
    flexDirection: 'column',
  },
  rowId: { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  rowTitle: { color: '#e5e7eb', fontSize: 14, marginTop: 2 },
  rowStatusBlock: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  rowStatus: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  rowDuration: { color: '#6b7280', fontSize: 11, marginLeft: 8 },
  detail: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
    paddingTop: 10,
  },
  errorText: { color: '#ef4444', fontSize: 12, marginBottom: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 2 },
  checkStatus: { fontSize: 12, width: 16, fontWeight: '700' },
  checkLabel: { color: '#d1d5db', fontSize: 12 },
  checkDetail: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  lockedBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  lockedText: { color: '#9ca3af', fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
