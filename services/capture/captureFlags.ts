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
 * 2026-09-29 — 60 BY DEFAULT, 120 WHEN THE PLAYER ASKS FOR IT.
 *
 * The camera used to ASK for 120 on every device and take the highest resolution at whatever rate it
 * got — on many phones a 4K format, and on most a 120fps format that needs range-daylight to expose
 * properly. 60fps is what MIN_TRACE_FPS needs for an honest departure trace, it exposes well indoors,
 * and nearly every phone offers it at 1080p. So the swing camera targets TARGET_CAPTURE_FPS at up to
 * 1080p, and records at HIGH_SPEED_CAPTURE_FPS only when the player turned it on (captureEngineStore
 * .highSpeedOptIn) AND the device has a ≤1080p format that reaches it. The selection itself is the
 * pure services/capture/captureFormat.selectCaptureFormat, so it is tested without a device.
 */
export const TARGET_CAPTURE_FPS = 60;
export const HIGH_SPEED_CAPTURE_FPS = 120;
/** Never pick a format above 1080p for swing capture — a 60fps request must not land on 4K60. */
export const MAX_CAPTURE_SHORT_EDGE = 1080;

/**
 * Floor we still consider "high-speed enough" to attempt a drawn departure trace.
 * Below this (e.g. a device that only offers 30fps) SmartTrace stays in its
 * sound+tempo tier rather than claiming a flight direction it can't see cleanly.
 */
export const MIN_TRACE_FPS = 60;
