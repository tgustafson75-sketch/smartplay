import {
  EQUIPMENT_DISTANCE_TIER_PRIORITY,
  type EquipmentDistanceTier,
  getIndustryAverageCarryYards,
  normalizeEquipmentClubLabel,
} from '../knowledge/equipment/equipment_intelligence';

export interface EquipmentDistanceObservation {
  club: string;
  carryYards: number;
  tier: EquipmentDistanceTier;
  sampleSize?: number;
}

export interface EquipmentDistanceResolved {
  club: string;
  carryYards: number;
  tier: EquipmentDistanceTier;
  sampleSize: number;
}

export interface EquipmentIntelligenceProfile {
  resolvedByClub: Record<string, EquipmentDistanceResolved>;
}

export interface EquipmentIntelligenceProfileInput {
  actualShotHistory?: EquipmentDistanceObservation[];
  launchMonitorData?: EquipmentDistanceObservation[];
  roundHistory?: EquipmentDistanceObservation[];
  equipmentIntelligence?: EquipmentDistanceObservation[];
  knownBagClubs?: string[];
}

function isPositiveNumber(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

export function buildEquipmentIntelligenceProfile(input: EquipmentIntelligenceProfileInput): EquipmentIntelligenceProfile {
  const buckets = new Map<string, EquipmentDistanceResolved>();

  const pushCandidate = (obs: EquipmentDistanceObservation) => {
    const key = normalizeEquipmentClubLabel(obs.club);
    if (!key || !isPositiveNumber(obs.carryYards)) return;

    const next: EquipmentDistanceResolved = {
      club: obs.club,
      carryYards: Math.round(obs.carryYards),
      tier: obs.tier,
      sampleSize: Math.max(1, Math.round(obs.sampleSize ?? 1)),
    };

    const prev = buckets.get(key);
    if (!prev) {
      buckets.set(key, next);
      return;
    }

    const prevRank = EQUIPMENT_DISTANCE_TIER_PRIORITY[prev.tier];
    const nextRank = EQUIPMENT_DISTANCE_TIER_PRIORITY[next.tier];

    if (nextRank < prevRank) {
      buckets.set(key, next);
      return;
    }

    if (nextRank === prevRank && next.sampleSize > prev.sampleSize) {
      buckets.set(key, next);
    }
  };

  const addTier = (rows: EquipmentDistanceObservation[] | undefined, expectedTier: EquipmentDistanceTier) => {
    for (const row of rows ?? []) pushCandidate({ ...row, tier: expectedTier });
  };

  addTier(input.actualShotHistory, 'actual_shot_history');
  addTier(input.launchMonitorData, 'launch_monitor_data');
  addTier(input.roundHistory, 'round_history');
  addTier(input.equipmentIntelligence, 'equipment_intelligence');

  const knownClubs = new Set<string>();
  for (const club of input.knownBagClubs ?? []) {
    const key = normalizeEquipmentClubLabel(club);
    if (key) knownClubs.add(key);
  }
  for (const key of buckets.keys()) knownClubs.add(key);

  for (const key of knownClubs) {
    if (buckets.has(key)) continue;
    const avg = getIndustryAverageCarryYards(key);
    if (typeof avg !== 'number' || !isPositiveNumber(avg)) continue;
    buckets.set(key, {
      club: key,
      carryYards: Math.round(avg),
      tier: 'industry_average',
      sampleSize: 1,
    });
  }

  const resolvedByClub: Record<string, EquipmentDistanceResolved> = {};
  for (const [key, value] of buckets.entries()) resolvedByClub[key] = value;
  return { resolvedByClub };
}
