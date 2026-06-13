/**
 * 2026-06-13 — Open Range surface (Practice Engine, Tank's mode).
 *
 * The honest answer to "mashing balls": start a session, hit through Smart Motion,
 * and this keeps a running, honest tally — Tank's "5 of 60" made visible, plus the
 * blocked-practice nudge. Practice runs THROUGH Smart Motion: this screen owns the
 * session (start/stop + the live read); each analyzed swing stamps itself in via the
 * global practice-session store, so the player just records swings as normal.
 *
 * Honest by construction: every number comes from summarizeOpenRange over real
 * analyzed swings (line judged only where flight was seen, tempo repeatability — no
 * fabricated dispersion). Persona = Tank (cage pillar default); copy stays plain
 * here and is voiced by the caddie layer. See memory practice-engine-smartmotion.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { summarizeOpenRange } from '../../services/practice/openRangeStats';

export default function OpenRangeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const active = usePracticeSessionStore((s) => s.active);
  const history = usePracticeSessionStore((s) => s.history);
  const startSession = usePracticeSessionStore((s) => s.startSession);
  const endSession = usePracticeSessionStore((s) => s.endSession);

  const summary = useMemo(() => (active ? summarizeOpenRange(active.swings) : null), [active]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Open Range</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {!active ? (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.text_primary }]}>Practice with intent</Text>
              <Text style={[styles.body, { color: colors.text_secondary }]}>
                Sixty balls with one club and five good ones isn’t practice. Start a session and every ball you
                hit in Smart Motion tallies here — on-line rate, tempo repeatability, and a nudge when you’re
                grinding one club.
              </Text>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                onPress={() => startSession('open_range', { environment: 'range' })}
                accessibilityRole="button"
                accessibilityLabel="Start an open range session"
              >
                <Ionicons name="golf-outline" size={18} color="#0a1410" />
                <Text style={styles.primaryBtnText}>Start Open Range</Text>
              </TouchableOpacity>
            </View>

            {history.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>RECENT SESSIONS</Text>
                {history.slice(0, 6).map((s) => {
                  const sum = summarizeOpenRange(s.swings);
                  return (
                    <View key={s.id} style={[styles.histRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.histMain, { color: colors.text_primary }]}>{sum.headline}</Text>
                      {sum.blockedPractice ? (
                        <Text style={[styles.histSub, { color: '#f59e0b' }]}>
                          {sum.blockedPractice.pct}% one club
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
              <Text style={[styles.sectionLabel, { color: colors.accent }]}>LIVE · OPEN RANGE</Text>
              <Text style={[styles.headline, { color: colors.text_primary }]}>{summary?.headline}</Text>
              <View style={styles.statRow}>
                <Stat label="BALLS" value={`${summary?.total ?? 0}`} colors={colors} />
                <Stat label="FLIGHT SEEN" value={`${summary?.flightSeen ?? 0}`} colors={colors} />
                <Stat
                  label="ON LINE"
                  value={summary && summary.flightSeen > 0 ? `${summary.onLine}/${summary.flightSeen}` : '—'}
                  colors={colors}
                />
                <Stat
                  label="TEMPO"
                  value={summary?.tempoConsistency != null ? `${Math.round(summary.tempoConsistency * 100)}%` : '—'}
                  colors={colors}
                />
              </View>
            </View>

            {summary && summary.insights.length > 0 && (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {summary.insights.map((line, i) => (
                  <Text key={i} style={[styles.insight, { color: colors.text_secondary }]}>• {line}</Text>
                ))}
              </View>
            )}

            {summary && summary.byClub.length > 0 && (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>BY CLUB</Text>
                {summary.byClub.map((c) => (
                  <View key={c.club} style={[styles.clubRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.clubName, { color: colors.text_primary }]}>{c.club}</Text>
                    <Text style={[styles.clubCount, { color: colors.text_secondary }]}>×{c.count}</Text>
                    <Text style={[styles.clubTempo, { color: c.avgTempo != null ? colors.accent : colors.text_muted }]}>
                      {c.avgTempo != null ? `${c.avgTempo.toFixed(1)}:1` : '—'}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              onPress={() => router.push('/swinglab/smartmotion')}
              accessibilityRole="button"
              accessibilityLabel="Open Smart Motion to record a swing"
            >
              <Ionicons name="videocam-outline" size={18} color="#0a1410" />
              <Text style={styles.primaryBtnText}>Record a swing</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.endBtn, { borderColor: colors.border }]}
              onPress={endSession}
              accessibilityRole="button"
              accessibilityLabel="End the open range session"
            >
              <Text style={[styles.endBtnText, { color: colors.text_secondary }]}>End session</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.text_primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.text_muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '900' },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  body: { fontSize: 13, lineHeight: 19 },
  sectionLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  headline: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginTop: 2 },
  insight: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  clubRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  clubName: { flex: 1, fontSize: 14, fontWeight: '800' },
  clubCount: { width: 50, textAlign: 'center', fontSize: 13, fontWeight: '600' },
  clubTempo: { width: 56, textAlign: 'right', fontSize: 13, fontWeight: '700' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 10,
  },
  primaryBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 14, letterSpacing: 0.3 },
  endBtn: { paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  endBtnText: { fontSize: 13, fontWeight: '700' },
  histRow: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 3 },
  histMain: { fontSize: 13, fontWeight: '700' },
  histSub: { fontSize: 11, fontWeight: '700' },
});
