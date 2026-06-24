/**
 * Cockpit Mode — SmartToolsRow
 *
 * Four pill buttons row: Vision (green), Motion (sky), Play (green),
 * Settings (amber). Each pill routes to the corresponding screen.
 *
 * 2026-06-23 (Tim) — colors snapped to the disciplined 3-color brand palette
 * (GREEN core/capture/play · SKY analysis · AMBER practice/warmth). Retired the
 * prior blue/pink/gold so cockpit + standard tool rows read on-brand and match.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ACCENT_GREEN, ACCENT_AMBER, ACCENT_SKY } from '../../../theme/tokens';

// Tinted pill backgrounds (~8% of each accent), kept inline so the row reads at
// a glance. Derived from the palette constants above.
const BG_GREEN = 'rgba(0,200,150,0.08)';   // ACCENT_GREEN
const BG_SKY   = 'rgba(56,189,248,0.08)';  // ACCENT_SKY
const BG_AMBER = 'rgba(251,191,36,0.08)';  // ACCENT_AMBER

export interface SmartToolsRowProps {
  onVision: () => void;
  onMotion: () => void;
  onPlay: () => void;
  onSettings: () => void;
  // 2026-05-26 — Fix DV: cockpit had no way to reach the full tools
  // menu (Drills, Library, Mark Location, Caddie Clip Test, etc.) —
  // user was stuck with just Vision/Motion/Play/Settings. Optional
  // prop so non-cockpit callers keep working unchanged; cockpit
  // passes a handler that opens the global tools menu.
  onAllTools?: () => void;
}

export function SmartToolsRow({ onVision, onMotion, onPlay, onSettings, onAllTools }: SmartToolsRowProps) {
  return (
    <View style={styles.row}>
      <Pill
        icon="eye-outline"
        label="Vision"
        color={ACCENT_GREEN}
        bg={BG_GREEN}
        onPress={onVision}
      />
      <Pill
        icon="body-outline"
        label="Motion"
        color={ACCENT_SKY}
        bg={BG_SKY}
        onPress={onMotion}
      />
      <Pill
        icon="fitness-outline"
        label="Play"
        color={ACCENT_GREEN}
        bg={BG_GREEN}
        onPress={onPlay}
      />
      <Pill
        icon="settings-outline"
        label="Settings"
        color={ACCENT_AMBER}
        bg={BG_AMBER}
        onPress={onSettings}
      />
      {onAllTools ? (
        <Pill
          icon="apps-outline"
          label="Tools"
          color={ACCENT_SKY}
          bg={BG_SKY}
          onPress={onAllTools}
        />
      ) : null}
    </View>
  );
}

interface PillProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  bg: string;
  onPress: () => void;
}

function Pill({ icon, label, color, bg, onPress }: PillProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: color, backgroundColor: bg, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text
        style={[styles.pillText, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

export default SmartToolsRow;
