import { CageShot } from '../store/cageStore';

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
  shots: CageShot[],
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

export const getKevinShotResponse = (
  feel: string,
  shape: string | null,
  shotNumber: number,
  pattern: PatternResult,
  club: string,
): string => {
  if (pattern.streakInfo && (feel === 'flush' || feel === 'solid')) {
    return pattern.streakInfo;
  }

  if (shotNumber === 1) {
    if (feel === 'flush' || feel === 'solid') return 'Good start.';
    return 'One shot. Keep going.';
  }

  switch (feel) {
    case 'flush':
    case 'solid':
      if (shotNumber <= 3) return "That's one.";
      return pattern.flushRate >= 70 ? 'Consistent.' : "That's the feeling.";

    case 'fat':
      return pattern.fatRate >= 40
        ? 'Still hitting behind it. Feel the ground after the ball — not before.'
        : 'Heavy. Ball first next one.';

    case 'thin':
      return pattern.thinRate >= 40
        ? 'Keep coming up through it. Stay down — see the divot.'
        : 'Thin. Stay down through impact.';

    case 'heel':
      return pattern.heelRate >= 30
        ? 'Still in the heel. Move a touch closer to the ball at address.'
        : 'Heel. Check your distance to the ball.';

    case 'toe':
      return pattern.toeRate >= 30
        ? 'Still off the toe. Stand one inch back from where you are.'
        : 'Toe. Just a touch back from the ball.';

    default:
      return 'Next one.';
  }
};

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
  return labels[miss] ?? miss;
};
