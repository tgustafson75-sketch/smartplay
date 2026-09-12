/**
 * 2026-06-13 — Capture-engine seam (SmartTrace migration, Stage 0).
 *
 * We're moving the swing/cage VIDEO path from expo-camera (no frame-rate control,
 * ~30fps default) to react-native-vision-camera (real fps/format selection) so
 * SmartTrace gets a dense launch window to read ball departure from. The swap is
 * staged behind this flag so the expo-camera path stays the working default until
 * a vision-camera dev build is proven on-device.
 *
 * IMPORTANT — native build, not OTA. Flipping USE_VISION_CAMERA only takes effect
 * in a build that linked react-native-vision-camera (the app.json config plugin).
 * An eas-update bundle on the current expo-camera build will NOT have the native
 * module; the seam falls back to expo-camera there. See memory:
 * practice-engine-smartmotion, ota-branch-preview.
 *
 * The acoustic impact anchor is NOT affected by this swap: acousticImpactDetector
 * runs its own parallel expo-av Audio.Recording for metering — it never read the
 * camera's audio track. The vision camera deliberately records video-only so it
 * never competes with that recording for the mic.
 */

/**
 * Compile-time DEFAULT for the vision-camera swing/cage capture path.
 *
 * 2026-09-12 — ON. Tim: "we have already proven it works better at 60, and if I am not mistaken
 * that is like minimum… most if not all phones now have 60fps."
 *
 * It was off from 2026-06-13 "until the vision path is validated on a device", and that validation
 * has happened. Three things make this safe to flip rather than merely desirable:
 *   - the module is linked in the SHIPPED build (docs/NEEDS-A-NATIVE-BUILD.md §3), so this reaches
 *     players over OTA rather than waiting for a store build;
 *   - smartmotion falls back to expo-camera both when the module is absent and — since 2026-09-12 —
 *     when it loads but resolves no device, which previously rendered a blank frame;
 *   - it is the ONLY engine that reports the fps it actually got, so MIN_TRACE_FPS finally applies
 *     on the path players are really on. expo-camera exposes no frame rate at all, which is why a
 *     30fps capture has been drawing the same confident departure trace as a 120fps one.
 *
 * Reversible from the Owner Console (native-modules-debug) at runtime, per device.
 */
export const DEFAULT_USE_VISION_CAMERA = true;

/**
 * Preferred capture frame rate (fps) for swing video. SmartTrace reads the ball's
 * departure over the first frames after impact, so more fps = more launch-window
 * points to fit a direction from. useCameraFormat picks the closest format the
 * device actually supports; very high fps needs good light (range/cage daylight),
 * so the format query degrades gracefully to the device max.
 */
export const PREFERRED_CAPTURE_FPS = 120;

/**
 * Floor we still consider "high-speed enough" to attempt a drawn departure trace.
 * Below this (e.g. a device that only offers 30fps) SmartTrace stays in its
 * sound+tempo tier rather than claiming a flight direction it can't see cleanly.
 */
export const MIN_TRACE_FPS = 60;
