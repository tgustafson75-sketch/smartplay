/**
 * 2026-06-08 — Golfer avatar. Shows a profile PHOTO when set (raw selfie
 * or AI-stylized caddie/pro portrait), otherwise the golfer's INITIALS in
 * a branded circle. Used in Coach Mode + the family roster. Replaces the
 * emoji-only avatar; initials are the friendly default.
 */

import React from 'react';
import { View, Text, Image, StyleSheet, type StyleProp, type ViewStyle, type ImageStyle } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

function initialsOf(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function GolferAvatar({
  firstName, photoUri, size = 44, ringColor, style,
}: {
  firstName: string;
  photoUri?: string | null;
  size?: number;
  /** Optional selected/active ring. */
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const radius = size / 2;
  const ring = ringColor ? { borderWidth: 2, borderColor: ringColor } : null;

  if (photoUri) {
    return (
      <Image
        source={{ uri: photoUri }}
        style={[{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surface }, ring, style as StyleProp<ImageStyle>]}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      style={[
        styles.initialsWrap,
        { width: size, height: size, borderRadius: radius, backgroundColor: colors.accent_muted },
        ring,
        style,
      ]}
    >
      <Text style={{ color: colors.accent, fontWeight: '800', fontSize: size * 0.4 }}>
        {initialsOf(firstName)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initialsWrap: { alignItems: 'center', justifyContent: 'center' },
});
