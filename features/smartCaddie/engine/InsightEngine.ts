/**
 * features/smartCaddie/engine/InsightEngine.ts
 *
 * Converts a RoundAnalysis into an ordered list of human-readable,
 * actionable caddie insights.
 *
 * Rules:
 *   • At most one insight per category (club bias, miss, club-specific)
 *   • Priority ordered: club bias → miss pattern → inconsistent clubs → positives
 *   • Minimum thresholds prevent noise on very short rounds
 *   • Never more than 5 insights total
 */

import type { RoundAnalysis } from './RoundAnalysis';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoundInsight {
  id:       string;
  emoji:    string;
  headline: string;
  detail:   string;
  /** 'warning' | 'tip' | 'positive' */
  tone:     'warning' | 'tip' | 'positive';
}

// ── Main function ─────────────────────────────────────────────────────────────

export function generateInsights(analysis: RoundAnalysis): RoundInsight[] {
  const insights: RoundInsight[] = [];
  const { totalShots, avgClubDiff, missCounts, clubUsage, dominantMiss, bestClub, worstClub } = analysis;

  if (totalShots < 3) return insights;

  // ── 1. Club bias ───────────────────────────────────────────────────────────
  if (avgClubDiff > 0.6) {
    insights.push({
      id:       'club-bias-up',
      emoji:    '📈',
      headline: 'You tend to club up',
      detail:   'You frequently chose a stronger club than recommended. Consider re-calibrating your baseline distances.',
      tone:     'tip',
    });
  } else if (avgClubDiff < -0.6) {
    insights.push({
      id:       'club-bias-down',
      emoji:    '📉',
      headline: 'You often club down',
      detail:   'You regularly took a weaker club than suggested. You may be overestimating your carry distances.',
      tone:     'tip',
    });
  }

  // ── 2. Miss pattern ────────────────────────────────────────────────────────
  const totalMisses = missCounts.left + missCounts.right + missCounts.short + missCounts.long;
  const missThreshold = Math.max(2, Math.floor(totalShots * 0.25));

  if (dominantMiss && totalMisses >= 2) {
    if (missCounts.right >= missThreshold) {
      insights.push({
        id:       'miss-right',
        emoji:    '➡️',
        headline: 'Frequent right misses',
        detail:   'You missed right on many approach shots. Favour the left side of your target next round.',
        tone:     'warning',
      });
    } else if (missCounts.left >= missThreshold) {
      insights.push({
        id:       'miss-left',
        emoji:    '⬅️',
        headline: 'Frequent left misses',
        detail:   'You pulled shots left consistently. Try favouring the right-centre of your target.',
        tone:     'warning',
      });
    } else if (missCounts.short >= missThreshold) {
      insights.push({
        id:       'miss-short',
        emoji:    '⬇️',
        headline: 'Leaving shots short',
        detail:   'Multiple shots came up short today. Take one extra club on approach shots.',
        tone:     'warning',
      });
    } else if (missCounts.long >= missThreshold) {
      insights.push({
        id:       'miss-long',
        emoji:    '⬆️',
        headline: 'Overshooting targets',
        detail:   'You flew several greens today. Trust your distances and commit to the planned club.',
        tone:     'warning',
      });
    }
  }

  // ── 3. Inconsistent club ───────────────────────────────────────────────────
  const inconsistentClubs: string[] = [];
  for (const [club, stat] of Object.entries(clubUsage)) {
    if (!stat || stat.total < 3) continue;
    const missRate = stat.misses / stat.total;
    if (missRate > 0.60) inconsistentClubs.push(club);
  }

  // Only surface the single most-used inconsistent club to avoid noise
  if (inconsistentClubs.length > 0) {
    const topBad = inconsistentClubs.reduce((a, b) =>
      (clubUsage[a]?.total ?? 0) >= (clubUsage[b]?.total ?? 0) ? a : b,
    );
    const stat   = clubUsage[topBad];
    const pct    = stat ? Math.round((stat.misses / stat.total) * 100) : 0;
    insights.push({
      id:       `inconsistent-${topBad}`,
      emoji:    '⚠️',
      headline: `${topBad} was unreliable today`,
      detail:   `${pct}% miss rate with ${topBad} (${stat?.total ?? 0} shots). Use safer club selection until you find the groove.`,
      tone:     'warning',
    });
  }

  // ── 4. Best club (positive reinforcement) ─────────────────────────────────
  if (bestClub && bestClub !== worstClub) {
    const stat    = clubUsage[bestClub];
    const goodPct = stat ? Math.round(((stat.total - stat.misses) / stat.total) * 100) : 0;
    if (goodPct >= 70) {
      insights.push({
        id:       `best-club-${bestClub}`,
        emoji:    '✅',
        headline: `${bestClub} was your best club today`,
        detail:   `${goodPct}% solid contact with ${bestClub}. Lean on it when you need a confident shot.`,
        tone:     'positive',
      });
    }
  }

  // ── 5. Performance summary ─────────────────────────────────────────────────
  if (insights.length === 0) {
    // No specific issues — give a clean bill of health
    insights.push({
      id:       'clean-round',
      emoji:    '🟢',
      headline: 'Solid, consistent round',
      detail:   `${totalShots} shots tracked with no dominant miss pattern. Keep it up.`,
      tone:     'positive',
    });
  }

  return insights.slice(0, 5);
}
