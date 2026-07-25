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

// 2026-07-25 (Tim — "we said EVERY screen goddammit"). The caddie input rides EVERY screen. Only the
// boot/onboarding flows and the live SWING-CAPTURE camera are exempt (that camera owns the mic for
// acoustic strike detection + has its own record controls). Everything else — SmartVision, SmartFinder,
// TightLie, the mark-* maps — gets the bar; screens that size to the full window read useCaddieBarReserve()
// so their bottom content sits ABOVE the bar instead of clipping.
const HIDE_PREFIXES = [
  '/intro-video', '/permissions', '/greeting', '/welcome', '/paywall',
  '/swinglab/smartmotion', '/swinglab/coach-lesson',
];

/** Height (px) the bar reserves at the root ABOVE the home-indicator inset, or 0 where it's hidden.
 *  Full-window-height screens (SmartVision) subtract this so their layout fits above the bar. The bar's
 *  own paddingBottom owns the safe-area inset, so this is the bar's content height only. */
export function useCaddieBarReserve(): number {
  const path = usePathname() ?? '';
  if (!CADDIE_BAR_ENABLED) return 0;
  if (HIDE_PREFIXES.some((p) => path.startsWith(p))) return 0;
  return CADDIE_BAR_RESERVE;
}

// wrap paddingTop (6) + the bar row (~54) + a hair = the space the bar takes above the safe-area inset.
export const CADDIE_BAR_RESERVE = 64;

export function GlobalCaddieBar() {
  const path = usePathname() ?? '';
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!CADDIE_BAR_ENABLED) return null;
  if (HIDE_PREFIXES.some((p) => path.startsWith(p))) return null;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* 2026-07-25 (Tim — "the caddie mic/text is slightly cut off at the bottom") — a small buffer on
          top of the safe-area inset so the bar always sits fully above the system nav / home indicator. */}
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) + 6, backgroundColor: colors.background }]}>
        <CaddieBottomBar />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 6 },
});

export default GlobalCaddieBar;
