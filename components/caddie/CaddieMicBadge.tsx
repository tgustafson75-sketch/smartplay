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
import {
  useTrustLevelStore,
  TRUST_LEVEL_SLIDER_ORDER,
  type TrustLevel,
} from '../../store/trustLevelStore';

export interface CaddieMicBadgeProps {
  /** Outer circle size in px. Default 56 matches the brand badge. */
  size?: number;
  /** Override tap handler. Defaults to `listeningSession.toggle()`. Pass null to disable. */
  onPress?: (() => void) | null;
  /** 2026-05-25 — Default true per Tim's feedback: the badge's pulse +
   *  ring color already signal listening state intuitively; an icon
   *  chip just adds clutter. Caller can pass false if a specific
   *  surface still wants the mic chip overlay. */
  hideMicIcon?: boolean;
  /** Accessibility label override. */
  accessibilityLabel?: string;
  /** 2026-05-25 — Fix AN follow-up: the trust-level chip on the badge
   *  added visual noise. Default true (hidden); trust cycling moves
   *  to the ••• Tools menu + Settings. Caller can opt in by passing
   *  false on a surface that explicitly wants quick-cycle on the badge. */
  hideTrustChip?: boolean;
}

// 2026-06-04 — Trust spectrum collapsed to {1,2,3}. L1 inherits the
// prior L5 Cockpit + Harry binding; L4 / L5 removed. Slider order is
// now plain numerical [1,2,3].
const TRUST_CHIP: Record<TrustLevel, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  1: { icon: 'speedometer-outline', label: 'Q' },  // Cockpit (Harry)
  2: { icon: 'person-outline', label: 'C' },        // Companion
  3: { icon: 'ear-outline', label: 'A' },           // Active
};

function nextTrustLevel(current: TrustLevel): TrustLevel {
  const idx = TRUST_LEVEL_SLIDER_ORDER.indexOf(current);
  if (idx === -1) return TRUST_LEVEL_SLIDER_ORDER[0];
  return TRUST_LEVEL_SLIDER_ORDER[(idx + 1) % TRUST_LEVEL_SLIDER_ORDER.length];
}

export function CaddieMicBadge({
  size = 56,
  onPress,
  hideMicIcon = true,
  accessibilityLabel,
  hideTrustChip = true,
}: CaddieMicBadgeProps) {
  const { colors } = useTheme();
  const listeningState = useListeningSessionStore((s) => s.state);
  const trustLevel = useTrustLevelStore((s) => s.level) as TrustLevel;
  const setTrustLevel = useTrustLevelStore((s) => s.setLevel);

  const isListening = listeningState === 'listening';
  const isThinking = listeningState === 'thinking' || listeningState === 'responding';
  const isOpening = listeningState === 'opening';
  const isActive = isListening || isThinking || isOpening;
  // 2026-06-04 — In-flight lock window (mirrors sessionInFlight in
  // services/listeningSession.ts). Badge dims during opening /
  // listening / thinking; full opacity returns at 'responding'
  // (Kevin starts speaking) or 'idle'.
  const isInFlightLocked = listeningState === 'opening' || listeningState === 'listening' || listeningState === 'thinking';
  const badgeOpacity = isInFlightLocked ? 0.4 : 1;

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

  // 2026-05-25 — Fix AN: trust-level quick-cycle chip. Sits at the
  // bottom-left of the badge (opposite the mic chip). Renders as a
  // sibling of the Pressable so its own onPress doesn't bubble to the
  // badge tap (and vice versa). Cycles trustLevel via
  // TRUST_LEVEL_SLIDER_ORDER on each tap. Owner-aware label so the
  // user sees what level they're flipping to.
  const trustChipSize = Math.max(18, Math.round(size * 0.34));
  const trustMeta = TRUST_CHIP[trustLevel] ?? TRUST_CHIP[3];
  const trustChip = !hideTrustChip ? (
    <Pressable
      onPress={() => setTrustLevel(nextTrustLevel(trustLevel))}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Trust level ${trustMeta.label}. Tap to cycle.`}
      style={({ pressed }) => ([{
        position: 'absolute',
        bottom: -2,
        left: -2,
        width: trustChipSize,
        height: trustChipSize,
        borderRadius: trustChipSize / 2,
        backgroundColor: 'rgba(13, 36, 24, 0.92)',
        borderWidth: 1.5,
        borderColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
        zIndex: 5,
      }])}
    >
      <Ionicons
        name={trustMeta.icon}
        size={Math.round(trustChipSize * 0.58)}
        color={colors.accent}
      />
    </Pressable>
  ) : null;

  if (handlePress === null) {
    // No badge press handler — wrap in a positioning View so the chip
    // can absolutely-position relative to the badge.
    return (
      <View style={{ width: ringSize, height: ringSize }}>
        {content}
        {trustChip}
      </View>
    );
  }
  return (
    <View style={{ width: ringSize, height: ringSize, opacity: badgeOpacity }}>
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
      {trustChip}
    </View>
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
