/**
 * Cockpit Mode — ShotResultRow
 *
 * Manual shot entry as a redundant backup to Pro's voice + auto-detection
 * paths. v3 had this on the caddie tab; Pro never did. Adds parity so
 * the user always has a one-tap fallback when:
 *   - voice doesn't catch the shot description
 *   - shotDetectionService misses the impact
 *   - user just wants to bang a quick result in without talking
 *
 * Layout (two rows):
 *   Row 1: ✓ Good (green) · ↓ Short (gold) · ↑ Long (gold)
 *   Row 2: ← Left (blue) · ↑ Straight (green) · Right → (red) · ⊕ Mark (gold)
 *
 * Distance + Direction are independent — tapping one logs that
 * aspect; the user can tap one or both. Mark captures current GPS
 * via Pro's positionMarkBus (same path the in-app Mark button uses).
 *
 * Non-developer note: this is presentational. The parent
 * (CockpitCaddieScreen) decides what to do with each callback —
 * typically calling roundStore.logShot() for distance/direction and
 * forceMarkPosition() for Mark.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';

export type ShotDistanceResult = 'good' | 'short' | 'long';
export type ShotDirectionResult = 'left' | 'straight' | 'right';

export interface ShotResultRowProps {
  onLogDistance: (result: ShotDistanceResult) => void;
  onLogDirection: (result: ShotDirectionResult) => void;
  onMarkShot: () => void;
  /**
   * 2026-05-22 — Refresh GPS pill. Optional; when supplied, renders a
   * "📍 GPS" pill on row 2 next to Mark. Calls the shared
   * services/refreshGpsAction handler (which bumps GPS active, runs
   * forceHoleReconciliation, and toasts the result).
   */
  onRefreshGps?: () => void;
}

export function ShotResultRow({
  onLogDistance,
  onLogDirection,
  onMarkShot,
  onRefreshGps,
}: ShotResultRowProps) {
  const { colors } = useTheme();
  const GOLD = '#F0C030';
  const BLUE = '#5DADE2';

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      <Text style={[styles.heading, { color: colors.text_muted }]}>SHOT RESULT</Text>

      {/* Row 1 — distance feedback */}
      <View style={styles.row}>
        <Pill label="✓ Good"  color={colors.accent} onPress={() => onLogDistance('good')} />
        <Pill label="↓ Short" color={GOLD}          onPress={() => onLogDistance('short')} />
        <Pill label="↑ Long"  color={GOLD}          onPress={() => onLogDistance('long')} />
      </View>

      {/* Row 2 — direction + Mark */}
      <View style={styles.row}>
        <Pill label="← Left"     color={BLUE}          onPress={() => onLogDirection('left')} />
        <Pill label="↑ Straight" color={colors.accent} onPress={() => onLogDirection('straight')} />
        <Pill label="Right →"    color={colors.error}  onPress={() => onLogDirection('right')} />
        <Pill label="⊕ Mark"     color={GOLD}          onPress={onMarkShot} />
        {onRefreshGps && (
          <Pill label="📍 GPS"    color={BLUE}          onPress={onRefreshGps} />
        )}
      </View>
    </View>
  );
}

interface PillProps {
  label: string;
  color: string;
  onPress: () => void;
}

function Pill({ label, color, onPress }: PillProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        {
          borderColor: color,
          backgroundColor: hexAlpha(color, 0.1),
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.pillText, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/**
 * Convert a #rrggbb hex to an rgba() with the given alpha. Allows the
 * pill backgrounds to be tinted with the same color used for the
 * border + text, at low opacity. Returns the raw input unchanged on
 * non-hex strings (defensive).
 */
function hexAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  heading: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

export default ShotResultRow;
