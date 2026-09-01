/**
 * 2026-08-31 — WHICH MOMENTS OF THE SWING TRAVEL IN A SHARE LINK.
 *
 * Pure and dependency-free on purpose: services/swingShare pulls in expo-av through videoUpload, so
 * nothing there can be exercised by the logic test project. The sampling rule is the part worth
 * testing — it is what decides whether a shared link shows a golf swing or a man walking up to a
 * ball — so it lives where it can be.
 */

/** Enough frames to read as motion without becoming a slideshow, and to keep the payload under ~1MB. */
export const SHARE_FRAME_COUNT = 8;

/**
 * Sample evenly ACROSS THE SWING WINDOW, never across the clip.
 *
 * The recording is 60-120 seconds; the swing is about three. Sampling the recording spends seven of
 * eight frames on a walk-up and a practice waggle — which is precisely the defect the analysis
 * sampler had to fix for its own frame selection, arrived at again from the other end.
 *
 * Degrades rather than throwing: an inverted, zero-length or negative window still yields a usable
 * ascending series, because a share failing on arithmetic would be a worse outcome than a share of
 * a slightly wrong three seconds.
 */
export function frameTimesMs(startSec: number, endSec: number, count: number = SHARE_FRAME_COUNT): number[] {
  const n = Math.max(2, Math.floor(count));
  const a = Math.max(0, Number.isFinite(startSec) ? startSec * 1000 : 0);
  const bRaw = Number.isFinite(endSec) ? endSec * 1000 : a;
  // A window that does not run forwards is not a window; give it a swing's worth of time.
  const b = bRaw > a ? bRaw : a + 3000;
  const span = b - a;
  return Array.from({ length: n }, (_, i) => Math.round(a + (span * i) / (n - 1)));
}
