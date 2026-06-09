/**
 * 2026-06-08 — Bag distances for grounded caddie strategy.
 *
 * Surfaces the player's REAL learned/entered club distances (clubStatsStore)
 * so the caddie brain answers club/strategy from actual numbers — see the
 * "[TIM'S BAG]" context block + the "beyond your longest = two-shot" rule
 * in api/kevin.ts (fed via hooks/useVoiceCaddie.ts). Memory:
 * course-target-strategy.
 *
 * NOTE: a richer recommendStrategy()/bagMaxCarry() helper lived here but
 * was unused dead code (the caddie does the reasoning in-prompt). Removed
 * 2026-06-08 pre-OTA; re-add from git history if a hole-view strategy chip
 * needs a client-side compute.
 */

import { useClubStatsStore, CLUB_ORDER, type ClubName } from '../store/clubStatsStore';

const FULL_CLUBS: ClubName[] = CLUB_ORDER.filter(c => c !== 'Putter');

/** A compact map of the player's real bag distances for the caddie brain. */
export function bagDistances(): Partial<Record<ClubName, number>> {
  const stats = useClubStatsStore.getState();
  const out: Partial<Record<ClubName, number>> = {};
  for (const c of FULL_CLUBS) {
    const y = stats.avgFor(c);
    if (y > 0) out[c] = y;
  }
  return out;
}
