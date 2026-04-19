import { Easing } from "react-native-reanimated";

export const Motion = {
  fast: 150,
  normal: 250,
  slow: 400,

  easing: {
    default: Easing.out(Easing.cubic),
    soft: Easing.out(Easing.quad),
    in: Easing.in(Easing.quad),
  },

  // Reusable spring configs for react-native-reanimated withSpring
  spring: {
    snappy: { damping: 20, stiffness: 300 },
    gentle: { damping: 18, stiffness: 180 },
  },

  // Pulse config for CaddieMic
  pulse: {
    listening: { scale: 1.05, duration: 700 },
    speaking: { scale: 1.06, duration: 500 },
  },

  // Tracer draw (ShotVisionOverlay)
  tracer: {
    draw: 1200,
    fadeIn: 200,
    fadeOut: 500,
  },

  // Card entrance stagger
  stagger: {
    item: 40,
    fadeOffset: 8, // translateY pixels
    duration: 260,
  },

  // Button press feedback
  press: {
    scale: 0.96,
    duration: 120,
  },

  // Overlay appear/disappear
  overlay: {
    in: 200,
    out: 250,
  },
} as const;
