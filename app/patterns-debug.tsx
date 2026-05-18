import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRoundStore } from '../store/roundStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { generatePatternInsights } from '../services/patternDetection';
import { ROUND_MODE_LABELS } from '../types/patterns';
import type { PatternInsights } from '../types/patterns';
import type { ShotResult } from '../store/roundStore';
import { useDebugRouteGate } from '../hooks/useDebugRouteGate';

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeMockShots(
  count: number,
  direction: 'left' | 'straight' | 'right',
  feel: ShotResult['feel'] = 'solid',
): ShotResult[] {
  return Array.from({ length: count }, (_, i) => ({
    feel,
    direction,
    shape: direction === 'left' ? 'draw' : direction === 'right' ? 'fade' : 'straight',
    club: '7-iron',
    hole: 1,
    timestamp: Date.now() - i * 30_000,
    acousticContact: null,
  }));
}

function makeMixedShots(count: number): ShotResult[] {
  const dirs: ShotResult['direction'][] = ['left', 'straight', 'right', 'straight', 'left'];
  const feels: ShotResult['feel'][] = ['solid', 'flush', 'fat', 'solid', 'thin'];
  return Array.from({ length: count }, (_, i) => ({
    feel: feels[i % feels.length] ?? 'solid',
    direction: dirs[i % dirs.length] ?? 'straight',
    shape: 'straight',
    club: '7-iron',
    hole: (i % 9) + 1,
    timestamp: Date.now() - i * 30_000,
    acousticContact: null,
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatternsDebug() {
  const _gateAllowed = useDebugRouteGate();
  const router = useRouter();
  if (!_gateAllowed) return null;

  const {
    shots,
    logShot,
    mode,
    isRoundActive,
    scores,
    courseHoles,
  } = useRoundStore();

  const { handicap, dominantMiss } = usePlayerProfileStore();

  const [insights, setInsights] = useState<PatternInsights | null>(null);

  const handleGenerate = useCallback(() => {
    const result = generatePatternInsights(shots, {
      currentRoundMode: mode,
      scores,
      courseHoles,
      handicap,
      dominantMiss: dominantMiss as 'left' | 'right' | 'straight' | null,
    });
    setInsights(result);
  }, [shots, mode, scores, courseHoles, handicap, dominantMiss]);

  const handleAddMock = useCallback((
    direction: 'left' | 'straight' | 'right',
    count: number,
    feel?: ShotResult['feel'],
  ) => {
    const mockShots = makeMockShots(count, direction, feel);
    mockShots.forEach(s => logShot(s));
  }, [logShot]);

  const handleAddMixed = useCallback((count: number) => {
    makeMixedShots(count).forEach(s => logShot(s));
  }, [logShot]);

  const handleClearShots = useCallback(() => {
    Alert.alert(
      'Clear Shot History',
      `This removes all ${shots.length} logged shots from the current round. Cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            // Reset shots via store — use the internal set directly
            useRoundStore.setState({ shots: [] });
            setInsights(null);
          },
        },
      ],
    );
  }, [shots.length]);

  const rs = insights?.raw_stats;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Player Patterns Debug</Text>
        <TouchableOpacity style={styles.clearBtn} onPress={handleClearShots}>
          <Text style={styles.clearBtnText}>Clear shots</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Current round state */}
        <View style={styles.stateBox}>
          <Text style={styles.stateRow}>
            Round active: <Text style={styles.stateVal}>{isRoundActive ? 'YES' : 'no'}</Text>
            {'  '}Mode:{' '}
            <Text style={[styles.stateVal, isRoundActive && styles.stateValActive]}>
              {ROUND_MODE_LABELS[mode]}
            </Text>
          </Text>
          <Text style={styles.stateRow}>
            Shots logged: <Text style={styles.stateVal}>{shots.length}</Text>
            {'  '}Handicap: <Text style={styles.stateVal}>{handicap}</Text>
            {'  '}Miss: <Text style={styles.stateVal}>{dominantMiss ?? 'none'}</Text>
          </Text>
        </View>

        {/* Generate button */}
        <TouchableOpacity style={styles.generateBtn} onPress={handleGenerate}>
          <Text style={styles.generateBtnText}>Generate Insights Now</Text>
        </TouchableOpacity>

        {/* Mock shot history */}
        <Text style={styles.sectionTitle}>Mock Shot History</Text>
        <View style={styles.mockGrid}>
          <TouchableOpacity style={styles.mockBtn} onPress={() => handleAddMock('right', 5)}>
            <Text style={styles.mockBtnText}>+5 Right misses</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mockBtn} onPress={() => handleAddMock('left', 5)}>
            <Text style={styles.mockBtnText}>+5 Left misses</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mockBtn} onPress={() => handleAddMock('straight', 5, 'flush')}>
            <Text style={styles.mockBtnText}>+5 Straight (flush)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mockBtn} onPress={() => handleAddMixed(10)}>
            <Text style={styles.mockBtnText}>+10 Mixed</Text>
          </TouchableOpacity>
        </View>

        {/* Insights results */}
        {insights && (
          <>
            <Text style={styles.sectionTitle}>
              Insights ({insights.shot_count_analyzed} shots analyzed)
            </Text>

            {insights.insights.length === 0 ? (
              <Text style={styles.emptyInsights}>No insights — insufficient shot history.</Text>
            ) : (
              <View style={styles.insightList}>
                {insights.insights.map((line, i) => (
                  <View key={i} style={styles.insightRow}>
                    <Text style={styles.insightBullet}>›</Text>
                    <Text style={styles.insightText}>{line}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Raw Stats</Text>
            <View style={styles.rawBox}>
              <Text style={styles.rawRow}>
                Overall miss: <Text style={styles.rawVal}>{rs?.miss_tendency_overall}</Text>
              </Text>
              <Text style={styles.rawRow}>
                Under pressure: <Text style={styles.rawVal}>{rs?.miss_tendency_under_pressure}</Text>
              </Text>
              <Text style={styles.rawRow}>
                Streak:{' '}
                <Text style={[
                  styles.rawVal,
                  rs?.streak.type === 'good' && styles.streakGood,
                  rs?.streak.type === 'rough' && styles.streakRough,
                ]}>
                  {rs?.streak.type} ({rs?.streak.length})
                </Text>
              </Text>
              <Text style={styles.rawRow}>
                Last 5 — L:{rs?.last_5_shots_breakdown.left}{' '}
                S:{rs?.last_5_shots_breakdown.straight}{' '}
                R:{rs?.last_5_shots_breakdown.right}
              </Text>
              <Text style={styles.rawRow}>
                Last 10 — L:{rs?.last_10_shots_breakdown.left}{' '}
                S:{rs?.last_10_shots_breakdown.straight}{' '}
                R:{rs?.last_10_shots_breakdown.right}
              </Text>
              {(rs?.strengths.length ?? 0) > 0 && (
                <Text style={styles.rawRow}>
                  Strengths: <Text style={styles.rawVal}>{rs?.strengths.join(', ')}</Text>
                </Text>
              )}
              <Text style={styles.generatedAt}>
                Generated: {new Date(insights.generated_at).toLocaleTimeString()}
              </Text>
            </View>
          </>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  backBtn: { paddingRight: 12 },
  backBtnText: { color: '#00C896', fontSize: 17 },
  headerTitle: { flex: 1, color: '#e8f5e9', fontSize: 17, fontWeight: '700' },
  clearBtn: {
    backgroundColor: '#1a0505',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#ef444444',
  },
  clearBtnText: { color: '#ef4444', fontSize: 11, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  stateBox: {
    backgroundColor: '#0a1e12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 12,
    gap: 4,
    marginBottom: 16,
  },
  stateRow: { color: '#6b7280', fontSize: 12 },
  stateVal: { color: '#a3b8a8', fontWeight: '600' },
  stateValActive: { color: '#00C896' },
  generateBtn: {
    backgroundColor: '#00C896',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  generateBtnText: { color: '#060f09', fontSize: 15, fontWeight: '800' },
  sectionTitle: {
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  mockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  mockBtn: {
    backgroundColor: '#0d2b1c',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#00C89633',
  },
  mockBtnText: { color: '#00C896', fontSize: 12, fontWeight: '600' },
  emptyInsights: { color: '#4b5563', fontSize: 13, fontStyle: 'italic', marginBottom: 12 },
  insightList: {
    backgroundColor: '#0a1e12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00C89633',
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  insightRow: { flexDirection: 'row', gap: 8 },
  insightBullet: { color: '#00C896', fontSize: 14, lineHeight: 20 },
  insightText: { flex: 1, color: '#e8f5e9', fontSize: 13, lineHeight: 20 },
  rawBox: {
    backgroundColor: '#0a1e12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 12,
    gap: 6,
    marginBottom: 16,
  },
  rawRow: { color: '#6b7280', fontSize: 12 },
  rawVal: { color: '#a3b8a8', fontWeight: '600' },
  streakGood: { color: '#00C896' },
  streakRough: { color: '#ef4444' },
  generatedAt: { color: '#4b5563', fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  bottomPad: { height: 40 },
});
