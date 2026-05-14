import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import type { TrustLevel } from '../../store/trustLevelStore';

/**
 * Phase F — Kevin avatar liveliness ring.
 *
 * Subtle animated ring that wraps (or sits beside) Kevin's avatar image. Four
 * states convey what Kevin is doing without pulling attention:
 *
 *   idle      — gentle 4-second breathing pulse, near-1.0 opacity range.
 *   listening — brighter ring, slightly faster pulse (mic open).
 *   speaking  — rhythmic pulse synced to TTS playback cadence (approximate).
 *   thinking  — amber-tinted slow pulse during latency-masking window.
 *
 * Per-Trust-Spectrum-level treatment via `presenceLevel`:
 *   L1 — component renders nothing (avatar isn't shown at L1).
 *   L2 — small/medium ring, idle treatment default. Locked layout doesn't
 *        mount this today; the existing CaddieAvatar in caddie.tsx handles
 *        L2 byte-identically. KevinAvatar is mountable for L3/L4 surfaces.
 *   L3 — medium ring with all four states wired.
 *   L4 — large prominent ring, all four states wired with stronger amplitude.
 *
 * Implementation note: react-native-reanimated drives the ring; no asset
 * dependency. Wraps an arbitrary child (e.g. an Image of the Kevin badge) so
 * consumer surfaces compose freely. Returns null at L1.
 */

export type AvatarState = 'idle' | 'listening' | 'speaking' | 'thinking';

const COLORS: Record<AvatarState, string> = {
  idle: '#00C896',
  listening: '#00C896',
  speaking: '#00FFAA',
  thinking: '#F5A623',
};

const PRESENCE_CONFIG: Record<TrustLevel, { size: number; ringWidth: number; show: boolean }> = {
  1: { size: 0,   ringWidth: 0,   show: false },
  2: { size: 64,  ringWidth: 2,   show: true  },
  3: { size: 96,  ringWidth: 2.5, show: true  },
  4: { size: 140, ringWidth: 3,   show: true  },
  // Cockpit (L5) has its own BrandHeader badge — no KevinAvatar surface.
  5: { size: 0,   ringWidth: 0,   show: false },
};

type Props = {
  state: AvatarState;
  presenceLevel: TrustLevel;
  children?: React.ReactNode;
  /** Override default size (e.g. for the L1 mic button surround). */
  sizeOverride?: number;
};

export default function KevinAvatar({ state, presenceLevel, children, sizeOverride }: Props) {
  const cfg = PRESENCE_CONFIG[presenceLevel];
  const size = sizeOverride ?? cfg.size;
  const show = sizeOverride != null ? true : cfg.show;

  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.85);

  useEffect(() => {
    // Cancel any in-flight by reassigning shared values to fresh sequences.
    if (state === 'idle') {
      scale.value = withRepeat(
        withTiming(1.02, { duration: 2000, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
      opacity.value = withRepeat(
        withTiming(1.0, { duration: 2000, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else if (state === 'listening') {
      scale.value = withRepeat(
        withTiming(1.06, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
      opacity.value = withRepeat(
        withTiming(1.0, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else if (state === 'speaking') {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 220, easing: Easing.out(Easing.quad) }),
          withTiming(1.00, { duration: 280, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        false,
      );
      opacity.value = 1.0;
    } else {
      // thinking
      scale.value = withRepeat(
        withTiming(1.04, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
      opacity.value = withRepeat(
        withTiming(1.0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    }
  }, [state, scale, opacity]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!show || size <= 0) return <>{children}</>;

  const color = COLORS[state];

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          ringStyle,
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: size / 2,
            borderWidth: cfg.ringWidth,
            borderColor: color,
          },
        ]}
      />
      <View style={[styles.content, { width: size, height: size, borderRadius: size / 2 }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  content: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
