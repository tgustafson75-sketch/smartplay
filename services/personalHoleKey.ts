/**
 * 2026-09-10 — ONE ANSWER TO "WHICH HOLE DOES A PLAYER'S OWN MARK LIVE UNDER".
 *
 * A nine-hole course played twice presents holes 1-18, but there are only nine physical greens.
 * A green marked on hole 3 IS the green of hole 12; they are the same piece of grass.
 *
 * Before this, three different answers coexisted:
 *   - every WRITER used the raw round hole — app/mark-green.tsx, services/gpsMarkOverride.ts,
 *     services/intents/openToolHandler.ts, services/intents/declareHoleHandler.ts,
 *     app/smartvision.tsx, app/dev/CourseTruth.tsx — so Mark Green on the back nine stored hole 12;
 *   - smartFinderService.resolveGreenCoords and resolveTeeCoords WRAPPED, so they looked under
 *     hole 3 and never found it;
 *   - smartFinderService.getAnchoredHoleLengthYards did NOT wrap, so it looked under 12 and did.
 *
 * The player walked to the green on 12, tapped Mark Green, got "Green marked: hole 12" — and the
 * yardage did not move, because the tier reading it was looking somewhere else. Worse, a mark made
 * on hole 3 during loop one silently answered for hole 12 with no way to correct it.
 *
 * Normalising inside the override storage itself means every writer and every reader agree by
 * construction, rather than by eight call sites remembering the same rule.
 * [[two-owners-is-the-root-cause]] [[no-half-fixes-enforce-every-surface]]
 */

/**
 * Map a round hole number to the PHYSICAL hole a player's own mark belongs to.
 *
 * Idempotent: holes 1-9 are returned unchanged, so applying it twice is harmless (an existing
 * caller that already wrapped cannot be broken by this landing underneath it).
 *
 * Only wraps when the ACTIVE round says it is a nine played twice. Off-round, and on a real
 * eighteen, the hole number is its own answer — reading roundStore lazily and defensively so a
 * storage module never depends on a round being in progress.
 */
export function personalHoleKey(hole: number): number {
  if (!Number.isFinite(hole) || hole < 10) return hole;
  try {
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    return useRoundStore.getState().twiceAround === true ? hole - 9 : hole;
  } catch {
    return hole;
  }
}
