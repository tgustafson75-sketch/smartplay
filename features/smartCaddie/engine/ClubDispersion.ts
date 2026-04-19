/**
 * features/smartCaddie/engine/ClubDispersion.ts
 *
 * Builds a per-club miss tendency model from shot history.
 * Pure functions — no React, no side effects.
 */

export type MissDirection = 'left' | 'right' | 'short' | 'long' | 'center';

export interface ClubStats {
  left:   number;
  right:  number;
  short:  number;
  long:   number;
  center: number;
  total:  number;
}

export type DispersionMap = Record<string, ClubStats>;

export interface ShotRecord {
  club:     string;
  result:   MissDirection;
  distance?: number;
}

// ── Build map from raw shot array ─────────────────────────────────────────────

export function buildClubDispersion(shots: ShotRecord[]): DispersionMap {
  const map: DispersionMap = {};

  for (const s of shots) {
    if (!s.club) continue;
    if (!map[s.club]) {
      map[s.club] = { left: 0, right: 0, short: 0, long: 0, center: 0, total: 0 };
    }
    const stats = map[s.club];
    if (s.result in stats) {
      (stats as unknown as Record<string, number>)[s.result]++;;
    }
    stats.total++;
  }

  return map;
}

// ── Predict most likely miss for a club ──────────────────────────────────────

/**
 * Returns the most frequent miss direction for the given club, or null when
 * there is insufficient data (< 3 shots) or the dominant result is 'center'.
 */
export function predictClubMiss(stats: ClubStats | undefined): MissDirection | null {
  if (!stats || stats.total < 3) return null;

  const candidates: [MissDirection, number][] = [
    ['left',   stats.left],
    ['right',  stats.right],
    ['short',  stats.short],
    ['long',   stats.long],
    ['center', stats.center],
  ];

  candidates.sort((a, b) => b[1] - a[1]);
  const [dir, count] = candidates[0];

  // Only suggest a miss tendency when it accounts for ≥ 30 % of shots
  if (count / stats.total < 0.30) return null;
  if (dir === 'center') return null;

  return dir;
}

// ── Aim-point pixel adjustment ────────────────────────────────────────────────

const AIM_NUDGE_PX = 14; // pixels to shift aim point against the predicted miss

/**
 * Returns pixel offsets { dx, dy } to nudge a target pixel so the natural
 * miss still ends up near the intended landing zone.
 */
export function aimAdjustment(miss: MissDirection | null): { dx: number; dy: number } {
  if (!miss) return { dx: 0, dy: 0 };
  switch (miss) {
    case 'left':  return { dx:  AIM_NUDGE_PX, dy: 0 };
    case 'right': return { dx: -AIM_NUDGE_PX, dy: 0 };
    case 'short': return { dx: 0, dy: -AIM_NUDGE_PX };
    case 'long':  return { dx: 0, dy:  AIM_NUDGE_PX };
    default:      return { dx: 0, dy: 0 };
  }
}

// ── Human-readable miss label ─────────────────────────────────────────────────

export function missLabel(miss: MissDirection | null): string {
  if (!miss) return '';
  const labels: Record<MissDirection, string> = {
    left:   'misses left',
    right:  'misses right',
    short:  'tends short',
    long:   'tends long',
    center: 'straight',
  };
  return labels[miss];
}
