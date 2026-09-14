import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { RangefinderLock } from '../types/smartfinder';

// 2026-07-25 (Tim — "remove Measure entirely") — the GPS-free known-height 'measure' rangefinder is
// retired (fiddly manual two-tap; the on-course Camera tap-for-yardage is the simple pointfinder). Kept
// out of the type; a persisted 'measure' maps to 'target' via migrate v3 + the setMode guard below.
export type SmartFinderMode = 'standard' | 'target' | 'map' | 'putt';

/** Every mode the screen can be opened in. Declared once so the URL validator cannot drift from the type. */
export const SMARTFINDER_MODES: readonly SmartFinderMode[] = ['standard', 'target', 'map', 'putt'];

/**
 * 2026-09-13 (Tim — "I think it opens SmartFinder in Putt mode"). It did not: SmartFinder read only
 * `autoread` from the URL, so NOTHING in the app could open it in a chosen mode, and arriving in putt
 * mode by voice worked purely because zustand had persisted 'putt' from the last time he tapped the tab.
 *
 * This is the validator for the `?mode=` param that fixes that. A route is a boundary, so an unknown or
 * absent value returns null and the persisted preference stands — a bad link must never strand the
 * screen in a mode that does not exist.
 */
export function parseSmartFinderMode(raw: unknown): SmartFinderMode | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  // 'measure' was retired above and still appears in old links; it maps where the migration maps it.
  if (v === 'measure') return 'target';
  return (SMARTFINDER_MODES as readonly string[]).includes(v) ? (v as SmartFinderMode) : null;
}

interface SmartFinderState {
  // Transient — not persisted. AR lock from the legacy camera mode.
  currentLock: RangefinderLock | null;
  setLock: (lock: RangefinderLock | null) => void;
  clearLock: () => void;
  // Phase D-2 — persisted mode preference for the full-screen view.
  mode: SmartFinderMode;
  setMode: (mode: SmartFinderMode) => void;
  /**
   * 2026-09-01 (Tim: "SmartFinder is supposed to have an off course setting so you can measure
   * during practice").
   *
   * PRACTICE MEASURE. Off a course the screen already stands its hole navigator down and behaves as
   * a pure point-to-point measure, because there is no course to have holes. But a player at the
   * RANGE often still has a course selected from earlier — preview or pending-start — so the app
   * thinks he is on one and shows hole furniture he cannot use.
   *
   * This is the explicit override: force the measure-only behaviour regardless of what course is
   * selected. Persisted, because "I am practising" outlives a screen mount.
   *
   * NOT a revival of the retired 'measure' MODE (the fiddly GPS-free two-tap, removed 2026-07-25 at
   * Tim's request). The measure here is the same camera target read the course path uses; only the
   * course-coupled chrome changes.
   */
  offCourse: boolean;
  setOffCourse: (on: boolean) => void;
}

export const useSmartFinderStore = create<SmartFinderState>()(
  persist(
    (set) => ({
      currentLock: null,
      setLock: (lock) => set({ currentLock: lock }),
      clearLock: () => set({ currentLock: null }),
      mode: 'target',
      // Guard: a stale/legacy 'measure' can never stick as the active mode.
      setMode: (mode) => set({ mode: (mode as string) === 'measure' ? 'target' : mode }),
      offCourse: false,
      setOffCourse: (on) => set({ offCourse: !!on }),
    }),
    {
      name: 'smartfinder-store-v1',
      // 2026-05-26 Fix BZ — __BZ_baseline__ version + passthrough migrate so future
      // version bumps don't wipe state. Replace `as never` with the real
      // state type when adding actual migration logic.
      // 2026-06-23 SF-3 — v2: retire the dead, ungated 'standard' camera path
      // (no longer UI-selectable) by mapping any persisted mode to 'target'.
      // All other persisted fields are preserved.
      // 2026-07-25 v3 — retire 'measure' (Tim) alongside the already-retired 'standard'; map either to
      // 'target' so a persisted value from an older build doesn't select a mode that no longer exists.
      // 2026-09-01 v4 — adds the persisted `offCourse` practice-measure setting. Passthrough: a v3
      // state simply has no flag, and `false` is the correct default for an existing player.
      version: 4,
      migrate: (s) => {
        // 2026-09-01 (adversarial audit) — a persisted PRIMITIVE must not be returned. zustand's
        // merge spreads the return value, so 'abc' becomes {0:'a',1:'b',2:'c'} and is persisted that
        // way — corrupting the store permanently rather than losing it once. Same class fixed across
        // the other stores on 08-31.
        if (typeof s !== 'object' || s === null || Array.isArray(s)) return {} as never;
        const prev = (s ?? {}) as Partial<SmartFinderState>;
        if (prev.mode === 'standard' || (prev.mode as string) === 'measure') {
          return { ...prev, mode: 'target' } as never;
        }
        return prev as never;
      },
      storage: createJSONStorage(() => getPersistStorage()),
      partialize: (s) => ({ mode: s.mode, offCourse: s.offCourse }),
    },
  ),
);
