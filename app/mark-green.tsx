/**
 * Mark Green — capture real green-center coordinates for the active hole.
 *
 * Why this exists: data/courses.ts ships courses we haven't fully
 * geometry-coded (Sunnyvale, SJ Muni) with zero coords for green
 * front/middle/back. If golfcourseapi doesn't return geometry for the
 * course either, the F/M/B yardage strip falls through to the static
 * scorecard distance — what Tim saw at Sunnyvale yesterday.
 *
 * This tool lets the user walk to the center of the green and tap a
 * button. The captured GPS fix is persisted per (courseId, hole) in
 * services/courseGreenOverrides and consumed first by smartFinderService
 * for all subsequent yardage calculations on that hole. One-time setup
 * per hole; persists across rounds.
 *
 * Reachable from Tools menu and Settings → Owner Tools (so any tester
 * who wants to use the app on a course we haven't pre-mapped has an
 * out).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useDebugRouteGate } from '../hooks/useDebugRouteGate';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useRoundStore } from '../store/roundStore';
import {
  getOneShotFix,
  subscribe as subscribeGps,
  type GpsFix,
} from '../services/gpsManager';
import {
  setGreenOverride,
  clearGreenOverride,
  useGreenOverride,
  listOverridesForCourse,
} from '../services/courseGreenOverrides';
import { useToastStore } from '../store/toastStore';
import * as Haptics from 'expo-haptics';

function formatAge(ms: number): string {
  if (ms < 1000) return '<1s ago';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  return new Date(Date.now() - ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function MarkGreenScreen() {
  // 2026-05-17 — Owner+__DEV__ gate. OSM auto-detect now handles
  // most courses; Mark Green is the fallback when OSM is wrong or
  // missing. Kept reachable for owner accounts (Settings → Owner
  // Tools row, GlobalToolsMenu row) but no longer deep-linkable by
  // arbitrary users.
  const _gateAllowed = useDebugRouteGate();
  const router = useRouter();
  const { colors } = useTheme();
  if (!_gateAllowed) return null;
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const activeCourse = useRoundStore(s => s.activeCourse);
  const currentHole = useRoundStore(s => s.currentHole);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const setCurrentHole = useRoundStore(s => s.setCurrentHole);
  const isRoundActive = useRoundStore(s => s.isRoundActive);

  const [fix, setFix] = useState<GpsFix | null>(null);
  const [marking, setMarking] = useState(false);
  const courseId = activeCourseId ?? null;
  const override = useGreenOverride(courseId, currentHole);
  const [overrideList, setOverrideList] = useState(() => courseId ? listOverridesForCourse(courseId) : []);

  useEffect(() => {
    if (!courseId) return;
    setOverrideList(listOverridesForCourse(courseId));
  }, [courseId, override]);

  useEffect(() => {
    let cancelled = false;
    void getOneShotFix({ maxAgeMs: 0 }).then((f) => { if (!cancelled) setFix(f); });
    const unsub = subscribeGps((f) => setFix(f));
    return () => { cancelled = true; unsub(); };
  }, []);

  const totalHoles = courseHoles.length || 18;

  const onMark = useCallback(async () => {
    if (!courseId) {
      Alert.alert('Start a round first', 'Mark Green needs an active course to know where to file the coordinates.');
      return;
    }
    if (marking) return;
    setMarking(true);
    try {
      // Force a fresh fix so the marked point is the user's CURRENT
      // position, not a stale cache.
      const fresh = await getOneShotFix({ maxAgeMs: 0 });
      if (!fresh) {
        Alert.alert('GPS unavailable', 'Step into open sky and try again.');
        return;
      }
      await setGreenOverride(courseId, currentHole, { lat: fresh.lat, lng: fresh.lng });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      useToastStore.getState().show(`Green marked: hole ${currentHole}`);
    } finally {
      setMarking(false);
    }
  }, [courseId, currentHole, marking]);

  const onClear = useCallback(async () => {
    if (!courseId) return;
    await clearGreenOverride(courseId, currentHole);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    useToastStore.getState().show(`Cleared: hole ${currentHole}`);
  }, [courseId, currentHole]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Mark Green</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.hint, { color: colors.text_muted }]}>
          Walk to the CENTER of the green. Tap "Mark green center". Your GPS position becomes this hole's middle coordinate for all future rounds at this course.
        </Text>

        {!isRoundActive && (
          <View style={[styles.warningCard, { backgroundColor: colors.surface, borderColor: '#F5A623' }]}>
            <Text style={[styles.warningText, { color: colors.text_primary }]}>
              No round active. Start a round first so Mark Green knows which course + hole to file.
            </Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>COURSE</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardValue, { color: colors.text_primary }]}>{activeCourse ?? '— not in a round —'}</Text>
          <Text style={[styles.cardSub, { color: colors.text_muted }]}>{courseId ?? '—'}</Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 18 }]}>HOLE</Text>
        <View style={[styles.holePicker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => setCurrentHole(Math.max(1, currentHole - 1))}
            disabled={currentHole <= 1}
            style={[styles.holeStep, { opacity: currentHole <= 1 ? 0.3 : 1 }]}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={22} color={colors.accent} />
          </TouchableOpacity>
          <Text style={[styles.holeNumber, { color: colors.text_primary }]}>{currentHole}</Text>
          <TouchableOpacity
            onPress={() => setCurrentHole(Math.min(totalHoles, currentHole + 1))}
            disabled={currentHole >= totalHoles}
            style={[styles.holeStep, { opacity: currentHole >= totalHoles ? 0.3 : 1 }]}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-forward" size={22} color={colors.accent} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 18 }]}>YOUR POSITION</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {fix == null ? (
            <Text style={[styles.cardSub, { color: colors.text_muted }]}>Waiting for GPS…</Text>
          ) : (
            <>
              <Text style={[styles.cardValue, { color: colors.text_primary }]}>
                {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)}
              </Text>
              <Text style={[styles.cardSub, { color: colors.text_muted }]}>
                {fix.accuracy_m != null ? `±${fix.accuracy_m.toFixed(1)}m` : 'accuracy unknown'}
                {' · '}
                {formatAge(Date.now() - fix.timestamp)}
              </Text>
            </>
          )}
        </View>

        <TouchableOpacity
          onPress={onMark}
          disabled={marking || !courseId || !fix}
          style={[
            styles.markBtn,
            { backgroundColor: colors.accent, opacity: (marking || !courseId || !fix) ? 0.5 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Mark green center at current position"
        >
          <Ionicons name="flag" size={20} color="#000" style={{ marginRight: 8 }} />
          <Text style={styles.markBtnText}>
            {marking ? 'Marking…' : `Mark green center for hole ${currentHole}`}
          </Text>
        </TouchableOpacity>

        {override && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 18 }]}>CURRENT MARK</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
              <Text style={[styles.cardValue, { color: colors.accent }]}>
                {override.lat.toFixed(6)}, {override.lng.toFixed(6)}
              </Text>
              <Text style={[styles.cardSub, { color: colors.text_muted }]}>
                Marked {formatAge(Date.now() - override.markedAt)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClear}
              style={[styles.clearBtn, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Clear mark for this hole"
            >
              <Ionicons name="trash-outline" size={16} color="#ef4444" style={{ marginRight: 6 }} />
              <Text style={styles.clearBtnText}>Clear mark for hole {currentHole}</Text>
            </TouchableOpacity>
          </>
        )}

        {courseId && overrideList.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 18 }]}>
              ALL MARKS THIS COURSE ({overrideList.length})
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {overrideList.map(({ hole, override: ov }) => (
                <View key={hole} style={styles.listRow}>
                  <Text style={[styles.listHole, { color: colors.text_primary }]}>Hole {hole}</Text>
                  <Text style={[styles.listCoords, { color: colors.text_muted }]}>
                    {ov.lat.toFixed(5)}, {ov.lng.toFixed(5)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  body: { padding: 16 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  warningCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  warningText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardValue: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2, fontVariant: ['tabular-nums'] },
  cardSub: { fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  holePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  holeStep: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holeNumber: { fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  markBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  markBtnText: { color: '#000', fontSize: 15, fontWeight: '900', letterSpacing: 0.3 },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    alignSelf: 'center',
  },
  clearBtnText: { color: '#ef4444', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  listHole: { fontSize: 13, fontWeight: '700' },
  listCoords: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
