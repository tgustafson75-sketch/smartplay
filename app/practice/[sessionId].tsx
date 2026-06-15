/**
 * 2026-06-14 (Tim — points/practice) — practice-session detail.
 *
 * Tap a session in the dashboard's Practice History → this screen. Shows the
 * per-club striation (where the reps went), a within-session tempo trend, and the
 * honest open-range read (headline + insights). Drills (no per-swing samples) show
 * the drill + rep count. Mirrors the recap [round_id] list→detail idiom.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { summarizeOpenRange } from '../../services/practice/openRangeStats';
import StriationBar from '../../components/charts/StriationBar';
import TrendChart from '../../components/charts/TrendChart';

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return ''; }
}
function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

export default function PracticeSessionDetail() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const history = usePracticeSessionStore((s) => s.history);

  const session = useMemo(
    () => history.find((s) => s.id === sessionId) ?? null,
    [history, sessionId],
  );

  const summary = useMemo(
    () => (session && session.swings.length > 0 ? summarizeOpenRange(session.swings) : null),
    [session],
  );
  const tempoSeries = useMemo(
    () => (session?.swings ?? []).map((s) => s.tempoRatio).filter((t): t is number => typeof t === 'number'),
    [session],
  );

  if (!session) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.emptyText, { color: colors.text_muted }]}>Practice session not found.</Text>
      </View>
    );
  }

  const title = session.label ?? (session.focus ? session.focus : session.kind === 'open_range' ? 'Open Range' : 'Practice');
  const ballCount = session.swingCount ?? session.swings.length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 48, paddingHorizontal: 16 }}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.text_primary }]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.text_muted }]}>
          {fmtDate(session.startedAt)} · {fmtTime(session.startedAt)} · {ballCount} {ballCount === 1 ? 'ball' : 'balls'}
          {session.environment ? ` · ${session.environment}` : ''}
        </Text>

        {summary?.headline ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.headline, { color: colors.text_primary }]}>{summary.headline}</Text>
            {summary.insights.map((ins, i) => (
              <Text key={i} style={[styles.insight, { color: colors.text_muted }]}>• {ins}</Text>
            ))}
          </View>
        ) : null}

        {/* Per-club striation — where the reps went. */}
        {summary && summary.byClub.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.text_muted }]}>BY CLUB</Text>
            <StriationBar
              width={300}
              segments={summary.byClub.map((c) => ({
                label: c.club,
                value: c.count,
                detail: c.avgTempo != null ? `tempo ${c.avgTempo.toFixed(1)}:1` : null,
              }))}
            />
          </View>
        ) : null}

        {/* Within-session tempo trend (improvement read). */}
        {tempoSeries.length >= 2 ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.text_muted }]}>TEMPO THROUGH THE SESSION</Text>
            {/* tighter (more repeatable) is better → lower spread; we just show the line. */}
            <TrendChart data={tempoSeries} width={300} height={70} color={colors.accent} emptyText="Not enough tempo reads" />
            <Text style={[styles.caption, { color: colors.text_muted }]}>Backswing:downswing ratio per ball.</Text>
          </View>
        ) : null}

        {/* Drill / no-sample sessions: keep it honest — show what we have. */}
        {!summary ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.insight, { color: colors.text_muted }]}>
              {session.drillId ? 'Single-focus drill — reps logged toward your practice points.' : 'Session logged.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: { width: 40, height: 40, justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '900', marginTop: 4 },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginBottom: 10 },
  headline: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  insight: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  caption: { fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 40 },
});
