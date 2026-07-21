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

import type { Scenario, ScenarioCategory } from '../services/harness/scenarios';
import type { ScenarioReport } from '../services/harness/assert';

// 2026-05-25 — Per-row crash boundary. Without this, ONE bad scenario
// (e.g. a non-string in detail / oversized error / weird unicode) takes
// down the entire harness screen via the React render path — which Tim
// hit as "tap to view report → app crashes." Boundary catches the throw
// and renders an honest "render error" tile so the rest of the list
// stays usable. Local to harness.tsx so the rest of the app stays
// unaware. No nav-side-effects.
class HarnessRowBoundary extends React.Component<
  { children: React.ReactNode; scenarioId: string },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode; scenarioId: string }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: Error): { error: string } {
    return { error: err.message ? String(err.message).slice(0, 200) : 'unknown' };
  }
  componentDidCatch(error: Error): void {
    console.log(`[harness ${this.props.scenarioId}] render boundary caught:`, error);
  }
  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <View style={{ padding: 12, backgroundColor: '#2a0d0d', borderRadius: 6, marginTop: 6 }}>
          <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 12 }}>
            Render error — see logs
          </Text>
          <Text style={{ color: '#fca5a5', fontSize: 11, marginTop: 4 }}>
            {this.state.error}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

/** Coerce arbitrary value to a bounded string for safe <Text> render. */
function safeText(v: unknown, maxLen = 500): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// Lazy-load the harness scenarios so a top-level import-time error
// (e.g. a transitive module crashing at load) surfaces as a visible
// error message rather than white-screening the whole route.
let _allScenariosCache: typeof import('../services/harness/scenarios').ALL_SCENARIOS | null = null;
let _scenariosLoadError: string | null = null;
function loadScenarios() {
  if (_allScenariosCache || _scenariosLoadError) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../services/harness/scenarios') as typeof import('../services/harness/scenarios');
    _allScenariosCache = mod.ALL_SCENARIOS;
  } catch (e) {
    _scenariosLoadError = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    console.log('[harness] scenarios module failed to load:', _scenariosLoadError);
  }
}
loadScenarios();

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

  const ALL_SCENARIOS = _allScenariosCache ?? [];
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);

  // Declared with all hooks, before any early return — rules-of-hooks.
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

  if (_scenariosLoadError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Scenario Harness</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
          <Text style={[styles.lockedText, { color: '#ef4444' }]}>
            Scenarios module failed to load. Force-quit + reopen if you just received an OTA. If this
            persists, the error below points at the import that crashed.
          </Text>
          <Text selectable style={{ color: '#9ca3af', fontSize: 11, marginTop: 16, fontFamily: 'monospace' }}>
            {_scenariosLoadError}
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const runOne = async (s: Scenario) => {
    console.log(`[harness ${s.id}] START "${s.title}"`);
    setStates(prev => ({ ...prev, [s.id]: { kind: 'running' } }));
    try {
      const report = await s.run();
      console.log(`[harness ${s.id}] DONE  status=${report.status} duration=${report.durationMs}ms checks=${report.checks.length}`);
      setStates(prev => ({ ...prev, [s.id]: { kind: 'done', report } }));
      return report;
    } catch (e) {
      // Belt-and-suspenders — runWithAsserts inside each scenario
      // already catches body throws. This catches anything that
      // escapes (e.g. async errors from a teardown that wasn't
      // awaited). Surface as a synthetic FAIL row so the UI doesn't
      // hang on "running" forever and the React tree never sees an
      // unhandled rejection during a setState.
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[harness ${s.id}] OUTER THROW`, msg);
      const fallback = {
        id: s.id,
        title: s.title,
        status: 'fail' as const,
        durationMs: 0,
        checks: [{ label: 'Scenario threw outside the assert harness', status: 'fail' as const, detail: msg }],
        error: msg,
      };
      setStates(prev => ({ ...prev, [s.id]: { kind: 'done', report: fallback } }));
      return fallback;
    }
  };

  const runAll = async () => {
    setRunning(true);
    console.log('[harness] === Run All begin ===');
    for (const s of ALL_SCENARIOS) {
      try {
        await runOne(s);
      } catch (e) {
        // Last-resort guard — runOne already wraps. A throw here means
        // something escaped both layers; log and continue so one bad
        // scenario doesn't abort the whole run.
        console.log(`[harness] runAll outer catch on ${s.id}`, e);
      }
    }
    console.log('[harness] === Run All done ===');
    setRunning(false);
  };

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
        <HarnessRowBoundary scenarioId={scenario.id}>
          <View style={styles.detail}>
            {errored && (
              <Text style={styles.errorText}>THROW · {safeText(errored, 1000)}</Text>
            )}
            {state.report.checks.map((c, i) => {
              // Defensive: cast c.status to known shape; if a scenario
              // pushed a weird value, render as skip-dot instead of
              // letting the STATUS_COLOR lookup return undefined and
              // crash the Text color prop on Android.
              const statusKey: 'pass' | 'fail' | 'skip' =
                c.status === 'pass' || c.status === 'fail' || c.status === 'skip' ? c.status : 'skip';
              const glyph = statusKey === 'pass' ? '✓' : statusKey === 'fail' ? '✗' : '·';
              return (
                <View key={i} style={styles.checkRow}>
                  <Text style={[styles.checkStatus, { color: STATUS_COLOR[statusKey] }]}>
                    {glyph}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkLabel}>{safeText(c.label, 300)}</Text>
                    {c.detail ? <Text style={styles.checkDetail}>↳ {safeText(c.detail, 500)}</Text> : null}
                  </View>
                </View>
              );
            })}
            {failedChecks.length === 0 && state.report.checks.length === 0 && !errored && (
              <Text style={styles.checkDetail}>No asserts ran.</Text>
            )}
          </View>
        </HarnessRowBoundary>
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
