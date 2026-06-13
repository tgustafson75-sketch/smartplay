/**
 * 2026-06-13 — SmartPlan: goal → weekly practice plan (Practice Engine, Tank's planner).
 *
 * Tank's breakdown made real: pick a goal, say how many days/week and minutes you
 * have and where you can practice (range / putting green / home carpet+glass), and
 * it lays out a weighted weekly plan — scoring goals lean on short game + putting,
 * distance leans on speed, home filters to what you can actually do. Tap a day to
 * run it through the Session Runner. Honest: it never promises an outcome.
 *
 * Simplified Sophistication: a few chip rows + a plan. Depth (the weighting, the
 * location filtering) lives in services/practice/goalPlan; the surface stays clean.
 * Pure JS, OTA-able. See memory practice-engine-smartmotion, simplified-sophistication.
 */

import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import {
  buildGoalPlan,
  PRACTICE_GOALS,
  type PracticeGoal,
  type PracticeLocation,
} from '../../services/practice/goalPlan';

const DAYS = [2, 3, 4, 5];
const MINUTES = [20, 45, 60, 90];
const LOCATIONS: { key: PracticeLocation; label: string }[] = [
  { key: 'full', label: 'Range + green' },
  { key: 'range_only', label: 'Range only' },
  { key: 'putting_green', label: 'Putting green' },
  { key: 'home', label: 'Home' },
];

export default function SmartPlanScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const startSession = usePracticeSessionStore((s) => s.startSession);

  const [goal, setGoal] = useState<PracticeGoal>('break_90');
  const [days, setDays] = useState(3);
  const [minutes, setMinutes] = useState(60);
  const [location, setLocation] = useState<PracticeLocation>('full');

  const plan = useMemo(
    () => buildGoalPlan({ goal, daysPerWeek: days, minutesPerSession: minutes, location }),
    [goal, days, minutes, location],
  );

  const runDay = (focusKey: string, reps: number) => {
    startSession('focus', { focus: focusKey, targetReps: reps, environment: location === 'home' ? 'home' : 'range' });
    router.push('/practice/session' as never);
  };

  const Chip = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent : 'transparent' }]}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, { color: active ? '#0a1410' : colors.text_secondary }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>SmartPlan</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={[styles.label, { color: colors.text_muted }]}>GOAL</Text>
        <View style={styles.chipRow}>
          {PRACTICE_GOALS.map((g) => (
            <Chip key={g.key} active={goal === g.key} label={g.label} onPress={() => setGoal(g.key)} />
          ))}
        </View>

        <Text style={[styles.label, { color: colors.text_muted }]}>DAYS / WEEK</Text>
        <View style={styles.chipRow}>
          {DAYS.map((d) => (
            <Chip key={d} active={days === d} label={`${d}`} onPress={() => setDays(d)} />
          ))}
        </View>

        <Text style={[styles.label, { color: colors.text_muted }]}>MINUTES / SESSION</Text>
        <View style={styles.chipRow}>
          {MINUTES.map((m) => (
            <Chip key={m} active={minutes === m} label={`${m}`} onPress={() => setMinutes(m)} />
          ))}
        </View>

        <Text style={[styles.label, { color: colors.text_muted }]}>WHERE</Text>
        <View style={styles.chipRow}>
          {LOCATIONS.map((l) => (
            <Chip key={l.key} active={location === l.key} label={l.label} onPress={() => setLocation(l.key)} />
          ))}
        </View>

        {/* The plan */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.planTitle, { color: colors.text_primary }]}>Your week · {plan.goalLabel}</Text>
          {plan.sessions.length === 0 ? (
            <Text style={[styles.note, { color: colors.text_secondary }]}>{plan.notes[plan.notes.length - 1]}</Text>
          ) : (
            plan.sessions.map((s) => (
              <TouchableOpacity
                key={s.day}
                style={[styles.dayRow, { borderBottomColor: colors.border }]}
                onPress={() => runDay(s.focusKey, s.reps)}
                accessibilityRole="button"
                accessibilityLabel={`Run day ${s.day}: ${s.focusLabel}`}
              >
                <Text style={[styles.dayNum, { color: colors.text_muted }]}>D{s.day}</Text>
                <Text style={[styles.dayFocus, { color: colors.text_primary }]}>{s.focusLabel}</Text>
                <Text style={[styles.dayReps, { color: colors.text_secondary }]}>{s.reps} balls</Text>
                <Ionicons name="play-circle" size={22} color={colors.accent} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {plan.notes.map((n, i) => (
          <Text key={i} style={[styles.note, { color: colors.text_muted }]}>• {n}</Text>
        ))}
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
  label: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1, marginBottom: -6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '700' },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 4, marginTop: 4 },
  planTitle: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  dayNum: { fontSize: 12, fontWeight: '800', width: 28 },
  dayFocus: { flex: 1, fontSize: 14, fontWeight: '700' },
  dayReps: { fontSize: 12, fontWeight: '600' },
  note: { fontSize: 12, lineHeight: 17 },
});
