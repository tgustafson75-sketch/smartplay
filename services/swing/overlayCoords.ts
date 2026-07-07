/**
 * 2026-07-07 (Tim — "shot tracing that actually lines up on the user").
 *
 * There are TWO normalized coordinate spaces in the SmartMotion overlays and they are
 * NOT interchangeable when the video is displayed with `cover`/`contain`:
 *
 *   • FRAME-normalized  — 0..1 of the SOURCE video frame. Everything the CV pipeline
 *     detects is here: ball departure point, ball-path points (divided by the real
 *     thumbnail pixel W/H in cropToFullNorm).
 *   • CONTAINER-normalized — 0..1 of the on-screen container the <Video> is drawn in.
 *     The user places the ball box + target here (they drag on what they SEE).
 *
 * Under `cover` the video is scaled up + cropped, so a frame-normalized point does NOT
 * sit at the same container-normalized spot — the ball trace drifted off the ball (up
 * to ~135px at the edges). The skeleton overlay already reconciles this via an SVG
 * viewBox + preserveAspectRatio; these helpers give the trace/target overlays the same
 * correctness with plain arithmetic (they draw with p.x*containerW, not an SVG viewBox).
 *
 * Pure + deterministic so it unit-tests. `frameAR`/`containerAR` are width/height ratios.
 */

export type FitMode = 'cover' | 'contain';

/** Norm-space scale factors for fitting a frame of ratio `frameAR` into a container of
 *  ratio `containerAR` with `mode`. (kx,ky) multiply the offset-from-center. */
function fitScale(frameAR: number, containerAR: number, mode: FitMode): { kx: number; ky: number } {
  if (!(frameAR > 0) || !(containerAR > 0)) return { kx: 1, ky: 1 };
  const r = frameAR / containerAR;
  if (mode === 'cover') {
    // The larger dimension overflows (crops); the other fills exactly.
    return { kx: Math.max(1, r), ky: Math.max(1, 1 / r) };
  }
  // contain: the larger dimension fits exactly; the other letterboxes (shrinks).
  return { kx: Math.min(1, r), ky: Math.min(1, 1 / r) };
}

/**
 * Convert a FRAME-normalized point to the CONTAINER-normalized point where it actually
 * appears on screen (given the video's fit mode). A returned value outside [0,1] means
 * that frame point is cropped off-screen under `cover` — which is correct (e.g. a ball
 * that departed into the cropped region).
 */
export function frameToContainerNorm(
  pt: { x: number; y: number },
  frameAR: number,
  containerAR: number,
  mode: FitMode,
): { x: number; y: number } {
  const { kx, ky } = fitScale(frameAR, containerAR, mode);
  return { x: 0.5 + (pt.x - 0.5) * kx, y: 0.5 + (pt.y - 0.5) * ky };
}

/**
 * Inverse: convert a CONTAINER-normalized point (e.g. the user-placed ball box / target)
 * to FRAME-normalized space, so it can be compared against CV-detected frame points.
 */
export function containerToFrameNorm(
  pt: { x: number; y: number },
  frameAR: number,
  containerAR: number,
  mode: FitMode,
): { x: number; y: number } {
  const { kx, ky } = fitScale(frameAR, containerAR, mode);
  return { x: 0.5 + (pt.x - 0.5) / kx, y: 0.5 + (pt.y - 0.5) / ky };
}
