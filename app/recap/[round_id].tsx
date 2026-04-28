import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { loadRecap } from '../../services/planStorage';
import { speak, stopSpeaking, isSpeaking } from '../../services/voiceService';
import { useSettingsStore } from '../../store/settingsStore';
import type { RoundRecap, HoleComparison } from '../../types/plan';

const MODE_LABELS: Record<string, string> = {
  break_100: 'Break 100',
  break_90: 'Break 90',
  break_80: 'Break 80',
  free_play: 'Free Play',
};

function varianceLabel(v: number | null): string {
  if (v == null) return '';
  if (v === 0) return 'Even';
  return v > 0 ? '+' + v : String(v);
}

function varianceColor(v: number | null): string {
  if (v == null) return '#6b7280';
  if (v <= 0) return '#00C896';
  if (v === 1) return '#F5A623';
  return '#ef4444';
}

function HoleCard({ hc }: { hc: HoleComparison }) {
  const v = hc.variance;
  const hasScore = hc.actual_score != null;
  return (
    <View style={styles.holeCard}>
      <View style={styles.holeCardHeader}>
        <Text style={styles.holeNum}>Hole {hc.hole_number}</Text>
        {hasScore && (
          <View style={[styles.variancePill, { backgroundColor: varianceColor(v) + '22', borderColor: varianceColor(v) }]}>
            <Text style={[styles.variancePillText, { color: varianceColor(v) }]}>
              {hc.actual_score} {v != null ? '(' + varianceLabel(v) + ' plan)' : ''}
            </Text>
          </View>
        )}
      </View>
      {hc.plan && (
        <Text style={styles.planLine}>
          Plan: {hc.plan.markers.tee.club_intent ?? '—'}
          {hc.plan.markers.approach?.club_intent ? ' → ' + hc.plan.markers.approach.club_intent : ''}
          {hc.plan.markers.pin?.club_intent ? ' → ' + hc.plan.markers.pin.club_intent : ''}
        </Text>
      )}
      {hc.kevin_summary ? (
        <Text style={styles.kevinSummary}>{hc.kevin_summary}</Text>
      ) : (
        <Text style={styles.noSummary}>No summary</Text>
      )}
    </View>
  );
}

export default function RecapScreen() {
  const { round_id } = useLocalSearchParams<{ round_id: string }>();
  const router = useRouter();
  const { voiceGender, voiceEnabled } = useSettingsStore();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  const [recap, setRecap] = useState<RoundRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!round_id) return;
    loadRecap(round_id).then(r => {
      setRecap(r);
      setLoading(false);
    });
  }, [round_id]);

  const handlePlayAloud = useCallback(async () => {
    if (!recap) return;
    if (isSpeaking()) {
      await stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (!voiceEnabled) return;
    setSpeaking(true);
    try {
      const text = recap.overall_kevin_summary ?? '';
      if (!text) return;
      await speak(text, voiceGender, 'en', apiUrl);
    } finally {
      setSpeaking(false);
    }
  }, [recap, voiceGender, voiceEnabled, apiUrl]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#00C896" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!recap) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.emptyText}>Recap not found.</Text>
      </SafeAreaView>
    );
  }

  const scoreVsPar = recap.total_score - (recap.hole_comparisons.reduce((acc, hc) => {
    const par = hc.plan ? 4 : 4; // best we have without storing par separately
    return acc + par;
  }, 0));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Round Recap</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={recap.hole_comparisons}
        keyExtractor={hc => String(hc.hole_number)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* Summary card */}
            <View style={styles.summaryCard}>
              <Text style={styles.courseName}>{recap.course_name}</Text>
              <Text style={styles.modeLabel}>{MODE_LABELS[recap.mode] ?? recap.mode}</Text>
              <View style={styles.scoreRow}>
                <View style={styles.scoreItem}>
                  <Text style={styles.scoreLabel}>SCORE</Text>
                  <Text style={styles.scoreValue}>{recap.total_score}</Text>
                </View>
                {recap.total_planned_score != null && (
                  <View style={styles.scoreItem}>
                    <Text style={styles.scoreLabel}>PLANNED</Text>
                    <Text style={styles.scoreValue}>{recap.total_planned_score}</Text>
                  </View>
                )}
                <View style={styles.scoreItem}>
                  <Text style={styles.scoreLabel}>HOLES</Text>
                  <Text style={styles.scoreValue}>{recap.hole_comparisons.length}</Text>
                </View>
              </View>
            </View>

            {/* Kevin overall summary */}
            <View style={styles.kevinCard}>
              <Text style={styles.kevinLabel}>KEVIN</Text>
              <Text style={styles.kevinOverall}>{recap.overall_kevin_summary}</Text>
              {voiceEnabled && (
                <TouchableOpacity style={styles.playBtn} onPress={handlePlayAloud}>
                  <Text style={styles.playBtnText}>{speaking ? 'Stop' : '▶ Play aloud'}</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.holesHeader}>HOLE BY HOLE</Text>
          </View>
        }
        renderItem={({ item }) => <HoleCard hc={item} />}
      />
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
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  listContent: { paddingBottom: 48 },
  emptyText: { color: '#6b7280', textAlign: 'center', marginTop: 80, fontSize: 16 },
  // Summary card
  summaryCard: {
    marginHorizontal: 12, marginBottom: 12,
    backgroundColor: '#0d2418', borderRadius: 14,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 16,
  },
  courseName: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 2 },
  modeLabel: { color: '#00C896', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 },
  scoreRow: { flexDirection: 'row', gap: 24 },
  scoreItem: { alignItems: 'center' },
  scoreLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  scoreValue: { color: '#ffffff', fontSize: 28, fontWeight: '900' },
  // Kevin card
  kevinCard: {
    marginHorizontal: 12, marginBottom: 16,
    backgroundColor: '#0d2418', borderLeftWidth: 3, borderLeftColor: '#00C896',
    borderRadius: 8, padding: 14,
  },
  kevinLabel: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  kevinOverall: { color: '#ffffff', fontSize: 15, lineHeight: 22 },
  playBtn: {
    marginTop: 10, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: '#00C896', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  playBtnText: { color: '#00C896', fontSize: 13, fontWeight: '600' },
  holesHeader: {
    color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 2,
    marginHorizontal: 16, marginBottom: 8,
  },
  // Hole card
  holeCard: {
    marginHorizontal: 12, marginBottom: 8,
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12,
  },
  holeCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  holeNum: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  variancePill: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  variancePillText: { fontSize: 12, fontWeight: '700' },
  planLine: { color: '#6b7280', fontSize: 11, marginBottom: 6 },
  kevinSummary: { color: '#e5e7eb', fontSize: 13, lineHeight: 19 },
  noSummary: { color: '#374151', fontSize: 12, fontStyle: 'italic' },
});
