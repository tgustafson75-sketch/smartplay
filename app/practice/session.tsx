/**
 * 2026-06-13 — Structured Session Runner (Practice Engine, Tank's mode).
 *
 * Tim: a session should KNOW what today is. Pick a focus (irons / short game /
 * driver distance / driver speed / hands / putting), and the runner walks you
 * through an INTERLEAVED plan — rotating clubs (or targets, single-club focuses)
 * in small blocks so it's never a one-club grind (Tank). You record each swing in
 * Smart Motion; it stamps into the session and the runner auto-advances
 * (currentRep = swings recorded). At the end it shows the honest read.
 *
 * Pure-JS surface over services/practice/sessionPlan + the practice-session store,
 * so it ships OTA. Persona = Tank; copy stays plain here, voiced by the caddie
 * layer. See memory practice-engine-smartmotion.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { summarizeOpenRange } from '../../services/practice/openRangeStats';
import { PRACTICE_FOCUSES, getFocus, buildInterleavedPlan } from '../../services/practice/sessionPlan';

const DEFAULT_REPS = 12;

export default function SessionRunnerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const active = usePracticeSessionStore((s) => s.active);
  const startSession = usePracticeSessionStore((s) => s.startSession);
  const endSession = usePracticeSessionStore((s) => s.endSession);

  // A focus session is active when kind === 'focus'.
  const focusSession = active && active.kind === 'focus' ? active : null;
  const focus = focusSession?.focus ? getFocus(focusSession.focus) : null;
  const total = focusSession?.targetReps ?? DEFAULT_REPS;

  const plan = useMemo(() => (focus ? buildInterleavedPlan(focus, total) : []), [focus, total]);
  const done = focusSession?.swings.length ?? 0;
  const complete = focusSession != null && done >= total;
  const currentRep = !complete && done < plan.length ? plan[done] : null;
  const summary = useMemo(() => (focusSession ? summarizeOpenRange(focusSession.swings) : null), [focusSession]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Focused Practice</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {!focusSession ? (
          <>
            <Text style={[styles.intro, { color: colors.text_secondary }]}>
              Pick what today is. Each one rotates clubs or targets so you practice like you play — not 60 balls
              at one flag.
            </Text>
            {PRACTICE_FOCUSES.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={[styles.focusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => startSession('focus', { focus: f.key, targetReps: DEFAULT_REPS, environment: 'range' })}
                accessibilityRole="button"
                accessibilityLabel={`Start ${f.label} session`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.focusLabel, { color: colors.text_primary }]}>{f.label}</Text>
                  <Text style={[styles.focusIntent, { color: colors.text_muted }]}>{f.intent}</Text>
                  <Text style={[styles.focusMeta, { color: colors.text_muted }]}>
                    {f.clubs.length > 1 ? `Rotates ${f.clubs.join(' · ')}` : `${f.clubs[0]} · vary targets`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.text_muted} />
              </TouchableOpacity>
            ))}
          </>
        ) : complete ? (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
              <Text style={[styles.sectionLabel, { color: colors.accent }]}>SESSION COMPLETE · {focus?.label?.toUpperCase()}</Text>
              <Text style={[styles.headline, { color: colors.text_primary }]}>{summary?.headline}</Text>
            </View>
            {summary && summary.insights.length > 0 && (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {summary.insights.map((line, i) => (
                  <Text key={i} style={[styles.insight, { color: colors.text_secondary }]}>• {line}</Text>
                ))}
              </View>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              onPress={endSession}
              accessibilityRole="button"
              accessibilityLabel="Finish the session"
            >
              <Text style={styles.primaryBtnText}>Finish</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
              <Text style={[styles.sectionLabel, { color: colors.accent }]}>{focus?.label?.toUpperCase()} · BALL {done + 1} OF {total}</Text>
              <Text style={[styles.repClub, { color: colors.text_primary }]}>{currentRep?.club}</Text>
              {currentRep?.switchClub && done > 0 ? (
                <Text style={[styles.switchCue, { color: '#f59e0b' }]}>↻ Switch clubs — {currentRep.club}</Text>
              ) : null}
              <Text style={[styles.repCue, { color: colors.text_secondary }]}>{currentRep?.targetCue}</Text>
              {/* progress dots */}
              <View style={styles.dotsRow}>
                {plan.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: i < done ? colors.accent : i === done ? colors.text_secondary : colors.border },
                    ]}
                  />
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              onPress={() => router.push('/swinglab/smartmotion')}
              accessibilityRole="button"
              accessibilityLabel="Record this swing in Smart Motion"
            >
              <Ionicons name="videocam-outline" size={18} color="#0a1410" />
              <Text style={styles.primaryBtnText}>Record this ball</Text>
            </TouchableOpacity>

            {summary && summary.total > 0 && (
              <Text style={[styles.liveLine, { color: colors.text_muted }]}>{summary.headline}</Text>
            )}

            <TouchableOpacity
              style={[styles.endBtn, { borderColor: colors.border }]}
              onPress={endSession}
              accessibilityRole="button"
              accessibilityLabel="End the session early"
            >
              <Text style={[styles.endBtnText, { color: colors.text_secondary }]}>End early</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '900' },
  intro: { fontSize: 13, lineHeight: 19 },
  focusCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  focusLabel: { fontSize: 15, fontWeight: '800' },
  focusIntent: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  focusMeta: { fontSize: 11, fontWeight: '600', marginTop: 5 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  headline: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
  repClub: { fontSize: 40, fontWeight: '900', letterSpacing: 1 },
  switchCue: { fontSize: 13, fontWeight: '800' },
  repCue: { fontSize: 14, fontWeight: '600' },
  dotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  insight: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  liveLine: { fontSize: 12, fontWeight: '600', textAlign: 'center', fontStyle: 'italic' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 10,
  },
  primaryBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 14, letterSpacing: 0.3 },
  endBtn: { paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  endBtnText: { fontSize: 13, fontWeight: '700' },
});
