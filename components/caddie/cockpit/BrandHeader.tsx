/**
 * Cockpit Mode — BrandHeader
 *
 * Ports v3's BrandHeader to Pro's stores/theme. The round badge is the
 * Caddie mic (per Tim's "badge-is-the-mic" rule). Tap the badge → calls
 * the onMicPress prop, which the parent (CockpitCaddieScreen) wires to
 * caddie.tsx's handleMicPress so the voice pipeline is shared with
 * Full Mode. No hook re-instantiation here; this is presentational.
 *
 * Visual states:
 *   - idle / speaking / thinking → static badge with the standard green ring
 *   - listening                  → soft animated halo around the badge
 *                                  (Animated.View, native driver, unmounted
 *                                  when not listening so idle cost is zero)
 *
 * Non-developer note: this component does NOT own voice state. It just
 * paints what the parent tells it (via the voiceState prop) and fires
 * onMicPress when tapped.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { useToolsMenuStore } from '../../../store/toolsMenuStore';
import type { VoiceState } from '../../CaddieAvatar';

export interface BrandHeaderProps {
  voiceState: VoiceState;
  onMicPress: () => void;
  // 2026-05-14 — onModePress removed. Tim: "Tools menu cycler is the only
  // mode control. Remove the MODE pill from Cockpit too." The ••• Tools
  // pill in BrandHeaderRow (every tab) is now the single mode switcher.
}

export function BrandHeader({ voiceState, onMicPress }: BrandHeaderProps) {
  const { colors } = useTheme();
  const openTools = useToolsMenuStore((s) => s.open);

  // Visible-state hints on the badge ring so the user gets immediate
  // feedback for every voice state — not just listening. Idle = accent
  // border; thinking/speaking get a tinted border so the tap clearly
  // "did something" even before audio init completes.
  const ringColor =
    voiceState === 'listening' ? colors.accent
    : voiceState === 'thinking' ? '#F5A623'
    : voiceState === 'speaking' ? colors.accent
    : colors.accent;
  const ringBg =
    voiceState === 'thinking' ? 'rgba(245,166,35,0.18)'
    : voiceState === 'speaking' ? colors.accent_muted
    : colors.surface_elevated;

  return (
    <View style={styles.wrap}>
      {/* Whole brand row (badge + title) is the mic tap surface — matches
          v3's "badge IS the mic" rule and gives a generous tap target so
          users don't keep missing the small 56-pixel circle. */}
      <Pressable
        onPress={onMicPress}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel="Talk to caddie"
        accessibilityHint="Starts recording. Tap again to stop."
        style={({ pressed }) => [styles.micRow, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View
          style={[
            styles.badgeBtn,
            {
              borderColor: ringColor,
              backgroundColor: ringBg,
            },
          ]}
        >
          {voiceState === 'listening' && <ListeningHalo accent={colors.accent} />}
          <Image
            source={require('../../../assets/avatars/smartplay_caddie_badge.png')}
            style={styles.badgeImg}
            resizeMode="contain"
          />
        </View>

        <View style={styles.titleBlock}>
          <View style={styles.wordmarkRow}>
            <Text style={[styles.brand1, { color: colors.accent }]}>SMARTPLAY</Text>
            <Text style={[styles.brand2, { color: colors.text_primary }]}> CADDIE</Text>
          </View>
          <Text style={[styles.tagline, { color: colors.text_muted }]}>
            {voiceState === 'listening' ? 'LISTENING…'
              : voiceState === 'thinking' ? 'THINKING…'
              : voiceState === 'speaking' ? 'SPEAKING…'
              : 'TAP TO TALK · REAL-TIME CADDIE'}
          </Text>
        </View>
      </Pressable>

      {/* ••• Tools pill — matches BrandHeaderRow on every other tab.
          Opens the GlobalToolsMenu (Presence cycler, Persona cycler,
          Settings). Without this pill Cockpit had no on-screen way to
          switch modes after the MODE pill was retired. */}
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
    </View>
  );
}

/**
 * Listening halo — pulses while voice state === 'listening' only.
 * Mounted only when listening so idle / speaking / thinking pay zero
 * cost. Uses Animated (native driver) — no Reanimated, no JS-thread
 * worklets.
 */
function ListeningHalo({ accent }: { accent: string }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      progress.setValue(0);
    };
  }, [progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.halo, { borderColor: accent, opacity, transform: [{ scale }] }]}
    />
  );
}

const BADGE_SIZE = 56;

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
  },
  micRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
  },
  badgeBtn: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeImg: {
    width: BADGE_SIZE * 0.82,
    height: BADGE_SIZE * 0.82,
    borderRadius: (BADGE_SIZE * 0.82) / 2,
  },
  halo: {
    position: 'absolute',
    width: BADGE_SIZE + 16,
    height: BADGE_SIZE + 16,
    borderRadius: (BADGE_SIZE + 16) / 2,
    borderWidth: 3,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  brand1: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  brand2: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  tagline: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.4,
    marginTop: 2,
  },
  toolsPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default BrandHeader;
