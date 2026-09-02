/**
 * app/simround-auto.tsx — AUTO SIM ROUND (silent). Owner-gated.
 *
 * 2026-09-02 (Tim) — "a second option for owner tools sim round that is non voice and goes by user
 * tendencies and data... watch hole transition, scoring, etc. This way we can finish surgical last
 * minute issues on my phone until I find them all."
 *
 * The narrated sim round needs him to speak every shot. This one plays itself through the same real
 * pipeline in seconds, on HIS bag and HIS miss, and reports per hole. Deliberately the same shape as
 * /harness — run, read, Export — because the output goes through the same formatter and lands in the
 * same place: a report he can send.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Share, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';
import { formatRunReport, collectRunEnv } from '../services/harness/report';
import type { ScenarioReport } from '../services/harness/assert';

const STATUS_COLOR: Record<'pass' | 'fail' | 'skip', string> = {
  pass: '#00C896', fail: '#ef4444', skip: '#9ca3af',
};

function safeText(v: unknown, maxLen = 400): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

export default function AutoSimRoundScreen() {
  const router = useRouter();
  const ownerEmail = usePlayerProfileStore(s => s.email);
  const isOwner = useMemo(() => isOwnerEmail(ownerEmail), [ownerEmail]);

  const [reports, setReports] = useState<ScenarioReport[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [nine, setNine] = useState(true);
  const [seed, setSeed] = useState(1);

  const summary = useMemo(() => {
    const pass = reports.filter(r => r.status === 'pass').length;
    const fail = reports.filter(r => r.status === 'fail').length;
    const skip = reports.filter(r => r.status === 'skip').length;
    const ms = reports.reduce((n, r) => n + r.durationMs, 0);
    return { pass, fail, skip, ms };
  }, [reports]);

  const run = async () => {
    setRunning(true);
    setReports([]);
    setProgress('starting…');
    try {
      const { runAutoSimRound } = await import('../services/simRoundAuto');
      const out = await runAutoSimRound(
        { nineHoles: nine, seed },
        (p) => setProgress(`hole ${p.hole} of ${p.of}`),
      );
      setReports(out);
      setProgress('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('[simround-auto] run failed:', msg);
      Alert.alert('Sim round failed', msg);
      setProgress('');
    } finally {
      setRunning(false);
    }
  };

  const exportRun = async () => {
    if (reports.length === 0) { Alert.alert('Nothing to export', 'Play a round first.'); return; }
    setExporting(true);
    try {
      const env = await collectRunEnv().catch(() => ({}));
      const text = formatRunReport(reports, { ...env, simSeed: seed, simHoles: nine ? 9 : 18 });
      await Share.share({ message: text, title: 'SmartPlay Caddie — auto sim round' });
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Auto Sim Round</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.lockedBody}>
          <Text style={styles.lockedText}>
            This surface is owner-only. It starts a real (SIM-tagged) round and writes to round state.
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
        <Text style={styles.title}>Auto Sim Round</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={exportRun}
            disabled={running || exporting || reports.length === 0}
            style={[styles.exportBtn, (running || exporting || reports.length === 0) && { opacity: 0.4 }]}
          >
            <Text style={styles.exportText}>{exporting ? '…' : 'Export'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={run} disabled={running} style={[styles.runAllBtn, running && { opacity: 0.5 }]}>
            <Text style={styles.runAllText}>{running ? 'Playing…' : 'Play'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.optionsRow}>
        <TouchableOpacity style={[styles.chip, nine && styles.chipOn]} onPress={() => setNine(v => !v)} disabled={running}>
          <Text style={[styles.chipText, nine && styles.chipTextOn]}>{nine ? '9 holes' : '18 holes'}</Text>
        </TouchableOpacity>
        {/* The seed is the reproducibility handle: same seed, same round, shot for shot. */}
        <TouchableOpacity style={styles.chip} onPress={() => setSeed(s => s + 1)} disabled={running}>
          <Text style={styles.chipText}>seed {seed} ›</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>silent · your bag · your miss</Text>
      </View>

      {(running || reports.length > 0) && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {running
              ? `Playing… ${progress}`
              : `${summary.pass} pass · ${summary.fail} fail · ${summary.skip} skip   (${(summary.ms / 1000).toFixed(1)}s)`}
          </Text>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 80 }}>
        {reports.length === 0 && !running && (
          <Text style={styles.empty}>
            Plays a full SIM-tagged round with no voice, using your learned club distances and your CNS
            miss tendency. Watches the yardage count down, the hole advance on the first score, and the
            scorecard reconcile against what was actually played. Never trains your handicap, bag or CNS.
          </Text>
        )}
        {running && reports.length === 0 && (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#00C896" />
          </View>
        )}
        {reports.map((r) => (
          <View key={r.id} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.rowId}>{r.id}</Text>
              <Text style={[styles.rowStatus, { color: STATUS_COLOR[r.status] }]}>{r.status.toUpperCase()}</Text>
              <Text style={styles.rowDuration}>{r.durationMs}ms</Text>
            </View>
            <Text style={styles.rowTitle}>{r.title}</Text>
            {r.error ? <Text style={styles.errorText}>THROW · {safeText(r.error, 600)}</Text> : null}
            {r.checks.map((c, i) => {
              const key: 'pass' | 'fail' | 'skip' =
                c.status === 'pass' || c.status === 'fail' || c.status === 'skip' ? c.status : 'skip';
              const glyph = key === 'pass' ? '✓' : key === 'fail' ? '✗' : '·';
              return (
                <View key={i} style={styles.checkRow}>
                  <Text style={[styles.checkStatus, { color: STATUS_COLOR[key] }]}>{glyph}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkLabel}>{safeText(c.label, 250)}</Text>
                    {c.detail ? <Text style={styles.checkDetail}>↳ {safeText(c.detail)}</Text> : null}
                  </View>
                </View>
              );
            })}
            {r.trace?.maxLagMs ? (
              <Text style={styles.traceStall}>{`⚠ JS thread blocked ${r.trace.maxLagMs}ms`}</Text>
            ) : null}
            {r.trace?.logs?.length ? (
              <View style={styles.traceBlock}>
                <Text style={styles.traceHead}>SWALLOWED · console errors</Text>
                {r.trace.logs.map((l, i) => <Text key={i} style={styles.traceErr}>{safeText(l, 200)}</Text>)}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e3a28',
  },
  back: { color: '#00C896', fontSize: 16, width: 60 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  exportBtn: {
    borderWidth: 1, borderColor: '#00C896', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, marginRight: 8, alignItems: 'center',
  },
  exportText: { color: '#00C896', fontWeight: '700', fontSize: 13 },
  runAllBtn: {
    backgroundColor: '#00C896', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, minWidth: 74, alignItems: 'center',
  },
  runAllText: { color: '#060f09', fontWeight: '700', fontSize: 13 },
  optionsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 10, gap: 8 },
  chip: {
    borderWidth: 1, borderColor: '#1e3a28', backgroundColor: '#0d2418',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
  },
  chipOn: { borderColor: '#00C896' },
  chipText: { color: '#c2cad4', fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#00C896' },
  hint: { color: '#6b7280', fontSize: 11, marginLeft: 'auto' },
  summaryRow: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#0d2418', marginTop: 10 },
  summaryText: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  empty: { color: '#c2cad4', fontSize: 13, lineHeight: 20, padding: 20 },
  row: {
    marginHorizontal: 12, marginVertical: 4, backgroundColor: '#0d2418',
    borderRadius: 8, borderWidth: 1, borderColor: '#1e3a28', padding: 12,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowId: { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  rowStatus: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  rowDuration: { color: '#6b7280', fontSize: 11, marginLeft: 'auto' },
  rowTitle: { color: '#e5e7eb', fontSize: 14, marginTop: 2, marginBottom: 6 },
  errorText: { color: '#ef4444', fontSize: 12, marginBottom: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 2 },
  checkStatus: { fontSize: 12, width: 16, fontWeight: '700' },
  checkLabel: { color: '#d1d5db', fontSize: 12 },
  checkDetail: { color: '#c2cad4', fontSize: 11, marginTop: 2 },
  traceBlock: { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' },
  traceHead: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  traceErr: { color: '#FF8A7A', fontSize: 11, lineHeight: 16 },
  traceStall: { color: '#F0C030', fontSize: 12, fontWeight: '700', marginTop: 8 },
  lockedBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  lockedText: { color: '#c2cad4', fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
