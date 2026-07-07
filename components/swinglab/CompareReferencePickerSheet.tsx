/**
 * 2026-05-22 — Compare-to-Reference bottom sheet.
 *
 * Replaces the toast-only flow in the swing detail "Compare to a
 * reference swing" action. Modal sheet renders a ranked list of
 * candidate references from swingDatabase.searchSimilarSwings + each
 * row's similarity score + takeaway. Tap a row to "lock in" that
 * reference and trigger the full SwingComparisonEngine result via
 * onSelect. Defensive — empty state walks the user toward
 * /swinglab/upload to add their first reference.
 *
 * Pure modal — no external dep. react-native-svg already loaded by
 * other screens; we don't need it here.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet, Image,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { searchSimilarSwings, type SimilarMatch } from '../../services/swingDatabase';
import type { PoseEstimate } from '../../services/poseEstimator';
import { useResolvedImageUri } from '../../hooks/useResolvedImageUri';

// 2026-07-06 (elite audit) — reference thumbnails are persisted as ABSOLUTE
// file:// paths and iOS regenerates the container UUID on every native build,
// so render through the re-anchoring resolver instead of trusting the stored
// prefix (a stale path rendered a blank tile). Remote (YouTube) thumbs pass
// through untouched.
const ReferenceThumb = ({ uri }: { uri: string }) => {
  const healed = useResolvedImageUri(uri);
  return <Image source={{ uri: healed ?? uri }} style={styles.rowThumb} resizeMode="cover" />;
};

export interface CompareReferencePickerSheetProps {
  visible: boolean;
  /** Current swing's pose estimate — used for the similarity search. */
  current: PoseEstimate | null;
  /** Optional club filter passed to searchSimilarSwings. */
  clubFilter?: string | null;
  onClose: () => void;
  /** Caller picks the chosen reference's match. The sheet
   *  closes itself after onSelect returns. */
  onSelect: (match: SimilarMatch) => void;
  /** Optional CTA when the list is empty — typically "Add a reference". */
  onAddReference?: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  self_upload: 'Your upload',
  pro_clip: 'Pro reference',
  archetype: 'Ideal model',
};

export default function CompareReferencePickerSheet({
  visible, current, clubFilter, onClose, onSelect, onAddReference,
}: CompareReferencePickerSheetProps) {
  const { colors } = useTheme();
  const [matches, setMatches] = useState<SimilarMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      // Reset state when the sheet closes so a re-open re-fetches with
      // potentially-different current pose.
      setMatches(null);
      setError(null);
      return;
    }
    if (!current?.biomechanics) {
      setError('No biomechanics on this swing yet — re-analyze first.');
      setMatches([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await searchSimilarSwings(current, 8, clubFilter ? { club: clubFilter } : undefined);
        if (!cancelled) setMatches(result);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setMatches([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [visible, current, clubFilter]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.scrim}>
        <Pressable style={styles.scrimDismiss} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* Drag handle */}
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.text_muted, opacity: 0.4 }]} />
          </View>

          <View style={styles.headerRow}>
            <Text style={[styles.heading, { color: colors.text_primary }]}>Compare to…</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[styles.closeText, { color: colors.text_muted }]}>Close</Text>
            </Pressable>
          </View>
          <Text style={[styles.subheading, { color: colors.text_muted }]}>
            {clubFilter ? `Filtered to ${clubFilter}.` : 'All clubs.'} Ranked by match similarity.
          </Text>

          {matches === null ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
              <Text style={[styles.loadingText, { color: colors.text_muted }]}>Reading the database…</Text>
            </View>
          ) : matches.length === 0 ? (
            <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surface_elevated }]}>
              <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>
                {error ? 'Couldn\'t compare' : 'No references yet'}
              </Text>
              <Text style={[styles.emptyHint, { color: colors.text_muted }]}>
                {error ?? 'Upload a reference swing or add a pro clip. The built-in archetypes will show up here too.'}
              </Text>
              {onAddReference ? (
                <Pressable
                  onPress={onAddReference}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                >
                  <Text style={styles.primaryBtnText}>Add a reference swing</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll}>
              {matches.map((m, i) => (
                <Pressable
                  key={m.reference.id}
                  onPress={() => {
                    onSelect(m);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: pressed ? colors.surface_elevated : colors.background,
                      borderColor: i === 0 ? colors.accent : colors.border,
                      borderWidth: i === 0 ? 1.5 : 1,
                    },
                  ]}
                >
                  <View style={styles.rowThumbWrap}>
                    {m.reference.thumbnailUri ? (
                      <ReferenceThumb uri={m.reference.thumbnailUri} />
                    ) : (
                      <View style={[styles.rowThumb, { backgroundColor: colors.surface_elevated, alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ fontSize: 22 }}>
                          {m.reference.source === 'archetype' ? '🌟' : m.reference.source === 'pro_clip' ? '🏆' : '🎥'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: colors.text_primary }]} numberOfLines={1}>
                      {m.reference.label}
                    </Text>
                    <Text style={[styles.rowMeta, { color: colors.text_muted }]} numberOfLines={1}>
                      {SOURCE_LABEL[m.reference.source] ?? m.reference.source}
                      {m.reference.club ? `  ·  ${m.reference.club}` : ''}
                      {m.reference.proName ? `  ·  ${m.reference.proName}` : ''}
                    </Text>
                    {m.takeaways[0] ? (
                      <Text style={[styles.rowTakeaway, { color: colors.text_secondary }]} numberOfLines={2}>
                        {m.takeaways[0]}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.matchBadge, { borderColor: matchColor(m.similarity) }]}>
                    <Text style={[styles.matchValue, { color: matchColor(m.similarity) }]}>{m.similarity}</Text>
                    <Text style={[styles.matchLabel, { color: matchColor(m.similarity) }]}>MATCH</Text>
                  </View>
                </Pressable>
              ))}
              {onAddReference ? (
                <Pressable
                  onPress={onAddReference}
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.text_muted }]}>
                    ＋ Add another reference
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function matchColor(score: number): string {
  if (score >= 80) return '#86efac';
  if (score >= 60) return '#a3e635';
  if (score >= 40) return '#fbbf24';
  return '#f87171';
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  scrimDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8,
    maxHeight: '85%',
  },
  handleRow: { alignItems: 'center', marginBottom: 6 },
  handle: { width: 44, height: 4, borderRadius: 2 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  heading: { fontSize: 18, fontWeight: '800' },
  subheading: { fontSize: 12, marginBottom: 14 },
  closeText: { fontSize: 13, fontWeight: '700' },

  loading: { paddingVertical: 36, alignItems: 'center', gap: 10 },
  loadingText: { fontSize: 12, fontStyle: 'italic' },

  scroll: { gap: 10, paddingBottom: 16 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, padding: 10,
  },
  rowThumbWrap: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden' },
  rowThumb: { width: 56, height: 56 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 14, fontWeight: '800' },
  rowMeta: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  rowTakeaway: { fontSize: 12, lineHeight: 16, marginTop: 4 },

  matchBadge: {
    width: 54, height: 54, borderRadius: 27, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  matchValue: { fontSize: 18, fontWeight: '900', lineHeight: 20 },
  matchLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1.2, marginTop: 1 },

  emptyCard: {
    borderWidth: 1, borderRadius: 14, padding: 20, gap: 10, alignItems: 'center',
  },
  emptyTitle: { fontSize: 15, fontWeight: '800' },
  emptyHint: { fontSize: 12, textAlign: 'center', lineHeight: 18 },

  primaryBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  primaryBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 13, letterSpacing: 0.4 },
  secondaryBtn: {
    marginTop: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center',
  },
  secondaryBtnText: { fontWeight: '700', fontSize: 12, letterSpacing: 0.3 },
});
