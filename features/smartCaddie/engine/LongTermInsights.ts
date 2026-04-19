/**
 * LongTermInsights.ts
 *
 * Converts a RoundTrends object into human-readable coaching insights.
 * Pure and synchronous — no side effects.
 */

import type { RoundTrends } from './TrendEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type InsightTone = 'positive' | 'warning' | 'tip';

export interface LongTermInsight {
  id: string;
  emoji: string;
  headline: string;
  detail: string;
  tone: InsightTone;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate up to 5 long-term coaching insights from a RoundTrends object.
 * Priority: improvement → club bias → miss pattern → consistency → top club.
 */
export function generateLongTermInsights(trends: RoundTrends): LongTermInsight[] {
  const insights: LongTermInsight[] = [];

  // ── Improvement / regression ──────────────────────────────────────────────
  if (trends.improvement.hasData) {
    if (trends.improvement.direction === 'improving') {
      insights.push({
        id: 'improvement_positive',
        emoji: '📈',
        headline: 'You are improving distance control.',
        detail: `Your performance score has risen ${trends.improvement.scoreDelta} points across your recent rounds. Keep it up.`,
        tone: 'positive',
      });
    } else if (trends.improvement.direction === 'declining') {
      insights.push({
        id: 'improvement_declining',
        emoji: '📉',
        headline: 'Slight regression detected.',
        detail: `Your performance score has dropped ${Math.abs(trends.improvement.scoreDelta)} points recently. Focus on commit-and-execute.`,
        tone: 'warning',
      });
    }
  }

  // ── Club bias ─────────────────────────────────────────────────────────────
  if (trends.clubBias.direction === 'up') {
    insights.push({
      id: 'club_bias_up',
      emoji: '🏌️',
      headline: 'Across rounds, you consistently club up.',
      detail: `You reach for one more club than recommended on average. Trust your distances — or your distances need updating.`,
      tone: 'tip',
    });
  } else if (trends.clubBias.direction === 'down') {
    insights.push({
      id: 'club_bias_down',
      emoji: '🏌️',
      headline: 'Across rounds, you tend to club down.',
      detail: `You're regularly leaving shots short of the recommendation. Try committing to the suggested club.`,
      tone: 'warning',
    });
  }

  // ── Miss pattern ──────────────────────────────────────────────────────────
  if (trends.dominantMiss === 'right') {
    insights.push({
      id: 'miss_right',
      emoji: '➡️',
      headline: 'Your most common miss is right across rounds.',
      detail: `Aim slightly left of your target until your dispersion improves. Check grip and alignment.`,
      tone: 'tip',
    });
  } else if (trends.dominantMiss === 'left') {
    insights.push({
      id: 'miss_left',
      emoji: '⬅️',
      headline: 'Your most common miss is left across rounds.',
      detail: `Aim slightly right of your target. Check hip rotation and follow-through.`,
      tone: 'tip',
    });
  } else if (trends.dominantMiss === 'short') {
    insights.push({
      id: 'miss_short',
      emoji: '⬇️',
      headline: 'You frequently come up short.',
      detail: `Take one more club on approach shots and swing at 80%. Distance control improves with fuller contact.`,
      tone: 'warning',
    });
  }

  // ── Consistency ────────────────────────────────────────────────────────────
  if (trends.consistencyScore >= 80) {
    insights.push({
      id: 'consistent',
      emoji: '🎯',
      headline: `Highly consistent miss pattern (${trends.consistencyScore}%).`,
      detail: `Your ball flight pattern is repeatable — that's actually useful. Adjust your aim pre-shot.`,
      tone: trends.dominantMiss === 'center' ? 'positive' : 'tip',
    });
  } else if (trends.consistencyScore < 45 && trends.roundCount >= 4) {
    insights.push({
      id: 'inconsistent',
      emoji: '🔀',
      headline: 'Inconsistent miss pattern detected.',
      detail: `Your misses vary a lot round to round. Focus on a pre-shot routine to build repeatability.`,
      tone: 'warning',
    });
  }

  // ── Top club praise ────────────────────────────────────────────────────────
  if (insights.length < 5 && trends.topClub) {
    insights.push({
      id: 'top_club',
      emoji: '⭐',
      headline: `Your go-to club is the ${trends.topClub}.`,
      detail: `You've reached for the ${trends.topClub} more than any other club across your rounds.`,
      tone: 'positive',
    });
  }

  return insights.slice(0, 5);
}
