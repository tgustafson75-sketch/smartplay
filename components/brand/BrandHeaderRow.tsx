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
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

export const BRAND_BADGE_SIZE = 56;
export const BRAND_TAGLINE = 'REAL-TIME CADDIE INTELLIGENCE';

export interface BrandHeaderRowProps {
  /** Override the default tagline (e.g. screen name). Falls back to the
   *  standard "REAL-TIME CADDIE INTELLIGENCE" line. */
  tagline?: string;
  /** Optional — makes the logo badge tappable (used on the Play tab to
   *  open the listening session). The wordmark + tagline stay static. */
  onLogoPress?: () => void;
}

export function BrandHeaderRow({ tagline = BRAND_TAGLINE, onLogoPress }: BrandHeaderRowProps) {
  const { colors } = useTheme();
  const logo = (
    <Image
      source={require('../../assets/avatars/smartplay_caddie_badge.png')}
      style={styles.badge}
      resizeMode="contain"
    />
  );
  return (
    <View style={styles.wrap}>
      {onLogoPress ? (
        <Pressable
          onPress={onLogoPress}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Talk to caddie"
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          {logo}
        </Pressable>
      ) : (
        logo
      )}
      <View style={styles.titleBlock}>
        <View style={styles.wordmarkRow}>
          <Text style={[styles.name1, { color: colors.accent }]}>SMARTPLAY</Text>
          <Text style={[styles.name2, { color: colors.text_primary }]}> CADDIE</Text>
        </View>
        <Text style={[styles.tagline, { color: colors.text_muted }]} numberOfLines={1}>
          {tagline}
        </Text>
      </View>
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
  badge: {
    width: BRAND_BADGE_SIZE,
    height: BRAND_BADGE_SIZE,
    borderRadius: BRAND_BADGE_SIZE / 2,
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
});
