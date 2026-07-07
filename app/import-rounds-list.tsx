/**
 * 2026-06-11 — Bulk round-LIST import.
 *
 * Sibling to import-round.tsx (single scorecard). Reads a screenshot of a
 * round-HISTORY LIST (Golfshot / 18Birdies / GHIN) and imports every round in
 * one pass — the on-ramp for players bringing a whole season from another app.
 *
 * Phases: PICK → PARSING → CONFIRM (review the kept rounds, flip any 9/18 the
 * forties-rule guessed, see how many no-score rows were dropped) → persist all
 * via addImportedRound, then recompute the handicap index from full history so
 * the import actually moves the number. Repeat for the next screenshot.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useRoundStore, eligibleHandicapRounds } from '../store/roundStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useToastStore } from '../store/toastStore';
import {
  pickFromLibrary, parseRoundListScreenshot, normalizeImportedList, buildListPersistInput,
  type NormalizedListRound,
} from '../services/roundImport';

type Phase =
  | { kind: 'pick' }
  | { kind: 'parsing'; uri: string }
  | { kind: 'confirm'; uri: string; rounds: NormalizedListRound[]; skippedNoScore: number; skippedIncomplete: number; confidence: string; warnings: string[] }
  | { kind: 'error'; message: string; retryable: boolean };

export default function ImportRoundsListScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const addImportedRound = useRoundStore(s => s.addImportedRound);
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });

  const onPick = useCallback(async () => {
    const picked = await pickFromLibrary();
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'permission_denied') {
      setPhase({ kind: 'error', message: 'Photo library permission denied. Grant access in Settings to import.', retryable: false });
      return;
    }
    if (picked.kind === 'error') { setPhase({ kind: 'error', message: picked.message, retryable: true }); return; }

    setPhase({ kind: 'parsing', uri: picked.uri });
    const parsed = await parseRoundListScreenshot(picked.uri);
    if (parsed.kind === 'ok') {
      const norm = normalizeImportedList(parsed.result.rounds);
      if (norm.keep.length === 0) {
        setPhase({ kind: 'error', message: norm.skippedNoScore > 0 || norm.skippedIncomplete > 0
          ? 'Every row in that screenshot was an in-progress or unfinished round (no score, or too few holes). Try a screen with completed rounds.'
          : 'No rounds were readable. Try a clearer round-list screenshot.', retryable: true });
        return;
      }
      setPhase({ kind: 'confirm', uri: picked.uri, rounds: norm.keep, skippedNoScore: norm.skippedNoScore, skippedIncomplete: norm.skippedIncomplete, confidence: parsed.result.confidence, warnings: parsed.result.warnings });
      return;
    }
    if (parsed.kind === 'too_large') { setPhase({ kind: 'error', message: 'Screenshot is too large. Crop it tighter and retry.', retryable: true }); return; }
    if (parsed.kind === 'not_a_list') { setPhase({ kind: 'error', message: "That doesn't look like a round-history list. Open your rounds list in Golfshot / 18Birdies / GHIN and screenshot that.", retryable: true }); return; }
    if (parsed.kind === 'no_network') { setPhase({ kind: 'error', message: 'Network unavailable. Reconnect and try again.', retryable: true }); return; }
    setPhase({ kind: 'error', message: parsed.message, retryable: true });
  }, []);

  // Flip a single round's 9/18 — the forties rule is a guess the user can correct.
  const toggleHoles = useCallback((idx: number) => {
    setPhase(p => {
      if (p.kind !== 'confirm') return p;
      const rounds = p.rounds.map((r, i) => {
        if (i !== idx) return r;
        const holesPlayed = r.holesPlayed === 9 ? 18 : 9;
        return { ...r, holesPlayed: holesPlayed as 9 | 18, nineHoleMode: holesPlayed === 9, holesSource: 'stated' as const };
      });
      return { ...p, rounds };
    });
  }, []);

  const onConfirm = useCallback(() => {
    if (phase.kind !== 'confirm') return;
    try {
      // updateHandicap:false — the per-round path no longer touches handicap;
      // the single rebuild below owns it. Count actual adds via the history-
      // length delta so dedupe-skipped re-imports don't inflate the toast.
      const before = useRoundStore.getState().roundHistory.length;
      for (const r of phase.rounds) {
        addImportedRound({ ...buildListPersistInput(r), updateHandicap: false });
      }
      const n = useRoundStore.getState().roundHistory.length - before;
      const dupCount = phase.rounds.length - n;
      // Recompute the index from FULL history so a first-ever import (index was
      // null) still produces a number — addImportedRound only updates an
      // existing index. Mirrors Settings → Recalculate.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const calcMod = require('../services/handicapCalculator') as typeof import('../services/handicapCalculator');
        const all = useRoundStore.getState().roundHistory;
        // 2026-07-06 (audit P0) — canonical filter also excludes sim rounds
        // (this recompute runs automatically after EVERY import).
        const eligible = eligibleHandicapRounds(all);
        if (eligible.length >= 3) {
          const differentials = calcMod.rebuildDifferentialsFromHistory(eligible);
          usePlayerProfileStore.setState({ recent_differentials: differentials });
          const result = calcMod.estimateNewIndex(differentials);
          if (result.newIndex != null && Number.isFinite(result.newIndex)) {
            usePlayerProfileStore.getState().setHandicapIndex(result.newIndex);
          }
        }
      } catch (e) {
        console.log('[import-rounds-list] handicap recompute failed (non-fatal):', e);
      }
      const idx = usePlayerProfileStore.getState().handicap_index;
      useToastStore.getState().show(
        `Imported ${n} round${n === 1 ? '' : 's'}` +
        `${dupCount > 0 ? ` · ${dupCount} already on record` : ''}` +
        `${idx != null ? ` · Index ${idx.toFixed(1)}` : ''}`,
      );
      setPhase({ kind: 'pick' });
    } catch (e) {
      console.log('[import-rounds-list] persist failed', e);
      setPhase({ kind: 'error', message: 'Could not save the rounds. Try again.', retryable: true });
    }
  }, [phase, addImportedRound]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.headerIcon}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Import Round History</Text>
        <View style={styles.headerIcon} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {phase.kind === 'pick' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text_primary }]}>Bring in a whole season</Text>
            <Text style={[styles.cardBody, { color: colors.text_muted }]}>
              Open your rounds list in Golfshot, 18Birdies, or GHIN and screenshot it. SmartPlay reads every round on the
              screen and adds them to your history and handicap. Scores in the 40s are treated as 9-hole rounds (you can
              flip any of them), and in-progress rounds with no score are skipped.
            </Text>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.accent }]} onPress={onPick}>
              <Ionicons name="list-outline" size={18} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>Choose a list screenshot</Text>
            </TouchableOpacity>
            <Text style={[styles.cardSub, { color: colors.text_muted, marginTop: 12 }]}>
              More than one screen of history? Import one, then come back and add the next.
            </Text>
          </View>
        )}

        {phase.kind === 'parsing' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, alignItems: 'center' }]}>
            <Image source={{ uri: phase.uri }} style={styles.previewSmall} resizeMode="cover" />
            <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 16 }} />
            <Text style={[styles.cardBody, { color: colors.text_primary, marginTop: 12 }]}>Reading your rounds…</Text>
            <Text style={[styles.cardSub, { color: colors.text_muted }]}>This usually takes 5-12 seconds.</Text>
          </View>
        )}

        {phase.kind === 'confirm' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text_primary }]}>
              {phase.rounds.length} round{phase.rounds.length === 1 ? '' : 's'} found
            </Text>
            <Text style={[styles.cardSub, { color: colors.text_muted, marginBottom: 4 }]}>
              {phase.skippedNoScore > 0 ? `${phase.skippedNoScore} in-progress round${phase.skippedNoScore === 1 ? '' : 's'} (no score) skipped. ` : ''}
              {phase.skippedIncomplete > 0 ? `${phase.skippedIncomplete} unfinished round${phase.skippedIncomplete === 1 ? '' : 's'} (too few holes) skipped. ` : ''}
              Tap a 9/18 chip to correct it. Read confidence:{' '}
              <Text style={{ fontWeight: '800', color: phase.confidence === 'high' ? colors.accent : phase.confidence === 'low' ? '#F5A623' : colors.text_primary }}>{phase.confidence}</Text>
            </Text>

            {phase.warnings.length > 0 && (
              <View style={[styles.warningBox, { borderColor: colors.border, backgroundColor: colors.surface_elevated }]}>
                <Ionicons name="warning-outline" size={14} color="#F5A623" />
                <View style={{ flex: 1 }}>
                  {phase.warnings.map((w, i) => (<Text key={i} style={[styles.warningText, { color: colors.text_muted }]}>{w}</Text>))}
                </View>
              </View>
            )}

            <View style={{ marginTop: 12 }}>
              {phase.rounds.map((r, i) => (
                <View key={i} style={[styles.roundRow, { borderColor: colors.border }]}>
                  <Text style={[styles.roundScore, { color: colors.text_primary }]}>{r.totalScore}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.roundCourse, { color: colors.text_primary }]} numberOfLines={1}>{r.courseName ?? 'Unknown course'}</Text>
                    <Text style={[styles.roundDate, { color: colors.text_muted }]}>
                      {r.playedDate ?? 'date unknown'}
                      {'  ·  '}
                      {r.scoreVsPar === 0 ? 'E' : r.scoreVsPar > 0 ? `+${r.scoreVsPar}` : r.scoreVsPar}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => toggleHoles(i)}
                    style={[styles.holesChip, { borderColor: r.holesPlayed === 9 ? '#F5A623' : colors.accent }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.holesPlayed} holes, tap to change`}
                  >
                    <Text style={[styles.holesChipText, { color: r.holesPlayed === 9 ? '#F5A623' : colors.accent }]}>
                      {r.holesPlayed}{r.holesSource === 'forties_rule' ? '?' : ''}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.accent }]} onPress={onConfirm}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>Add {phase.rounds.length} round{phase.rounds.length === 1 ? '' : 's'} to history</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={() => setPhase({ kind: 'pick' })}>
              <Text style={[styles.secondaryBtnText, { color: colors.text_primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase.kind === 'error' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: '#ef4444' }]}>
            <Text style={[styles.cardTitle, { color: '#ef4444' }]}>Import failed</Text>
            <Text style={[styles.cardBody, { color: colors.text_primary }]}>{phase.message}</Text>
            {phase.retryable && (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.accent }]} onPress={onPick}>
                <Ionicons name="refresh-outline" size={18} color="#0d1a0d" />
                <Text style={styles.primaryBtnText}>Try another screenshot</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={() => router.back()}>
              <Text style={[styles.secondaryBtnText, { color: colors.text_primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  scroll: { paddingBottom: 60 },
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 14, borderWidth: 1, padding: 16 },
  cardTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  cardBody: { fontSize: 14, lineHeight: 21 },
  cardSub: { fontSize: 12, marginTop: 6, lineHeight: 18 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingVertical: 13, borderRadius: 12 },
  primaryBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '800' },
  secondaryBtn: { alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  secondaryBtnText: { fontSize: 14, fontWeight: '700' },
  previewSmall: { width: 120, height: 120, borderRadius: 10 },
  warningBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  warningText: { fontSize: 12, lineHeight: 18 },
  roundRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  roundScore: { fontSize: 22, fontWeight: '900', width: 40, textAlign: 'center' },
  roundCourse: { fontSize: 14, fontWeight: '700' },
  roundDate: { fontSize: 12, marginTop: 2 },
  holesChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, minWidth: 40, alignItems: 'center' },
  holesChipText: { fontSize: 13, fontWeight: '800' },
});
