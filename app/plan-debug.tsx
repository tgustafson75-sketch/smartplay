import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRoundStore } from '../store/roundStore';
import { listArchivedRecaps, loadRecap } from '../services/planStorage';
import { generateRecap } from '../services/recapGenerator';
import type { RoundRecap } from '../types/plan';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export default function PlanDebugScreen() {
  const router = useRouter();
  const {
    isRoundActive,
    currentRoundId,
    plans,
    shots,
    scores,
    courseHoles,
    activeCourse,
    activeCourseId,
    mode,
    roundStartTime,
  } = useRoundStore();

  const [recaps, setRecaps] = useState<RoundRecap[]>([]);
  const [generating, setGenerating] = useState(false);
  const [listLoading, setListLoading] = useState(false);

  const activePlan = plans.find(p => p.hole_number === 1) ?? null;

  const handleMockPlan = () => {
    useRoundStore.getState().addOrUpdatePlan({
      hole_number: 1,
      markers: {
        tee: { x: 0.5, y: 0.85, club_intent: 'Driver', landmark_target: null },
        approach: { x: 0.5, y: 0.45, club_intent: '7i', landmark_target: null },
        pin: { x: 0.5, y: 0.15, club_intent: 'PW', landmark_target: null },
      },
      computed_yardages: { from_tee_to_approach: 210, from_approach_to_pin: 130, total: 340 },
    });
  };

  const handleMockShots = () => {
    const hole = 1;
    const ts = Date.now();
    [
      { feel: 'flush' as const, direction: 'straight' as const, shape: 'straight' as const, club: 'Driver', hole, timestamp: ts, acousticContact: null },
      { feel: 'solid' as const, direction: 'right' as const, shape: 'fade' as const, club: '7i', hole, timestamp: ts + 1000, acousticContact: null },
      { feel: 'solid' as const, direction: 'straight' as const, shape: 'straight' as const, club: 'PW', hole, timestamp: ts + 2000, acousticContact: null },
    ].forEach(s => useRoundStore.getState().logShot(s));
    if (!scores[1]) useRoundStore.getState().logScore(1, 4);
  };

  const handleGenerateRecap = async () => {
    if (!currentRoundId) {
      Alert.alert('No Active Round', 'Start a round first to generate a recap.');
      return;
    }
    setGenerating(true);
    try {
      const total = Object.values(scores).reduce((a, b) => a + b, 0);
      let vspar = 0;
      Object.entries(scores).forEach(([h, s]) => {
        const par = courseHoles.find(ch => ch.hole === Number(h))?.par ?? 4;
        vspar += s - par;
      });

      const recap = await generateRecap(currentRoundId, {
        courseName: activeCourse ?? 'Debug Course',
        courseId: activeCourseId,
        mode,
        startedAt: roundStartTime ?? Date.now(),
        endedAt: Date.now(),
        totalScore: total,
        scoreVsPar: vspar,
        scores,
        plans,
        shots,
        courseHoles,
        patternInsights: ['DEBUG: mock shot data used'],
        playerName: 'Debug Player',
        apiUrl,
      });

      Alert.alert('Recap Generated', `Round ${recap.round_id}\n${recap.overall_kevin_summary}`, [
        { text: 'View', onPress: () => router.push(('/recap/' + recap.round_id) as never) },
        { text: 'OK' },
      ]);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleListRecaps = async () => {
    setListLoading(true);
    try {
      const list = await listArchivedRecaps();
      setRecaps(list);
    } finally {
      setListLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Plan Debug</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* State */}
        <Text style={styles.section}>ROUND STATE</Text>
        <View style={styles.card}>
          <Text style={styles.row}>Active: <Text style={styles.val}>{isRoundActive ? 'YES' : 'NO'}</Text></Text>
          <Text style={styles.row}>Round ID: <Text style={styles.val}>{currentRoundId ?? '—'}</Text></Text>
          <Text style={styles.row}>Mode: <Text style={styles.val}>{mode}</Text></Text>
          <Text style={styles.row}>Course: <Text style={styles.val}>{activeCourse ?? '—'}</Text></Text>
          <Text style={styles.row}>Plans: <Text style={styles.val}>{plans.length}</Text></Text>
          <Text style={styles.row}>Shots: <Text style={styles.val}>{shots.length}</Text></Text>
          <Text style={styles.row}>Scored holes: <Text style={styles.val}>{Object.keys(scores).length}</Text></Text>
        </View>

        {/* Active plan for hole 1 */}
        <Text style={styles.section}>PLAN — HOLE 1</Text>
        <View style={styles.card}>
          {activePlan ? (
            <>
              <Text style={styles.row}>Status: <Text style={styles.val}>{activePlan.locked_at ? 'Locked' : 'Draft'}</Text></Text>
              <Text style={styles.row}>Tee: <Text style={styles.val}>{activePlan.markers.tee.club_intent ?? '—'}</Text></Text>
              <Text style={styles.row}>Approach: <Text style={styles.val}>{activePlan.markers.approach?.club_intent ?? '—'}</Text></Text>
              <Text style={styles.row}>Pin: <Text style={styles.val}>{activePlan.markers.pin?.club_intent ?? '—'}</Text></Text>
              <Text style={styles.row}>Yardage: <Text style={styles.val}>{activePlan.computed_yardages.total ?? '—'}y</Text></Text>
            </>
          ) : (
            <Text style={styles.empty}>No plan for hole 1</Text>
          )}
        </View>

        {/* Actions */}
        <Text style={styles.section}>ACTIONS</Text>

        <TouchableOpacity style={styles.btn} onPress={handleMockPlan}>
          <Text style={styles.btnText}>+ Mock Plan (Hole 1)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={handleMockShots}>
          <Text style={styles.btnText}>+ Mock Shots + Score (Hole 1)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnGreen]}
          onPress={handleGenerateRecap}
          disabled={generating}
        >
          {generating
            ? <ActivityIndicator color="#060f09" />
            : <Text style={[styles.btnText, styles.btnTextDark]}>Generate Recap Now</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={handleListRecaps} disabled={listLoading}>
          <Text style={styles.btnText}>{listLoading ? 'Loading...' : 'List Archived Recaps'}</Text>
        </TouchableOpacity>

        {/* Archived recaps list */}
        {recaps.length > 0 && (
          <>
            <Text style={styles.section}>ARCHIVED RECAPS ({recaps.length})</Text>
            {recaps.map(r => (
              <TouchableOpacity
                key={r.round_id}
                style={styles.recapRow}
                onPress={() => router.push(('/recap/' + r.round_id) as never)}
              >
                <Text style={styles.recapCourse}>{r.course_name}</Text>
                <Text style={styles.recapMeta}>
                  {r.mode} · {r.total_score} · {r.hole_comparisons.length} holes
                </Text>
                <Text style={styles.recapDate}>
                  {new Date(r.ended_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 60 },
  section: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 16, marginBottom: 6 },
  card: {
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 12, gap: 4,
  },
  row: { color: '#9ca3af', fontSize: 13 },
  val: { color: '#ffffff', fontWeight: '700' },
  empty: { color: '#374151', fontSize: 13 },
  btn: {
    marginBottom: 8, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', backgroundColor: '#0d2418',
    alignItems: 'center',
  },
  btnGreen: { backgroundColor: '#00C896', borderColor: '#00C896' },
  btnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  btnTextDark: { color: '#060f09' },
  recapRow: {
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 12, marginBottom: 8,
  },
  recapCourse: { color: '#ffffff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  recapMeta: { color: '#9ca3af', fontSize: 12 },
  recapDate: { color: '#6b7280', fontSize: 11, marginTop: 2 },
});
