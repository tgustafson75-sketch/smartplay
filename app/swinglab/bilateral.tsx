/**
 * 2026-06-14 (Tim — bilateral / second video source) — link two analyzed swings
 * (one down-the-line, one face-on of the SAME swing) into one combined read.
 * Route: /swinglab/bilateral?a=<sessionId>&b=<sessionId>. Pure presentation over
 * mergeBilateral; honest about angle gaps + the 2D (not 3D) ceiling.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
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
  const faultName = pi?.name ?? (pi as { primary_fault?: string } | null)?.primary_fault ?? null;
  const category = pi?.category ?? null;
  // A real fault = a named fault whose primary_fault isn't the "clean / can't tell"
  // outcomes. primary_fault carries those sentinels (category is the fault family).
  const pf = pi?.primary_fault ?? null;
  const hasFault = !!faultName && pf !== 'no_dominant_fault' && pf !== 'inconclusive';
  // Model-named strengths — server `strengths` field (staged; absent until deployed).
  const strengths = (pi as { strengths?: string[] } | null)?.strengths ?? null;
  return {
    sessionId: s.id,
    angle: s.upload?.angleOverride ?? null,
    label: `${club} · ${fmtDate(s.date)}`,
    // The acoustic impact anchor lives on the shot (detectionOffsetSeconds); use the
    // first shot's offset as this swing's impact for cross-angle alignment.
    impactSec: typeof s.shots?.[0]?.detectionOffsetSeconds === 'number' ? s.shots[0].detectionOffsetSeconds : null,
    faultName,
    category,
    breakdown: pi?.mechanical_breakdown ?? null,
    fix: (pi as { fix?: string } | null)?.fix ?? pi?.feel_cue ?? null,
    strengths,
    hasFault,
  };
}

/** Best representative frame for the side-by-side: library thumbnail, else the
 *  server's wire-quality fault frame. Null ⇒ render a placeholder tile. */
function frameUri(s: CageSession | null): string | null {
  if (!s) return null;
  return s.thumbnailUri ?? s.primary_issue?.visual_reference_path ?? null;
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

  // Map each session to its angle for the side-by-side biplane strip (DTL left, face-on right).
  const dtlSession = useMemo(
    () => [sa, sb].find((s) => s?.upload?.angleOverride === 'down_the_line') ?? null,
    [sa, sb],
  );
  const faceOnSession = useMemo(
    () => [sa, sb].find((s) => s?.upload?.angleOverride === 'face_on') ?? null,
    [sa, sb],
  );

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

  // Honest positives for this angle: model-named strengths if present, else the
  // clean-base note (absence of a flagged fault in this angle's domain).
  const positives = (r: BilateralAngleRead): string[] =>
    r.strengths.length > 0 ? r.strengths : r.cleanNote ? [r.cleanNote] : [];

  const AngleCard = ({ r }: { r: BilateralAngleRead }) => {
    const wins = positives(r);
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.angleLabel, { color: colors.accent }]}>
          {r.angle === 'down_the_line' ? 'DOWN THE LINE' : 'FACE-ON'}
        </Text>
        <Text style={[styles.sub, { color: colors.text_muted }]}>{r.label} · reads {r.reads}</Text>
        {wins.length > 0 ? (
          <View style={styles.winBlock}>
            <Text style={[styles.winLabel, { color: '#3FB950' }]}>WHAT&apos;S WORKING</Text>
            {wins.map((w, i) => (
              <Text key={i} style={[styles.win, { color: colors.text_primary }]}>✓ {w}</Text>
            ))}
          </View>
        ) : null}
        {r.faultName ? <Text style={[styles.fault, { color: colors.text_primary }]}>{r.faultName}</Text> : <Text style={[styles.sub, { color: colors.text_muted }]}>No fault flagged from this angle.</Text>}
        {r.breakdown ? <Text style={[styles.body, { color: colors.text_primary }]}>{r.breakdown}</Text> : null}
        {r.fix ? <Text style={[styles.fix, { color: colors.accent }]}>Fix: {r.fix}</Text> : null}
      </View>
    );
  };

  // Side-by-side biplane strip: the two angles' representative frames together.
  const FrameTile = ({ session, fallbackLabel }: { session: CageSession | null; fallbackLabel: string }) => {
    const uri = frameUri(session);
    return (
      <View style={[styles.tile, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.tileLabel, { color: colors.accent }]}>{fallbackLabel}</Text>
        {uri ? (
          <Image source={{ uri }} style={styles.tileImg} resizeMode="cover" />
        ) : (
          <View style={[styles.tileImg, styles.tilePlaceholder]}>
            <Ionicons name="image-outline" size={22} color={colors.text_muted} />
            <Text style={[styles.tilePlaceholderText, { color: colors.text_muted }]}>no frame</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 48, paddingHorizontal: 16 }}>
        {back}
        <Text style={[styles.title, { color: colors.text_primary }]}>Bilateral read</Text>
        <Text style={[styles.headline, { color: colors.text_primary }]}>{read.headline}</Text>

        {/* Side-by-side biplane: same swing, two angles together. */}
        <View style={styles.biplaneRow}>
          <FrameTile session={dtlSession} fallbackLabel="DOWN THE LINE" />
          <FrameTile session={faceOnSession} fallbackLabel="FACE-ON" />
        </View>

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
  biplaneRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tile: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 8 },
  tileLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 6 },
  tileImg: { width: '100%', aspectRatio: 3 / 4, borderRadius: 8 },
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  tilePlaceholderText: { fontSize: 11 },
  winBlock: { marginTop: 10, marginBottom: 2 },
  winLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 4 },
  win: { fontSize: 13, lineHeight: 19, fontWeight: '600', marginTop: 2 },
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
