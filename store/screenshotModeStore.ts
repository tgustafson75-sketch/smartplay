/**
 * 2026-05-27 — Fix EA: Screenshot mode store.
 *
 * Single boolean app-wide. When ON, the global StatusBar hides so the
 * user can take screenshots that don't include the phone's top chrome
 * (time / battery / wifi). Tim's request: "take screenshots that don't
 * have anything from my phone." Lets us produce clean marketing /
 * App Store / promo screenshots without post-processing.
 *
 * Intentionally NOT persisted. If a user enables this and force-quits
 * the app, the next launch comes back in normal mode — eliminates the
 * "where did my status bar go" support question after a forgetten toggle.
 *
 * Limitation v1 (Android): the bottom system nav bar (back / home /
 * recent) does NOT hide via this toggle. Hiding it cleanly requires
 * expo-navigation-bar, which is a native dep — needs the next EAS
 * Build, not OTA-able. Top status bar hides via expo-status-bar which
 * is JS-only and ships in this OTA. iOS has no equivalent bottom nav
 * bar (only the slim home indicator), so iOS gets the full effect now.
 */

import { create } from 'zustand';

interface ScreenshotModeState {
  enabled: boolean;
  setEnabled: (b: boolean) => void;
  toggle: () => void;
}

export const useScreenshotModeStore = create<ScreenshotModeState>((set) => ({
  enabled: false,
  setEnabled: (b) => set({ enabled: b }),
  toggle: () => set((s) => ({ enabled: !s.enabled })),
}));
