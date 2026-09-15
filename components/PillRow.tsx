/**
 * 2026-09-14 (Tim — "Make profile setup buttons where it can be and only type when needed") —
 * THE PILL ROW, extracted so there is one of it.
 *
 * It was declared INSIDE the Settings component, closing over that screen's `colors` and
 * `styles`. That made it unreachable from anywhere else, which is why `app/profile.tsx` had no
 * button controls at all and its header said the detailed fields "still live in Settings, so we
 * don't fork the edit form" — the form could not move, because its only control could not.
 *
 * A labelled row of mutually-exclusive choices. The selected value is the one that matches
 * `value`; nothing is selected when `value` matches no option, which is the honest rendering of a
 * field the player has not answered yet rather than a silently-defaulted first pill.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

export interface PillOption {
  label: string;
  value: string;
}

export interface PillRowProps {
  label: string;
  options: PillOption[];
  /** The selected value. A value matching no option renders nothing selected — that is correct. */
  value: string;
  onSelect: (v: string) => void;
  /** Drops the divider above the label, for the first row in a card. */
  noDivider?: boolean;
}

export function PillRow({ label, options, value, onSelect, noDivider }: PillRowProps) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={[s.section, noDivider && { borderTopWidth: 0, paddingTop: 0 }]}>
      <Text style={s.label}>{label}</Text>
      <View style={s.row}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.pill, active && { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}
              onPress={() => onSelect(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${opt.label}`}
            >
              <Text style={[s.pillText, active && { color: colors.accent, fontWeight: '700' }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    section: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
    label: { color: colors.text_secondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
    row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    pill: {
      paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1,
      borderColor: colors.border, backgroundColor: colors.surface_elevated,
    },
    pillText: { color: colors.text_muted, fontSize: 13, fontWeight: '600' },
  });
}

export default PillRow;
