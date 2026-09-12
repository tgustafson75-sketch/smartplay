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

/**
 * 2026-09-11 — a MaterialCommunityIcons branch lived here briefly, added to reach `bag-personal`
 * for the Play tab's bag card. Tim's verdict on it was "that looks like a fucking suitcase", and he
 * was right — it is luggage. The branded golf-bag icon replaced it, so the second family had zero
 * call sites and went with it. Adding a family back is a two-line change if a real need appears;
 * keeping an unused one is the half-build this codebase treats as a live bug.
 * [[orphans-are-live-bugs-not-dead-code]]
 */
export default function AppIcon({ name, size = 22, color = '#00C896' }: AppIconProps) {
  return <Ionicons name={name} size={size} color={color} />;
}
