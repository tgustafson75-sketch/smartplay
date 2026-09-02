import { SwingShot } from '../store/swingSessionStore';

export interface PatternResult {
  dominantMiss: string | null;
  dominantFeel: string | null;
  flushRate: number;
  fatRate: number;
  thinRate: number;
  heelRate: number;
  toeRate: number;
  totalShots: number;
  rootCause: string | null;
  rootCauseDetail: string | null;
  kevinSummary: string;
  kevinNextDrill: string | null;
  improvement: boolean;
  trend: 'improving' | 'declining' | 'consistent' | 'insufficient';
  streakInfo: string | null;
}

const count = (arr: string[], val: string): number =>
  arr.filter(x => x === val).length;

const dominant = (rec: Record<string, number>): string | null => {
  const entries = Object.entries(rec);
  if (entries.length === 0) return null;
  return entries.sort(([, a], [, b]) => b - a)[0][0];
};

const rate = (n: number, total: number): number =>
  total === 0 ? 0 : Math.round((n / total) * 100);

export const analyzeSession = (
  shots: SwingShot[],
  club: string,
): PatternResult => {

  if (shots.length === 0) {
    return {
      dominantMiss: null,
      dominantFeel: null,
      flushRate: 0,
      fatRate: 0,
      thinRate: 0,
      heelRate: 0,
      toeRate: 0,
      totalShots: 0,
      rootCause: null,
      rootCauseDetail: null,
      kevinSummary: 'No shots logged yet.',
      kevinNextDrill: null,
      improvement: false,
      trend: 'insufficient',
      streakInfo: null,
    };
  }

  const total = shots.length;
  const feels = shots.map(s => s.feel ?? 'unknown');
  const shapes = shots.map(s => s.shape ?? 'unknown');

  const flushCount = count(feels, 'flush') + count(feels, 'solid');
  const fatCount   = count(feels, 'fat');
  const thinCount  = count(feels, 'thin');
  const heelCount  = count(feels, 'heel');
  const toeCount   = count(feels, 'toe');

  const flushRate = rate(flushCount, total);
  const fatRate   = rate(fatCount, total);
  const thinRate  = rate(thinCount, total);
  const heelRate  = rate(heelCount, total);
  const toeRate   = rate(toeCount, total);

  const shapeCounts: Record<string, number> = {};
  shapes.forEach(s => {
    if (s !== 'unknown') {
      shapeCounts[s] = (shapeCounts[s] ?? 0) + 1;
    }
  });

  const feelCounts: Record<string, number> = {
    flush: flushCount,
    fat: fatCount,
    thin: thinCount,
    heel: heelCount,
    toe: toeCount,
  };

  const dominantMiss = dominant(shapeCounts);
  const dominantFeel = dominant(feelCounts);

  let rootCause: string | null = null;
  let rootCauseDetail: string | null = null;
  let kevinNextDrill: string | null = null;

  if (fatRate >= 40) {
    rootCause = 'Low point control';
    rootCauseDetail =
      'Club is bottoming out before the ball. Low point is too far back.';
    kevinNextDrill = 'Impact bag drill — hands forward at impact.';
  } else if (thinRate >= 40) {
    rootCause = 'Early extension';
    rootCauseDetail =
      'Hips rising through impact. Standing up causes thin contact.';
    kevinNextDrill = 'Stay down drill — hold finish with knees bent.';
  } else if (heelRate >= 30) {
    rootCause = 'Standing too far from ball';
    rootCauseDetail =
      'Consistent heel contact means setup distance is too great.';
    kevinNextDrill = 'Setup check — move one inch closer to the ball.';
  } else if (toeRate >= 30) {
    rootCause = 'Standing too close to ball';
    rootCauseDetail =
      'Consistent toe contact means setup distance is too tight.';
    kevinNextDrill = 'Setup check — move one inch back from the ball.';
  } else if (dominantMiss === 'fade' && shapeCounts['fade'] >= total * 0.5) {
    rootCause = 'Out to in swing path';
    rootCauseDetail =
      'Consistent fade means path is crossing target line. Club is coming over the top.';
    kevinNextDrill = 'Pump drill — drop the club inside on the way down.';
  } else if (dominantMiss === 'draw' && shapeCounts['draw'] >= total * 0.5) {
    rootCause = 'In to out swing path';
    rootCauseDetail =
      'Consistent draw means path is swinging too far right. Face is closing to path.';
    kevinNextDrill = 'Alignment check — confirm feet and shoulders are square.';
  } else if (dominantMiss === 'slice' || dominantMiss === 'hook') {
    rootCause = dominantMiss === 'slice' ? 'Severe out to in path' : 'Severe in to out path';
    rootCauseDetail = dominantMiss === 'slice'
      ? 'Face open to path at impact.'
      : 'Face closed to path at impact.';
    kevinNextDrill = 'One-handed drill — train each hand separately.';
  } else if (flushRate >= 70) {
    rootCause = null;
    rootCauseDetail = null;
    kevinNextDrill = null;
  }

  let kevinSummary = '';

  if (total < 5) {
    kevinSummary = 'Getting started with the ' + club + '. Keep going.';
  } else if (flushRate >= 80) {
    kevinSummary =
      flushRate + '% solid with the ' + club + '. ' +
      "That's a strong session. Take that feeling to the course.";
  } else if (flushRate >= 60) {
    kevinSummary =
      flushRate + '% solid. More good than bad with the ' + club + '. Keep building.';
  } else if (fatRate >= 40) {
    kevinSummary =
      "You're hitting it heavy " + fatRate + '% of the time. ' +
      'Ball first — ground after. That\'s the whole fix.';
  } else if (thinRate >= 40) {
    kevinSummary =
      thinRate + '% thin. You\'re coming up through impact. ' +
      'Stay down through the ' + club + ' — see the divot.';
  } else if (dominantMiss && shapeCounts[dominantMiss] >= total * 0.4) {
    kevinSummary =
      Math.round((shapeCounts[dominantMiss] / total) * 100) + '% ' + dominantMiss +
      ' with the ' + club + '. ' +
      (rootCause ? rootCause + '.' : 'Work on path consistency.');
  } else {
    kevinSummary =
      total + ' shots with the ' + club + '. ' +
      flushRate + '% solid contact. Consistent work builds consistent results.';
  }

  // Trend — compare first third to last third
  let trend: 'improving' | 'declining' | 'consistent' | 'insufficient' = 'insufficient';

  if (total >= 9) {
    const third = Math.floor(total / 3);
    const firstThird = shots.slice(0, third);
    const lastThird  = shots.slice(total - third);

    const firstFlush =
      firstThird.filter(s => s.feel === 'flush' || s.feel === 'solid').length / third;
    const lastFlush =
      lastThird.filter(s => s.feel === 'flush' || s.feel === 'solid').length / third;

    const diff = lastFlush - firstFlush;
    if (diff >= 0.2)       trend = 'improving';
    else if (diff <= -0.2) trend = 'declining';
    else                   trend = 'consistent';
  }

  // Streak — consecutive flush/solid at end
  let streakInfo: string | null = null;
  let currentStreak = 0;
  for (let i = shots.length - 1; i >= 0; i--) {
    if (shots[i].feel === 'flush' || shots[i].feel === 'solid') {
      currentStreak++;
    } else {
      break;
    }
  }
  if (currentStreak >= 3) {
    streakInfo = currentStreak + ' solid shots in a row.';
  }

  const improvement = trend === 'improving';

  return {
    dominantMiss,
    dominantFeel,
    flushRate,
    fatRate,
    thinRate,
    heelRate,
    toeRate,
    totalShots: total,
    rootCause,
    rootCauseDetail,
    kevinSummary,
    kevinNextDrill,
    improvement,
    trend,
    streakInfo,
  };
};

/**
 * 2026-09-01 — getKevinShotResponse DELETED, not wired.
 *
 * It returned a canned line per shot feel ("That's one.", "Heavy. Ball first next one.", "Next
 * one."), selected by a switch over rate thresholds. Nothing had called it, and wiring it would have
 * been the wrong fix: a fixed string chosen by a lookup table is precisely the robotic moment the
 * north star calls a defect, and Tim reported one of these as a bug in the field ("a canned speech in
 * Serena at startup"). The caddie speaks through the brain, which has the session, the pattern and
 * the player in front of it. [[feels-like-a-real-caddie]] [[learning-layer-must-not-intercept]]
 *
 * The PatternResult fields it read (flushRate, fatRate, streakInfo, …) are unchanged and still reach
 * the brain — what is gone is the shortcut that would have answered the player without asking it.
 */

/**
 * The display label for a session's dominant shape. ONE owner, because two practice screens were
 * each spelling it `miss.charAt(0).toUpperCase() + miss.slice(1)` by hand.
 *
 * SCOPE, deliberately narrow: this labels the SHAPE TAG vocabulary (SwingActionSheet SHAPE_OPTIONS:
 * draw / straight / fade / hook / slice). It is NOT the labeller for
 * caddieMemoryStore.tendencies.dominantMiss, which holds FAULT IDS ('over_the_top') from a different
 * vocabulary and is rendered by the dashboard with its own underscore rule. Same field name, two
 * value spaces — folding them together would be a worse defect than the duplication it removed.
 *
 * 'push' / 'pull' are not in the current SHAPE_OPTIONS and are kept for shots tagged before it
 * narrowed: a persisted value must still render, and "Push Right" says more to a player than "Push".
 * The fallback title-cases anything unknown, so a legacy or underscored value reads as words rather
 * than as the raw identifier the hand-rolled version would have shown.
 */
export const getDominantMissLabel = (miss: string | null): string => {
  if (!miss) return 'Straight';
  const labels: Record<string, string> = {
    'fade':     'Fade',
    'draw':     'Draw',
    'straight': 'Straight',
    'slice':    'Slice',
    'hook':     'Hook',
    'push':     'Push Right',
    'pull':     'Pull Left',
  };
  return labels[miss] ?? miss
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};
