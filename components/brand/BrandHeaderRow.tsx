/**
 * Shared v3-style brand header row.
 *
 * Layout: circular logo badge (56px) · SMARTPLAY CADDIE wordmark
 * stacked with REAL-TIME CADDIE INTELLIGENCE tagline.
 *
 * Lifted from the inline copies in dashboard.tsx + swinglab.tsx (and
 * mirrored in CockpitCaddieScreen's BrandHeader) so every tab uses the
 * exact same alignment, font weights, and letter-spacing. Editing the
 * brand visual in one place is preferable to chasing four call sites.
 *
 * The Cockpit BrandHeader (components/caddie/cockpit/BrandHeader.tsx)
 * does NOT use this component because it adds tap-the-row-to-talk +
 * voice-state badge ring + MODE pill. Both renderings stay in visual
 * lock-step by sharing the same constants below.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useToolsMenuStore } from '../../store/toolsMenuStore';
// 2026-05-21 — Fix A: BrandHeaderRow's badge logic moved to the shared
// CaddieMicBadge component so every tap-to-talk surface (this row +
// SmartMotion + Cage Mode) uses the same ring / halo / mic-icon
// affordance.
import { CaddieMicBadge } from '../caddie/CaddieMicBadge';

export const BRAND_BADGE_SIZE = 56;
export const BRAND_TAGLINE = 'REAL-TIME CADDIE INTELLIGENCE';

export interface BrandHeaderRowProps {
  /** Override the default tagline (e.g. screen name). Falls back to the
   *  standard "REAL-TIME CADDIE INTELLIGENCE" line. */
  tagline?: string;
  /** Override the badge tap. Defaults to listeningSession.toggle() so
   *  every tab's badge acts as a functional caddie mic — same voice
   *  pipeline as tapping Kevin's face. Pass null to disable taps. */
  onLogoPress?: (() => void) | null;
  /** Hide the ••• Tools pill. Use on screens that have their own
   *  Tools button (e.g. the Caddie tab's anchored top-right ••• with
   *  Caddie-specific actions). */
  hideToolsPill?: boolean;
  /** 2026-05-25 — Fix AK follow-up: hide the badge's built-in mic
   *  chip on tabs that have their own dedicated mic button (Caddie
   *  tab's L4 actions row). Trust-cycle chip stays visible. */
  hideLogoMicIcon?: boolean;
}

export function BrandHeaderRow({ tagline = BRAND_TAGLINE, onLogoPress, hideToolsPill = false, hideLogoMicIcon = false }: BrandHeaderRowProps) {
  const { colors } = useTheme();
  const openTools = useToolsMenuStore((s) => s.open);

  return (
    <View style={styles.wrap}>
      <CaddieMicBadge size={BRAND_BADGE_SIZE} onPress={onLogoPress ?? undefined} hideMicIcon={hideLogoMicIcon} />
      <View style={styles.titleBlock}>
        <View style={styles.wordmarkRow}>
          <Text style={[styles.name1, { color: colors.accent }]}>SMARTPLAY</Text>
          <Text style={[styles.name2, { color: colors.text_primary }]}> CADDIE</Text>
        </View>
        <Text style={[styles.tagline, { color: colors.text_muted }]} numberOfLines={1}>
          {tagline}
        </Text>
      </View>
      {/* ••• Tools pill — same control on every tab so mode cycler +
          persona cycler + Settings link are always one tap away. Opens
          the GlobalToolsMenu mounted at app/_layout.tsx root. Hidden
          when hideToolsPill is true (Caddie tab has its own anchored
          Tools button with round-specific actions). */}
      {!hideToolsPill && (
        <Pressable
          onPress={openTools}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Open tools menu"
          style={({ pressed }) => [
            styles.toolsPill,
            { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text_muted} />
        </Pressable>
      )}
    </View>
  );
}

export default BrandHeaderRow;

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  name1: { fontSize: 18, fontWeight: '800', letterSpacing: 2.5 },
  name2: { fontSize: 18, fontWeight: '800', letterSpacing: 2.5 },
  tagline: { fontSize: 10, fontWeight: '500', letterSpacing: 1.4, marginTop: 2 },
  toolsPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
