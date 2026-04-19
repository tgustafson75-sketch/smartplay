/**
 * AnimatedPressable
 * Drop-in replacement for Pressable with a quick scale-down on press.
 * Uses react-native-reanimated for smooth 120ms feedback without triggering
 * JS re-renders.
 *
 * Usage:
 *   <AnimatedPressable onPress={...} style={...}>
 *     <Text>Label</Text>
 *   </AnimatedPressable>
 */
import React from "react";
import { PressableProps, StyleProp, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Motion } from "../theme/motion";

interface AnimatedPressableProps extends Omit<PressableProps, "style"> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleValue?: number;
}

export default function AnimatedPressable({
  children,
  style,
  onPress,
  disabled,
  scaleValue = Motion.press.scale,
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .onBegin(() => {
      scale.value = withTiming(scaleValue, { duration: Motion.press.duration });
    })
    .onFinalize(() => {
      scale.value = withTiming(1, { duration: Motion.press.duration });
      if (onPress) runOnJS(onPress as () => void)();
    });

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[style, animStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}
