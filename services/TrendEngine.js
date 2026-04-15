/**
 * TrendEngine.js
 *
 * Analyses multiple practice sessions to surface long-term trends.
 *
 * Primary export:
 *   analyzeTrends(sessions) → TrendResult
 *
 * TrendResult shape:
 * {
 *   longTermMissBias:   'left' | 'right' | 'neutral',
 *   improvementTrend:   'improving' | 'regressing' | 'stable',
 *   consistencyScore:   number,        // 0–100
 *   confidenceScore:    number,        // 0–100 composite
 *   dominantShape:      string,        // e.g. 'slice', 'draw', 'straight'
 *   sessionCount:       number,
 *   recentAvgStraight:  number,        // % straight shots — last 3 sessions
 *   olderAvgStraight:   number,        // % straight shots — sessions 4–5 (or earlier)
 *   summary:            string,        // human-readable single sentence
 * }
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const WINDOW = 5;           // number of sessions to analyse
const BIAS_THRESHOLD = 0.55; // > 55% in one direction → biased
const TREND_DELTA    = 5;    // ppt change required to call improving/regressing

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Given an array of { goodCount, leftCount, rightCount, straightPct }
 * summary objects, return the dominant miss bias.
 */
function deriveBias(summaries) {
  if (!summaries.length) return 'neutral';

  let totalLeft = 0, totalRight = 0, totalShots = 0;
  for (const s of summaries) {
    totalLeft  += s.leftCount  ?? 0;
    totalRight += s.rightCount ?? 0;
    totalShots += (s.goodCount ?? 0) + (s.leftCount ?? 0) + (s.rightCount ?? 0);
  }
  if (totalShots === 0) return 'neutral';
  if (totalRight / totalShots > BIAS_THRESHOLD) return 'right';
  if (totalLeft  / totalShots > BIAS_THRESHOLD) return 'left';
  return 'neutral';
}

/**
 * Count plurality shape across all shotShapeData entries in the session list.
 */
function deriveDominantShape(sessions) {
  const counts = {};
  for (const session of sessions) {
    for (const shot of (session.shotShapeData ?? [])) {
      const start  = shot.ballStart;
      const finish = shot.finish;
      let shape = 'straight';
      if (start === 'right' && finish === 'right')     shape = 'push';
      else if (start === 'right' && finish === 'left')  shape = 'slice';
      else if (start === 'right' && finish === 'straight') shape = 'fade';
      else if (start === 'left'  && finish === 'right')  shape = 'draw';
      else if (start === 'left'  && finish === 'left')   shape = 'pull';
      else if (start === 'left'  && finish === 'straight') shape = 'hook';
      else if (start === 'neutral' && finish === 'right') shape = 'fade';
      else if (start === 'neutral' && finish === 'left')  shape = 'draw';
      counts[shape] = (counts[shape] ?? 0) + 1;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : 'straight';
}

/**
 * Average straightPct over a list of session summaries.
 */
function avgStraightPct(summaries) {
  if (!summaries.length) return 0;
  return summaries.reduce((acc, s) => acc + (s.straightPct ?? 0), 0) / summaries.length;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Analyse up to the last WINDOW sessions and return trend metrics.
 *
 * @param {import('./SessionHistory').SessionEntry[]} sessions
 *   Array of session entries — newest first (as returned by getHistory()).
 *
 * @returns {{
 *   longTermMissBias:  'left' | 'right' | 'neutral',
 *   improvementTrend:  'improving' | 'regressing' | 'stable',
 *   consistencyScore:  number,
 *   confidenceScore:   number,
 *   dominantShape:     string,
 *   sessionCount:      number,
 *   recentAvgStraight: number,
 *   olderAvgStraight:  number,
 *   summary:           string,
 * }}
 */
export function analyzeTrends(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return {
      longTermMissBias:  'neutral',
      improvementTrend:  'stable',
      consistencyScore:  0,
      confidenceScore:   0,
      dominantShape:     'straight',
      sessionCount:      0,
      recentAvgStraight: 0,
      olderAvgStraight:  0,
      summary:           'No session data yet.',
    };
  }

  const window = sessions.slice(0, WINDOW);
  const summaries = window.map((s) => s.summary).filter(Boolean);

  // ── 1. Long-term miss bias ────────────────────────────────────────────────
  const longTermMissBias = deriveBias(summaries);

  // ── 2. Improvement trend  ─────────────────────────────────────────────────
  // Compare average straightPct of most-recent 2 vs older sessions
  const recentSummaries = summaries.slice(0, 2);
  const olderSummaries  = summaries.slice(2);

  const recentAvgStraight = Math.round(avgStraightPct(recentSummaries));
  const olderAvgStraight  = Math.round(avgStraightPct(olderSummaries));

  let improvementTrend = 'stable';
  if (olderSummaries.length > 0) {
    const delta = recentAvgStraight - olderAvgStraight;
    if (delta >= TREND_DELTA)       improvementTrend = 'improving';
    else if (delta <= -TREND_DELTA) improvementTrend = 'regressing';
  }

  // ── 3. Consistency score  ─────────────────────────────────────────────────
  // Average of per-session straight percentages, weighted slightly toward recent
  const weights = recentSummaries.map(() => 1.5).concat(olderSummaries.map(() => 1.0));
  const weighted = summaries.reduce((acc, s, i) => acc + (s.straightPct ?? 0) * (weights[i] ?? 1), 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const consistencyScore = clamp(Math.round(totalWeight > 0 ? weighted / totalWeight : 0), 0, 100);

  // ── 4. Composite confidence score ────────────────────────────────────────
  // Rewards consistency, penalises strong bias, boosts for improving trend
  const biasePenalty = longTermMissBias !== 'neutral' ? 15 : 0;
  const trendBonus   = improvementTrend === 'improving' ? 10
                     : improvementTrend === 'regressing' ? -10 : 0;
  const volumeBonus  = clamp(Math.round((window.length / WINDOW) * 20), 0, 20);
  const confidenceScore = clamp(consistencyScore - biasePenalty + trendBonus + volumeBonus, 0, 100);

  // ── 5. Dominant shot shape  ───────────────────────────────────────────────
  const dominantShape = deriveDominantShape(window);

  // ── 6. Human-readable summary ─────────────────────────────────────────────
  let summary = '';
  if (improvementTrend === 'improving') {
    summary = `You're improving — straight shots up ${recentAvgStraight - olderAvgStraight}% over recent sessions.`;
  } else if (improvementTrend === 'regressing') {
    summary = `Slight regression lately — straight shots down ${olderAvgStraight - recentAvgStraight}%. Focus on consistency.`;
  } else if (longTermMissBias === 'right') {
    summary = `Consistent right miss bias across ${window.length} sessions. Work on closing the face.`;
  } else if (longTermMissBias === 'left') {
    summary = `Consistent left miss bias across ${window.length} sessions. Check your swing path.`;
  } else {
    summary = `Stable ball-striking over ${window.length} sessions. Consistency score: ${consistencyScore}%.`;
  }

  return {
    longTermMissBias,
    improvementTrend,
    consistencyScore,
    confidenceScore,
    dominantShape,
    sessionCount:      window.length,
    recentAvgStraight,
    olderAvgStraight,
    summary,
  };
}

/**
 * Convenience: given a TrendResult, return the recommended caddie strategy mode.
 *
 * @param {ReturnType<typeof analyzeTrends>} trends
 * @returns {'safe' | 'normal' | 'aggressive'}
 */
export function trendStrategyMode(trends) {
  if (trends.confidenceScore >= 70 && trends.improvementTrend !== 'regressing') {
    return 'aggressive';
  }
  if (trends.confidenceScore < 40 || trends.improvementTrend === 'regressing') {
    return 'safe';
  }
  return 'normal';
}
