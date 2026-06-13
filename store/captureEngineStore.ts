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
}

export const useCaptureEngineStore = create<CaptureEngineState>()(
  persist(
    (set, get) => ({
      useVisionCamera: DEFAULT_USE_VISION_CAMERA,
      setUseVisionCamera: (on) => set({ useVisionCamera: on }),
      toggleVisionCamera: () => set({ useVisionCamera: !get().useVisionCamera }),
    }),
    {
      name: 'capture-engine-v1',
      version: 1,
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
