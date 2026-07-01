/**
 * 2026-07-01 (Tim — "tell me what you see" should read the vision of what's seen on the WHOLE
 * VIEW (the SmartVision aerial) as well as what's ingested through the camera).
 *
 * A claim bus: when the player says "tell me what you see" (scene_read), a mounted SmartVision
 * screen can CLAIM the request and speak its own in-place read of the current hole (yardage +
 * hazards + club) instead of the default behavior of opening the SmartFinder camera. If no vision
 * screen is mounted to claim it, the handler falls through to the camera scene read.
 */

let smartVisionReadHandler: (() => void) | null = null;

/** SmartVision registers its "read this hole aloud" handler on mount; pass null on unmount. */
export function registerSmartVisionRead(fn: (() => void) | null): void {
  smartVisionReadHandler = fn;
}

/** Returns true if a mounted SmartVision claimed + handled the read (spoke the aerial). */
export function requestSmartVisionRead(): boolean {
  if (smartVisionReadHandler) {
    try { smartVisionReadHandler(); return true; } catch { return false; }
  }
  return false;
}
