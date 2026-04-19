/**
 * FadeInView
 * Wraps children in a fade + slight upward entrance animation.
 * Supports per-item stagger delay for lists.
 *
 * Usage:
 *   <FadeInView delay={index * Motion.stagger.item}>
 *     <DrillCard ... />
 *   </FadeInView>
 *
 *   // Overlay fade (no translate):
 *   <FadeInView translateY={0} duration={Motion.overlay.in}>
 *     <ShotVisionPlayer ... />
 *   </FadeInView>
 */
import React, { useEffect } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";
import { Motion } from "../theme/motion";

interface FadeInViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  translateY?: number;
  style?: StyleProp<ViewStyle>;
}

export default function FadeInView({
  children,
  delay = 0,
  duration = Motion.stagger.duration,
  translateY = Motion.stagger.fadeOffset,
  style,
}: FadeInViewProps) {
  const opacity = useSharedValue(0);
  const ty = useSharedValue(translateY);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration }));
    ty.value = withDelay(delay, withTiming(0, { duration }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }],
  }));

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}
