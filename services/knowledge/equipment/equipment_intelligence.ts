/**
 * Equipment intelligence knowledge base.
 *
 * Additive-only data layer used as a low-priority prior when measured or
 * player-history club distances are missing.
 */

export type EquipmentDistanceTier =
  | 'actual_shot_history'
  | 'launch_monitor_data'
  | 'round_history'
  | 'equipment_intelligence'
  | 'industry_average';

export interface EquipmentClubKnowledge {
  club: string;
  typicalCarryYards: number;
  launchBias: 'low' | 'mid' | 'high';
  forgivenessBias: 'low' | 'mid' | 'high';
}

export const EQUIPMENT_DISTANCE_TIER_PRIORITY: Readonly<Record<EquipmentDistanceTier, number>> = {
  actual_shot_history: 1,
  launch_monitor_data: 2,
  round_history: 3,
  equipment_intelligence: 4,
  industry_average: 5,
};

const INDUSTRY_CARRY_BY_CLUB: Readonly<Record<string, EquipmentClubKnowledge>> = {
  driver: { club: 'Driver', typicalCarryYards: 230, launchBias: 'low', forgivenessBias: 'mid' },
  '3 wood': { club: '3 wood', typicalCarryYards: 215, launchBias: 'mid', forgivenessBias: 'mid' },
  '5 wood': { club: '5 wood', typicalCarryYards: 200, launchBias: 'mid', forgivenessBias: 'mid' },
  hybrid: { club: 'Hybrid', typicalCarryYards: 190, launchBias: 'mid', forgivenessBias: 'high' },
  '4 iron': { club: '4 iron', typicalCarryYards: 180, launchBias: 'low', forgivenessBias: 'low' },
  '5 iron': { club: '5 iron', typicalCarryYards: 170, launchBias: 'low', forgivenessBias: 'low' },
  '6 iron': { club: '6 iron', typicalCarryYards: 160, launchBias: 'mid', forgivenessBias: 'mid' },
  '7 iron': { club: '7 iron', typicalCarryYards: 150, launchBias: 'mid', forgivenessBias: 'mid' },
  '8 iron': { club: '8 iron', typicalCarryYards: 140, launchBias: 'high', forgivenessBias: 'mid' },
  '9 iron': { club: '9 iron', typicalCarryYards: 130, launchBias: 'high', forgivenessBias: 'mid' },
  pw: { club: 'PW', typicalCarryYards: 115, launchBias: 'high', forgivenessBias: 'mid' },
  gw: { club: 'GW', typicalCarryYards: 95, launchBias: 'high', forgivenessBias: 'high' },
  sw: { club: 'SW', typicalCarryYards: 80, launchBias: 'high', forgivenessBias: 'high' },
  lw: { club: 'LW', typicalCarryYards: 65, launchBias: 'high', forgivenessBias: 'high' },
};

export function normalizeEquipmentClubLabel(club: string | null | undefined): string {
  if (!club) return '';
  const c = club.toLowerCase().trim().replace(/\s+/g, ' ');
  if (c === 'd' || c === '1w' || c.includes('driver')) return 'driver';
  if (c === '3w' || c.includes('3 wood') || c.includes('3wood')) return '3 wood';
  if (c === '5w' || c.includes('5 wood') || c.includes('5wood')) return '5 wood';
  if (c.includes('hybrid') || /^[3-7]h$/.test(c)) return 'hybrid';
  if (/^4i(ron)?$/.test(c) || c === '4 iron') return '4 iron';
  if (/^5i(ron)?$/.test(c) || c === '5 iron') return '5 iron';
  if (/^6i(ron)?$/.test(c) || c === '6 iron') return '6 iron';
  if (/^7i(ron)?$/.test(c) || c === '7 iron') return '7 iron';
  if (/^8i(ron)?$/.test(c) || c === '8 iron') return '8 iron';
  if (/^9i(ron)?$/.test(c) || c === '9 iron') return '9 iron';
  if (c === 'pw' || c.includes('pitching')) return 'pw';
  if (c === 'gw' || c === 'aw' || c.includes('gap') || c.includes('approach')) return 'gw';
  if (c === 'sw' || c.includes('sand')) return 'sw';
  if (c === 'lw' || c.includes('lob')) return 'lw';
  if (c.includes('putter')) return 'putter';
  return c;
}

export function getIndustryClubKnowledge(club: string | null | undefined): EquipmentClubKnowledge | null {
  const key = normalizeEquipmentClubLabel(club);
  return INDUSTRY_CARRY_BY_CLUB[key] ?? null;
}

export function getIndustryAverageCarryYards(club: string | null | undefined): number | null {
  return getIndustryClubKnowledge(club)?.typicalCarryYards ?? null;
}

export function getIndustryClubOrderByCarryDesc(): string[] {
  return Object.values(INDUSTRY_CARRY_BY_CLUB)
    .sort((a, b) => b.typicalCarryYards - a.typicalCarryYards)
    .map((x) => x.club);
}
