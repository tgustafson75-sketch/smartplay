/**
 * 2026-10-27 (SB4x) — GRAB FRAME: the photo, and whether an overlay is really baked into it.
 *
 * The library's Grab Frame keyed its "Frame + overlay saved" toast on the raw toggles, while the still bakes
 * only the layers on screen (overlayLayers) — with Swing Trace on and no drawable arc, Body off, the photo
 * was the plain frame and the toast still claimed an overlay. And a bake that failed fell back to the plain
 * thumbnail under the same claim. `baked` is what the photo holds.
 */
export async function grabFrameStill(i: {
  hasPose: boolean;
  /** The layers on screen (overlayLayers): a layer the player turned off is not in his photo. */
  layers: { skeleton: boolean; trace: boolean };
  capture: (layers: { showSkeleton: boolean; showTrace: boolean }) => Promise<string | null>;
  thumbnail: () => Promise<string>;
}): Promise<{ uri: string; baked: boolean }> {
  if (i.hasPose && (i.layers.skeleton || i.layers.trace)) {
    const out = await i.capture({ showSkeleton: i.layers.skeleton, showTrace: i.layers.trace });
    if (out) return { uri: out, baked: true };
  }
  return { uri: await i.thumbnail(), baked: false };
}
