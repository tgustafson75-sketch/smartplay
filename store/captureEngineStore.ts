/**
 * 2026-06-13 — Capture-engine runtime toggle (SmartTrace migration).
 *
 * The compile-time default lives in services/capture/captureFlags.ts
 * (DEFAULT_USE_VISION_CAMERA = false). This persisted store lets the OWNER flip
 * the swing camera between expo-camera and react-native-vision-camera AT RUNTIME
 * (native-modules-debug screen), so a SINGLE dev/preview build can A/B both
 * engines on a real phone — record a swing on each, compare, confirm the acoustic
 * strike detection still fires — instead of needing a separate build per engine.
 *
 * Only meaningful in a build that linked vision-camera; on an OTA bundle over the
 * old expo-camera build the native module is absent and the swing path stays on
 * expo-camera regardless of this flag. See memory practice-engine-smartmotion.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import { DEFAULT_USE_VISION_CAMERA } from '../services/capture/captureFlags';

interface CaptureEngineState {
  /** When true, the swing path records via vision-camera (high-fps). */
  useVisionCamera: boolean;
  setUseVisionCamera: (on: boolean) => void;
  toggleVisionCamera: () => void;
  /**
   * 2026-08-26 (Tim — "make sure the app is ready when I get the iPhone Pro Max with the 120 FPS,
   * and make sure that we can maximize for that capability").
   *
   * The fps vision-camera ACTUALLY resolved for this device, not the fps we asked for.
   * PREFERRED_CAPTURE_FPS is a request; useCameraFormat degrades to whatever the phone offers, so
   * a 30fps device silently produced a capture that looks identical to a 120fps one downstream.
   *
   * captureFlags has always declared MIN_TRACE_FPS — "the floor we still consider high-speed enough
   * to attempt a drawn departure trace… below this, SmartTrace stays in its sound+tempo tier rather
   * than claiming a flight direction it can't see cleanly" — and NOTHING READ IT. The judgement was
   * written down and never consulted, so the honest fallback it describes could not happen. This is
   * the value that lets it. NOT persisted: it is a property of this device and this format, and
   * re-resolved every time the camera mounts.
   */
  capturedFps: number | null;
  setCapturedFps: (fps: number | null) => void;
  /**
   * 2026-09-12 — did a HUMAN pick this engine, or is it just the default sitting on disk?
   *
   * `useVisionCamera` is persisted, so every device that has ever opened the app already has `false`
   * written to it — not because anyone chose expo-camera, but because that was the compile-time
   * default and persist wrote it out. Raising the default alone would therefore have reached NOBODY,
   * while looking exactly like a shipped change.
   *
   * This is the defect that cost a whole audit once before: a DEFAULT read back as a CHOICE.
   * [[nobody-chose-cage-the-default-did]] Only an explicit flip on the debug screen sets this, so the
   * v2 migration can adopt the new default for everyone who never expressed a preference and leave
   * alone the one person who did.
   */
  chosenByUser: boolean;
  /**
   * 2026-09-12 (Tim) — "if navigate to SmartMotion with 30 set, provide one text box reminder."
   *
   * ONE. Persisted so it survives relaunch, because a reminder that returns every time you open the
   * screen is a nag, and this app does not nag. There is nothing to gain from saying it twice: the
   * setting is on their camera and they either changed it or decided not to.
   *
   * Self-retiring: it only fires below MIN_TRACE_FPS, so a player who acts on it never sees it
   * again, and one who does not has already heard it.
   */
  lowFpsNoticeShown: boolean;
  markLowFpsNoticeShown: () => void;
}

export const useCaptureEngineStore = create<CaptureEngineState>()(
  persist(
    (set, get) => ({
      useVisionCamera: DEFAULT_USE_VISION_CAMERA,
      chosenByUser: false,
      setUseVisionCamera: (on) => set({ useVisionCamera: on, chosenByUser: true }),
      toggleVisionCamera: () => set({ useVisionCamera: !get().useVisionCamera, chosenByUser: true }),
      capturedFps: null,
      setCapturedFps: (fps) => set({ capturedFps: typeof fps === 'number' && fps > 0 ? fps : null }),
      lowFpsNoticeShown: false,
      markLowFpsNoticeShown: () => set({ lowFpsNoticeShown: true }),
    }),
    {
      name: 'capture-engine-v1',
      // capturedFps is a property of THIS device + THIS format, re-resolved on every mount.
      partialize: (s) => ({
        useVisionCamera: s.useVisionCamera,
        chosenByUser: s.chosenByUser,
        lowFpsNoticeShown: s.lowFpsNoticeShown,
      }) as CaptureEngineState,
      version: 2,
      /**
       * 2026-09-12 — v1 → v2: adopt the new engine default for anyone who never chose.
       *
       * v1 stored no record of WHY `useVisionCamera` held its value, so every device carries `false`
       * whether or not a human ever looked at the setting. Treating that as a preference would mean
       * raising DEFAULT_USE_VISION_CAMERA changed nothing for a single existing player — the change
       * would ship, pass every gate, and reach zero people.
       *
       * So a v1 record is read as "no preference expressed" and takes the current default. From v2
       * on, `chosenByUser` records the difference honestly and this migration never runs again.
       * The owner's explicit A/B flip is preserved the moment they make it.
       */
      migrate: (persisted, version) => {
        /**
         * A truncated or cleared write can leave a PRIMITIVE here, and zustand merges what this
         * returns by spreading it — so returning 'abc' writes {0:'a',1:'b',2:'c'} back to disk and
         * corrupts the store permanently, on every launch after. Falling back to defaults loses it
         * once instead. [[a-corrupt-write-must-cost-one-store]]
         */
        const prev = (persisted == null || typeof persisted !== 'object'
          ? {}
          : persisted) as Partial<CaptureEngineState>;
        if (version < 2) {
          return { ...prev, useVisionCamera: DEFAULT_USE_VISION_CAMERA, chosenByUser: false } as never;
        }
        return prev as never;
      },
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
