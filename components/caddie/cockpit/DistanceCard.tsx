/**
 * Cockpit Mode — DistanceCard
 *
 * Big yards-to-pin hero + FRONT/CENTER/BACK strip with green glow.
 * Tapping the card opens Pro's existing SmartFinder screen
 * (app/smartfinder.tsx) which has the full rangefinder + zoom + lock UX.
 *
 * Source of yardage:
 *   - `fmb` prop carries the live front/middle/back values supplied by
 *     the parent (CockpitCaddieScreen) from Pro's smartFinderService
 *     `getGreenYardagesSync()` plus subscribeFixChange() updates.
 *   - `baseYardage` is the static hole distance fallback when GPS hasn't
 *     produced a fix yet.
 *
 * Non-developer note: this card is a VIEW. The actual rangefinder math
 * lives in services/smartFinderService.ts which is unchanged. This
 * component just paints the result + offers a tap-through to the full
 * SmartFinder screen for zoom and locking.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';

export interface FrontMiddleBack {
  front: number | null;
  middle: number | null;
  back: number | null;
}

export interface DistanceCardProps {
  fmb: FrontMiddleBack | null;
  baseYardage?: number | null;
  /** 'good' = green dot, 'weak' = muted, 'off' = pin-with-slash. */
  gpsAccuracy?: 'good' | 'weak' | 'off';
  unit?: 'yards' | 'meters';
  onPressOpenRangefinder?: () => void;
}

export function DistanceCard({
  fmb,
  baseYardage,
  gpsAccuracy = 'off',
  unit = 'yards',
  onPressOpenRangefinder,
}: DistanceCardProps) {
  const { colors } = useTheme();

  const middle = fmb?.middle ?? baseYardage ?? null;
  const front = fmb?.front ?? null;
  const back = fmb?.back ?? null;
  const unitLabel = unit === 'meters' ? 'METERS TO PIN' : 'YARDS TO PIN';

  return (
    <Pressable
      onPress={onPressOpenRangefinder}
      accessibilityRole="button"
      accessibilityLabel="Open SmartFinder rangefinder"
      style={({ pressed }) => [
        styles.outer,
        {
          borderColor: colors.accent,
          backgroundColor: colors.surface_elevated,
          opacity: pressed ? 0.92 : 1,
          // Subtle glow — green shadow on iOS. Android falls back to
          // elevation (no native colored shadow), still gets the border.
          shadowColor: colors.accent,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: colors.text_primary }]}>
          <Text style={{ color: colors.accent }}>SMART </Text>FINDER
        </Text>
        <View style={[styles.gpsBadge, { borderColor: colors.accent }]}>
          <Ionicons
            name={gpsAccuracy === 'off' ? 'locate-outline' : 'locate'}
            size={16}
            color={gpsAccuracy === 'good' ? colors.accent : colors.text_muted}
          />
        </View>
      </View>

      <Text style={[styles.hero, { color: colors.text_primary }]}>
        {middle != null ? String(middle) : '—'}
      </Text>
      <Text style={[styles.heroLabel, { color: colors.text_muted }]}>{unitLabel}</Text>

      <View style={[styles.fmbRow, { borderTopColor: colors.border }]}>
        <FmbCell label="FRONT" value={front} accent />
        <FmbCell label="CENTER" value={middle} hero />
        <FmbCell label="BACK" value={back} accent />
      </View>
    </Pressable>
  );
}

interface FmbCellProps {
  label: string;
  value: number | null;
  hero?: boolean;
  accent?: boolean;
}

function FmbCell({ label, value, hero, accent }: FmbCellProps) {
  const { colors } = useTheme();
  const valueColor = hero ? colors.accent : accent ? '#F0C030' : colors.text_primary;
  const labelColor = hero ? colors.accent : accent ? '#F0C030' : colors.text_muted;
  return (
    <View style={styles.fmbCell}>
      <Text style={[styles.fmbLabel, { color: labelColor }]}>{label}</Text>
      <Text style={[styles.fmbValue, { color: valueColor }, hero && styles.fmbValueHero]}>
        {value != null ? String(value) : '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginHorizontal: 12,
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    // iOS glow; no-op on Android.
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  gpsBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    fontSize: 84,
    lineHeight: 92,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 4,
    letterSpacing: -2,
  },
  heroLabel: {
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 1.4,
    marginTop: -2,
  },
  fmbRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  fmbCell: {
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  fmbLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  fmbValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  fmbValueHero: {
    fontSize: 22,
    fontWeight: '900',
  },
});

export default DistanceCard;
