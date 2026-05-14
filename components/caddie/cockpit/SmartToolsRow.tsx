/**
 * Cockpit Mode — SmartToolsRow
 *
 * Four pill buttons row: Vision (green), Motion (blue), Play (pink),
 * Settings (gold). Each pill routes to the corresponding screen.
 *
 * Non-developer note: literal pill colors are intentional brand
 * differentiation (matches the v3 design language). They don't
 * follow the theme tokens because each tool has its own brand color
 * that should look the same in light + dark mode.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface SmartToolsRowProps {
  onVision: () => void;
  onMotion: () => void;
  onPlay: () => void;
  onSettings: () => void;
}

export function SmartToolsRow({ onVision, onMotion, onPlay, onSettings }: SmartToolsRowProps) {
  return (
    <View style={styles.row}>
      <Pill
        icon="eye-outline"
        label="Vision"
        color="#00C896"
        bg="rgba(0,200,150,0.08)"
        onPress={onVision}
      />
      <Pill
        icon="body-outline"
        label="Motion"
        color="#5DADE2"
        bg="rgba(93,173,226,0.08)"
        onPress={onMotion}
      />
      <Pill
        icon="fitness-outline"
        label="Play"
        color="#E879A6"
        bg="rgba(232,121,166,0.08)"
        onPress={onPlay}
      />
      <Pill
        icon="settings-outline"
        label="Settings"
        color="#F0C030"
        bg="rgba(240,192,48,0.08)"
        onPress={onSettings}
      />
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
