import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { SmartFinderMode } from '../../store/smartFinderStore';

type Props = {
  mode: SmartFinderMode;
  onChange: (mode: SmartFinderMode) => void;
};

const ITEMS: { mode: SmartFinderMode; label: string }[] = [
  { mode: 'standard', label: 'Standard' },
  { mode: 'target', label: 'Target' },
  { mode: 'map', label: 'Map' },
];

/**
 * Three-button segmented toggle for SmartFinder modes. Mode preference is
 * persisted in smartFinderStore.
 */
export default function SmartFinderModeToggle({ mode, onChange }: Props) {
  return (
    <View style={styles.row}>
      {ITEMS.map((item, i) => {
        const active = item.mode === mode;
        return (
          <TouchableOpacity
            key={item.mode}
            onPress={() => onChange(item.mode)}
            style={[
              styles.btn,
              i === 0 && styles.btnLeft,
              i === ITEMS.length - 1 && styles.btnRight,
              active && styles.btnActive,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: '#0a1e12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    overflow: 'hidden',
    marginHorizontal: 16,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  btnLeft: {},
  btnRight: {},
  btnActive: { backgroundColor: '#003d20' },
  label: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  labelActive: { color: '#00C896' },
});
