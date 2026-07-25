/**
 * 2026-07-24 (Tim — "anchor it as a bottom element on each screen; other bars sit above it, content
 * scrolls behind"). The unified CaddieBottomBar, mounted ONCE at the app root as the BOTTOM-MOST
 * element. It reserves space at the very bottom, so every screen's own bottom UI (the caddie-tab data
 * strip, the tab bar, SmartVision's F/M/B panel) stacks ABOVE it and scrollable content scrolls in the
 * area above — consistent on every screen, no per-screen wiring, no floating overlap with the top nav.
 *
 * Route-gated: hidden on boot/onboarding flows and on the full-screen swing camera (SmartMotion owns the
 * mic + screen there). Keyboard-aware so the text field lifts above the keyboard.
 *
 * CADDIE_BAR_ENABLED is a one-line kill switch: flip to false + OTA to remove the bar app-wide instantly
 * if it ever mis-renders on a device, with zero other change.
 */
import React from 'react';
import { View, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { CaddieBottomBar } from './caddie/CaddieBottomBar';

export const CADDIE_BAR_ENABLED = true;

// Boot / onboarding flows + full-bleed IMMERSIVE tool screens. The bar RESERVES height at the root,
// which is right for normal scroll screens but would clip screens that lay themselves out to the full
// window height and own their own dense bottom controls (SmartVision aerial F/M/B, SmartFinder/TightLie
// camera, the mark-tee/green maps, the swing camera). Those own the bottom; the caddie tab is where the
// unified input lives. 2026-07-24 (Tim — Fold Z: "many screens the bottom gets overlapped").
const HIDE_PREFIXES = [
  '/intro-video', '/permissions', '/greeting', '/welcome', '/paywall',
  '/swinglab/smartmotion', '/swinglab/coach-lesson',
  '/smartvision', '/smartfinder', '/lie-analysis', '/mark-tee', '/mark-green',
];

export function GlobalCaddieBar() {
  const path = usePathname() ?? '';
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!CADDIE_BAR_ENABLED) return null;
  if (HIDE_PREFIXES.some((p) => path.startsWith(p))) return null;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 6), backgroundColor: colors.background }]}>
        <CaddieBottomBar />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 6 },
});

export default GlobalCaddieBar;
