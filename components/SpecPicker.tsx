/**
 * 2026-09-14 (Tim) — "Include dropdowns for Shaft Brand and weight for each club and grip size."
 *
 * A DROPDOWN, because these are closed sets. The options themselves live in
 * `services/clubSpecOptions` — this renders them and nothing more, so a list can never be declared
 * by a screen.
 *
 * Why a modal sheet and not a native picker: `@react-native-picker/picker` is not in this project,
 * and the two platforms render it as two different controls (a wheel on iOS, a spinner dialog on
 * Android) — on a Z Fold's short closed aspect the iOS wheel eats a third of the screen. A sheet of
 * rows is one control on both, reads at any aspect ratio, and shows the current value with a tick
 * rather than requiring a scroll to find out what is selected.
 *
 * CLEARING IS A FIRST-CLASS ANSWER. "Not set" sits at the top of every list, because the honest
 * state of a shaft weight you have not looked up is unknown, and a picker that can only ever move
 * from one wrong answer to another is how a bag fills with confident fiction.
 * [[illustration-data-points]]
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';

export interface SpecPickerProps {
  /** Shown above the control. */
  label: string;
  /** Current value, or undefined when unset. */
  value?: string;
  options: readonly string[];
  /** Called with the chosen value, or undefined when cleared. */
  onChange: (v: string | undefined) => void;
  /** Lays two pickers side by side when true. */
  compact?: boolean;
}

export function SpecPicker({ label, value, options, onChange, compact }: SpecPickerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const s = makeStyles(colors);
  const unset = t('bag.spec.not_set');

  const choose = (v: string | undefined) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <View style={[s.wrap, compact && { flex: 1 }]}>
      <Text style={s.label}>{label}</Text>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={s.control}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ?? unset }}
      >
        <Text style={[s.value, !value && s.valueUnset]} numberOfLines={1}>{value ?? unset}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.text_muted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* The scrim closes the sheet — a picker you can only leave by choosing is a trap. */}
        <Pressable style={s.scrim} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={t('bag.spec.close')}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>{label}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity onPress={() => choose(undefined)} style={s.row} accessibilityRole="button">
                <Text style={[s.rowText, s.valueUnset]}>{unset}</Text>
                {value == null && <Ionicons name="checkmark" size={18} color={colors.accent} />}
              </TouchableOpacity>
              {options.map((o) => (
                <TouchableOpacity key={o} onPress={() => choose(o)} style={s.row} accessibilityRole="button">
                  <Text style={s.rowText}>{o}</Text>
                  {value === o && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    wrap: { gap: 4 },
    label: { color: colors.text_muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
    control: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 10, paddingVertical: 9,
    },
    value: { color: colors.text_primary, fontSize: 13, fontWeight: '600', flex: 1 },
    valueUnset: { color: colors.text_muted, fontWeight: '500' },
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
    sheet: {
      backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
      paddingVertical: 12, paddingHorizontal: 8,
    },
    sheetTitle: {
      color: colors.text_muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
      paddingHorizontal: 12, paddingBottom: 8,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingVertical: 12,
    },
    rowText: { color: colors.text_primary, fontSize: 15, fontWeight: '600' },
  });
}
