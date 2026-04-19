import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg";
import { Motion } from "../theme/motion";

// Animated wrapper for SVG Path stroke-dashoffset
const AnimatedPath = Animated.createAnimatedComponent(Path);

interface ShotVisionOverlayProps {
  width?: number;
  height?: number;
  triggerKey?: number | string;
}

// Static constants — defined once, never recalculated
const ARC_PATH = "M 40 260 Q 180 80 340 120";
const PATH_LENGTH = 340;

const ShotVisionOverlay = memo(function ShotVisionOverlay({
  width = 360,
  height = 300,
  triggerKey,
}: ShotVisionOverlayProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const containerOpacity = useRef(new Animated.Value(0)).current;

  // Interpolations created once — stable references, no recalculation per render
  const dashOffset = useRef(
    progress.interpolate({ inputRange: [0, 1], outputRange: [PATH_LENGTH, 0] })
  ).current;
  const strokeOpacity = useRef(
    progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] })
  ).current;

  useEffect(() => {
    progress.setValue(0);
    containerOpacity.setValue(0);

    const delayTimer = setTimeout(() => {
      Animated.timing(containerOpacity, { toValue: 1, duration: Motion.tracer.fadeIn, useNativeDriver: false }).start();

      Animated.timing(progress, {
        toValue: 1,
        duration: Motion.tracer.draw,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        Animated.timing(containerOpacity, {
          toValue: 0,
          duration: Motion.tracer.fadeOut,
          easing: Easing.in(Easing.quad),
          useNativeDriver: false,
        }).start();
      });
    }, 500);

    return () => clearTimeout(delayTimer);
  }, [triggerKey]);

  return (
    <Animated.View
      style={{ position: "absolute", top: 0, left: 0, width, height, opacity: containerOpacity }}
      pointerEvents="none"
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#3CBF8F" stopOpacity="0.15" />
            <Stop offset="0.5" stopColor="#3CBF8F" stopOpacity="1" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.55" />
          </LinearGradient>
        </Defs>

        {/* Single arc — no shadow for performance */}
        <AnimatedPath
          d={ARC_PATH}
          fill="none"
          stroke="url(#arcGrad)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={PATH_LENGTH}
          strokeDashoffset={dashOffset}
          opacity={strokeOpacity}
        />
      </Svg>
    </Animated.View>
  );
});

export default ShotVisionOverlay;
