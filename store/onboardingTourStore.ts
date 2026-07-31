/**
 * 2026-08-01 (tester feedback — "on first 3 uses of the app a skippable icon-by-icon highlight
 * explanation of the tool and what it does"). Drives the first-run guided tour.
 *
 * Behavior (Tim): a FULL guided tour on the first use, then it keeps offering on the next couple of
 * opens (up to the first 3) until the user finishes or skips — auto-shown, always skippable. Once
 * completed or skipped it never auto-shows again (a "Show me around" entry can re-launch it later).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

const MAX_AUTO_OPENS = 3;

interface OnboardingTourState {
  /** Incremented once per app launch (see app/_layout.tsx). */
  appOpens: number;
  /** True once the user finished OR skipped the tour — no more auto-shows. */
  tourDone: boolean;
  /** Guards noteAppOpen against double-counting within a single launch. */
  countedThisLaunch: boolean;
  /** 2026-07-30 (audit #18) — bumps on every relaunchTour() so an ALREADY-MOUNTED caddie tab (a tab never
   *  re-mounts) can react and re-show the tour. A mount-only shouldAutoShow() check made the "Show me
   *  around" button a dead no-op. Session-only (not persisted). */
  relaunchNonce: number;

  /** 2026-07-30 (Tim — "basics on all main tabs"). Per-tab "seen the basics" flags so each main tab shows
   *  its short basics tour once on first visit (within the auto-show window), independently of the caddie
   *  tab's tour. Persisted. */
  seenTabs: Record<string, boolean>;

  noteAppOpen: () => void;
  completeTour: () => void;
  /** Force it back on (e.g. a "Show me around" button). */
  relaunchTour: () => void;
  /** Auto-show when it hasn't been completed and we're still within the first few opens. */
  shouldAutoShow: () => boolean;
  /** Mark a tab's basics tour as seen. */
  markTabSeen: (tab: string) => void;
  /** True if this tab's basics should auto-show now: within the auto-show window AND not seen yet. */
  shouldShowTab: (tab: string) => boolean;
}

export const useOnboardingTourStore = create<OnboardingTourState>()(
  persist(
    (set, get) => ({
      appOpens: 0,
      tourDone: false,
      countedThisLaunch: false,
      relaunchNonce: 0,
      seenTabs: {},

      noteAppOpen: () => {
        if (get().countedThisLaunch) return;
        set((s) => ({ appOpens: s.appOpens + 1, countedThisLaunch: true }));
      },
      completeTour: () => set({ tourDone: true }),
      relaunchTour: () => set((s) => ({ tourDone: false, appOpens: 1, relaunchNonce: s.relaunchNonce + 1, seenTabs: {} })),
      shouldAutoShow: () => {
        const s = get();
        return !s.tourDone && s.appOpens > 0 && s.appOpens <= MAX_AUTO_OPENS;
      },
      markTabSeen: (tab) => set((s) => (s.seenTabs[tab] ? {} : { seenTabs: { ...s.seenTabs, [tab]: true } })),
      shouldShowTab: (tab) => {
        const s = get();
        // Only within the first few opens, and only once per tab. Independent of the caddie tour's tourDone.
        return s.appOpens > 0 && s.appOpens <= MAX_AUTO_OPENS && !s.seenTabs[tab];
      },
    }),
    {
      name: 'onboarding-tour-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      // countedThisLaunch + relaunchNonce are per-process — never persist them.
      partialize: (s) => ({ appOpens: s.appOpens, tourDone: s.tourDone, seenTabs: s.seenTabs }),
    },
  ),
);
