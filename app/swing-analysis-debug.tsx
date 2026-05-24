/**
 * 2026-05-24 — Owner-tool swing-analysis verification screen.
 *
 * In-app readout of the most recent /api/swing-analysis call: how many
 * frames the client POSTed vs how many the server actually saw (echoed
 * back via the response's _debug field). PASS when they agree and >= 2;
 * CHECK when they don't or only 1 frame reached the model.
 *
 * Built specifically so Tim can verify the BUG #1 fix in-app without a
 * field trip to Vercel logs or adb logcat. After a real swing through
 * SmartMotion / Coach Mode, open this screen — one glance proves the
 * full pipe.
 *
 * Owner-gated via useDebugRouteGate (same as voice-misses, owner-logs,
 * mark-green, mark-tee). Non-owners get an empty View.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDebugRouteGate } from '../hooks/useDebugRouteGate';
import { useTheme } from '../contexts/ThemeContext';
import { useSwingAnalysisDebugStore } from '../store/swingAnalysisDebugStore';

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return `${date} · ${time}`;
}

type Verdict = { state: 'pass' | 'check' | 'na'; label: string; reason: string };

function verdictFor(entry: ReturnType<typeof useSwingAnalysisDebugStore.getState>['last']): Verdict {
  if (!entry) {
    return { state: 'na', label: 'NO DATA', reason: 'No swing has been analyzed yet on this build.' };
  }
  if (entry.imageBlocks == null) {
    return {
      state: 'na',
      label: 'N/A',
      reason: 'Server didn\'t return _debug — either a legacy Vercel deploy, or the call went through the putt path (not instrumented yet).',
    };
  }
  if (entry.framesSent === entry.imageBlocks && entry.imageBlocks >= 2) {
    return {
      state: 'pass',
      label: 'PASS',
      reason: `Client sent ${entry.framesSent} frames; server saw ${entry.imageBlocks} image blocks. Multi-frame pipeline confirmed end-to-end.`,
    };
  }
  if (entry.framesSent !== entry.imageBlocks) {
    return {
      state: 'check',
      label: 'CHECK',
      reason: `Mismatch: client sent ${entry.framesSent}, server saw ${entry.imageBlocks}. Something is dropping frames at the API boundary.`,
    };
  }
  // Equal but < 2
  return {
    state: 'check',
    label: 'CHECK',
    reason: `Only ${entry.imageBlocks} frame reached the model — multi-frame motion analysis can't run on a single frame.`,
  };
}

export default function SwingAnalysisDebugScreen() {
  const _gateAllowed = useDebugRouteGate();
  const router = useRouter();
  const { colors } = useTheme();
  const last = useSwingAnalysisDebugStore(s => s.last);
  const clear = useSwingAnalysisDebugStore(s => s.clear);

  const verdict = useMemo(() => verdictFor(last), [last]);

  if (!_gateAllowed) return null;

  const onClear = () => {
    if (!last) return;
    Alert.alert(
      'Clear last run?',
      'Removes the stashed counts. Next swing analysis will repopulate.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => clear() },
      ],
    );
  };

  const verdictColor =
    verdict.state === 'pass' ? '#00C896' :
    verdict.state === 'check' ? '#ef4444' :
    colors.text_muted;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Swing Analysis Telemetry</Text>
        <TouchableOpacity
          onPress={onClear}
          disabled={!last}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Clear last entry"
        >
          <Ionicons name="trash-outline" size={20} color={last ? colors.text_muted : 'transparent'} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.hint, { color: colors.text_muted }]}>
          The last /api/swing-analysis call recorded by the client. PASS when frames-sent equals image-blocks the server received AND that count is at least 2 (multi-frame motion). Run a swing through SmartMotion to refresh.
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>LAST SWING ANALYSIS</Text>
        {!last ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardValue, { color: colors.text_muted }]}>No analysis yet</Text>
            <Text style={[styles.cardSub, { color: colors.text_muted }]}>
              Capture a swing through SmartMotion or Coach Mode; this card refreshes when the analysis returns.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.verdictCard, { borderColor: verdictColor, backgroundColor: colors.surface }]}>
              <View style={styles.verdictRow}>
                <Ionicons
                  name={verdict.state === 'pass' ? 'checkmark-circle' : verdict.state === 'check' ? 'alert-circle' : 'help-circle'}
                  size={22}
                  color={verdictColor}
                />
                <Text style={[styles.verdictLabel, { color: verdictColor }]}>{verdict.label}</Text>
              </View>
              <Text style={[styles.verdictReason, { color: colors.text_primary }]}>{verdict.reason}</Text>
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.kv}>
                <Text style={[styles.k, { color: colors.text_muted }]}>Frames sent (client)</Text>
                <Text style={[styles.v, { color: colors.text_primary }]}>{last.framesSent}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={[styles.k, { color: colors.text_muted }]}>Image blocks (server)</Text>
                <Text style={[styles.v, { color: colors.text_primary }]}>
                  {last.imageBlocks ?? '—'}
                </Text>
              </View>
              <View style={styles.kv}>
                <Text style={[styles.k, { color: colors.text_muted }]}>Text blocks (server)</Text>
                <Text style={[styles.v, { color: colors.text_primary }]}>
                  {last.textBlocks ?? '—'}
                </Text>
              </View>
              <View style={styles.kv}>
                <Text style={[styles.k, { color: colors.text_muted }]}>Mode</Text>
                <Text style={[styles.v, { color: colors.text_primary }]}>{last.mode ?? '—'}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={[styles.k, { color: colors.text_muted }]}>Short game</Text>
                <Text style={[styles.v, { color: colors.text_primary }]}>
                  {last.shortGame == null ? '—' : last.shortGame ? 'yes' : 'no'}
                </Text>
              </View>
              {last.perspective && (
                <View style={styles.kv}>
                  <Text style={[styles.k, { color: colors.text_muted }]}>Perspective</Text>
                  <Text style={[styles.v, { color: colors.text_primary }]}>{last.perspective}</Text>
                </View>
              )}
              <View style={[styles.kv, { marginTop: 4 }]}>
                <Text style={[styles.k, { color: colors.text_muted }]}>Recorded</Text>
                <Text style={[styles.v, { color: colors.text_muted, fontSize: 12 }]}>
                  {formatTimestamp(last.at)}
                </Text>
              </View>
            </View>
          </>
        )}

        <Text style={[styles.footnote, { color: colors.text_muted }]}>
          Putt-path analyses (/api/putting-analysis) are not instrumented here yet — that endpoint runs through a different handler. If a putt session lands while the server is on a legacy deploy (no _debug field), this card shows N/A.
        </Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '900', letterSpacing: 0.2 },
  body: { padding: 16 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  cardValue: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  cardSub: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  verdictCard: {
    borderRadius: 12,
    borderWidth: 2,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verdictLabel: { fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  verdictReason: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  k: { fontSize: 12, fontWeight: '600' },
  v: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 11, marginTop: 18, lineHeight: 16, fontStyle: 'italic' },
});
