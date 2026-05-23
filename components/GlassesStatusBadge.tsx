/**
 * 2026-05-23 — Glasses status badge.
 *
 * Tiny inline chip that surfaces the live Ray-Ban Meta connection
 * state. Designed to drop into the header of any tool screen
 * (SmartMotion, PuttingLab, SmartVision, Lie Analysis) without
 * pushing layout around — when glasses aren't available it renders
 * nothing.
 *
 * Renders ONE of three states (when available):
 *   - MULTIMODAL ON   (green, glasses streaming + frames flowing)
 *   - GLASSES PAIRED  (amber, session up but no recent frame —
 *                      typically right after start, or stale)
 *   - GLASSES OFF     (neutral, available but no session)
 *
 * Tap behavior: optional onPress so the badge can deep-link into
 * Settings → Connect Ray-Ban Meta. When onPress is omitted the badge
 * is non-interactive (informational chip only).
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGlassesStatus } from '../hooks/useGlassesStatus';

interface Props {
  onPress?: () => void;
  /** When true (default), the badge renders nothing while
   *  `available === false` so non-DAT builds stay clean. Set false
   *  in dev builds to confirm the badge is actually mounted. */
  hideWhenUnavailable?: boolean;
}

export default function GlassesStatusBadge({ onPress, hideWhenUnavailable = true }: Props) {
  const status = useGlassesStatus();
  if (hideWhenUnavailable && !status.available) return null;

  const { label, color, dotColor } = (() => {
    if (status.multimodalReady) {
      return { label: 'MULTIMODAL ON', color: '#86efac', dotColor: '#22c55e' };
    }
    if (status.connected) {
      return { label: 'GLASSES PAIRED', color: '#fbbf24', dotColor: '#f59e0b' };
    }
    return { label: 'GLASSES OFF', color: '#9ca3af', dotColor: '#6b7280' };
  })();

  const inner = (
    <View style={[styles.chip, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Ray-Ban Meta glasses: ${label.toLowerCase()}. Tap for settings.`}>
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
});
