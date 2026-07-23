/**
 * 2026-07-23 (Tim — "give the screenshots our treatment: change the contrast, make them look like
 * ours"). A reusable branded overlay dropped INSIDE an ImageBackground that renders a bundled
 * course screenshot. It deepens the top/bottom (a vignette that reads as higher contrast) and lays
 * a faint teal accent wash so third-party GPS-app screenshots visually match our satellite hole
 * views. Pure overlay — no new dependency (expo-linear-gradient is already installed), pointer-
 * transparent, and it never changes layout. Place it as the FIRST child of the ImageBackground so
 * markers / labels / distance chips still draw on top.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// App base is a near-black green (#03140c); the accent is the teal #00C896.
const BRAND_DARK = '3, 20, 12';
const BRAND_ACCENT = '0, 200, 150';

export function HoleImageTreatment() {
  return (
    <>
      {/* Contrast/vignette — darken top + bottom, keep the middle readable. */}
      <LinearGradient
        colors={[
          `rgba(${BRAND_DARK}, 0.48)`,
          `rgba(${BRAND_DARK}, 0.06)`,
          `rgba(${BRAND_DARK}, 0.12)`,
          `rgba(${BRAND_DARK}, 0.58)`,
        ]}
        locations={[0, 0.3, 0.66, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Faint diagonal teal wash — the brand tint that unifies with our satellite tiles. */}
      <LinearGradient
        colors={[`rgba(${BRAND_ACCENT}, 0.07)`, `rgba(${BRAND_ACCENT}, 0)`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </>
  );
}
