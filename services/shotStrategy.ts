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

/** A compact map of the player's real bag CARRY distances for the caddie brain.
 *  2026-07-24 (club-logic unification) — returns honest CARRY, not the tee→rest TOTAL. This is THE
 *  hub the safety-critical readers consume (Kevin's "go for it if ≤ your longest", the offline
 *  reach/"can I carry it" answers, cnsShotRead's "your {club} carries ~X" + lay-up gating). Feeding
 *  them a roll-inclusive total made the caddie green-light carries the player can't actually FLY.
 *  carryFor() = measured carry → stated → (tracked total − typical roll) → chart. Gate on hasDistance()
 *  so untracked clubs stay absent (the prompt calls this "real distances"; never emit the bare chart). */
export function bagDistances(): Partial<Record<ClubName, number>> {
  const stats = useClubStatsStore.getState();
  const out: Partial<Record<ClubName, number>> = {};
  for (const c of FULL_CLUBS) {
    if (!stats.hasDistance(c)) continue;
    const y = stats.carryFor(c);
    if (y > 0) out[c] = y;
  }
  return out;
}
