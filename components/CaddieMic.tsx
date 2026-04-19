import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useTheme } from "../theme/brand";
import { useCaddie } from "../context/CaddieContext";
import { Motion } from "../theme/motion";

interface CaddieMicProps {
  size?: number;
}

export default function CaddieMic({ size = 56 }: CaddieMicProps) {
  const { state = "idle" } = useCaddie() ?? {};
  const theme = useTheme();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const speakScaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pulseAnim.stopAnimation();
    glowAnim.stopAnimation();

    if (state === "listening") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: Motion.pulse.listening.scale, duration: Motion.pulse.listening.duration, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: Motion.pulse.listening.duration, useNativeDriver: true }),
        ])
      ).start();
      Animated.timing(glowAnim, { toValue: 0, duration: Motion.normal, useNativeDriver: false }).start();
    } else if (state === "speaking") {
      Animated.timing(pulseAnim, { toValue: 1.0, duration: Motion.normal, useNativeDriver: true }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: Motion.pulse.speaking.duration, useNativeDriver: false }),
          Animated.timing(glowAnim, { toValue: 0.3, duration: Motion.pulse.speaking.duration, useNativeDriver: false }),
        ])
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(speakScaleAnim, { toValue: Motion.pulse.speaking.scale, duration: Motion.pulse.speaking.duration, useNativeDriver: true }),
          Animated.timing(speakScaleAnim, { toValue: 1.0, duration: Motion.pulse.speaking.duration, useNativeDriver: true }),
        ])
      ).start();
    } else {
      Animated.timing(pulseAnim, { toValue: 1.0, duration: Motion.normal, useNativeDriver: true }).start();
      Animated.timing(glowAnim, { toValue: 0, duration: Motion.normal, useNativeDriver: false }).start();
      Animated.timing(speakScaleAnim, { toValue: 1.0, duration: Motion.normal, useNativeDriver: true }).start();
    }

    return () => {
      pulseAnim.stopAnimation();
      glowAnim.stopAnimation();
    };
  }, [state]);

  const ringOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] });
  const ringScale   = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });

  const isBright = theme.isBright;

  // Light mode: use theme colors for higher contrast outdoors
  const coreColor =
    state === "listening"
      ? theme.accent
      : state === "speaking"
      ? theme.primaryLight
      : theme.surface;

  const borderColor = state === "idle" ? (isBright ? "#000000" : theme.textSecondary) : theme.accent;
  const borderWidth = isBright ? 2.5 : 1.5;

  return (
    <View style={[styles.wrapper, { width: size * 2, height: size * 2 }]}>
      {/* Glow ring — speaking only */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: size * 2,
            height: size * 2,
            borderRadius: size,
            borderColor: theme.accent,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />

      {/* Pulse scale wrapper */}
      <Animated.View
        style={[
          styles.micOuter,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: coreColor,
            borderColor,
            borderWidth,
            transform: [{ scale: pulseAnim }, { scale: speakScaleAnim }],
          },
        ]}
      >
        <View style={[styles.micBody, { height: size * 0.32, width: size * 0.22, backgroundColor: theme.textPrimary }]} />
        <View style={[styles.micBase, { width: size * 0.36, borderTopColor: borderColor }]} />
        <View style={[styles.micStand, { height: size * 0.1, backgroundColor: borderColor }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    borderWidth: 1.5,
  },
  micOuter: {
    alignItems: "center",
    justifyContent: "center",
    // borderWidth overridden dynamically
    gap: 2,
  },
  micBody: {
    borderRadius: 6,
    marginBottom: 2,
  },
  micBase: {
    height: 10,
    borderTopWidth: 1.5,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderRadius: 99,
  },
  micStand: {
    width: 1.5,
  },
});
