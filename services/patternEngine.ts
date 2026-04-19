/**
 * patternEngine.ts — Shot Intelligence System
 *
 * Analyses the last 5–10 shots to detect:
 *   • Directional miss bias (left / right / neutral)
 *   • Distance bias (short / long / neutral)
 *   • Per-club performance (avg offset, dispersion, consistency)
 *
 * Produces:
 *   • currentPattern  — e.g. "miss_right_short"
 *   • patternConfidence 0–100
 *   • patternInsight   — human-readable caddie sentence
 *   • getRecommendedClub() — adapts baseline club to real performance
 *
 * Pure functions — no side effects, no state.
 */

import type { Shot } from '../store/roundStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternResult {
  currentPattern: string;          // "miss_right" | "miss_left" | "neutral" | compound
  patternConfidence: number;        // 0–100
  patternInsight: string;           // caddie-ready sentence
  missRight: number;                // 0–1 fraction
  missLeft: number;                 // 0–1 fraction
  avgDistanceOffset: number;        // yards (negative = short)
}

export interface ClubStat {
  club: string;
  shots: number;
  avgOffset: number;       // yards vs expected (negative = short)
  leftBias: number;        // 0–1
  rightBias: number;       // 0–1
  consistency: number;     // 0–100 (higher = tighter dispersion)
}

export interface ClubRecommendation {
  club: string;
  reason: string | null;   // null = baseline, no adjustment needed
}

// ---------------------------------------------------------------------------
// Baseline club distances (yards) — fallback when no learned data
// ---------------------------------------------------------------------------
const BASELINE_CLUBS: Array<{ name: string; yds: number }> = [
  { name: 'Driver',  yds: 230 },
  { name: '3 Wood',  yds: 215 },
  { name: '5 Wood',  yds: 200 },
  { name: '3 Iron',  yds: 185 },
  { name: '4 Iron',  yds: 175 },
  { name: '5 Iron',  yds: 165 },
  { name: '6 Iron',  yds: 155 },
  { name: '7 Iron',  yds: 145 },
  { name: '8 Iron',  yds: 135 },
  { name: '9 Iron',  yds: 125 },
  { name: 'PW',      yds: 115 },
  { name: 'GW',      yds: 100 },
  { name: 'SW',      yds:  85 },
  { name: 'LW',      yds:  70 },
  { name: 'Putter',  yds:  10 },
];

// ---------------------------------------------------------------------------
// analyzePatterns — main pattern detection
// ---------------------------------------------------------------------------

export function analyzePatterns(shots: Shot[]): PatternResult {
  const window = shots.slice(-10).filter(
    (s) => s.result === 'left' || s.result === 'right' || s.result === 'center',
  );

  if (window.length === 0) {
    return {
      currentPattern: 'neutral',
      patternConfidence: 0,
      patternInsight: '',
      missRight: 0,
      missLeft: 0,
      avgDistanceOffset: 0,
    };
  }

  const total = window.length;

  // Direction — use directionOffset when user-corrected, else result
  const dirSamples = window.map((s) => s.directionOffset ?? s.result);
  const rightCount = dirSamples.filter((d) => d === 'right').length;
  const leftCount  = dirSamples.filter((d) => d === 'left').length;
  const missRight  = rightCount / total;
  const missLeft   = leftCount  / total;

  // Distance offset — use adjustedDistance vs gpsDistance when available
  const offsetSamples = window
    .map((s) => s.distanceOffset ?? 0)
    .filter((o) => o !== 0);
  const avgDistanceOffset =
    offsetSamples.length > 0
      ? offsetSamples.reduce((a, b) => a + b, 0) / offsetSamples.length
      : 0;

  // Build pattern string
  const parts: string[] = [];

  if (missRight >= 0.6)      parts.push('miss_right');
  else if (missLeft >= 0.6)  parts.push('miss_left');

  if (avgDistanceOffset < -10) parts.push('short');
  else if (avgDistanceOffset > 10) parts.push('long');

  const currentPattern = parts.length > 0 ? parts.join('_') : 'neutral';

  // Confidence — based on window size and how strong the bias is
  const dirBias = Math.max(missRight, missLeft);
  const distBias = Math.min(Math.abs(avgDistanceOffset) / 20, 1);
  const rawConf = (dirBias * 0.6 + distBias * 0.4) * (Math.min(total, 5) / 5);
  const patternConfidence = Math.round(rawConf * 100);

  // Human insight
  const patternInsight = buildInsight(currentPattern, avgDistanceOffset);

  return { currentPattern, patternConfidence, patternInsight, missRight, missLeft, avgDistanceOffset };
}

function buildInsight(pattern: string, avgOffset: number): string {
  const parts: string[] = [];

  if (pattern.includes('miss_right')) parts.push("You're missing right — aim slightly left.");
  else if (pattern.includes('miss_left')) parts.push("You're pulling left — ease your alignment.");

  if (pattern.includes('short')) {
    const yds = Math.abs(Math.round(avgOffset));
    parts.push(`Shots are coming up short by ~${yds} yards — take more club.`);
  } else if (pattern.includes('long')) {
    const yds = Math.round(avgOffset);
    parts.push(`You're running ${yds} yards long — consider less club.`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// analyzeClubPerformance
// ---------------------------------------------------------------------------

export function analyzeClubPerformance(shots: Shot[]): ClubStat[] {
  const byClub: Record<string, Shot[]> = {};

  shots.forEach((s) => {
    if (!s.club) return;
    if (!byClub[s.club]) byClub[s.club] = [];
    byClub[s.club].push(s);
  });

  return Object.entries(byClub).map(([club, clubShots]) => {
    const n = clubShots.length;

    const offsets = clubShots.map((s) => s.distanceOffset ?? 0);
    const avgOffset = offsets.reduce((a, b) => a + b, 0) / n;

    const dirSamples = clubShots.map((s) => s.directionOffset ?? s.result);
    const leftBias  = dirSamples.filter((d) => d === 'left').length  / n;
    const rightBias = dirSamples.filter((d) => d === 'right').length / n;

    // Consistency: 100 = all straight, 0 = perfectly split left/right
    const dispersion = leftBias + rightBias; // 0 = all straight, 1 = all off-line
    const consistency = Math.round((1 - dispersion) * 100);

    return { club, shots: n, avgOffset: Math.round(avgOffset), leftBias, rightBias, consistency };
  });
}

// ---------------------------------------------------------------------------
// getRecommendedClub
// ---------------------------------------------------------------------------

export function getRecommendedClub(
  distanceToTarget: number,
  shots: Shot[],
  currentClub?: string,
): ClubRecommendation {
  if (!distanceToTarget || distanceToTarget <= 0) {
    return { club: currentClub ?? 'Unknown', reason: null };
  }

  // Get club stats from recent shots
  const clubStats = analyzeClubPerformance(shots);
  const statsMap: Record<string, ClubStat> = {};
  clubStats.forEach((cs) => { statsMap[cs.club] = cs; });

  // Find baseline club for this distance
  const baseline = BASELINE_CLUBS.reduce((prev, curr) =>
    Math.abs(curr.yds - distanceToTarget) < Math.abs(prev.yds - distanceToTarget)
      ? curr : prev,
  );

  const baselineStat = statsMap[baseline.name];

  // If no history for this club, return baseline
  if (!baselineStat || baselineStat.shots < 2) {
    return { club: baseline.name, reason: null };
  }

  const offset = baselineStat.avgOffset;

  // Consistently short with this club — step up one
  if (offset < -10) {
    const idx = BASELINE_CLUBS.findIndex((c) => c.name === baseline.name);
    const stronger = BASELINE_CLUBS[Math.max(0, idx - 1)];
    return {
      club: stronger.name,
      reason: `Shots trending short with ${baseline.name} — take ${stronger.name}`,
    };
  }

  // Consistently long — step down one
  if (offset > 10) {
    const idx = BASELINE_CLUBS.findIndex((c) => c.name === baseline.name);
    const weaker = BASELINE_CLUBS[Math.min(BASELINE_CLUBS.length - 1, idx + 1)];
    return {
      club: weaker.name,
      reason: `Carrying long with ${baseline.name} — try ${weaker.name}`,
    };
  }

  return { club: baseline.name, reason: null };
}

// ---------------------------------------------------------------------------
// buildCaddieMessage — enriches a base message with pattern + club data
// ---------------------------------------------------------------------------

export function buildCaddieMessage(
  baseMessage: string,
  pattern: PatternResult,
  clubRec: ClubRecommendation,
): string {
  const parts: string[] = [baseMessage];

  if (pattern.patternConfidence >= 50 && pattern.patternInsight) {
    parts.push(pattern.patternInsight);
  }

  if (clubRec.reason) {
    parts.push(clubRec.reason + '.');
  }

  // Keep it concise — first 2 parts max
  return parts.slice(0, 2).join(' ');
}
