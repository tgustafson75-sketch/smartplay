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
import { useTheme } from '../../../contexts/ThemeContext';
import type { VoiceState } from '../../CaddieAvatar';

export interface BrandHeaderProps {
  voiceState: VoiceState;
  onMicPress: () => void;
  /** Optional — tap target on the right that opens the mode/presence picker. */
  onModePress?: () => void;
}

export function BrandHeader({ voiceState, onMicPress, onModePress }: BrandHeaderProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onMicPress}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Talk to caddie"
        accessibilityHint="Starts recording. Tap again to stop."
        style={({ pressed }) => [
          styles.badgeBtn,
          {
            borderColor: colors.accent,
            backgroundColor: colors.surface_elevated,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {voiceState === 'listening' && <ListeningHalo accent={colors.accent} />}
        <Image
          source={require('../../../assets/avatars/smartplay_caddie_badge.png')}
          style={styles.badgeImg}
          resizeMode="contain"
        />
      </Pressable>

      <View style={styles.titleBlock}>
        <View style={styles.wordmarkRow}>
          <Text style={[styles.brand1, { color: colors.accent }]}>SMARTPLAY</Text>
          <Text style={[styles.brand2, { color: colors.text_primary }]}> CADDIE</Text>
        </View>
        <Text style={[styles.tagline, { color: colors.text_muted }]}>
          REAL-TIME CADDIE INTELLIGENCE
        </Text>
      </View>

      {onModePress && (
        <Pressable
          onPress={onModePress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Change caddie mode"
          accessibilityHint="Opens the presence picker — Quiet, Companion, Active, Full, or Cockpit."
          style={({ pressed }) => [
            styles.modePill,
            { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.modePillText, { color: colors.accent }]}>MODE</Text>
        </Pressable>
      )}
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
    gap: 12,
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
  modePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
});

export default BrandHeader;
