/**
 * 2026-06-13 — Tee Goals: "break X from the Y tees" challenges.
 *
 * Round-side sibling of SmartPlan. Build a goal (tee + target + 9/18), and each
 * goal shows honest progress evaluated against your round history — best score,
 * attempts, strokes to go, and a nudge to tag your tee when past rounds didn't.
 *
 * Simplified Sophistication: pick three chips, get a challenge with live progress.
 * Depth (the evaluation, the honest skipped-no-tee handling) lives in
 * services/goals/teeScoreGoal. Pure JS, OTA-able. See memory: tee-box-score-goals.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useRoundStore, type TeeColor } from '../store/roundStore';
import { useTeeGoalStore } from '../store/teeGoalStore';
import { evaluateTeeGoal, describeTeeGoal, type TeeScoreGoal } from '../services/goals/teeScoreGoal';

const TEES: { key: TeeColor; label: string; dot: string }[] = [
  { key: 'red', label: 'Reds', dot: '#ef4444' },
  { key: 'white', label: 'Whites', dot: '#e5e7eb' },
  { key: 'blue', label: 'Blues', dot: '#3b82f6' },
  { key: 'gold', label: 'Golds', dot: '#eab308' },
  { key: 'unspecified', label: 'Any', dot: '#6b7280' },
];
const TARGETS_18 = [100, 90, 85, 80];
const TARGETS_9 = [55, 50, 45, 40];

export default function TeeGoalsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const history = useRoundStore((s) => s.roundHistory);
  const goals = useTeeGoalStore((s) => s.goals);
  const addGoal = useTeeGoalStore((s) => s.addGoal);
  const removeGoal = useTeeGoalStore((s) => s.removeGoal);

  const [tee, setTee] = useState<TeeColor>('red');
  const [nine, setNine] = useState(false);
  const [beatPar, setBeatPar] = useState(false);
  const [target, setTarget] = useState(90);

  const targets = nine ? TARGETS_9 : TARGETS_18;

  const progress = useMemo(
    () => goals.map((g) => evaluateTeeGoal(g, history)),
    [goals, history],
  );

  const create = () => {
    const id = `teegoal_${goals.length}_${history.length}_${tee}_${beatPar ? 'par' : target}_${nine ? 9 : 18}`;
    const goal: Omit<TeeScoreGoal, 'id' | 'createdAt'> = {
      tee,
      targetScore: beatPar ? null : target,
      beatPar,
      nine,
      courseId: null,
      courseName: null,
    };
    addGoal(goal, id, history.length); // createdAt as a monotonic-ish stamp (no Date.now in pure path)
  };

  const Chip = ({ active, label, onPress, dot }: { active: boolean; label: string; onPress: () => void; dot?: string }) => (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent : 'transparent' }]}
      accessibilityRole="button"
    >
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.chipText, { color: active ? '#0a1410' : colors.text_secondary }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Tee Goals</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {/* Builder */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text_muted }]}>TEE</Text>
          <View style={styles.chipRow}>
            {TEES.map((t) => (
              <Chip key={t.key} active={tee === t.key} label={t.label} dot={t.dot} onPress={() => setTee(t.key)} />
            ))}
          </View>

          <Text style={[styles.label, { color: colors.text_muted }]}>HOLES</Text>
          <View style={styles.chipRow}>
            <Chip active={!nine} label="18 holes" onPress={() => { setNine(false); setTarget(90); }} />
            <Chip active={nine} label="Front 9" onPress={() => { setNine(true); setTarget(50); }} />
          </View>

          <Text style={[styles.label, { color: colors.text_muted }]}>TARGET</Text>
          <View style={styles.chipRow}>
            {targets.map((t) => (
              <Chip key={t} active={!beatPar && target === t} label={`Break ${t}`} onPress={() => { setBeatPar(false); setTarget(t); }} />
            ))}
            <Chip active={beatPar} label="Break par" onPress={() => setBeatPar(true)} />
          </View>

          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.accent }]}
            onPress={create}
            accessibilityRole="button"
            accessibilityLabel="Add this tee goal"
          >
            <Ionicons name="add-circle" size={18} color="#0a1410" />
            <Text style={styles.addBtnText}>Add challenge</Text>
          </TouchableOpacity>
        </View>

        {/* Active goals */}
        {progress.length === 0 ? (
          <Text style={[styles.empty, { color: colors.text_muted }]}>
            No challenges yet. Build one above — like “Break 90 from the reds.”
          </Text>
        ) : (
          progress.map((p) => (
            <View key={p.goal.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.goalHead}>
                <Text style={[styles.goalTitle, { color: colors.text_primary }]}>{describeTeeGoal(p.goal)}</Text>
                <TouchableOpacity onPress={() => removeGoal(p.goal.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={colors.text_muted} />
                </TouchableOpacity>
              </View>
              <View style={styles.statusRow}>
                <Ionicons
                  name={p.achieved ? 'trophy' : 'flag-outline'}
                  size={16}
                  color={p.achieved ? colors.accent : colors.text_secondary}
                />
                <Text style={[styles.note, { color: p.achieved ? colors.accent : colors.text_secondary }]}>{p.note}</Text>
              </View>
            </View>
          ))
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
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 8 },
  label: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  addBtnText: { fontSize: 15, fontWeight: '800', color: '#0a1410' },
  empty: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  goalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalTitle: { flex: 1, fontSize: 15, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  note: { flex: 1, fontSize: 13, lineHeight: 18 },
});
