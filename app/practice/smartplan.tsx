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

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '../../contexts/ThemeContext';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { usePracticePlanStore } from '../../store/practicePlanStore';
import {
  buildGoalPlan,
  PRACTICE_GOALS,
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

  // 2026-07-04 (Tim) — the plan is now PERSISTED (this week's plan), drives caddie
  // guidance, and carries a goals/challenges narrative + check-offs + reminders.
  const { goal, days, minutes, location, narrative, completed, reminders } = usePracticePlanStore(
    useShallow((s) => ({
      goal: s.goal, days: s.daysPerWeek, minutes: s.minutesPerSession, location: s.location,
      narrative: s.narrative, completed: s.completed, reminders: s.reminders,
    })),
  );
  const setConfig = usePracticePlanStore((s) => s.setConfig);
  const setNarrative = usePracticePlanStore((s) => s.setNarrative);
  const toggleComplete = usePracticePlanStore((s) => s.toggleComplete);
  const toggleReminderDone = usePracticePlanStore((s) => s.toggleReminderDone);
  const removeReminder = usePracticePlanStore((s) => s.removeReminder);

  const setGoal = (g: typeof goal) => setConfig({ goal: g });
  const setDays = (d: number) => setConfig({ daysPerWeek: d });
  const setMinutes = (m: number) => setConfig({ minutesPerSession: m });
  const setLocation = (l: typeof location) => setConfig({ location: l });

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
            plan.sessions.map((s) => {
              const done = !!completed[s.focusKey];
              return (
                <View key={s.day} style={[styles.dayRow, { borderBottomColor: colors.border }]}>
                  <TouchableOpacity onPress={() => toggleComplete(s.focusKey)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} accessibilityLabel={`Mark day ${s.day} ${done ? 'not done' : 'done'}`}>
                    <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={done ? colors.accent : colors.text_muted} />
                  </TouchableOpacity>
                  <Text style={[styles.dayNum, { color: colors.text_muted }]}>D{s.day}</Text>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => runDay(s.focusKey, s.reps)} accessibilityRole="button" accessibilityLabel={`Run day ${s.day}: ${s.focusLabel}`}>
                    <Text style={[styles.dayFocus, { color: colors.text_primary }, done && { textDecorationLine: 'line-through', opacity: 0.55 }]}>{s.focusLabel}</Text>
                  </TouchableOpacity>
                  <Text style={[styles.dayReps, { color: colors.text_secondary }]}>{s.reps} balls</Text>
                  <TouchableOpacity onPress={() => runDay(s.focusKey, s.reps)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
                    <Ionicons name="play-circle" size={22} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        {plan.notes.map((n, i) => (
          <Text key={i} style={[styles.note, { color: colors.text_muted }]}>• {n}</Text>
        ))}

        {/* 2026-07-04 (Tim) — free-text goals + challenges the CADDIE reads + considers
            all week. Feeds buildPipecatContext so guidance is steered toward these. */}
        <Text style={[styles.label, { color: colors.text_muted }]}>GOALS & CHALLENGES · your caddie reads this</Text>
        <TextInput
          style={[styles.narrative, { color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={narrative}
          onChangeText={setNarrative}
          multiline
          placeholder="e.g. Round Saturday — want to stop the double-cross off the tee and get my speed on lag putts. Only have ~3 hrs this week."
          placeholderTextColor={colors.text_muted}
          textAlignVertical="top"
        />

        {reminders.length > 0 && (
          <>
            <Text style={[styles.label, { color: colors.text_muted }]}>REMINDERS · say &quot;remind me to…&quot;</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {reminders.map((r) => (
                <View key={r.id} style={[styles.dayRow, { borderBottomColor: colors.border }]}>
                  <TouchableOpacity onPress={() => toggleReminderDone(r.id)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
                    <Ionicons name={r.done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={r.done ? colors.accent : colors.text_muted} />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dayFocus, { color: colors.text_primary }, r.done && { textDecorationLine: 'line-through', opacity: 0.55 }]}>{r.text}</Text>
                    {r.whenText ? <Text style={[styles.dayReps, { color: colors.text_secondary }]}>{r.whenText}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => removeReminder(r.id)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
                    <Ionicons name="close" size={18} color={colors.text_muted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
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
  narrative: { minHeight: 92, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 20 },
});
