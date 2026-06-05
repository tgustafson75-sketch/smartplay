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

function pickClosestClub(targetYards: number, candidates: Array<{ club: string; carryYards: number }>): { club: string; carryYards: number } | null {
  if (!Number.isFinite(targetYards) || targetYards <= 0 || candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => b.carryYards - a.carryYards);
  const conservative = sorted.find((c) => c.carryYards >= targetYards);
  if (conservative) return conservative;

  return sorted.reduce((best, next) => {
    const bestDelta = Math.abs(best.carryYards - targetYards);
    const nextDelta = Math.abs(next.carryYards - targetYards);
    return nextDelta < bestDelta ? next : best;
  });
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

  let rows = Object.entries(profile.resolvedByClub)
    .filter(([key]) => allowedKeys.size === 0 || allowedKeys.has(key))
    .map(([key, value]) => ({ key, ...value }));

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
    return {
      recommendedClub: input.fallbackClub,
      sourceTier: 'industry_average',
      confidence: TIER_CONFIDENCE.industry_average,
      rationale: 'No club-distance evidence found; kept baseline recommendation.',
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
