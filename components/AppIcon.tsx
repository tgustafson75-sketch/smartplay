/**
 * Canonical icon wrapper for the SmartPlay UI.
 *
 * Uses @expo/vector-icons (Ionicons family) — pure JS font set, no native
 * module, no Java/Android compilation risk. The wrapper centralises sizing
 * + color defaults so swapping the icon family later (or theme tokens) is
 * a one-place change.
 *
 * Replaces the scattered emoji that gave the app a generic feel. Use this
 * instead of `<Text>📹</Text>` patterns.
 */

import React from 'react';
import { Ionicons } from '@expo/vector-icons';

export type IconName = keyof typeof Ionicons.glyphMap;

export type AppIconProps = {
  name: IconName;
  size?: number;
  color?: string;
};

export default function AppIcon({ name, size = 22, color = '#00C896' }: AppIconProps) {
  return <Ionicons name={name} size={size} color={color} />;
}
