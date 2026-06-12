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

/** Skill scale on the industry carries: scratch (≤2) ≈ full, a higher handicap
 *  carries shorter. Bounded so it never collapses. Default handicap 18 → ~0.86. */
function handicapFactor(handicap: number | null | undefined): number {
  const h = typeof handicap === 'number' ? handicap : 18;
  return Math.max(0.78, Math.min(1, 1 - Math.max(0, h - 2) * 0.009));
}

/** Best estimate of a club's FULL carry (yards): a learned average wins; otherwise the
 *  industry table scaled by handicap. Null for putter / unknown / no club. */
export function fullCarryYards(
  club: ClubId | null,
  handicap?: number | null,
  learnedAvgCarryYds?: number | null,
): number | null {
  if (!club || club === 'unknown' || club === 'PT') return null;
  if (learnedAvgCarryYds != null && learnedAvgCarryYds > 0) return Math.round(learnedAvgCarryYds);
  const label = CLUB_LABEL[club];
  const industry = label ? getIndustryAverageCarryYards(label) : null;
  if (industry == null) return null;
  return Math.round(industry * handicapFactor(handicap));
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
