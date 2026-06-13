/**
 * 2026-06-12 — Global battery-saver prompt.
 *
 * services/batteryMonitor sets `promptVisible` when the battery drops to ≤20%
 * during an active round, and engages setBatterySaverFloor('walking') on accept.
 * Until now that state was ONLY rendered by app/battery-debug.tsx (a debug screen),
 * so in the real app the prompt NEVER appeared — the monitor fired into the void and
 * the player never got the chance to ease GPS (Tim's Z Fold drained mid-round). This
 * mounts once globally (sibling to GlobalToast in _layout) so the offer actually shows.
 *
 * Non-blocking banner, not a modal — it sits at the top and the round keeps going
 * whether or not the player taps. Honest copy: saver keeps yardages ACCURATE, just
 * refreshed a little slower (walking mode = 10s / High instead of 1Hz BestForNav).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  subscribeBattery,
  acceptBatterySaver,
  declineBatterySaver,
  type BatteryState,
} from '../../services/batteryMonitor';

export function BatterySaverPrompt() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [bs, setBs] = useState<BatteryState | null>(null);
  useEffect(() => subscribeBattery(setBs), []);

  if (!bs?.promptVisible) return null;
  const pct = bs.level != null ? Math.round(bs.level * 100) : null;

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
        <View style={styles.headRow}>
          <Ionicons name="battery-half-outline" size={20} color={colors.warning} />
          <Text style={[styles.title, { color: colors.text_primary }]}>
            Battery low{pct != null ? ` · ${pct}%` : ''}
          </Text>
        </View>
        <Text style={[styles.body, { color: colors.text_secondary }]}>
          Ease GPS to stretch your round? Yardages stay accurate — they just refresh a touch slower.
        </Text>
        <View style={styles.btnRow}>
          <Pressable
            onPress={declineBatterySaver}
            style={[styles.btn, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Keep full GPS power"
          >
            <Text style={[styles.btnText, { color: colors.text_secondary }]}>Keep full power</Text>
          </Pressable>
          <Pressable
            onPress={acceptBatterySaver}
            style={[styles.btn, { backgroundColor: colors.accent, borderColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Turn on battery saver"
          >
            <Ionicons name="leaf-outline" size={15} color="#06281b" />
            <Text style={[styles.btnText, { color: '#06281b', fontWeight: '800' }]}>Save battery</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 50, alignItems: 'center' },
  card: {
    width: '100%', maxWidth: 460, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
  body: { fontSize: 13, lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 10,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
});
