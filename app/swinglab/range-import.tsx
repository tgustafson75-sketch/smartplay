/**
 * TopTracer range session import.
 *
 * Pick a TopTracer screenshot → AI parses per-club data → user reviews →
 * confirm applies flat-carry to clubStatsStore, calibrating Kevin's
 * distance recommendations for this player.
 *
 * Design: scorecard club-table style (dark card, all-caps labels, accent
 * yardages) matching the 8058 render reference.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
  ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useClubStatsStore } from '../../store/clubStatsStore';
import { useToastStore } from '../../store/toastStore';
import {
  pickForTopTracer, parseTopTracerScreenshot, sortedClubs,
  type TopTracerParseResult, type TopTracerClubRow,
} from '../../services/topTracerImport';

type Phase =
  | { kind: 'pick' }
  | { kind: 'parsing'; uri: string }
  | { kind: 'confirm'; uri: string; result: TopTracerParseResult }
  | { kind: 'done'; applied: number }
  | { kind: 'error'; message: string; retryable: boolean };

export default function RangeImportScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const setManual = useClubStatsStore(s => s.setManual);
  const showToast = useToastStore(s => s.show);
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });

  const onPick = useCallback(async () => {
    const picked = await pickForTopTracer();
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'permission_denied') {
      setPhase({ kind: 'error', message: 'Photo library permission denied. Grant access in Settings to import.', retryable: false });
      return;
    }
    if (picked.kind === 'error') {
      setPhase({ kind: 'error', message: picked.message, retryable: true });
      return;
    }
    setPhase({ kind: 'parsing', uri: picked.uri });
    const outcome = await parseTopTracerScreenshot(picked.uri);
    switch (outcome.kind) {
      case 'ok':
        setPhase({ kind: 'confirm', uri: picked.uri, result: outcome.result });
        break;
      case 'not_toptracer':
        setPhase({ kind: 'error', message: "That doesn't look like a TopTracer screenshot. Try the club data table view.", retryable: true });
        break;
      case 'no_clubs':
        setPhase({ kind: 'error', message: "No club distances were readable. Make sure the per-club data table is visible.", retryable: true });
        break;
      case 'too_large':
        setPhase({ kind: 'error', message: 'Screenshot is too large to process. Try a smaller image.', retryable: true });
        break;
      case 'no_network':
        setPhase({ kind: 'error', message: 'No network connection. Check your connection and try again.', retryable: true });
        break;
      case 'error':
        setPhase({ kind: 'error', message: outcome.message, retryable: true });
        break;
    }
  }, []);

  const onApply = useCallback((result: TopTracerParseResult) => {
    const applicable = result.clubs.filter(r => r.club_id !== null && r.flat_carry_yds !== null);
    applicable.forEach(r => {
      setManual(r.club_id!, r.flat_carry_yds!);
    });
    const n = applicable.length;
    showToast(`${n} club distance${n === 1 ? '' : 's'} applied to your bag.`);
    setPhase({ kind: 'done', applied: n });
  }, [setManual, showToast]);

  const onReset = useCallback(() => setPhase({ kind: 'pick' }), []);

  const BackBtn = () => (
    <TouchableOpacity
      onPress={() => router.back()}
      style={styles.backBtn}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={24} color={c.text_primary} />
    </TouchableOpacity>
  );

  // ── PICK ────────────────────────────────────────────────────────────────────
  if (phase.kind === 'pick') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
        <View style={styles.header}>
          <BackBtn />
          <Text style={[styles.pageTitle, { color: c.text_primary }]}>Range Import</Text>
        </View>
        <View style={styles.pickBody}>
          <Ionicons name="golf-outline" size={52} color={c.accent} style={styles.pickIcon} />
          <Text style={[styles.pickHeadline, { color: c.text_primary }]}>Import TopTracer data</Text>
          <Text style={[styles.pickSub, { color: c.text_muted }]}>
            Choose a TopTracer Range screenshot showing the club data table.
            Kevin will use the flat-carry numbers to calibrate your distance recommendations.
          </Text>
          <TouchableOpacity
            style={[styles.pickBtn, { backgroundColor: c.accent }]}
            onPress={() => void onPick()}
            accessibilityRole="button"
          >
            <Ionicons name="image-outline" size={18} color="#06281b" />
            <Text style={styles.pickBtnText}>Choose screenshot</Text>
          </TouchableOpacity>
          <Text style={[styles.pickHint, { color: c.text_muted }]}>
            Works with the side-view table (Flat Carry / Total / Speed) and the overhead radar scatter view.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── PARSING ─────────────────────────────────────────────────────────────────
  if (phase.kind === 'parsing') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
        <View style={styles.header}>
          <BackBtn />
          <Text style={[styles.pageTitle, { color: c.text_primary }]}>Range Import</Text>
        </View>
        <View style={styles.loadBody}>
          {phase.uri ? (
            <Image source={{ uri: phase.uri }} style={[styles.previewThumb, { borderColor: c.border }]} resizeMode="cover" />
          ) : null}
          <ActivityIndicator size="large" color={c.accent} style={styles.spinner} />
          <Text style={[styles.loadText, { color: c.text_muted }]}>Reading your TopTracer data…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── ERROR ────────────────────────────────────────────────────────────────────
  if (phase.kind === 'error') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
        <View style={styles.header}>
          <BackBtn />
          <Text style={[styles.pageTitle, { color: c.text_primary }]}>Range Import</Text>
        </View>
        <View style={styles.pickBody}>
          <Ionicons name="alert-circle-outline" size={48} color={c.error ?? '#F87171'} style={styles.pickIcon} />
          <Text style={[styles.pickHeadline, { color: c.text_primary }]}>Couldn't read screenshot</Text>
          <Text style={[styles.pickSub, { color: c.text_muted }]}>{phase.message}</Text>
          {phase.retryable ? (
            <TouchableOpacity
              style={[styles.pickBtn, { backgroundColor: c.accent }]}
              onPress={onReset}
              accessibilityRole="button"
            >
              <Text style={styles.pickBtnText}>Try another screenshot</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  // ── DONE ─────────────────────────────────────────────────────────────────────
  if (phase.kind === 'done') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
        <View style={styles.header}>
          <BackBtn />
          <Text style={[styles.pageTitle, { color: c.text_primary }]}>Range Import</Text>
        </View>
        <View style={styles.pickBody}>
          <Ionicons name="checkmark-circle" size={52} color={c.accent} style={styles.pickIcon} />
          <Text style={[styles.pickHeadline, { color: c.text_primary }]}>
            {phase.applied} distance{phase.applied === 1 ? '' : 's'} applied
          </Text>
          <Text style={[styles.pickSub, { color: c.text_muted }]}>
            Kevin's club recommendations are now calibrated to your real TopTracer carry numbers.
          </Text>
          <TouchableOpacity
            style={[styles.pickBtn, { backgroundColor: c.accent }]}
            onPress={onReset}
            accessibilityRole="button"
          >
            <Text style={styles.pickBtnText}>Import another session</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: c.border }]}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            <Text style={[styles.secondaryBtnText, { color: c.text_secondary }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── CONFIRM ──────────────────────────────────────────────────────────────────
  const { result, uri } = phase;
  const rows = sortedClubs(result.clubs);
  const mappable = rows.filter(r => r.club_id && r.flat_carry_yds != null);
  const unmapped = rows.filter(r => !r.club_id);
  const lowConf = result.confidence === 'low';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.header}>
        <BackBtn />
        <Text style={[styles.pageTitle, { color: c.text_primary }]}>Range Import</Text>
      </View>
      <ScrollView contentContainerStyle={styles.confirmScroll}>

        {/* Preview thumbnail */}
        <Image source={{ uri }} style={[styles.previewFull, { borderColor: c.border }]} resizeMode="cover" />

        {/* Session summary pill */}
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: c.text_muted }]}>
            {mappable.length} club{mappable.length === 1 ? '' : 's'} detected
            {result.consistency_pct != null ? `  ·  ${result.consistency_pct}% consistency` : ''}
          </Text>
          <View style={[styles.confBadge, { backgroundColor: lowConf ? (c.error ?? '#F87171') + '22' : c.accent + '22' }]}>
            <Text style={[styles.confBadgeText, { color: lowConf ? (c.error ?? '#F87171') : c.accent }]}>
              {result.confidence.toUpperCase()} CONFIDENCE
            </Text>
          </View>
        </View>

        {/* Club data table */}
        {rows.length > 0 ? (
          <View style={[styles.clubGrid, { backgroundColor: c.surface, borderColor: c.border }]}>
            {/* Header */}
            <View style={[styles.clubRow, styles.clubHeader, { backgroundColor: c.surface_elevated ?? c.surface, borderBottomColor: c.border }]}>
              <Text style={[styles.clubCell, styles.colClub, { color: c.text_muted }]}>CLUB</Text>
              <Text style={[styles.clubCell, styles.colCarry, { color: c.text_muted }]}>CARRY</Text>
              <Text style={[styles.clubCell, styles.colTotal, { color: c.text_muted }]}>TOTAL</Text>
              <Text style={[styles.clubCell, styles.colSpeed, { color: c.text_muted }]}>SPD</Text>
            </View>
            {rows.map((row, i) => <ClubDataRow key={i} row={row} c={c} />)}
          </View>
        ) : null}

        {/* Unmapped clubs note */}
        {unmapped.length > 0 ? (
          <Text style={[styles.unmappedNote, { color: c.text_muted }]}>
            {unmapped.map(r => r.display_name).join(', ')} — not matched to a known club; excluded from import.
          </Text>
        ) : null}

        {/* Warnings */}
        {result.warnings.length > 0 ? (
          <View style={[styles.warnBox, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.warnTitle, { color: c.text_muted }]}>NOTES</Text>
            {result.warnings.map((w, i) => (
              <Text key={i} style={[styles.warnLine, { color: c.text_muted }]}>• {w}</Text>
            ))}
          </View>
        ) : null}

        <Text style={[styles.applyNote, { color: c.text_muted }]}>
          Flat-carry numbers will calibrate Kevin's club recommendations. You can update or clear these any time in Settings → My Bag.
        </Text>

        {/* CTA */}
        {mappable.length > 0 ? (
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: c.accent }]}
            onPress={() => onApply(result)}
            accessibilityRole="button"
          >
            <Text style={styles.applyBtnText}>Apply {mappable.length} distance{mappable.length === 1 ? '' : 's'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: c.border }]}
            onPress={onReset}
            accessibilityRole="button"
          >
            <Text style={[styles.applyBtnText, { color: c.text_muted }]}>No distances to apply — try another screenshot</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: c.border }]}
          onPress={onReset}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryBtnText, { color: c.text_secondary }]}>Choose a different screenshot</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ClubDataRow({ row, c }: { row: TopTracerClubRow; c: ReturnType<typeof useTheme>['colors'] }) {
  const isMapped = row.club_id != null;
  return (
    <View style={[styles.clubRow, { borderBottomColor: c.border, opacity: isMapped ? 1 : 0.5 }]}>
      <Text style={[styles.clubCell, styles.colClub, { color: c.text_primary, fontWeight: '700' }]}>
        {row.club_id ?? row.display_name}
      </Text>
      <Text style={[styles.clubCell, styles.colCarry, { color: row.flat_carry_yds != null ? c.accent : c.text_muted }]}>
        {row.flat_carry_yds != null ? row.flat_carry_yds : '—'}
      </Text>
      <Text style={[styles.clubCell, styles.colTotal, { color: c.text_secondary }]}>
        {row.total_yds != null ? row.total_yds : '—'}
      </Text>
      <Text style={[styles.clubCell, styles.colSpeed, { color: c.text_secondary }]}>
        {row.ball_speed_mph != null ? row.ball_speed_mph : '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  pageTitle: { fontSize: 18, fontWeight: '900', marginLeft: 4 },

  // Pick / Done / Error
  pickBody: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  pickIcon: { marginBottom: 16 },
  pickHeadline: { fontSize: 20, fontWeight: '900', textAlign: 'center', marginBottom: 10 },
  pickSub: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28 },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14, marginBottom: 10 },
  pickBtnText: { color: '#06281b', fontSize: 16, fontWeight: '900' },
  pickHint: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  secondaryBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, marginTop: 8 },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },

  // Parsing
  loadBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  previewThumb: { width: 200, height: 140, borderRadius: 12, borderWidth: 1, marginBottom: 24 },
  spinner: { marginBottom: 16 },
  loadText: { fontSize: 15, fontWeight: '700' },

  // Confirm
  confirmScroll: { paddingHorizontal: 16, paddingBottom: 40 },
  previewFull: { width: '100%', height: 180, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  summaryLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  confBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  confBadgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },

  // Club table
  clubGrid: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', marginBottom: 12 },
  clubRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  clubHeader: {},
  clubCell: { fontSize: 13, fontWeight: '700' },
  colClub: { flex: 2.2 },
  colCarry: { flex: 1.5, textAlign: 'right' },
  colTotal: { flex: 1.5, textAlign: 'right' },
  colSpeed: { flex: 1.5, textAlign: 'right' },

  unmappedNote: { fontSize: 11, lineHeight: 16, marginBottom: 10 },
  warnBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  warnTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  warnLine: { fontSize: 12, lineHeight: 18 },
  applyNote: { fontSize: 12, lineHeight: 18, marginBottom: 16 },
  applyBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginBottom: 8 },
  applyBtnText: { color: '#06281b', fontSize: 16, fontWeight: '900' },
});
