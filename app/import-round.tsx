/**
 * 2026-05-26 — Fix AA: Round screenshot import screen.
 *
 * Standalone screen reached from Settings → "Import past round from
 * screenshot". Three-phase UX:
 *
 *   PICK     — Tap "Choose screenshot" → expo-image-picker
 *   PARSING  — POST to /api/round-import (Gemini → OpenAI → Anthropic)
 *   CONFIRM  — Show parsed result; user reviews each hole + can tap
 *              Cancel to discard or "Add to history" to persist
 *
 * Persist hits useRoundStore.addImportedRound → router.back().
 * Failure states (no_network / too_large / not_a_scorecard / error)
 * each get a distinct copy with the right retry action.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
  ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useRoundStore } from '../store/roundStore';
import { useToastStore } from '../store/toastStore';
import {
  pickFromLibrary, parseRoundScreenshot, buildPersistInput,
  type RoundImportResult,
} from '../services/roundImport';

type Phase =
  | { kind: 'pick' }
  | { kind: 'parsing'; uri: string }
  | { kind: 'confirm'; uri: string; result: RoundImportResult }
  | { kind: 'error'; uri: string | null; message: string; retryable: boolean };

export default function ImportRoundScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const addImportedRound = useRoundStore(s => s.addImportedRound);
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });

  const onPick = useCallback(async () => {
    const picked = await pickFromLibrary();
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'permission_denied') {
      setPhase({ kind: 'error', uri: null, message: 'Photo library permission denied. Grant access in Settings to import a screenshot.', retryable: false });
      return;
    }
    if (picked.kind === 'error') {
      setPhase({ kind: 'error', uri: null, message: picked.message, retryable: true });
      return;
    }
    setPhase({ kind: 'parsing', uri: picked.uri });
    const parsed = await parseRoundScreenshot(picked.uri);
    if (parsed.kind === 'ok') {
      setPhase({ kind: 'confirm', uri: picked.uri, result: parsed.result });
      return;
    }
    if (parsed.kind === 'too_large') {
      setPhase({ kind: 'error', uri: picked.uri, message: 'Screenshot is too large. Pick a smaller one or crop it tighter first.', retryable: true });
      return;
    }
    if (parsed.kind === 'not_a_scorecard') {
      setPhase({ kind: 'error', uri: picked.uri, message: 'That doesn\'t look like a scorecard. Try a Golfshot / 18Birdies / GHIN screenshot, or a clear photo of a paper card.', retryable: true });
      return;
    }
    if (parsed.kind === 'no_network') {
      setPhase({ kind: 'error', uri: picked.uri, message: 'Network unavailable. Reconnect and try again.', retryable: true });
      return;
    }
    setPhase({ kind: 'error', uri: picked.uri, message: parsed.message, retryable: true });
  }, []);

  const onConfirm = useCallback(() => {
    if (phase.kind !== 'confirm') return;
    const input = buildPersistInput(phase.result);
    if (!input) {
      setPhase({ kind: 'error', uri: phase.uri, message: 'No hole scores were readable. Try a clearer screenshot.', retryable: true });
      return;
    }
    const id = addImportedRound(input);
    useToastStore.getState().show(`Round imported (${input.totalScore} on ${input.holesPlayed} holes)`);
    console.log('[import-round] persisted', id, input.courseName, input.totalScore);
    router.back();
  }, [phase, addImportedRound, router]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.headerIcon}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Import Past Round</Text>
        <View style={styles.headerIcon} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {phase.kind === 'pick' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text_primary }]}>Bring in a past round</Text>
            <Text style={[styles.cardBody, { color: colors.text_muted }]}>
              Pick a screenshot from Golfshot, 18Birdies, GHIN, the USGA app, or a clear photo of a paper scorecard.
              SmartPlay reads the holes, scores, and putts so the round counts toward your stats.
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              onPress={onPick}
            >
              <Ionicons name="image-outline" size={18} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>Choose screenshot</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase.kind === 'parsing' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, alignItems: 'center' }]}>
            <Image source={{ uri: phase.uri }} style={styles.previewSmall} resizeMode="cover" />
            <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 16 }} />
            <Text style={[styles.cardBody, { color: colors.text_primary, marginTop: 12 }]}>
              Reading the scorecard…
            </Text>
            <Text style={[styles.cardSub, { color: colors.text_muted }]}>
              This usually takes 4-10 seconds.
            </Text>
          </View>
        )}

        {phase.kind === 'confirm' && (
          <ConfirmCard
            colors={colors}
            uri={phase.uri}
            result={phase.result}
            onConfirm={onConfirm}
            onCancel={() => setPhase({ kind: 'pick' })}
          />
        )}

        {phase.kind === 'error' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: '#ef4444' }]}>
            <Text style={[styles.cardTitle, { color: '#ef4444' }]}>Import failed</Text>
            <Text style={[styles.cardBody, { color: colors.text_primary }]}>{phase.message}</Text>
            {phase.retryable && (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                onPress={onPick}
              >
                <Ionicons name="refresh-outline" size={18} color="#0d1a0d" />
                <Text style={styles.primaryBtnText}>Try a different screenshot</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
              onPress={() => router.back()}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text_primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ConfirmCard({
  colors, uri, result, onConfirm, onCancel,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  uri: string;
  result: RoundImportResult;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const scoredHoles = result.holes.filter(h => typeof h.score === 'number');
  const totalScore = result.total_score
    ?? scoredHoles.reduce((acc, h) => acc + (h.score ?? 0), 0);
  const totalPar = result.total_par
    ?? (scoredHoles.every(h => typeof h.par === 'number')
        ? scoredHoles.reduce((acc, h) => acc + (h.par ?? 0), 0)
        : null);
  const scoreVsPar = result.score_vs_par
    ?? (totalPar != null ? totalScore - totalPar : null);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.confirmHeader}>
        <Image source={{ uri }} style={styles.previewThumb} resizeMode="cover" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.confirmCourse, { color: colors.text_primary }]} numberOfLines={2}>
            {result.course_name ?? 'Unknown course'}
          </Text>
          {result.played_date && (
            <Text style={[styles.confirmDate, { color: colors.text_muted }]}>
              {result.played_date}
              {result.tee_color && result.tee_color !== 'unknown' ? ` · ${result.tee_color} tees` : ''}
            </Text>
          )}
          <View style={styles.confirmTotalsRow}>
            <Text style={[styles.confirmTotal, { color: colors.text_primary }]}>
              {totalScore || '—'}
            </Text>
            {scoreVsPar != null && (
              <Text style={[styles.confirmVsPar, { color: scoreVsPar <= 0 ? colors.accent : colors.text_muted }]}>
                {scoreVsPar === 0 ? 'E' : scoreVsPar > 0 ? `+${scoreVsPar}` : scoreVsPar}
              </Text>
            )}
            <Text style={[styles.confirmHolesPlayed, { color: colors.text_muted }]}>
              · {scoredHoles.length} holes
            </Text>
          </View>
        </View>
      </View>

      {result.warnings.length > 0 && (
        <View style={[styles.warningBox, { borderColor: colors.border, backgroundColor: colors.surface_elevated }]}>
          <Ionicons name="warning-outline" size={14} color="#F5A623" />
          <View style={{ flex: 1 }}>
            {result.warnings.map((w, i) => (
              <Text key={i} style={[styles.warningText, { color: colors.text_muted }]}>{w}</Text>
            ))}
          </View>
        </View>
      )}

      <Text style={[styles.holesHeader, { color: colors.text_muted }]}>HOLES</Text>
      <View style={styles.holesGrid}>
        {result.holes.map(h => (
          <View key={h.hole} style={[styles.holeCell, { borderColor: colors.border, backgroundColor: colors.surface_elevated }]}>
            <Text style={[styles.holeCellNum, { color: colors.text_muted }]}>{h.hole}</Text>
            <Text style={[styles.holeCellScore, { color: colors.text_primary }]}>
              {h.score ?? '—'}
            </Text>
            {h.par != null && (
              <Text style={[styles.holeCellPar, { color: colors.text_muted }]}>par {h.par}</Text>
            )}
            {h.putts != null && (
              <Text style={[styles.holeCellPutts, { color: colors.text_muted }]}>{h.putts}p</Text>
            )}
          </View>
        ))}
      </View>

      <Text style={[styles.confidenceTag, { color: colors.text_muted }]}>
        Read confidence: <Text style={{
          color: result.confidence === 'high' ? colors.accent : result.confidence === 'low' ? '#F5A623' : colors.text_primary,
          fontWeight: '800',
        }}>{result.confidence}</Text>
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
        onPress={onConfirm}
      >
        <Ionicons name="checkmark-circle-outline" size={18} color="#0d1a0d" />
        <Text style={styles.primaryBtnText}>Add to history</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.secondaryBtn, { borderColor: colors.border }]}
        onPress={onCancel}
      >
        <Text style={[styles.secondaryBtnText, { color: colors.text_primary }]}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 8,
  },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  scroll: { paddingBottom: 60 },
  card: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 14, borderWidth: 1, padding: 16,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  cardBody: { fontSize: 14, lineHeight: 21 },
  cardSub: { fontSize: 12, marginTop: 6 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 18, paddingVertical: 13, borderRadius: 12,
  },
  primaryBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    alignItems: 'center', justifyContent: 'center',
    marginTop: 10, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700' },
  previewSmall: { width: 120, height: 120, borderRadius: 10 },
  previewThumb: { width: 64, height: 64, borderRadius: 8, marginRight: 12 },
  confirmHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  confirmCourse: { fontSize: 16, fontWeight: '800' },
  confirmDate: { fontSize: 12, marginTop: 2 },
  confirmTotalsRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6, gap: 8 },
  confirmTotal: { fontSize: 28, fontWeight: '900' },
  confirmVsPar: { fontSize: 14, fontWeight: '800' },
  confirmHolesPlayed: { fontSize: 12 },
  warningBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 12, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1,
  },
  warningText: { fontSize: 12, lineHeight: 18 },
  holesHeader: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  holesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  holeCell: {
    width: 56, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, borderWidth: 1,
    alignItems: 'center',
  },
  holeCellNum: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  holeCellScore: { fontSize: 17, fontWeight: '900', marginTop: 2 },
  holeCellPar: { fontSize: 9, marginTop: 1 },
  holeCellPutts: { fontSize: 9, marginTop: 1 },
  confidenceTag: { fontSize: 12, marginTop: 14, marginBottom: 4 },
});
