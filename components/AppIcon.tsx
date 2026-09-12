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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export type IconName = keyof typeof Ionicons.glyphMap;
export type MciIconName = keyof typeof MaterialCommunityIcons.glyphMap;

/**
 * 2026-09-11 (Tim — "needs a slightly bigger icon that clearly says golf bag") — A SECOND FAMILY,
 * FOR THE GLYPHS IONICONS DOES NOT HAVE.
 *
 * Ionicons has `golf` (a flag and ball) and `bag` (a shopping bag). Neither says GOLF BAG, and the
 * bag card was using the flag — which reads as "golf", the one thing every icon on that screen
 * already means. Searching every installed family for a golf bag found none: the nearest true
 * silhouette is MaterialCommunityIcons `bag-personal`, a tall upright bag with a shoulder strap.
 *
 * MaterialCommunityIcons is ALREADY bundled — app/(tabs)/_layout uses it — so this costs no extra
 * font. This wrapper's own header says swapping the icon family should be a one-place change; this
 * is that place, rather than importing a second family at the call site and starting the scatter
 * the wrapper exists to prevent.
 */
export type AppIconProps =
  | { family?: 'ionicons'; name: IconName; size?: number; color?: string }
  | { family: 'mci'; name: MciIconName; size?: number; color?: string };

export default function AppIcon(props: AppIconProps) {
  const { size = 22, color = '#00C896' } = props;
  if (props.family === 'mci') {
    return <MaterialCommunityIcons name={props.name} size={size} color={color} />;
  }
  return <Ionicons name={props.name} size={size} color={color} />;
}
