/**
 * 2026-06-13 (Tim) — Gyro-parallax "wow" (v1 of the 3D illusion).
 *
 * Tilt the phone and the BACKGROUND layer pans opposite the tilt while the overlays
 * stay put — the differential reads as depth (the "3D photo" look). Pure presentation
 * illusion (no real depth data) — great for previews + screenshots; NEVER feeds
 * analysis. See memory: roadmap-3d-4d (rung 1).
 *
 * Drop-in for an ImageBackground: pass the image as `background`, overlays as children.
 *   <ParallaxTilt style={wrap} background={<Image .../>}>{overlays}</ParallaxTilt>
 *
 * OTA-safe (expo-sensors already ships). Self-contained + defensive: if DeviceMotion
 * isn't available (web, sensor off), it renders static — no crash, no motion. Captures
 * a neutral baseline on first reading so it parallaxes relative to how you're holding it.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { DeviceMotion } from 'expo-sensors';

const MAX_SHIFT = 16;     // px the background can pan at full tilt
const OVERSCAN = 1.14;    // scale the bg up so panning never reveals an edge
const SMOOTH = 0.18;      // low-pass on the raw tilt (0..1; higher = snappier)
const RANGE_RAD = 0.5;    // tilt (rad) mapped to full shift (~28°)

export function ParallaxTilt({
  style,
  radius = 10,
  background,
  children,
  disabled = false,
}: {
  style?: StyleProp<ViewStyle>;
  radius?: number;
  background: React.ReactNode;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const roll = useRef(0);
  const pitch = useRef(0);
  const baseRoll = useRef<number | null>(null);
  const basePitch = useRef<number | null>(null);

  useEffect(() => {
    if (disabled) return;
    let sub: { remove: () => void } | null = null;
    let active = true;
    (async () => {
      try {
        const avail = await DeviceMotion.isAvailableAsync();
        if (!avail || !active) return;
        DeviceMotion.setUpdateInterval(40); // ~25fps; smooth enough, light on battery
        sub = DeviceMotion.addListener((d) => {
          const rot = d?.rotation;
          if (!rot) return;
          const g = typeof rot.gamma === 'number' ? rot.gamma : 0; // left-right tilt
          const b = typeof rot.beta === 'number' ? rot.beta : 0;   // front-back tilt
          // Neutral = how they're holding it on the first reading.
          if (baseRoll.current === null) { baseRoll.current = g; basePitch.current = b; }
          // Low-pass the delta from neutral.
          roll.current += ((g - (baseRoll.current ?? 0)) - roll.current) * SMOOTH;
          pitch.current += ((b - (basePitch.current ?? 0)) - pitch.current) * SMOOTH;
          const nx = Math.max(-1, Math.min(1, roll.current / RANGE_RAD));
          const ny = Math.max(-1, Math.min(1, pitch.current / RANGE_RAD));
          tx.setValue(-nx * MAX_SHIFT); // background moves OPPOSITE the tilt = depth
          ty.setValue(-ny * MAX_SHIFT);
        });
      } catch { /* sensor unavailable → render static */ }
    })();
    return () => { active = false; sub?.remove?.(); };
  }, [disabled, tx, ty]);

  return (
    <View style={[{ overflow: 'hidden', borderRadius: radius }, style]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ scale: OVERSCAN }, { translateX: tx }, { translateY: ty }] },
        ]}
      >
        {background}
      </Animated.View>
      {children}
    </View>
  );
}
