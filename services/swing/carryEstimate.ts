/**
 * 2026-06-12 — Carry estimate for the DTL effort readout. Connects the SELECTED CLUB
 * + the geometry-derived EFFORT % into a rough yardage (Tim: "club selected and
 * percentage give a yardage estimate").
 *
 * REUSES the app's existing club math — getIndustryAverageCarryYards() from
 * services/knowledge/equipment/equipment_intelligence (the original per-club carry
 * table) — rather than a new duplicate table (Tim: "we had average yardages built
 * into the math of clubs"). Those are INDUSTRY averages, so we scale them by the
 * player's handicap so the baseline starts near a HIGH-HANDICAP golfer (Tim) and a
 * scratch player gets the full number.
 *
 * Source priority for full carry:
 *   1. LEARNED average (≥5 real shots) — the honest, player-specific number.
 *   2. (future) explicit user club-distance setting — none exists yet.
 *   3. industry table × handicap factor — the starting baseline.
 *
 * Honest: an ESTIMATE (shown with ~), linear in effort. Null for putter / unknown.
 */

import { getIndustryAverageCarryYards } from '../knowledge/equipment/equipment_intelligence';
import { standardCarryFor } from '../standardBag';
import type { ClubId } from '../clubRecognition';

// Map our ClubId codes onto labels the equipment table understands (it covers
// driver → LW). Clubs the table lacks (3-iron, 2-hybrid, 7-wood) map to the nearest.
const CLUB_LABEL: Partial<Record<ClubId, string>> = {
  DR: 'driver', '3W': '3 wood', '5W': '5 wood', '7W': '5 wood',
  '2H': 'hybrid', '3H': 'hybrid', '4H': 'hybrid', '5H': 'hybrid',
  '3I': '4 iron', '4I': '4 iron', '5I': '5 iron', '6I': '6 iron',
  '7I': '7 iron', '8I': '8 iron', '9I': '9 iron',
  PW: 'pw', GW: 'gw', AW: 'gw', SW: 'sw', LW: 'lw',
};

/**
 * Best estimate of a club's FULL carry (yards). A learned/verified player average always wins;
 * otherwise THE standard bag — the same table the caddie quotes.
 *
 * 2026-08-12 (Tim — "make sure SmartMotion planned distance also correlates to the player's bag
 * and/or verified/played distances"). It used a third private table (equipment_intelligence) and
 * then scaled it by handicap, so with no logged data the caddie said his driver goes 245 and this
 * said the same swing carried 198. Two numbers for one club in one session is worse than either
 * number being slightly off, so the baseline is now shared.
 *
 * The handicap scaling went with it, deliberately. It only ever applied to the DEFAULT — and the
 * caddie's recommendation, which the player acts on, has never been handicap-scaled. Scaling one
 * surface and not the other is precisely what made them disagree. Real measured carries override
 * per club as soon as they exist, which is the honest way to personalise this. `handicap` stays in
 * the signature (callers pass it) but no longer silently shrinks the estimate.
 */
export function fullCarryYards(
  club: ClubId | null,
  _handicap?: number | null,
  learnedAvgCarryYds?: number | null,
): number | null {
  if (!club || club === 'unknown' || club === 'PT') return null;
  if (learnedAvgCarryYds != null && learnedAvgCarryYds > 0) return Math.round(learnedAvgCarryYds);
  // ClubId codes ARE the standard bag's keys for everything except the few the bag doesn't carry.
  const direct = standardCarryFor(club);
  if (direct != null) return direct;
  const label = CLUB_LABEL[club];
  const industry = label ? getIndustryAverageCarryYards(label) : null;
  return industry == null ? null : Math.round(industry);
}

/** Estimated carry for a PARTIAL-effort shot: effort% × full carry. Null when we
 *  can't honestly estimate (no club carry or no effort). */
export function estimateCarryYards(
  club: ClubId | null,
  effortPct: number | null,
  handicap?: number | null,
  learnedAvgCarryYds?: number | null,
): number | null {
  const full = fullCarryYards(club, handicap, learnedAvgCarryYds);
  if (full == null || effortPct == null || effortPct <= 0) return null;
  return Math.round(full * Math.min(1, effortPct / 100));
}
