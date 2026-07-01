/**
 * 2026-07-01 (Tim — "you can also see the course layout" — show the whole course at a glance, his
 * home course especially). A digital scorecard: every hole's par + yardage with front-9 / back-9 /
 * total summaries. Works for ANY course — bundled `local:`, API, or a `custom:` course added from a
 * scorecard photo — via the same getBundledHoles → active-round → API resolution the rest of the
 * app uses. Reached from the Play tab's selected course.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import AppIcon from '../components/AppIcon';
import { getBundledHoles } from '../data/courses';
import { getCourse as getApiCourse, courseToHoles } from '../services/golfCourseApi';
import { useRoundStore, type CourseHole } from '../store/roundStore';

function sumPar(holes: CourseHole[]): number { return holes.reduce((s, h) => s + (h.par || 0), 0); }
function sumYds(holes: CourseHole[]): number { return holes.reduce((s, h) => s + (h.distance > 0 ? h.distance : 0), 0); }

export default function CourseLayoutScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ courseId?: string; name?: string }>();
  const rs = useRoundStore.getState();
  const courseId = params.courseId ?? rs.previewCourseId ?? rs.activeCourseId ?? null;

  const [holes, setHoles] = useState<CourseHole[]>([]);
  const [loading, setLoading] = useState(true);
  const [courseName, setCourseName] = useState<string>(params.name ?? 'Course layout');

  useEffect(() => {
    if (!courseId) { setLoading(false); return; }
    let alive = true;
    (async () => {
      // 1) Bundled (local:) or custom: scorecard course — synchronous.
      const bundled = getBundledHoles(courseId);
      if (bundled.length > 0) { if (alive) { setHoles(bundled); setLoading(false); } return; }
      // 2) The active/preview round already has holes loaded.
      const store = useRoundStore.getState();
      if (store.courseHoles.length > 0 && (store.activeCourseId === courseId || store.previewCourseId === courseId)) {
        if (alive) { setHoles(store.courseHoles); setLoading(false); }
        return;
      }
      // 3) API course — fetch + convert.
      try {
        const c = await getApiCourse(courseId);
        if (alive && c) { setHoles(courseToHoles(c)); setCourseName((n) => (params.name ? n : c.club_name)); }
      } catch { /* leave empty */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [courseId, params.name]);

  const sorted = useMemo(() => [...holes].sort((a, b) => a.hole - b.hole), [holes]);
  const front = useMemo(() => sorted.filter((h) => h.hole <= 9), [sorted]);
  const back = useMemo(() => sorted.filter((h) => h.hole >= 10), [sorted]);
  const hasYards = sorted.some((h) => h.distance > 0);

  const renderRows = (list: CourseHole[]) => list.map((h) => (
    <View key={h.hole} style={[styles.row, { borderColor: colors.border }]}>
      <Text style={[styles.cell, styles.cHole, { color: colors.text_primary }]}>{h.hole}</Text>
      <Text style={[styles.cell, styles.cPar, { color: colors.text_primary }]}>{h.par || '—'}</Text>
      <Text style={[styles.cell, styles.cYds, { color: colors.text_secondary }]}>{h.distance > 0 ? h.distance : '—'}</Text>
    </View>
  ));

  const summary = (label: string, list: CourseHole[]) => (
    <View style={[styles.row, styles.summaryRow, { borderColor: colors.accent }]}>
      <Text style={[styles.cell, styles.cHole, styles.summaryText, { color: colors.accent }]}>{label}</Text>
      <Text style={[styles.cell, styles.cPar, styles.summaryText, { color: colors.accent }]}>{sumPar(list) || '—'}</Text>
      <Text style={[styles.cell, styles.cYds, styles.summaryText, { color: colors.accent }]}>{hasYards ? sumYds(list) : '—'}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <AppIcon name="chevron-back" size={26} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]} numberOfLines={1}>{courseName}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : sorted.length === 0 ? (
        <View style={styles.center}>
          <AppIcon name="map-outline" size={40} color={colors.text_secondary} />
          <Text style={[styles.empty, { color: colors.text_secondary }]}>No hole data for this course yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={[styles.headRow, { borderColor: colors.border }]}>
            <Text style={[styles.cellH, styles.cHole, { color: colors.text_secondary }]}>HOLE</Text>
            <Text style={[styles.cellH, styles.cPar, { color: colors.text_secondary }]}>PAR</Text>
            <Text style={[styles.cellH, styles.cYds, { color: colors.text_secondary }]}>YARDS</Text>
          </View>
          {renderRows(front)}
          {front.length > 0 && summary('OUT', front)}
          {back.length > 0 && renderRows(back)}
          {back.length > 0 && summary('IN', back)}
          {summary('TOTAL', sorted)}
          {!hasYards && (
            <Text style={[styles.note, { color: colors.text_secondary }]}>
              Yardages fill in from the scorecard or GPS once available.
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  empty: { fontSize: 15, textAlign: 'center' },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 11 },
  summaryRow: { borderBottomWidth: 1.5, borderTopWidth: 1.5 },
  cell: { fontSize: 16 },
  cellH: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cHole: { flex: 1 },
  cPar: { flex: 1, textAlign: 'center' },
  cYds: { flex: 1, textAlign: 'right' },
  summaryText: { fontWeight: '800' },
  note: { fontSize: 12, marginTop: 14, textAlign: 'center', fontStyle: 'italic' },
});
