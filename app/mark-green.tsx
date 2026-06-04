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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useRoundStore } from '../store/roundStore';
import { getCourseHoleCount } from '../data/courses';
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
// 2026-05-25 — Fix J: unified screen also handles Tee marks. Tee
// override imports load lazily to keep the existing Mark Green
// surface unchanged when mode='green' (the default).
import {
  setTeeOverride,
  clearTeeOverride,
  useTeeOverride,
} from '../services/courseTeeOverrides';
import { useToastStore } from '../store/toastStore';
import * as Haptics from 'expo-haptics';

// 2026-05-25 — Fix J: unified Mark screen mode. 'green' is the
// original Mark Green surface (clean, tested); 'tee' uses the same
// UX flow + GPS capture but writes to the tee override store. URL
// param `mode=tee` flips it; `/mark-tee` route forwards into this
// screen with that param.
type MarkMode = 'green' | 'tee';

function formatAge(ms: number): string {
  if (ms < 1000) return '<1s ago';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  return new Date(Date.now() - ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function MarkPositionScreen() {
  // 2026-05-17 — Owner+__DEV__ gate. OSM auto-detect now handles
  // most courses; Mark Green is the fallback when OSM is wrong or
  // missing. Kept reachable for owner accounts (Settings → Owner
  // Tools row, GlobalToolsMenu row) but no longer deep-linkable by
  // arbitrary users.
  //
  // CRITICAL — all hooks must run on every render so React's
  // Rules of Hooks aren't violated. The previous arrangement
  // (early `return null` between hook calls) crashed with
  // "Rendered fewer hooks than expected" when the gate's allowed
  // flag flipped mid-lifecycle (e.g. owner email hydrating async
  // after first render). All hooks now run first; the gate-deny
  // branch renders an empty View from the JSX body.
  const _gateAllowed = useDebugRouteGate();
  const router = useRouter();
  const { colors } = useTheme();
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const activeCourse = useRoundStore(s => s.activeCourse);
  const currentHole = useRoundStore(s => s.currentHole);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const setCurrentHole = useRoundStore(s => s.setCurrentHole);
  const isRoundActive = useRoundStore(s => s.isRoundActive);

  // 2026-05-25 — Fix J: read URL mode + render a toggle so the user
  // can switch tee/green within the screen. Initial value comes from
  // ?mode= so deep-links (voice "mark the tee" → /mark-green?mode=tee)
  // open straight to the right mode.
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const initialMode: MarkMode = modeParam === 'tee' ? 'tee' : 'green';
  const [mode, setMode] = useState<MarkMode>(initialMode);
  const isTeeMode = mode === 'tee';
  // 2026-05-26 — Screen header always reads "Mark Location" (the
  // canonical entry name Tim sees in Owner Tools + the global Tools
  // menu). The TEE/GREEN toggle below disambiguates which target the
  // current capture writes to. labelTarget still drives the body copy
  // ("Walk to the green center…") so the instructions stay precise.
  const labelTitle = 'Mark Location';
  const labelTarget = isTeeMode ? 'tee' : 'green';

  const [fix, setFix] = useState<GpsFix | null>(null);
  const [marking, setMarking] = useState(false);
  const courseId = activeCourseId ?? null;
  // Both override hooks always run (Rules of Hooks); we just pick which
  // one's value to render below based on mode.
  const greenOverride = useGreenOverride(courseId, currentHole);
  const teeOverride = useTeeOverride(courseId, currentHole);
  const override = isTeeMode ? teeOverride : greenOverride;
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

  // 2026-06-04 — Bundled hole count wins for known local courses (9-hole
  // executive courses like Echo Hills + Mariners Point shouldn't allow
  // navigating past hole 9).
  const totalHoles = getCourseHoleCount(courseId, courseHoles.length);

  const onMark = useCallback(async () => {
    if (!courseId) {
      Alert.alert('Start a round first', `${labelTitle} needs an active course to know where to file the coordinates.`);
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
      if (isTeeMode) {
        await setTeeOverride(courseId, currentHole, { lat: fresh.lat, lng: fresh.lng });
      } else {
        await setGreenOverride(courseId, currentHole, { lat: fresh.lat, lng: fresh.lng });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      useToastStore.getState().show(`${isTeeMode ? 'Tee' : 'Green'} marked: hole ${currentHole}`);
    } finally {
      setMarking(false);
    }
  }, [courseId, currentHole, marking, isTeeMode, labelTitle]);

  const onClear = useCallback(async () => {
    if (!courseId) return;
    if (isTeeMode) {
      await clearTeeOverride(courseId, currentHole);
    } else {
      await clearGreenOverride(courseId, currentHole);
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    useToastStore.getState().show(`Cleared: hole ${currentHole}`);
  }, [courseId, currentHole, isTeeMode]);

  // 2026-05-17 — Gate check AFTER all hooks have been declared so
  // React's hook-count invariant holds across renders even when
  // _gateAllowed flips. See header comment.
  if (!_gateAllowed) return null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>{labelTitle}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* 2026-05-25 — Fix J: mode toggle. Two pills (Tee / Green)
            with the active one filled. Tap to swap the target store;
            screen contents update through the shared render. */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14, justifyContent: 'center' }}>
          {(['tee', 'green'] as const).map(m => {
            const active = mode === m;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => setMode(m)}
                style={{
                  paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: active ? colors.accent : colors.border,
                  backgroundColor: active ? colors.accent + '22' : 'transparent',
                }}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${m === 'tee' ? 'Tee' : 'Green'} mode${active ? ' (active)' : ''}`}
              >
                <Text style={{
                  color: active ? colors.accent : colors.text_muted,
                  fontWeight: '800',
                  letterSpacing: 0.8,
                  fontSize: 12,
                }}>
                  {m === 'tee' ? 'TEE' : 'GREEN'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.hint, { color: colors.text_muted }]}>
          {isTeeMode
            ? `Walk to the TEE BOX. Tap "Mark ${labelTarget}". Your GPS position becomes this hole's tee coordinate for all future rounds at this course.`
            : `Walk to the CENTER of the green. Tap "Mark ${labelTarget} center". Your GPS position becomes this hole's middle coordinate for all future rounds at this course.`}
        </Text>

        {!isRoundActive && (
          <View style={[styles.warningCard, { backgroundColor: colors.surface, borderColor: '#F5A623' }]}>
            <Text style={[styles.warningText, { color: colors.text_primary }]}>
              No round active. Start a round first so {labelTitle} knows which course + hole to file.
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
          accessibilityLabel={`Mark ${labelTarget} at current position`}
        >
          <Ionicons name={isTeeMode ? 'golf' : 'flag'} size={20} color="#000" style={{ marginRight: 8 }} />
          <Text style={styles.markBtnText}>
            {marking
              ? 'Marking…'
              : isTeeMode
                ? `Mark tee for hole ${currentHole}`
                : `Mark green center for hole ${currentHole}`}
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
