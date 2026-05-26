/**
 * 2026-05-26 — Fix BL: SmartPlay live-wind badge for hole-view overlay.
 *
 * Tim: "We can place our windage bubble over the images if we can set
 * it logically to float there."
 *
 * Two birds, one stone:
 *   1. Covers the noisiest cluster of baked-in 18Birdies chrome — the
 *      floating "Mid 117y / Back 128y / See wind & slope" bubbles that
 *      cluster in the top-center of the hole image. Our pill is opaque
 *      enough to hide them.
 *   2. Surfaces live wind data + relative direction (head/tail/cross/
 *      quarter) — actually useful for the player's shot choice, which
 *      the 18B static bubbles never were inside SmartPlay's flow.
 *
 * Position: absolute top: ~5% of container height, centered horizontally.
 * Sized to ~50% width × auto height so it overlaps the top-center
 * region where the 18B yardage bubbles + "See wind & slope" pill
 * typically render.
 *
 * Renders only when round is active AND weather is available.
 * Gracefully shrinks to nothing when offline.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useCurrentWeather } from '../../hooks/useCurrentWeather';

interface Props {
  /** Total container width — used to size the badge proportionally. */
  containerWidth: number;
  /** Total container height — used to compute top offset. */
  containerHeight: number;
}

/**
 * Convert meteorological wind direction (degrees FROM) and shot bearing
 * (degrees TO target) into a player-facing label: "Tail", "Head",
 * "Cross L→R", etc. The wind is in the player's face when it comes FROM
 * the shot bearing (delta ~0°); at their back when FROM opposite
 * (delta ~180°); cross when ~90°.
 */
function relativeWindLabel(windFromDeg: number | null, shotBearingDeg: number | null): string {
  if (windFromDeg == null || shotBearingDeg == null) return 'Wind';
  // delta = angle the wind comes from RELATIVE to the shot line.
  // 0° = wind comes from where you're aiming → headwind.
  // 180° = wind comes from behind you → tailwind.
  const delta = ((windFromDeg - shotBearingDeg + 540) % 360) - 180;
  const abs = Math.abs(delta);
  if (abs <= 30) return 'Head';
  if (abs >= 150) return 'Tail';
  // Cross — pick L or R from delta sign. Negative delta = wind comes
  // from LEFT of the shot line → blows the ball RIGHT (R drift).
  // We label by the side the wind COMES FROM.
  const side = delta < 0 ? 'L' : 'R';
  if (abs >= 60 && abs <= 120) return `Cross ${side}`;
  // Quartering — between cross and head/tail.
  if (abs < 90) return `Q-Head ${side}`;
  return `Q-Tail ${side}`;
}

export default function WindageBadge({ containerWidth, containerHeight }: Props) {
  const { colors } = useTheme();
  const { weather, shotBearingDeg } = useCurrentWeather();

  if (!weather) return null;
  const mph = Math.round(weather.wind_speed_mph ?? 0);
  const label = relativeWindLabel(weather.wind_direction_deg, shotBearingDeg);

  const badgeWidth = Math.min(280, Math.max(180, containerWidth * 0.55));
  const topOffset = Math.max(8, containerHeight * 0.05);
  const leftOffset = (containerWidth - badgeWidth) / 2;

  return (
    <View
      style={[
        styles.badge,
        {
          width: badgeWidth,
          top: topOffset,
          left: leftOffset,
          backgroundColor: 'rgba(13, 36, 24, 0.92)',
          borderColor: colors.accent,
        },
      ]}
      pointerEvents="none"
    >
      <Ionicons name="navigate" size={14} color={colors.accent} style={styles.icon} />
      <Text style={[styles.value, { color: colors.accent }]}>{mph}</Text>
      <Text style={[styles.unit, { color: colors.accent }]}>mph</Text>
      <View style={[styles.divider, { backgroundColor: colors.accent }]} />
      <Text style={[styles.label, { color: '#ffffff' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1.5,
    gap: 5,
    // SDK 54 elevation shadow on Android; iOS uses shadowColor/Opacity.
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  icon: { marginRight: 2 },
  value: { fontSize: 18, fontWeight: '900' },
  unit: { fontSize: 11, fontWeight: '700', marginLeft: 1, marginRight: 4 },
  divider: { width: 1, height: 16, opacity: 0.45, marginHorizontal: 4 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
});
