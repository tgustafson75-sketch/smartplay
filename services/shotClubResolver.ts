/**
 * 2026-08-09 (Tim — "missing major club use logic. If user does not change the advised club then that
 * use should be logged and tied to the distances and populated. We have always had the dumbest lost
 * logic when it comes to club use.")
 *
 * ONE arbiter for "what club was this shot actually hit with", used by every shot-logging path:
 *
 *   1. EXPLICIT — the user said the club in the same breath ("hit a 7 iron 150"). Always wins.
 *   2. DECLARED vs ADVISED by RECENCY — the player's last declared club (voice club change /
 *      plan) and the caddie's last recommendation (pendingKevinRec) both carry timestamps; the
 *      MORE RECENT one stands. This is the missing rule: caddie says "this is an 8-iron", player
 *      hits it without a word → the 8-iron IS the club, it gets logged, and (via the tracked-shot
 *      confirm chain) its measured distance trains the learned bag. If the player changed club
 *      AFTER the advice, their change wins.
 *   3. Neither fresh → null (callers may fall back to distance inference, clearly lower trust).
 *
 * FRESHNESS: both signals expire after 12 minutes — a club declared three holes ago is stale, not
 * "current". (pendingKevinRec is additionally cleared on hole change and consumed on shot log by
 * the callers, so the window rarely matters for advice; it protects the declared-club side.)
 */

import { useRoundStore } from '../store/roundStore';

const FRESH_MS = 12 * 60 * 1000;

export interface ResolvedShotClub {
  club: string | null;
  source: 'explicit' | 'declared' | 'advised' | null;
  /** True when the resolved club IS the caddie's recommendation (silent adherence included). */
  adhered: boolean | null;
  /** The recommendation in play for this shot (for kevin_rec_* stamping), regardless of source. */
  recClub: string | null;
  recShape: string | null;
}

export function resolveShotClub(explicit?: string | null): ResolvedShotClub {
  const round = useRoundStore.getState();
  const rec = round.pendingKevinRec ?? null;
  const recClub = rec?.club ?? null;
  const recShape = rec?.shape ?? null;

  if (explicit && explicit.trim()) {
    const c = explicit.trim();
    return { club: c, source: 'explicit', adhered: recClub != null ? c === recClub : null, recClub, recShape };
  }

  const now = Date.now();
  const declaredFresh = round.club != null && round.clubSetAt != null && now - round.clubSetAt <= FRESH_MS;
  const recAt = rec?.at ?? null;
  const advisedFresh = recClub != null && recAt != null && now - recAt <= FRESH_MS;

  if (declaredFresh && advisedFresh) {
    // Recency arbitration: a club change AFTER the advice overrides it; advice after a change stands.
    if ((round.clubSetAt as number) >= (recAt as number)) {
      return { club: round.club, source: 'declared', adhered: recClub != null ? round.club === recClub : null, recClub, recShape };
    }
    return { club: recClub, source: 'advised', adhered: true, recClub, recShape };
  }
  if (declaredFresh) {
    return { club: round.club, source: 'declared', adhered: recClub != null ? round.club === recClub : null, recClub, recShape };
  }
  if (advisedFresh) {
    return { club: recClub, source: 'advised', adhered: true, recClub, recShape };
  }
  return { club: null, source: null, adhered: null, recClub, recShape };
}
