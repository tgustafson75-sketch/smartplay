import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { searchCourses, getCourse, clearCourseCache } from '../services/golfCourseApi';
import type { Course } from '../types/course';
import { useDebugRouteGate } from '../hooks/useDebugRouteGate';

const BATTERY_TESTS = [
  {
    key: 'briefing',
    label: 'Pre-round briefing',
    endpoint: '/api/briefing',
    payload: {
      courseName: 'Pebble Beach', mode: 'break_90', playerName: 'Tim',
      handicap: 14, goal: 'Break 90', dominantMiss: 'right',
      patternInsights: ['Tending right off the tee under pressure', 'Short game improving'],
      ghostLabel: 'Past You — 93', roundsTogether: 8,
    },
    responseKey: 'brief',
  },
  {
    key: 'commentary',
    label: 'Live hole commentary',
    endpoint: '/api/kevin',
    payload: {
      message: "What's the play here?",
      firstName: 'Tim', handicap: 14, roundsTogether: 8,
      activeCourse: 'Pebble Beach', currentHole: 7, currentPar: 3, currentYardage: 107,
      isRoundActive: true, mentalState: 'neutral', roundMode: 'break_90',
      patternInsights: { insights: ['Tending right under pressure'] },
    },
    responseKey: 'text',
  },
  {
    key: 'recap',
    label: 'Round recap summary',
    endpoint: '/api/recap',
    payload: {
      player_name: 'Tim', course_name: 'Pebble Beach', mode: 'break_90',
      total_score: 92, score_vs_par: 20, holes_played: 18,
      holes: [
        { hole_number: 7, par: 3, score: 4, plan_summary: '8-iron to center', shots_summary: 'shot 1: 8-iron thin right', variance: 1 },
        { hole_number: 18, par: 5, score: 6, plan_summary: '3-wood, 9-iron approach', shots_summary: 'shot 1: 3-wood straight, shot 2: 9-iron left', variance: 1 },
      ],
      pattern_insights: ['Tending right off the tee'],
    },
    responseKey: 'overall_summary',
  },
  {
    key: 'preround',
    label: 'Pre-round brief (legacy)',
    endpoint: '/api/preround',
    payload: {
      firstName: 'Tim', courseName: 'Pebble Beach', totalPar: 72,
      courseRating: '74.7', courseSlope: '145', handicap: 14,
      roundsTogether: 8, sessionsTogether: 3,
      goal: 'Break 90', dominantMiss: 'right',
    },
    responseKey: 'brief',
  },
];

export default function ApiDebug() {
  const _gateAllowed = useDebugRouteGate();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; club_name: string; course_name: string; location: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [detailId, setDetailId] = useState('');
  const [detailResult, setDetailResult] = useState<Course | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [batteryResults, setBatteryResults] = useState<Record<string, string>>({});
  const [batteryLoading, setBatteryLoading] = useState<Record<string, boolean>>({});

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  const runBatteryTest = async (test: typeof BATTERY_TESTS[0]) => {
    setBatteryLoading(prev => ({ ...prev, [test.key]: true }));
    setBatteryResults(prev => ({ ...prev, [test.key]: '' }));
    try {
      const res = await fetch(apiUrl + test.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(test.payload),
      });
      const data = await res.json() as Record<string, unknown>;
      const result = String(data[test.responseKey] ?? JSON.stringify(data));
      setBatteryResults(prev => ({ ...prev, [test.key]: result }));
    } catch (e) {
      setBatteryResults(prev => ({ ...prev, [test.key]: 'Error: ' + (e instanceof Error ? e.message : String(e)) }));
    } finally {
      setBatteryLoading(prev => ({ ...prev, [test.key]: false }));
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchResults([]);
    const results = await searchCourses(searchQuery.trim());
    setSearchResults(results);
    setSearchLoading(false);
  };

  const handleDetail = async () => {
    const id = detailId.trim();
    if (!id) return;
    setDetailLoading(true);
    setDetailResult(null);
    setDetailError('');
    try {
      const course = await getCourse(id);
      if (course) {
        setDetailResult(course);
      } else {
        setDetailError(`No course found for id: ${id}`);
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Unknown error');
    }
    setDetailLoading(false);
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Course Cache',
      'Delete all locally cached course data?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearCourseCache();
            Alert.alert('Done', 'Course cache cleared.');
          },
        },
      ],
    );
  };

  // 2026-05-17 — gate check AFTER all hooks (Rules of Hooks)
  if (!_gateAllowed) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Course API Debug</Text>
        <TouchableOpacity style={styles.clearCacheBtn} onPress={handleClearCache}>
          <Text style={styles.clearCacheBtnText}>Clear cache</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Search */}
        <Text style={styles.sectionTitle}>Search Courses</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="e.g. Pebble Beach"
            placeholderTextColor="#4b5563"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            autoCapitalize="words"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.runBtn} onPress={handleSearch} disabled={searchLoading}>
            {searchLoading
              ? <ActivityIndicator size="small" color="#060f09" />
              : <Text style={styles.runBtnText}>Search</Text>
            }
          </TouchableOpacity>
        </View>

        {searchResults.length > 0 && (
          <View style={styles.resultBox}>
            {searchResults.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.resultRow}
                onPress={() => { setDetailId(r.id); }}
              >
                <Text style={styles.resultName}>{r.club_name}</Text>
                <Text style={styles.resultSub}>{r.location}  ·  id: {r.id}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.hint}>Tap a result to auto-fill the detail lookup below.</Text>
          </View>
        )}

        {/* Detail */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Course Detail</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Course ID"
            placeholderTextColor="#4b5563"
            value={detailId}
            onChangeText={setDetailId}
            returnKeyType="done"
            onSubmitEditing={handleDetail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="default"
          />
          <TouchableOpacity style={styles.runBtn} onPress={handleDetail} disabled={detailLoading}>
            {detailLoading
              ? <ActivityIndicator size="small" color="#060f09" />
              : <Text style={styles.runBtnText}>Fetch</Text>
            }
          </TouchableOpacity>
        </View>

        {detailError ? (
          <Text style={styles.errorText}>{detailError}</Text>
        ) : null}

        {detailResult && (
          <View style={styles.detailBox}>
            <Text style={styles.detailTitle}>{detailResult.club_name}</Text>
            <Text style={styles.detailMeta}>
              {detailResult.course_name}  ·  {detailResult.location.city}, {detailResult.location.state}
            </Text>
            <Text style={styles.detailMeta}>ID: {detailResult.id}  ·  Cached: {new Date(detailResult.cached_at).toLocaleString()}</Text>
            <Text style={styles.detailMeta}>{detailResult.tees.length} tee(s) available</Text>

            {detailResult.tees.map((tee) => (
              <View key={tee.tee_name} style={styles.teeBox}>
                <Text style={styles.teeName}>
                  {tee.tee_name}  {tee.total_yards}yds  par{tee.par_total}
                  {tee.course_rating ? `  rating ${tee.course_rating}/${tee.slope_rating}` : ''}
                </Text>
                <Text style={styles.holeList}>
                  {tee.holes.map(h => `H${h.hole_number}:p${h.par}/${h.yardage}y`).join('  ')}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── CHARACTER BATTERY ──────────── */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Character Battery</Text>
        <Text style={styles.batterySubtitle}>
          Tap each to generate Kevin speech and ear-test consistency.
        </Text>

        {BATTERY_TESTS.map(test => (
          <View key={test.key} style={styles.batteryCard}>
            <View style={styles.batteryHeader}>
              <Text style={styles.batteryLabel}>{test.label}</Text>
              <TouchableOpacity
                style={[styles.runBtn, { minWidth: 56 }]}
                onPress={() => runBatteryTest(test)}
                disabled={batteryLoading[test.key]}
              >
                {batteryLoading[test.key]
                  ? <ActivityIndicator size="small" color="#060f09" />
                  : <Text style={styles.runBtnText}>Run</Text>
                }
              </TouchableOpacity>
            </View>
            {batteryResults[test.key] ? (
              <Text style={styles.batteryResult}>{batteryResults[test.key]}</Text>
            ) : null}
          </View>
        ))}

        {/* SmartFinder Debug link */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Tools</Text>
        <TouchableOpacity
          style={styles.batteryCard}
          onPress={() => router.push('/smartfinder-debug' as never)}
        >
          <Text style={styles.batteryLabel}>SmartFinder Debug →</Text>
          <Text style={styles.batteryResult}>GPS sensors, mock locks, confidence testing</Text>
        </TouchableOpacity>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

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
  clearCacheBtn: {
    backgroundColor: '#1a0505',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#ef444444',
  },
  clearCacheBtnText: { color: '#ef4444', fontSize: 11, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  sectionTitle: { color: '#e8f5e9', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  input: {
    backgroundColor: '#0a1e12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    color: '#e8f5e9',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  runBtn: {
    backgroundColor: '#00C896',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 70,
  },
  runBtnText: { color: '#060f09', fontSize: 13, fontWeight: '700' },
  resultBox: {
    backgroundColor: '#0a1e12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    overflow: 'hidden',
    marginBottom: 4,
  },
  resultRow: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  resultName: { color: '#e8f5e9', fontSize: 13, fontWeight: '600' },
  resultSub: { color: '#6b7280', fontSize: 11, marginTop: 1 },
  hint: { color: '#4b5563', fontSize: 10, padding: 8, fontStyle: 'italic' },
  errorText: { color: '#ef4444', fontSize: 12, marginBottom: 8 },
  detailBox: {
    backgroundColor: '#0a1e12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00C89633',
    padding: 14,
    gap: 4,
  },
  detailTitle: { color: '#e8f5e9', fontSize: 15, fontWeight: '700' },
  detailMeta: { color: '#6b7280', fontSize: 12 },
  teeBox: {
    marginTop: 8,
    backgroundColor: '#0d2b1c',
    borderRadius: 8,
    padding: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: '#00C89622',
  },
  teeName: { color: '#00C896', fontSize: 12, fontWeight: '700' },
  holeList: { color: '#a3b8a8', fontSize: 11, lineHeight: 17 },
  bottomPad: { height: 40 },
  batterySubtitle: { color: '#4b5563', fontSize: 11, marginBottom: 12, fontStyle: 'italic' },
  batteryCard: {
    backgroundColor: '#0a1e12', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 12, marginBottom: 10,
  },
  batteryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  batteryLabel: { color: '#e8f5e9', fontSize: 13, fontWeight: '600', flex: 1, marginRight: 8 },
  batteryResult: { color: '#9ca3af', fontSize: 12, lineHeight: 19, marginTop: 10, fontStyle: 'italic' },
});
