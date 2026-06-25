/**
 * Active Listening status pill — Caddie tab.
 *
 * 2026-05-16: Tim's report — Kevin was responding to ambient TV audio
 * with no on-screen indication the mic was live. Two missing UX
 * affordances: (1) the user couldn't tell the mic was hot; (2) toggling
 * it off required digging into Settings.
 *
 * This pill renders ONLY when the VAD is actually live — i.e. Active
 * Listening is on AND a round is active. Tap = immediately disable
 * Active Listening (single setter, no confirmation dialog).
 *
 * Render conditions intentionally tight: no round → no pill (no false
 * sense of "always listening"). Active Listening off → no pill (no
 * clutter when nothing's listening).
 */

import React, { useEffect, useRef } from 'react';
import { Text, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '../../store/settingsStore';
import { useRoundStore } from '../../store/roundStore';
import { useToastStore } from '../../store/toastStore';

export function ActiveListeningPill() {
  const autoListenEnabled = useSettingsStore(s => s.autoListenEnabled);
  const setAutoListenEnabled = useSettingsStore(s => s.setAutoListenEnabled);
  const isRoundActive = useRoundStore(s => s.isRoundActive);

  const visible = autoListenEnabled && isRoundActive;

  // Pulse animation while visible so the mic dot reads as "live" rather
  // than just "on". Stops when hidden so we pay zero animation cost
  // when the pill isn't rendered.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  if (!visible) return null;

  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] });

  const handleTap = () => {
    setAutoListenEnabled(false);
    useToastStore.getState().show('Active Listening muted');
  };

  return (
    <Pressable
      onPress={handleTap}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Active Listening is on. Tap to mute."
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
    >
      <Animated.View style={[styles.dot, { opacity: dotOpacity, transform: [{ scale: dotScale }] }]} />
      <Ionicons name="mic" size={14} color="#0d1a0d" />
      <Text style={styles.label}>Active Listening</Text>
      <Text style={styles.muteHint}>tap to mute</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#00C896',
    alignSelf: 'center',
  },
  pillPressed: { opacity: 0.7 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 2,
  },
  label: { color: '#0d1a0d', fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },
  muteHint: { color: 'rgba(13, 26, 13, 0.7)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
});

export default ActiveListeningPill;
