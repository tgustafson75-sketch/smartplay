/**
 * 2026-05-23 — Comparison result sheet.
 *
 * Replaces the previous toast-only result of a `compareSwings` pass
 * with a proper side-by-side visual surface. Renders the overall
 * match %, the reference identity, top takeaways, and a vertical
 * stack of per-metric bars (current vs reference value, colored
 * by direction — better / worse / same).
 *
 * Mounted from `app/swinglab/swing/[swing_id].tsx`'s
 * `onCompareToSelect` flow. When a comparison resolves, the screen
 * sets the result state and the sheet animates up; tapping the
 * scrim or "Done" dismisses it.
 *
 * Pure React Native — uses the built-in Animated API for the slide-
 * up + scrim-fade entry, native driver enabled. No new dependencies.
 *
 * Defensive: when `result === null` or `reference === null`, the
 * sheet renders nothing (caller controls visibility via the
 * non-null pair).
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal, View, Text, ScrollView, Pressable, StyleSheet,
  Animated, Easing, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import type { SwingComparison, MetricDelta } from '../../services/swingComparisonEngine';
import type { ReferenceSwing } from '../../services/swingDatabase';

export interface ComparisonResultSheetProps {
  visible: boolean;
  /** The comparison result from swingComparisonEngine.compareSwings.
   *  When null, the sheet renders nothing — caller manages the pair. */
  result: SwingComparison | null;
  /** The reference swing the player compared against. Surfaces the
   *  label + thumbnail + source. */
  reference: ReferenceSwing | null;
  onClose: () => void;
  /** Optional: tapped when the player wants to compare against
   *  ANOTHER reference (reopens the picker). */
  onCompareAnother?: () => void;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

export default function ComparisonResultSheet({
  visible, result, reference, onClose, onCompareAnother,
}: ComparisonResultSheetProps) {
  const { colors } = useTheme();

  // Slide-up animation. Native driver enabled — Animated.Value driven
  // for transform + opacity only, both supported.
  const slideY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && result && reference) {
      Animated.parallel([
        Animated.timing(slideY, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      slideY.setValue(SCREEN_HEIGHT);
      scrimOpacity.setValue(0);
    }
  }, [visible, result, reference, slideY, scrimOpacity]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideY, {
        toValue: SCREEN_HEIGHT,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  };

  // Insufficient-data state: the engine returns overall_match === null
  // when there was no usable biomechanics to compare. We must NOT render
  // a confident "0% MATCH" ring in that case — that's a fabricated
  // negative. Show a muted "—" / "Not enough data to compare" instead.
  const hasMatch = result?.overall_match != null;

  const matchColor = useMemo(() => {
    const m = result?.overall_match;
    if (m == null) return '#6b7280'; // muted — insufficient data
    if (m >= 80) return '#86efac';
    if (m >= 60) return '#a3e635';
    if (m >= 40) return '#fbbf24';
    return '#f87171';
  }, [result]);

  if (!result || !reference) return null;

  // Filter to metrics with usable values — engine produces every
  // entry but null-current ones can't render a bar pair honestly.
  const renderableMetrics = result.metrics.filter(
    (m) => m.current != null && m.reference != null,
  );

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              transform: [{ translateY: slideY }],
            },
          ]}
        >
          {/* Drag handle */}
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.text_muted, opacity: 0.4 }]} />
          </View>

          {/* Header: big match % + close. When the engine couldn't
              compare (overall_match === null), show a muted "—" and a
              "not enough data" hint instead of a confident 0% ring. */}
          <View style={styles.headerRow}>
            <View style={[styles.matchRing, { borderColor: matchColor }]}>
              <Text style={[styles.matchValue, { color: matchColor }]}>
                {hasMatch ? result.overall_match : '—'}
              </Text>
              <Text style={[styles.matchLabel, { color: matchColor }]}>MATCH</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.headerHint, { color: colors.text_muted }]}>
                {hasMatch ? 'vs reference' : 'Not enough data to compare'}
              </Text>
              <Text style={[styles.headerLabel, { color: colors.text_primary }]} numberOfLines={2}>
                {reference.label}
              </Text>
              <Text style={[styles.headerMeta, { color: colors.text_muted }]} numberOfLines={1}>
                {SOURCE_LABEL[reference.source] ?? reference.source}
                {reference.proName ? `  ·  ${reference.proName}` : ''}
                {reference.club ? `  ·  ${reference.club}` : ''}
              </Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close comparison">
              <Ionicons name="close" size={22} color={colors.text_muted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.scroll}>
            {/* Top takeaways */}
            {result.takeaways.length > 0 ? (
              <View style={[styles.takeawayCard, { borderColor: matchColor, backgroundColor: tint(matchColor, 0.10) }]}>
                {result.takeaways.slice(0, 3).map((t, i) => (
                  <View key={i} style={styles.takeawayRow}>
                    <View style={[styles.takeawayDot, { backgroundColor: matchColor }]} />
                    <Text style={[styles.takeawayText, { color: colors.text_primary }]}>{t}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* 2026-06-25 — Tour-benchmark card. Present only when the
                comparison was graded against the BENCHMARK BANK (no captured
                pro). HONEST: it leads with the directional framing, then the
                proExemplars FEEL + a drill to close each gap — never a
                "you're X° off [named pro]" claim. */}
            {result.benchmark ? (
              <View style={[styles.benchmarkCard, { borderColor: colors.border, backgroundColor: colors.surface_elevated }]}>
                <View style={styles.benchmarkHeader}>
                  <Ionicons name="flag-outline" size={14} color={colors.accent} />
                  <Text style={[styles.benchmarkTitle, { color: colors.text_primary }]}>
                    vs the tour benchmark (directional)
                  </Text>
                </View>
                <Text style={[styles.benchmarkFraming, { color: colors.text_muted }]}>
                  {result.benchmark.framing}
                </Text>
                {result.benchmark.focuses.length === 0 ? (
                  <Text style={[styles.benchmarkFocusNote, { color: colors.text_secondary }]}>
                    Looks tour-standard on everything we could measure — inside the benchmark range.
                  </Text>
                ) : (
                  result.benchmark.focuses.slice(0, 3).map((f, i) => (
                    <View key={i} style={styles.benchmarkFocusRow}>
                      <Text style={[styles.benchmarkFocusLabel, { color: colors.text_primary }]}>
                        {f.label}
                      </Text>
                      <Text style={[styles.benchmarkFocusNote, { color: colors.text_secondary }]}>
                        {f.note}
                      </Text>
                      <Text style={[styles.benchmarkFeel, { color: colors.accent }]}>
                        Feel: {f.feel}
                        {f.drillId ? `  ·  drill: ${f.drillId}` : ''}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            ) : null}

            {/* Per-metric side-by-side bars */}
            <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>SIDE BY SIDE</Text>
            {renderableMetrics.length === 0 ? (
              <Text style={[styles.emptyHint, { color: colors.text_muted }]}>
                {hasMatch
                  ? 'Not enough biomechanics to compare metric-by-metric. The match score above is based on what data was available.'
                  : 'Not enough biomechanics captured to compare against this reference. Record a clearer swing — full body in frame — and try again.'}
              </Text>
            ) : (
              renderableMetrics.map((m) => (
                <MetricBar
                  key={m.key}
                  metric={m}
                  colors={colors}
                />
              ))
            )}

            {/* Voice summary read-aloud */}
            {result.voice_summary ? (
              <View style={[styles.voiceCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.accent} />
                <Text style={[styles.voiceText, { color: colors.text_primary }]} numberOfLines={4}>
                  {result.voice_summary}
                </Text>
              </View>
            ) : null}

            {/* Action row */}
            <View style={styles.actionRow}>
              {onCompareAnother ? (
                <Pressable
                  onPress={() => { handleClose(); setTimeout(onCompareAnother, 260); }}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Compare against another reference"
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.accent }]}>
                    Compare another
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text style={styles.primaryBtnText}>Done</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Metric bar ─────────────────────────────────────────────────────

function MetricBar({ metric, colors }: {
  metric: MetricDelta;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: metric.match_score,
      duration: 600,
      delay: 80,
      easing: Easing.out(Easing.cubic),
      // Width animations can't use native driver; the fill is the
      // cheapest possible interpolation so this isn't a perf hit.
      useNativeDriver: false,
    }).start();
  }, [metric.match_score, fillAnim]);

  const directionColor =
    metric.direction === 'better' ? '#86efac' :
    metric.direction === 'worse'  ? '#f87171' :
    metric.direction === 'same'   ? '#a3e635' :
                                    colors.text_muted;

  const fillWidth = fillAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.metricRow}>
      <View style={styles.metricHeader}>
        <Text style={[styles.metricLabel, { color: colors.text_primary }]} numberOfLines={1}>
          {metric.label}
        </Text>
        <Text style={[styles.metricScore, { color: directionColor }]}>
          {metric.match_score}
        </Text>
      </View>
      <View style={styles.metricValues}>
        <Text style={[styles.metricValueLeft, { color: colors.text_secondary }]}>
          you · <Text style={{ color: colors.text_primary, fontWeight: '800' }}>{formatValue(metric.current)}</Text>
        </Text>
        <Text style={[styles.metricValueRight, { color: colors.text_secondary }]}>
          ref · <Text style={{ color: colors.text_primary, fontWeight: '800' }}>{formatValue(metric.reference)}</Text>
        </Text>
      </View>
      <View style={[styles.metricTrack, { backgroundColor: colors.surface_elevated }]}>
        <Animated.View
          style={[
            styles.metricFill,
            { width: fillWidth, backgroundColor: directionColor },
          ]}
        />
      </View>
      <Text style={[styles.metricVerdict, { color: colors.text_muted }]} numberOfLines={2}>
        {metric.verdict}
      </Text>
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  self_upload: 'Your upload',
  pro_clip: 'Pro reference',
  archetype: 'Ideal model',
};

function formatValue(v: number | null): string {
  if (v == null) return '—';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/\.?0+$/, '');
}

/** Tint a hex color with an alpha-style rgba string. The match-tier
 *  hex colors are 6-char (no alpha), so we parse + reassemble. */
function tint(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8,
    maxHeight: '88%',
  },
  handleRow: { alignItems: 'center', marginBottom: 6 },
  handle: { width: 44, height: 4, borderRadius: 2 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  matchRing: {
    width: 78, height: 78, borderRadius: 39,
    borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  matchValue: { fontSize: 26, fontWeight: '900', lineHeight: 28 },
  matchLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.4, marginTop: 2 },
  headerText: { flex: 1, gap: 2 },
  headerHint: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  headerLabel: { fontSize: 16, fontWeight: '800', lineHeight: 20 },
  headerMeta: { fontSize: 11, fontWeight: '600' },

  scroll: { gap: 12, paddingBottom: 16 },

  takeawayCard: {
    borderWidth: 1, borderRadius: 12, padding: 12, gap: 8,
  },
  takeawayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  takeawayDot: {
    width: 8, height: 8, borderRadius: 4, marginTop: 6,
  },
  takeawayText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },

  benchmarkCard: {
    borderWidth: 1, borderRadius: 12, padding: 12, gap: 6, marginTop: 2,
  },
  benchmarkHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  benchmarkTitle: { fontSize: 13, fontWeight: '900' },
  benchmarkFraming: { fontSize: 11, lineHeight: 15, fontStyle: 'italic' },
  benchmarkFocusRow: { gap: 2, marginTop: 6 },
  benchmarkFocusLabel: { fontSize: 12, fontWeight: '800' },
  benchmarkFocusNote: { fontSize: 11, lineHeight: 15 },
  benchmarkFeel: { fontSize: 11, fontWeight: '700', lineHeight: 15 },

  sectionLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, marginTop: 6 },
  emptyHint: { fontSize: 12, fontStyle: 'italic', lineHeight: 17 },

  metricRow: { gap: 4 },
  metricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricLabel: { fontSize: 13, fontWeight: '700', flex: 1 },
  metricScore: { fontSize: 13, fontWeight: '900' },
  metricValues: { flexDirection: 'row', justifyContent: 'space-between' },
  metricValueLeft: { fontSize: 11, fontWeight: '600' },
  metricValueRight: { fontSize: 11, fontWeight: '600' },
  metricTrack: {
    height: 6, borderRadius: 3, overflow: 'hidden',
  },
  metricFill: { height: '100%', borderRadius: 3 },
  metricVerdict: { fontSize: 11, marginTop: 2, lineHeight: 15 },

  voiceCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 4,
  },
  voiceText: { flex: 1, fontSize: 12, fontStyle: 'italic', lineHeight: 17 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  primaryBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  primaryBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  secondaryBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center',
  },
  secondaryBtnText: { fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
});
