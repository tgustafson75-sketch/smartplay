import { create } from 'zustand';

/**
 * 2026-09-17 (Tim) — "my daughter is actually using 18Birdies for one reason and one reason only:
 * on their rest screen she can still see the yardage."
 *
 * The rest overlay paints pure black over everything to save the OLED, and the number the player
 * most wants goes with it — while GPS, the round and the yardage resolver all keep running
 * underneath at full rate. Nothing throttles on rest (restModeStore has three consumers and none of
 * them touch GPS), so the yardage is being computed the whole time and then covered up. Showing it
 * is a display change, not a power change.
 *
 * WHY A STORE RATHER THAN A SECOND CALCULATION. app/(tabs)/caddie.tsx resolves the yardage through
 * the tier ladder (resolvedYardage → displayYardage → playsLike via caddieDecision) inside its own
 * render. RestModeOverlay is mounted in app/_layout.tsx, ABOVE and OUTSIDE that screen, so it cannot
 * see those values. Recomputing them here would put a second answer to "how far is it" on the
 * player's phone — and a rest screen that disagrees with the strip he just looked at is worse than a
 * rest screen with no number on it. So the caddie screen PUBLISHES what it already decided and this
 * only mirrors it. One owner, one number. [[two-owners-is-the-root-cause]]
 *
 * WHY THE TIMESTAMP IS NOT OPTIONAL. The publisher is a screen, and a screen can be unmounted — rest
 * engages on ANY route after a minute idle, including ones reached without ever opening the caddie
 * tab. Without a freshness check the overlay would faithfully display the last yardage from twenty
 * minutes and three holes ago, which is not a stale number, it is a WRONG one, shown at the exact
 * moment the player cannot see anything else to contradict it. Stale reads to null and the overlay
 * falls back to what it showed before this existed. [[a-read-cannot-outlive-its-shot]]
 */

/** Older than this and the number is not shown. Generous next to the GPS tick, tight next to a walk
 *  between shots: a fix lands every few seconds during a live round, so anything approaching this
 *  means the publisher is gone, not that the player stood still. */
export const REST_READOUT_STALE_MS = 45_000;

export interface RestReadout {
  /** Raw yards to the target, exactly as the caddie strip shows it. */
  yardage: number | null;
  /** Plays-like yards after wind/elevation, or null when there is no adjustment to show. */
  playsLike: number | null;
  hole: number | null;
  /** Epoch ms of the last publish. 0 = never published this session. */
  updatedAt: number;
}

interface RestReadoutState extends RestReadout {
  publish: (r: Omit<RestReadout, 'updatedAt'>) => void;
  clear: () => void;
}

export const useRestReadoutStore = create<RestReadoutState>((set) => ({
  yardage: null,
  playsLike: null,
  hole: null,
  updatedAt: 0,
  publish: (r) => set({ ...r, updatedAt: Date.now() }),
  clear: () => set({ yardage: null, playsLike: null, hole: null, updatedAt: 0 }),
}));

/**
 * The readout to draw, or null when there is nothing honest to draw.
 *
 * Pure and exported so the rule is testable without mounting the overlay — the whole point of this
 * module is the case where it must REFUSE, and that is the case a render test is worst at reaching.
 */
export function freshReadout(r: RestReadout, now: number = Date.now()): RestReadout | null {
  if (!r.updatedAt) return null;
  if (now - r.updatedAt > REST_READOUT_STALE_MS) return null;
  if (r.yardage == null) return null;
  return r;
}
