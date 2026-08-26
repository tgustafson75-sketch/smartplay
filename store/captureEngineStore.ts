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
}

export const useCaptureEngineStore = create<CaptureEngineState>()(
  persist(
    (set, get) => ({
      useVisionCamera: DEFAULT_USE_VISION_CAMERA,
      setUseVisionCamera: (on) => set({ useVisionCamera: on }),
      toggleVisionCamera: () => set({ useVisionCamera: !get().useVisionCamera }),
      capturedFps: null,
      setCapturedFps: (fps) => set({ capturedFps: typeof fps === 'number' && fps > 0 ? fps : null }),
    }),
    {
      name: 'capture-engine-v1',
      // capturedFps is a property of THIS device + THIS format, re-resolved on every mount.
      partialize: (s) => ({ useVisionCamera: s.useVisionCamera }) as CaptureEngineState,
      version: 1,
      migrate: (s) => s as never, // 2026-06-15 (audit) — passthrough; no silent wipe on bump
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
