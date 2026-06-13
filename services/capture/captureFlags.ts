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
 * Master switch for the vision-camera swing/cage capture path. Default OFF so
 * every build behaves exactly like today until the vision path is validated on a
 * device. Flip to true (in a vision-camera build) to route the swing camera
 * through react-native-vision-camera.
 */
export const USE_VISION_CAMERA = false;

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
