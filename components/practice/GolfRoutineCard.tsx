/**
 * 2026-11-01 — Reusable golf routine checklist (ported from SmartPump's golf mobility work).
 *
 * Presentational only: the caller owns the moves and the done-set and gets every toggle back through
 * onToggle. Groups moves by mobility / activation in the order the data gives them.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { ACCENT_SKY } from '../../theme/tokens';
import type { GolfRoutineGroup, GolfRoutineMove } from '../../services/practice/golfRoutine';

interface Props {
  moves: readonly GolfRoutineMove[];
  done: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

const GROUP_ORDER: GolfRoutineGroup[] = ['mobility', 'activation'];

export function GolfRoutineCard({ moves, done, onToggle }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
      {GROUP_ORDER.map((group) => {
        const groupMoves = moves.filter((m) => m.group === group);
        if (groupMoves.length === 0) return null;
        return (
          <View key={group}>
            <Text style={[styles.groupLabel, { color: colors.text_muted }]}>
              {group === 'mobility' ? t('practice_preround.golf_routine.group_mobility') : t('practice_preround.golf_routine.group_activation')}
            </Text>
            {groupMoves.map((move) => {
              const checked = done.has(move.id);
              return (
                <TouchableOpacity
                  key={move.id}
                  style={styles.move}
                  onPress={() => onToggle(move.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                >
                  <Ionicons
                    name={checked ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={checked ? '#3FB950' : colors.text_muted}
                    style={styles.check}
                  />
                  <View style={styles.moveBody}>
                    <View style={styles.moveTitleRow}>
                      <Text style={[styles.moveName, { color: colors.text_primary }]}>{move.name}</Text>
                      <Text style={[styles.moveDose, { color: ACCENT_SKY }]}>{move.dose}</Text>
                    </View>
                    <Text style={[styles.moveCue, { color: colors.text_muted }]}>{move.cue}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12, gap: 6 },
  groupLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 4, marginBottom: 4 },
  move: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  check: { marginTop: 1 },
  moveBody: { flex: 1 },
  moveTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  moveName: { fontSize: 14, fontWeight: '700', flex: 1 },
  moveDose: { fontSize: 12, fontWeight: '800' },
  moveCue: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});
