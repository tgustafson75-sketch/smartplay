/**
 * features/smartCaddie/data/shotPatterns.ts
 *
 * Pattern classification types and scoring helpers.
 * Derived from the shot history in roundStore; used by SmartCaddieEngine
 * and usePlayerModel to classify miss tendencies and session momentum.
 */

import type { Shot } from '../../../store/roundStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MissDirection = 'left' | 'right' | null;

export type SessionTrend = 'improving' | 'struggling' | 'neutral';

export interface ShotPattern {
  /** Total shots analyzed */
  total: number;
  /** % of shots that went left (0–100) */
  leftPct: number;
  /** % of shots that went right (0–100) */
  rightPct: number;
  /** % of shots center/straight (0–100) */
  centerPct: number;
  /** Dominant miss direction — null if balanced */
  dominantMiss: MissDirection;
  /** Confidence level of the dominant miss (0–1) */
  missConfidence: number;
  /** Trend over last 5 shots */
  recentTrend: SessionTrend;
  /** Was the last shot a miss? */
  lastWasMiss: boolean;
  /** Streak of identical results (e.g., 3 lefts in a row) */
  currentStreakLength: number;
  currentStreakDir: 'left' | 'right' | 'center' | null;
}

export interface ClubPattern {
  club: string;
  total: number;
  leftPct: number;
  rightPct: number;
  centerPct: number;
  /** Avg distance carried (yards) — null if no GPS data available */
  avgDistance: number | null;
  accuracy: 'reliable' | 'erratic' | 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a ShotPattern summary from an array of shots. */
export function analyzeShotPatterns(shots: Shot[]): ShotPattern {
  if (shots.length === 0) {
    return {
      total: 0,
      leftPct: 0,
      rightPct: 0,
      centerPct: 0,
      dominantMiss: null,
      missConfidence: 0,
      recentTrend: 'neutral',
      lastWasMiss: false,
      currentStreakLength: 0,
      currentStreakDir: null,
    };
  }

  const left   = shots.filter((s) => s.result === 'left').length;
  const right  = shots.filter((s) => s.result === 'right').length;
  const center = shots.filter((s) => s.result === 'center').length;
  const total  = shots.length;

  const leftPct   = Math.round((left   / total) * 100);
  const rightPct  = Math.round((right  / total) * 100);
  const centerPct = Math.round((center / total) * 100);

  // Dominant miss: must exceed the other direction by ≥15 pct points
  let dominantMiss: MissDirection = null;
  let missConfidence = 0;
  if (leftPct  >= rightPct  + 15 && leftPct  >= 30) { dominantMiss = 'left';  missConfidence = leftPct  / 100; }
  if (rightPct >= leftPct   + 15 && rightPct >= 30) { dominantMiss = 'right'; missConfidence = rightPct / 100; }

  // Recent trend — last 5 shots vs the 5 before
  const recentTrend = _computeTrend(shots);

  // Streak detection
  const last = shots[shots.length - 1];
  const lastWasMiss = last?.result === 'left' || last?.result === 'right';
  const { streakLength, streakDir } = _computeStreak(shots);

  return {
    total,
    leftPct,
    rightPct,
    centerPct,
    dominantMiss,
    missConfidence,
    recentTrend,
    lastWasMiss,
    currentStreakLength: streakLength,
    currentStreakDir: streakDir,
  };
}

/** Per-club accuracy breakdown. */
export function analyzeClubPatterns(shots: Shot[]): ClubPattern[] {
  const clubMap = new Map<string, { left: number; right: number; center: number; distances: number[] }>();

  for (const s of shots) {
    if (!s.club) continue;
    if (!clubMap.has(s.club)) clubMap.set(s.club, { left: 0, right: 0, center: 0, distances: [] });
    const entry = clubMap.get(s.club)!;
    if      (s.result === 'left')   entry.left++;
    else if (s.result === 'right')  entry.right++;
    else if (s.result === 'center') entry.center++;
    const carried = s.yardsCarried ?? (s.yardsBefore != null && s.distance != null ? s.yardsBefore - s.distance : null);
    if (carried != null && carried > 10 && carried < 700) entry.distances.push(carried);
  }

  const results: ClubPattern[] = [];
  clubMap.forEach((v, club) => {
    const total = v.left + v.right + v.center;
    const leftPct   = Math.round((v.left   / total) * 100);
    const rightPct  = Math.round((v.right  / total) * 100);
    const centerPct = Math.round((v.center / total) * 100);
    const avgDistance = v.distances.length > 0
      ? Math.round(v.distances.reduce((a, b) => a + b, 0) / v.distances.length)
      : null;
    const accuracy: ClubPattern['accuracy'] =
      total < 3 ? 'unknown' :
      centerPct >= 60 ? 'reliable' : 'erratic';
    results.push({ club, total, leftPct, rightPct, centerPct, avgDistance, accuracy });
  });

  return results.sort((a, b) => b.total - a.total);
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function _computeTrend(shots: Shot[]): SessionTrend {
  if (shots.length < 6) return 'neutral';
  const recent = shots.slice(-5);
  const earlier = shots.slice(-10, -5);
  const recentCenter  = recent.filter((s)  => s.result === 'center').length;
  const earlierCenter = earlier.filter((s) => s.result === 'center').length;
  if (recentCenter > earlierCenter + 1) return 'improving';
  if (recentCenter < earlierCenter - 1) return 'struggling';
  return 'neutral';
}

function _computeStreak(shots: Shot[]): { streakLength: number; streakDir: 'left' | 'right' | 'center' | null } {
  if (shots.length === 0) return { streakLength: 0, streakDir: null };
  const dir = shots[shots.length - 1].result;
  if (dir !== 'left' && dir !== 'right' && dir !== 'center') return { streakLength: 0, streakDir: null };
  let count = 0;
  for (let i = shots.length - 1; i >= 0; i--) {
    if (shots[i].result === dir) count++;
    else break;
  }
  return { streakLength: count, streakDir: dir as 'left' | 'right' | 'center' };
}
