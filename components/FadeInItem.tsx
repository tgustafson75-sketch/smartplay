/**
 * FadeInItem
 * Subtle fade + upward entrance for list items.
 * Pass `delay={index * 40}` for staggered lists.
 *
 * Usage:
 *   {drills.map((d, i) => (
 *     <FadeInItem key={d.id} delay={i * 40}>
 *       <DrillCard drill={d} />
 *     </FadeInItem>
 *   ))}
 */
import React, { useEffect } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

interface FadeInItemProps {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export default function FadeInItem({ children, delay = 0, style }: FadeInItemProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(8);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 250 }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 250 }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}
