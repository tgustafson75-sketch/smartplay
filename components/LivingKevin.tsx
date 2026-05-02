import React, { useEffect, useRef } from 'react';
import { Image, ImageSourcePropType, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// Voice state drives breath speed and depth.
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface LivingKevinProps {
  source: ImageSourcePropType;
  resizeMode?: 'cover' | 'contain';
  voiceState: VoiceState;
}

export default function LivingKevin({
  source,
  resizeMode: _resizeMode = 'contain',
  voiceState,
}: LivingKevinProps) {
  const breathScale = useSharedValue(1.0);
  const nudgeY      = useSharedValue(0);
  const driftX      = useSharedValue(0);
  const driftY      = useSharedValue(0);
  const nodY        = useSharedValue(0);

  const prevVoiceRef = useRef<VoiceState>('idle');

  // ── Breath: half-cycle and peak depth vary with voice state ──────────────
  useEffect(() => {
    cancelAnimation(breathScale);
    cancelAnimation(nudgeY);

    const half =
      voiceState === 'speaking'  ? 1400 :
      voiceState === 'listening' ? 1800 : 2100;
    const peak =
      voiceState === 'speaking'  ? 1.022 :
      voiceState === 'listening' ? 1.018 : 1.015;
    const nudgePeak =
      voiceState === 'speaking'  ? 2.5 :
      voiceState === 'listening' ? 1.8 : 1.2;

    breathScale.value = withRepeat(
      withSequence(
        withTiming(peak, { duration: half, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0,  { duration: half, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );

    nudgeY.value = withRepeat(
      withSequence(
        withTiming(nudgePeak, { duration: half, easing: Easing.inOut(Easing.sin) }),
        withTiming(0,         { duration: half, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // ── Micro-drift: X 7300 ms, Y 5500 ms — set once on mount ───────────────
  useEffect(() => {
    driftX.value = withRepeat(
      withSequence(
        withTiming( 0.4, { duration: 2433, easing: Easing.inOut(Easing.sin) }),
        withTiming(-0.3, { duration: 2434, easing: Easing.inOut(Easing.sin) }),
        withTiming( 0.0, { duration: 2433, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    driftY.value = withRepeat(
      withSequence(
        withTiming(-0.3, { duration: 1833, easing: Easing.inOut(Easing.sin) }),
        withTiming( 0.4, { duration: 1834, easing: Easing.inOut(Easing.sin) }),
        withTiming( 0.0, { duration: 1833, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(driftX);
      cancelAnimation(driftY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Nod: greeting on mount, then on speaking → idle ──────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      nodY.value = withSequence(
        withTiming(4, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 300, easing: Easing.inOut(Easing.ease) }),
      );
    }, 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (prevVoiceRef.current === 'speaking' && voiceState === 'idle') {
      nodY.value = withSequence(
        withTiming(4, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 300, easing: Easing.inOut(Easing.ease) }),
      );
    }
    prevVoiceRef.current = voiceState;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // ── UI-thread animated style ──────────────────────────────────────────────
  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: breathScale.value },
      { translateX: driftX.value },
      { translateY: driftY.value + nudgeY.value + nodY.value },
    ],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, animStyle]}>
      <Image
        source={source}
        style={StyleSheet.absoluteFillObject}
        resizeMode="contain"
      />
    </Animated.View>
  );
}
