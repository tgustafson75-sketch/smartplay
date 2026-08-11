import {
  EQUIPMENT_DISTANCE_TIER_PRIORITY,
  getIndustryAverageCarryYards,
  getIndustryClubOrderByCarryDesc,
  normalizeEquipmentClubLabel,
  type EquipmentDistanceTier,
} from '../knowledge/equipment/equipment_intelligence';
import {
  buildEquipmentIntelligenceProfile,
  type EquipmentDistanceObservation,
} from '../profiles/equipment_intelligence_profile';

export interface EquipmentDistanceModifierInput {
  targetYards: number;
  fallbackClub: string;
  knownBagClubs?: string[];
  actualShotHistory?: EquipmentDistanceObservation[];
  launchMonitorData?: EquipmentDistanceObservation[];
  roundHistory?: EquipmentDistanceObservation[];
  equipmentIntelligence?: EquipmentDistanceObservation[];
}

export interface EquipmentDistanceModifierResult {
  recommendedClub: string;
  sourceTier: EquipmentDistanceTier;
  confidence: number;
  rationale: string;
}

const TIER_CONFIDENCE: Readonly<Record<EquipmentDistanceTier, number>> = {
  actual_shot_history: 0.92,
  launch_monitor_data: 0.84,
  round_history: 0.75,
  equipment_intelligence: 0.58,
  industry_average: 0.45,
};

/**
 * 2026-08-11 (Tim — "the caddie suggestion in SmartVision is STILL showing a gap wedge for a three
 * hundred and twenty four yard shot").
 *
 * THE BUG I MISSED. Yesterday I fixed clubStatsStore.inferClub and shipped it as "the gap wedge
 * fix". It wasn't — it was ONE producer of four. SmartVision's chip comes through here, and this
 * function had no notion of whether the club it returns can actually REACH.
 *
 * `pickClosestClub` first looks for a club that carries at least the target; when none does, it
 * falls to "nearest by absolute difference" across whatever clubs we happen to have EVIDENCE for.
 * If the only observed club is a gap wedge, then for a 324-yard shot the nearest — and only —
 * candidate is that gap wedge, and it is returned with total confidence. The maths is doing exactly
 * what it was told; it was told the wrong thing.
 *
 * A recommendation that cannot reach the target is not a recommendation. When the best candidate
 * falls hopelessly short (or is absurdly long), we return null so the caller keeps its BASELINE
 * ladder club — the honest full-bag answer — instead of parroting sparse evidence.
 */
const REACH_FLOOR = 0.7;  // must carry at least 70% of the target
const REACH_CEILING = 1.6; // and not be a wild over-club

function pickClosestClub(targetYards: number, candidates: Array<{ club: string; carryYards: number }>): { club: string; carryYards: number } | null {
  if (!Number.isFinite(targetYards) || targetYards <= 0 || candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => b.carryYards - a.carryYards);
  /**
   * 2026-08-11 — `sorted` is DESCENDING, so the old `.find(c => c.carryYards >= targetYards)`
   * returned the LONGEST club that reaches — the driver on essentially every shot it can cover.
   * The intent was "take enough club": the SHORTEST club that still gets there. Searching the
   * ascending order fixes a bug that was skewing every recommendation upward, quietly, for as long
   * as this function has existed.
   */
  const ascending = [...sorted].reverse();
  const conservative = ascending.find((c) => c.carryYards >= targetYards);
  if (conservative) {
    // Even the "carries far enough" pick must not be a comical over-club (a driver for 40 yards).
    return conservative.carryYards <= targetYards * REACH_CEILING ? conservative : null;
  }

  const nearest = sorted.reduce((best, next) => {
    const bestDelta = Math.abs(best.carryYards - targetYards);
    const nextDelta = Math.abs(next.carryYards - targetYards);
    return nextDelta < bestDelta ? next : best;
  });
  // THE GATE: sparse evidence must not put a wedge on a 324-yard shot.
  if (nearest.carryYards < targetYards * REACH_FLOOR) return null;
  return nearest;
}

export function recommendClubFromEquipmentIntelligence(input: EquipmentDistanceModifierInput): EquipmentDistanceModifierResult {
  const profile = buildEquipmentIntelligenceProfile({
    actualShotHistory: input.actualShotHistory,
    launchMonitorData: input.launchMonitorData,
    roundHistory: input.roundHistory,
    equipmentIntelligence: input.equipmentIntelligence,
    knownBagClubs: input.knownBagClubs,
  });

  const allowedKeys = new Set<string>();
  for (const c of input.knownBagClubs ?? []) {
    const key = normalizeEquipmentClubLabel(c);
    if (key) allowedKeys.add(key);
  }

  /**
   * 2026-08-11 (Tim — "why are we basing it on evidence? We know a standard golf yardage bag, and we
   * use that as the DEFAULT if we don't have an updated user-specific one. You are over-thinking the
   * shit out of the club issue").
   *
   * He's right, and this was the actual defect. The ladder was built ONLY from clubs we had
   * evidence for, and the full standard bag was used solely when there was NO evidence whatsoever.
   * So a player with one logged gap wedge got a one-club ladder — and every shot on the course, at
   * any distance, resolved to that gap wedge. 324 yards included. My first pass added a "can it
   * reach" gate, which suppresses the symptom while leaving the ladder wrong.
   *
   * The right model is the simple one: a COMPLETE standard bag is always the baseline, and the
   * player's own numbers override it club by club, only where we actually have them. Then nearest-
   * distance selection works the way it always should have, because the ladder is never full of
   * holes. Personalization becomes an improvement on a correct answer instead of a replacement for
   * having one.
   */
  const rowByKey = new Map<string, { key: string; club: string; carryYards: number; tier: EquipmentDistanceTier; sampleSize: number }>();
  // 1) the full standard bag — every club, always.
  for (const club of getIndustryClubOrderByCarryDesc()) {
    const key = normalizeEquipmentClubLabel(club);
    if (!key) continue;
    if (allowedKeys.size > 0 && !allowedKeys.has(key)) continue; // respect a registered bag
    rowByKey.set(key, {
      key,
      club,
      carryYards: getIndustryAverageCarryYards(club) ?? 0,
      tier: 'industry_average',
      sampleSize: 1,
    });
  }
  // 2) the player's own numbers replace the chart, club by club, where we have them.
  for (const [key, value] of Object.entries(profile.resolvedByClub)) {
    if (allowedKeys.size > 0 && !allowedKeys.has(key)) continue;
    rowByKey.set(key, { key, ...value });
  }
  let rows = [...rowByKey.values()].filter((r) => r.carryYards > 0);

  if (rows.length === 0) {
    rows = getIndustryClubOrderByCarryDesc().map((club) => ({
      key: normalizeEquipmentClubLabel(club),
      club,
      carryYards: getIndustryAverageCarryYards(club) ?? 0,
      tier: 'industry_average' as const,
      sampleSize: 1,
    })).filter((x) => x.key.length > 0);
  }

  const candidate = pickClosestClub(
    input.targetYards,
    rows.map((x) => ({ club: x.club, carryYards: x.carryYards })),
  );

  if (!candidate) {
    // Either no evidence at all, or none of it could plausibly reach the target — in both cases the
    // caller's baseline ladder club is the honest answer, so hand it straight back.
    return {
      recommendedClub: input.fallbackClub,
      sourceTier: 'industry_average',
      confidence: TIER_CONFIDENCE.industry_average,
      rationale: 'No club-distance evidence that could reach this number; kept the baseline recommendation.',
    };
  }

  const selectedKey = normalizeEquipmentClubLabel(candidate.club);
  const selected = rows.find((x) => normalizeEquipmentClubLabel(x.club) === selectedKey) ?? rows[0];
  const rank = EQUIPMENT_DISTANCE_TIER_PRIORITY[selected.tier];
  const conf = TIER_CONFIDENCE[selected.tier];

  return {
    recommendedClub: selected.club,
    sourceTier: selected.tier,
    confidence: conf,
    rationale:
      rank <= EQUIPMENT_DISTANCE_TIER_PRIORITY.round_history
        ? `Used ${selected.tier.replace(/_/g, ' ')} for ${selected.club} (${selected.carryYards}y carry).`
        : `Used ${selected.tier.replace(/_/g, ' ')} as fallback prior for ${selected.club}.`,
  };
}
