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

  noteAppOpen: () => void;
  completeTour: () => void;
  /** Force it back on (e.g. a "Show me around" button). */
  relaunchTour: () => void;
  /** Auto-show when it hasn't been completed and we're still within the first few opens. */
  shouldAutoShow: () => boolean;
}

export const useOnboardingTourStore = create<OnboardingTourState>()(
  persist(
    (set, get) => ({
      appOpens: 0,
      tourDone: false,
      countedThisLaunch: false,

      noteAppOpen: () => {
        if (get().countedThisLaunch) return;
        set((s) => ({ appOpens: s.appOpens + 1, countedThisLaunch: true }));
      },
      completeTour: () => set({ tourDone: true }),
      relaunchTour: () => set({ tourDone: false, appOpens: 1 }),
      shouldAutoShow: () => {
        const s = get();
        return !s.tourDone && s.appOpens > 0 && s.appOpens <= MAX_AUTO_OPENS;
      },
    }),
    {
      name: 'onboarding-tour-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      // countedThisLaunch is per-process — never persist it.
      partialize: (s) => ({ appOpens: s.appOpens, tourDone: s.tourDone }),
    },
  ),
);
