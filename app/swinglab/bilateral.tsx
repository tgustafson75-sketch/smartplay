/**
 * 2026-06-14 (Tim — bilateral / second video source) — link two analyzed swings
 * (one down-the-line, one face-on of the SAME swing) into one combined read.
 * Route: /swinglab/bilateral?a=<sessionId>&b=<sessionId>. Pure presentation over
 * mergeBilateral; honest about angle gaps + the 2D (not 3D) ceiling.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore, type CageSession } from '../../store/cageStore';
import { mergeBilateral, type BilateralSwingInput, type BilateralAngleRead } from '../../services/swing/bilateralMerge';

function fmtDate(ms: number): string {
  try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}

function toInput(s: CageSession): BilateralSwingInput {
  const pi = s.primary_issue ?? null;
  const club = s.currentClub ?? s.club ?? 'swing';
  return {
    sessionId: s.id,
    angle: s.upload?.angleOverride ?? null,
    label: `${club} · ${fmtDate(s.date)}`,
    // The acoustic impact anchor lives on the shot (detectionOffsetSeconds); use the
    // first shot's offset as this swing's impact for cross-angle alignment.
    impactSec: typeof s.shots?.[0]?.detectionOffsetSeconds === 'number' ? s.shots[0].detectionOffsetSeconds : null,
    faultName: pi?.name ?? (pi as { primary_fault?: string } | null)?.primary_fault ?? null,
    category: pi?.category ?? null,
    breakdown: pi?.mechanical_breakdown ?? null,
    fix: (pi as { fix?: string } | null)?.fix ?? pi?.feel_cue ?? null,
  };
}

export default function BilateralReview() {
  const { a, b } = useLocalSearchParams<{ a?: string; b?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const history = useCageStore((s) => s.sessionHistory);

  const sa = useMemo(() => history.find((s) => s.id === a) ?? null, [history, a]);
  const sb = useMemo(() => history.find((s) => s.id === b) ?? null, [history, b]);

  const read = useMemo(() => (sa && sb ? mergeBilateral(toInput(sa), toInput(sb)) : null), [sa, sb]);

  const back = (
    <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
      <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
    </TouchableOpacity>
  );

  if (!read) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
        {back}
        <Text style={[styles.empty, { color: colors.text_muted }]}>Couldn&apos;t load both swings to link.</Text>
      </View>
    );
  }

  const AngleCard = ({ r }: { r: BilateralAngleRead }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.angleLabel, { color: colors.accent }]}>
        {r.angle === 'down_the_line' ? 'DOWN THE LINE' : 'FACE-ON'}
      </Text>
      <Text style={[styles.sub, { color: colors.text_muted }]}>{r.label} · reads {r.reads}</Text>
      {r.faultName ? <Text style={[styles.fault, { color: colors.text_primary }]}>{r.faultName}</Text> : <Text style={[styles.sub, { color: colors.text_muted }]}>No fault flagged from this angle.</Text>}
      {r.breakdown ? <Text style={[styles.body, { color: colors.text_primary }]}>{r.breakdown}</Text> : null}
      {r.fix ? <Text style={[styles.fix, { color: colors.accent }]}>Fix: {r.fix}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 48, paddingHorizontal: 16 }}>
        {back}
        <Text style={[styles.title, { color: colors.text_primary }]}>Bilateral read</Text>
        <Text style={[styles.headline, { color: colors.text_primary }]}>{read.headline}</Text>

        {read.dtl ? <AngleCard r={read.dtl} /> : null}
        {read.faceOn ? <AngleCard r={read.faceOn} /> : null}

        {read.notes.length > 0 ? (
          <View style={[styles.notesCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {read.notes.map((n, i) => (
              <Text key={i} style={[styles.note, { color: colors.text_muted }]}>• {n}</Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: { width: 40, height: 40, justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '900', marginTop: 4 },
  headline: { fontSize: 15, fontWeight: '700', marginTop: 6, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  angleLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  sub: { fontSize: 12, marginTop: 4 },
  fault: { fontSize: 16, fontWeight: '800', marginTop: 8 },
  body: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  fix: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  notesCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 4 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  empty: { fontSize: 14, textAlign: 'center', marginTop: 40 },
});
