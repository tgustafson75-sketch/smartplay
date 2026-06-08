/**
 * 2026-06-07 — Shot Tracked sheet (cart-mark verification UI).
 *
 * Appears after the player taps the cart at the ball's resting spot. Shows
 * the just-tracked shot distance + approach to the pin, with a DEFAULT
 * club chip you tap to open a horizontal SCROLL picker and correct it
 * (no separate interface — see memory club-tied-shot-tracking). Correcting
 * the club re-points the learned bag model via correctShotClub.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { CLUB_ORDER, type ClubName } from '../../store/clubStatsStore';
import type { ShotTrackResult } from '../../services/shotTracking';

export function ClubScrollPicker({
  value,
  onSelect,
}: {
  value: ClubName | null;
  onSelect: (c: ClubName) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
      {CLUB_ORDER.map((c) => {
        const sel = c === value;
        return (
          <Pressable
            key={c}
            onPress={() => onSelect(c)}
            style={[styles.clubChip, { borderColor: sel ? colors.accent : colors.border, backgroundColor: sel ? colors.accent : colors.surface_elevated }]}
          >
            <Text style={[styles.clubChipText, { color: sel ? '#06281b' : colors.text_secondary }]}>{c}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function ShotTrackedSheet({
  result,
  onCorrectClub,
  onDismiss,
}: {
  result: ShotTrackResult;
  onCorrectClub: (club: ClubName) => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [club, setClub] = useState<ClubName | null>(result.club);

  const estimated = result.distanceSource === 'hole_yardage';

  return (
    <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
      <View style={styles.row}>
        <Ionicons name="golf" size={18} color={colors.accent} />
        <Text style={[styles.title, { color: colors.text_primary }]}>SHOT TRACKED</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Confirm tracked shot">
          <Ionicons name="checkmark-circle" size={26} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text_primary }]}>
            {result.shotDistanceYards != null ? `${estimated ? '~' : ''}${result.shotDistanceYards}` : '—'}
          </Text>
          <Text style={[styles.statLabel, { color: colors.text_muted }]}>YDS{estimated ? ' (est)' : ''}</Text>
        </View>

        {/* Club chip — tap to scroll-correct. */}
        <Pressable onPress={() => setEditing((v) => !v)} style={[styles.clubBtn, { borderColor: colors.border, backgroundColor: colors.surface_elevated }]}>
          <Ionicons name="golf-outline" size={15} color={colors.accent} />
          <Text style={[styles.clubBtnText, { color: colors.text_primary }]}>{club ?? 'Tag club'}</Text>
          <Ionicons name={editing ? 'chevron-up' : 'chevron-down'} size={14} color={colors.text_muted} />
        </Pressable>

        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.accent }]}>{result.approachYards != null ? result.approachYards : '—'}</Text>
          <Text style={[styles.statLabel, { color: colors.text_muted }]}>TO PIN</Text>
        </View>
      </View>

      {editing ? (
        <ClubScrollPicker
          value={club}
          onSelect={(c) => { setClub(c); onCorrectClub(c); setEditing(false); }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { borderWidth: 1.5, borderRadius: 16, padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  statLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginTop: 1 },
  clubBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  clubBtnText: { fontSize: 14, fontWeight: '800' },
  pickerRow: { gap: 6, paddingVertical: 2 },
  clubChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, minWidth: 44, alignItems: 'center' },
  clubChipText: { fontSize: 13, fontWeight: '800' },
});
