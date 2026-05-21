/**
 * 2026-05-21 — Fix A: persistent caddie tap-to-talk badge.
 *
 * One reusable component for the canonical "tap the caddie badge to talk"
 * affordance. Wraps the brand badge image with:
 *   - tap-to-talk pressable that calls `listeningSession.toggle()`
 *     (same pipeline as the earbud tap, BrandHeaderRow logo tap, and
 *     cage-mode header tap — every entry point hits one place)
 *   - listening-state ring (lights up when the session is open)
 *   - pulsing halo on the 'listening' state
 *   - small mic-icon overlay so the badge visually reads as a control,
 *     not a decorative logo (the prior "looks like a logo, not a button"
 *     problem Tim flagged on real-device testing)
 *
 * Used by:
 *   - BrandHeaderRow (consumes via composition — every tab gets the
 *     consistent treatment)
 *   - app/swinglab/smartmotion.tsx (added top-left of the screen header)
 *   - app/swinglab/cage-mode.tsx (replaces the prior static Image badge)
 */

import React, { useEffect, useRef } from 'react';
import { View, Image, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useListeningSessionStore } from '../../store/listeningSessionStore';
import { toggle as toggleListening } from '../../services/listeningSession';

export interface CaddieMicBadgeProps {
  /** Outer circle size in px. Default 56 matches the brand badge. */
  size?: number;
  /** Override tap handler. Defaults to `listeningSession.toggle()`. Pass null to disable. */
  onPress?: (() => void) | null;
  /** Hide the small mic-icon overlay (e.g. for a purely decorative use). */
  hideMicIcon?: boolean;
  /** Accessibility label override. */
  accessibilityLabel?: string;
}

export function CaddieMicBadge({
  size = 56,
  onPress,
  hideMicIcon = false,
  accessibilityLabel,
}: CaddieMicBadgeProps) {
  const { colors } = useTheme();
  const listeningState = useListeningSessionStore((s) => s.state);

  const isListening = listeningState === 'listening';
  const isThinking = listeningState === 'thinking' || listeningState === 'responding';
  const isOpening = listeningState === 'opening';
  const isActive = isListening || isThinking || isOpening;

  const ringColor = isThinking ? '#F5A623' : isActive ? colors.accent : 'transparent';
  const micColor = isActive ? '#060f09' : '#060f09';
  const micBg = isThinking ? '#F5A623' : isActive ? colors.accent : 'rgba(0, 200, 150, 0.92)';

  const handlePress =
    onPress === null ? null :
    onPress ?? (() => { void toggleListening(); });

  const ringSize = size + 4;
  const haloSize = size + 16;
  const micSize = Math.max(16, Math.round(size * 0.34));

  const content = (
    <View style={[styles.ring, { width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderColor: ringColor }]}>
      {isListening && <ListeningHalo accent={colors.accent} size={haloSize} />}
      <Image
        source={require('../../assets/avatars/smartplay_caddie_badge.png')}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="contain"
      />
      {!hideMicIcon && (
        <View
          style={[
            styles.micChip,
            {
              width: micSize, height: micSize, borderRadius: micSize / 2,
              backgroundColor: micBg,
              bottom: -2, right: -2,
            },
          ]}
          pointerEvents="none"
        >
          <Ionicons name="mic" size={Math.round(micSize * 0.62)} color={micColor} />
        </View>
      )}
    </View>
  );

  if (handlePress === null) return content;
  return (
    <Pressable
      onPress={handlePress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (isListening ? 'Stop talking to caddie' : 'Tap to talk to caddie')}
      accessibilityHint="Starts recording. Tap again to stop."
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

function ListeningHalo({ accent, size }: { accent: string; size: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true,
      }),
    );
    loop.start();
    return () => { loop.stop(); progress.setValue(0); };
  }, [progress]);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.halo,
        { width: size, height: size, borderRadius: size / 2, borderColor: accent, opacity, transform: [{ scale }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    borderWidth: 3,
  },
  micChip: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#060f09',
  },
});

export default CaddieMicBadge;
