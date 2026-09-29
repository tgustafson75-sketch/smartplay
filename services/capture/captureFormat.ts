/**
 * 2026-09-29 — WHICH CAMERA FORMAT THE SWING CAMERA RECORDS IN. Pure, so it is proven without a device.
 *
 * The previous selection was `useCameraFormat(device, [{ fps: 120 }, { videoResolution: 'max' }])`:
 * ask every phone for 120fps, then take the largest resolution at whatever rate that produced. On a
 * phone with 4K60 that is a 4K clip for every swing (slow to copy, slow to decode, no read gained), and
 * 120fps formats need range daylight to expose — indoors they come back dark and noisy.
 *
 * Now:
 *   - only formats up to 1080p are candidates (a 60fps request must not land on 4K60);
 *   - the target is TARGET_CAPTURE_FPS (60), or HIGH_SPEED_CAPTURE_FPS (120) when the player opted in
 *     AND a ≤1080p format reaches it — otherwise the opt-in quietly falls back to 60;
 *   - among formats that reach the target: the highest resolution, then the one whose maxFps is
 *     CLOSEST to the target (a dedicated 240fps slow-mo mode is not a better 60fps format);
 *   - a device with no format reaching the target gets its best available rate (usually 30), and the
 *     existing low-fps notice (captureQuality) says what that costs;
 *   - a device reporting NO formats gets `format: null, fps: null` — the camera then uses its own
 *     default rather than being handed an fps it may not support. Nothing here can throw.
 */
import { HIGH_SPEED_CAPTURE_FPS, MAX_CAPTURE_SHORT_EDGE, TARGET_CAPTURE_FPS } from './captureFlags';

/** The slice of vision-camera's CameraDeviceFormat this needs. */
export type CaptureFormatLike = {
  videoWidth: number;
  videoHeight: number;
  maxFps: number;
  minFps?: number;
};

export type CaptureFormatChoice<F> = {
  format: F | null;
  /** The fps to request, always within the chosen format's range; null when there is no format. */
  fps: number | null;
  /** True when this device has a ≤1080p format that reaches HIGH_SPEED_CAPTURE_FPS — the opt-in toggle is shown only then. */
  highSpeedAvailable: boolean;
};

const shortEdge = (f: CaptureFormatLike) => Math.min(f.videoWidth, f.videoHeight);
const longEdge = (f: CaptureFormatLike) => Math.max(f.videoWidth, f.videoHeight);
const area = (f: CaptureFormatLike) => f.videoWidth * f.videoHeight;
const minOf = (f: CaptureFormatLike) => (typeof f.minFps === 'number' && Number.isFinite(f.minFps) && f.minFps > 0 ? f.minFps : 1);
const valid = (f: CaptureFormatLike | null | undefined): f is CaptureFormatLike =>
  !!f && [f.videoWidth, f.videoHeight, f.maxFps].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);

export function selectCaptureFormat<F extends CaptureFormatLike>(
  formats: readonly F[] | null | undefined,
  opts: { highSpeedOptIn: boolean },
): CaptureFormatChoice<F> {
  const all = (formats ?? []).filter(valid);
  if (all.length === 0) return { format: null, fps: null, highSpeedAvailable: false };

  const capped = all.filter((f) => shortEdge(f) <= MAX_CAPTURE_SHORT_EDGE && longEdge(f) <= Math.round(MAX_CAPTURE_SHORT_EDGE * 16 / 9));
  // A device whose every format is above 1080p is still a camera — use what it has rather than nothing.
  const pool = capped.length > 0 ? capped : all;

  const highSpeedAvailable = pool.some((f) => f.maxFps >= HIGH_SPEED_CAPTURE_FPS && minOf(f) <= HIGH_SPEED_CAPTURE_FPS);
  const target = opts.highSpeedOptIn && highSpeedAvailable ? HIGH_SPEED_CAPTURE_FPS : TARGET_CAPTURE_FPS;

  // Formats that can actually RUN at the target — a slow-motion-only mode (min 120) cannot run at 60.
  const reaching = pool.filter((f) => f.maxFps >= target && minOf(f) <= target);
  let format: F;
  if (reaching.length > 0) {
    format = [...reaching].sort((a, b) => (area(b) - area(a)) || (a.maxFps - b.maxFps))[0];
  } else {
    // Nothing reaches the target: the best rate this device has, then the most detail at it.
    const runnable = pool.filter((f) => minOf(f) <= target);
    format = [...(runnable.length > 0 ? runnable : pool)].sort((a, b) => (b.maxFps - a.maxFps) || (area(b) - area(a)))[0];
  }
  const fps = Math.max(minOf(format), Math.min(target, format.maxFps));
  return { format, fps, highSpeedAvailable };
}
