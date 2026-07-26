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
import React, { useEffect, useState } from 'react';
import { View, Keyboard, Platform, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { CaddieBottomBar } from './caddie/CaddieBottomBar';
// 2026-07-26 — the status strip is now a SHARED component so the full-screen capture screens
// (SmartMotion / Coach lesson) can float it over the camera too (Tim: "bar everywhere logical").
import { CaddieStatusStrip } from './caddie/CaddieStatusStrip';

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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    // iOS reports the frame before the animation (Will*); Android only fires Did*.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: { endCoordinates?: { height?: number } }) => setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    const onHide = () => setKeyboardHeight(0);
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => { subShow.remove(); subHide.remove(); };
  }, []);
  if (!CADDIE_BAR_ENABLED) return null;
  if (HIDE_PREFIXES.some((p) => path.startsWith(p))) return null;
  // 2026-07-25 (Tim — "when the keyboard comes up I can't see what I'm typing") — the old
  // KeyboardAvoidingView was a NO-OP on Android (behavior undefined), so the input sat behind the
  // keyboard. Lift the whole bar by the measured keyboard height instead (works on both platforms,
  // independent of the native windowSoftInputMode). The bar isn't lifted by anything else today, so
  // this can't double-lift. When the keyboard is up it owns the bottom inset, so we drop the
  // home-indicator pad to avoid an extra gap between the bar and the keyboard.
  // 2026-07-25 (Tim — "close but I still can't see what I typed") — lifting by exactly the reported
  // keyboard height left the input a hair behind the keyboard: on Android edge-to-edge, keyboardDidShow
  // height is measured to the screen bottom and EXCLUDES the nav-bar inset, so the bar sat ~a nav bar
  // too low. Add insets.bottom + a small buffer to the lift. Erring slightly HIGH (a small gap above
  // the keyboard) is fine; erring low hides the input — so bias upward.
  const bottomPad = keyboardHeight > 0 ? 6 : Math.max(insets.bottom, 8) + 6;
  const lift = keyboardHeight > 0 ? keyboardHeight + insets.bottom + 10 : 0;
  return (
    <View style={[styles.wrap, { paddingBottom: bottomPad, marginBottom: lift, backgroundColor: colors.background }]}>
      <CaddieStatusStrip />
      <CaddieBottomBar />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 6 },
});

export default GlobalCaddieBar;
