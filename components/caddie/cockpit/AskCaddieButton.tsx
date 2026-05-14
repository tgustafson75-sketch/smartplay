/**
 * Cockpit Mode — AskCaddieButton
 *
 * Full-width pill with the SmartPlay Caddie badge on the left + a state-
 * aware label. Tap to start/stop voice. Mirrors v3's AskCaddieButton
 * without pulling in Reanimated (we use RN's Animated API for the halo
 * pulse — same effect, no extra native dep, native driver only).
 *
 * State-aware label:
 *   idle      → "Tap to ask Caddie"
 *   listening → "Tap when done"
 *   thinking  → "Thinking…"
 *   speaking  → "Tap to interrupt"
 *
 * Non-developer note: this is the primary mic affordance on the Cockpit
 * screen. It does NOT own voice state — the parent (caddie.tsx via
 * CockpitCaddieScreen) tells it what to display. Tap → calls onTap,
 * which is wired to caddie.tsx's handleMicPress.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import type { VoiceState } from '../../CaddieAvatar';

export interface AskCaddieButtonProps {
  voiceState: VoiceState;
  onTap: () => void;
}

const LABEL: Record<VoiceState, string> = {
  idle:      'Tap to ask Caddie',
  listening: 'Tap when done',
  thinking:  'Thinking…',
  speaking:  'Tap to interrupt',
  proactive: 'Tap to interrupt',
};

export function AskCaddieButton({ voiceState, onTap }: AskCaddieButtonProps) {
  const { colors } = useTheme();
  const isActive =
    voiceState === 'listening' ||
    voiceState === 'thinking' ||
    voiceState === 'speaking';

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.pill,
          {
            borderColor: isActive ? colors.accent : colors.border,
            backgroundColor: isActive ? colors.accent_muted : colors.surface_elevated,
          },
        ]}
      >
        <Pressable
          onPress={onTap}
          hitSlop={12}
          android_ripple={{ color: 'rgba(0,200,150,0.18)' }}
          accessibilityRole="button"
          accessibilityLabel={LABEL[voiceState] ?? 'Tap to ask Caddie'}
          accessibilityHint="Starts recording. Tap again to stop."
          style={styles.pressable}
        >
          <View style={styles.badgeWrap}>
            {voiceState === 'listening' && <ListeningHalo accent={colors.accent} />}
            <Image
              source={require('../../../assets/avatars/smartplay_caddie_badge.png')}
              style={styles.badge}
              resizeMode="contain"
            />
          </View>
          <Text
            style={[
              styles.label,
              { color: isActive ? colors.accent : colors.text_primary },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {LABEL[voiceState] ?? 'Tap to ask Caddie'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Listening halo — pulses around the badge while voice state is listening.
 * Mounted only while listening, so idle / thinking / speaking pay zero
 * cost. Native driver — no JS-thread work per frame.
 */
function ListeningHalo({ accent }: { accent: string }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1400,
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

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.halo, { borderColor: accent, opacity, transform: [{ scale }] }]}
    />
  );
}

const BADGE = 48;

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  pill: {
    borderRadius: 36,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
  },
  badgeWrap: {
    width: BADGE,
    height: BADGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: BADGE + 12,
    height: BADGE + 12,
    borderRadius: (BADGE + 12) / 2,
    borderWidth: 2,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
  },
  label: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default AskCaddieButton;
