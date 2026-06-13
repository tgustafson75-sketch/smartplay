import { create } from 'zustand';

/**
 * 2026-06-13 — Round "Rest" mode (Tim #8 battery drain).
 *
 * Tim disables his phone's auto-lock during a round so GPS never sleeps — but
 * that leaves the OLED screen at full brightness the whole time, the real drain.
 * Brightness is independent of GPS/voice/sensors, so we can darken HARD without
 * losing any function. expo-brightness would need a native build (not OTA-able),
 * so the OTA fix is a near-black overlay: on the Z Fold's OLED, black pixels are
 * physically OFF, so a mostly-black rest screen slashes power while the round,
 * gpsManager, and the caddie keep running full-speed underneath. Tap to wake.
 *
 * This store is just the shared flag + an activity heartbeat. The overlay
 * component owns the idle timer; the _layout touch-capture wrapper bumps
 * `lastActivityAt` on every touch so rest only engages when you're truly idle.
 */

interface RestModeState {
  /** Rest overlay is showing (screen darkened). */
  active: boolean;
  /** Epoch ms of the last user touch anywhere in the app. */
  lastActivityAt: number;
  /** Bump on any touch — wakes the screen and resets the idle countdown. */
  noteActivity: () => void;
  /** Engage rest now (manual button or the idle timer). */
  enterRest: () => void;
  /** Wake the screen (tap on the overlay). */
  exitRest: () => void;
}

export const useRestModeStore = create<RestModeState>((set, get) => ({
  active: false,
  lastActivityAt: Date.now(),
  noteActivity: () => {
    // Any touch both records activity AND wakes the screen if it was resting.
    const wasActive = get().active;
    set({ lastActivityAt: Date.now(), ...(wasActive ? { active: false } : null) });
  },
  enterRest: () => set({ active: true }),
  exitRest: () => set({ active: false, lastActivityAt: Date.now() }),
}));
