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

import { getLearnedCarryDistances, type ClubName } from '../store/clubStatsStore';

/** A compact map of the player's real bag CARRY distances for the caddie brain.
 *  2026-07-24 (club-logic unification) — returns honest CARRY, not the tee→rest TOTAL. This is THE
 *  hub the safety-critical readers consume (Kevin's "go for it if ≤ your longest", the offline
 *  reach/"can I carry it" answers, cnsShotRead's "your {club} carries ~X" + lay-up gating). Feeding
 *  them a roll-inclusive total made the caddie green-light carries the player can't actually FLY.
 *  carryFor() = measured carry → stated → (tracked total − typical roll) → chart. Gate on hasDistance()
 *  so untracked clubs stay absent (the prompt calls this "real distances"; never emit the bare chart). */
export function bagDistances(): Partial<Record<ClubName, number>> {
  /**
   * 2026-08-24 (club sweep, step 2 — ONE OWNER FOR A CLUB) — this used to iterate the club list and
   * call carryFor() itself, which made it a SECOND implementation of the carry bag.
   * store/clubStatsStore.getLearnedCarryDistances() is the first, written the same day as the
   * 07-24 club-logic unification, and it had ZERO callers — so the honest carry bag existed twice
   * and the app used the copy that lives in a strategy module rather than the one in the data owner.
   *
   * They were provably identical: FULL_CLUBS was `CLUB_ORDER.filter(c => c !== 'Putter')`, matching
   * that function's `for (CLUB_ORDER) { if (Putter) continue }`; its guard
   * `carry.samples || manual != null || total.samples` is the literal body of hasDistance(); and both
   * emitted carryFor(club). So this is a delegation, not a behaviour change — the only thing kept
   * here is the `> 0` filter, which is this caller's own contract ("never emit a zero yardage").
   *
   * Why the STORE wins: it owns the data. A strategy module owning the bag is how you end up with
   * two answers to "how far does he carry his 7", which is the whole complaint in
   * docs/NEXT-CLUB-LOGIC-SWEEP.md — 33 files touch club identity and nobody owns "a club".
   */
  const out: Partial<Record<ClubName, number>> = {};
  for (const [club, yards] of Object.entries(getLearnedCarryDistances())) {
    if (yards > 0) out[club as ClubName] = yards;
  }
  return out;
}
