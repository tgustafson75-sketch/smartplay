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

import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useToolsMenuStore } from '../../store/toolsMenuStore';
import { useListeningSessionStore } from '../../store/listeningSessionStore';
import { toggle as toggleListening } from '../../services/listeningSession';

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
}

export function BrandHeaderRow({ tagline = BRAND_TAGLINE, onLogoPress, hideToolsPill = false }: BrandHeaderRowProps) {
  const { colors } = useTheme();
  const openTools = useToolsMenuStore((s) => s.open);
  const listeningState = useListeningSessionStore((s) => s.state);

  // Default = toggle the listening session (same pipeline that earbud
  // taps and Play-tab badge already use). Pass `null` explicitly to
  // disable taps on a particular surface.
  const effectiveOnLogoPress: (() => void) | null =
    onLogoPress === undefined ? () => { void toggleListening(); } : onLogoPress;
  const isListening = listeningState === 'listening';
  const isThinking = listeningState === 'thinking' || listeningState === 'responding';

  // Subtle ring color + halo while the session is active so the badge
  // gives the same listening / thinking feedback Kevin's face does.
  const ringColor = isListening || isThinking ? colors.accent : 'transparent';
  const logo = (
    <View style={[styles.badgeRing, { borderColor: ringColor }]}>
      {isListening && <ListeningHalo accent={colors.accent} />}
      <Image
        source={require('../../assets/avatars/smartplay_caddie_badge.png')}
        style={styles.badge}
        resizeMode="contain"
      />
    </View>
  );
  return (
    <View style={styles.wrap}>
      {effectiveOnLogoPress ? (
        <Pressable
          onPress={effectiveOnLogoPress}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={isListening ? 'Stop talking' : 'Talk to caddie'}
          accessibilityHint="Starts recording. Tap again to stop."
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

/** Pulsing halo around the badge while the listening session is in the
 *  'listening' state. Mounted only when listening so idle pays zero
 *  animation cost. Mirrors the same pulse pattern Cockpit's BrandHeader
 *  uses so the two surfaces feel identical when active. */
function ListeningHalo({ accent }: { accent: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true,
    }));
    loop.start();
    return () => { loop.stop(); progress.setValue(0); };
  }, [progress]);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.halo, { borderColor: accent, opacity, transform: [{ scale }] }]}
    />
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
  // Ring around the badge that lights up while the listening session
  // is active. Pure container — no border when listeningState is idle.
  badgeRing: {
    width: BRAND_BADGE_SIZE + 4,
    height: BRAND_BADGE_SIZE + 4,
    borderRadius: (BRAND_BADGE_SIZE + 4) / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: BRAND_BADGE_SIZE + 16,
    height: BRAND_BADGE_SIZE + 16,
    borderRadius: (BRAND_BADGE_SIZE + 16) / 2,
    borderWidth: 3,
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
