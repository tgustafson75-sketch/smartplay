/**
 * ValidationSummary.tsx
 *
 * Post-round summary of all hole validation data.
 * Shows adjusted holes, average yardage correction, and top tags.
 * Rendered as a modal-style overlay triggered after the final hole.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Modal,
} from 'react-native';
import type { HoleValidation } from './useValidationStore';

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  validations: Record<number, HoleValidation>;
  baseHoles: Array<{ hole: number; par: number; yardage: number }>;
  onClose: () => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ValidationSummary({ visible, validations, baseHoles, onClose }: Props) {
  const entries = Object.values(validations);
  const adjusted = entries.filter((e) => e.yardageAdjustment !== 0).sort((a, b) => a.holeId - b.holeId);
  const parChanged = entries.filter((e) => e.parOverride !== undefined);

  const avgAdj =
    adjusted.length > 0
      ? Math.round(adjusted.reduce((a, e) => a + e.yardageAdjustment, 0) / adjusted.length)
      : 0;

  // Tag frequency
  const tagCounts: Record<string, number> = {};
  for (const e of entries) {
    for (const t of e.tags) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const totalTagged = entries.filter((e) => e.tags.length > 0).length;
  const totalValidated = entries.length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Validation Summary</Text>
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeBtnText}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {/* Quick stats */}
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={s.statNum}>{totalValidated}</Text>
              <Text style={s.statLabel}>Holes validated</Text>
            </View>
            <View style={s.statCard}>
              <Text style={[s.statNum, { color: avgAdj > 0 ? '#F59E0B' : avgAdj < 0 ? '#60A5FA' : '#A7F3D0' }]}>
                {avgAdj > 0 ? `+${avgAdj}` : String(avgAdj)}y
              </Text>
              <Text style={s.statLabel}>Avg yardage adjust</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statNum}>{totalTagged}</Text>
              <Text style={s.statLabel}>Holes tagged</Text>
            </View>
          </View>

          {/* Yardage adjustments */}
          {adjusted.length > 0 && (
            <>
              <Text style={s.sectionTitle}>YARDAGE CORRECTIONS</Text>
              {adjusted.map((e) => {
                const base = baseHoles.find((h) => h.hole === e.holeId)?.yardage ?? 0;
                return (
                  <View key={e.holeId} style={s.row}>
                    <Text style={s.rowHole}>Hole {e.holeId}</Text>
                    <Text style={s.rowDetail}>
                      {base}y → {base + e.yardageAdjustment}y
                      {'  '}
                      <Text style={{ color: e.yardageAdjustment > 0 ? '#F59E0B' : '#60A5FA', fontWeight: '700' }}>
                        {e.yardageAdjustment > 0 ? `+${e.yardageAdjustment}` : String(e.yardageAdjustment)}
                      </Text>
                    </Text>
                  </View>
                );
              })}
            </>
          )}

          {/* Par overrides */}
          {parChanged.length > 0 && (
            <>
              <Text style={s.sectionTitle}>PAR CORRECTIONS</Text>
              {parChanged.map((e) => {
                const base = baseHoles.find((h) => h.hole === e.holeId)?.par ?? 4;
                return (
                  <View key={e.holeId} style={s.row}>
                    <Text style={s.rowHole}>Hole {e.holeId}</Text>
                    <Text style={s.rowDetail}>
                      Par {base} → Par {e.parOverride}
                    </Text>
                  </View>
                );
              })}
            </>
          )}

          {/* Top tags */}
          {topTags.length > 0 && (
            <>
              <Text style={s.sectionTitle}>COMMON CONDITIONS</Text>
              {topTags.map(([tag, count]) => (
                <View key={tag} style={s.row}>
                  <Text style={s.rowTag}>{tag}</Text>
                  <View style={s.countBadge}>
                    <Text style={s.countText}>{count} {count === 1 ? 'hole' : 'holes'}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {totalValidated === 0 && (
            <Text style={s.emptyText}>No holes validated this round.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a1a0e', padding: 20 },

  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingTop: 8 },
  title:        { color: '#fff', fontSize: 20, fontWeight: '800' },
  closeBtn:     { backgroundColor: '#059669', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  closeBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  statsRow:     { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard:     { flex: 1, backgroundColor: '#111E14', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1F3A22' },
  statNum:      { color: '#A7F3D0', fontSize: 22, fontWeight: '800', marginBottom: 2 },
  statLabel:    { color: '#6B7280', fontSize: 11, textAlign: 'center' },

  sectionTitle: { color: '#4B5563', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 16 },

  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#111E14' },
  rowHole:      { color: '#9CA3AF', fontSize: 14, fontWeight: '600', minWidth: 64 },
  rowDetail:    { color: '#fff', fontSize: 14 },
  rowTag:       { color: '#93C5FD', fontSize: 14 },
  countBadge:   { backgroundColor: '#1E3A5F', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  countText:    { color: '#93C5FD', fontSize: 12 },

  emptyText:    { color: '#4B5563', fontSize: 14, textAlign: 'center', marginTop: 40 },
});
