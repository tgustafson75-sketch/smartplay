import { CageShot } from '../store/cageStore';

export interface PatternResult {
  dominantMiss: string | null;
  dominantFeel: string | null;
  flushRate: number;
  fatRate: number;
  thinRate: number;
  totalShots: number;
  rootCause: string | null;
  kevinSummary: string;
  improvement: boolean;
}

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
      totalShots: 0,
      rootCause: null,
      kevinSummary: 'No shots logged this session.',
      improvement: false,
    };
  }

  const total = shots.length;

  const feelCounts: Record<string, number> = {};
  shots.forEach(s => {
    if (s.feel) {
      feelCounts[s.feel] = (feelCounts[s.feel] ?? 0) + 1;
    }
  });

  const shapeCounts: Record<string, number> = {};
  shots.forEach(s => {
    if (s.shape) {
      shapeCounts[s.shape] = (shapeCounts[s.shape] ?? 0) + 1;
    }
  });

  const flushCount = (feelCounts['flush'] ?? 0) + (feelCounts['solid'] ?? 0);
  const fatCount = feelCounts['fat'] ?? 0;
  const thinCount = feelCounts['thin'] ?? 0;

  const flushRate = Math.round((flushCount / total) * 100);
  const fatRate = Math.round((fatCount / total) * 100);
  const thinRate = Math.round((thinCount / total) * 100);

  const dominantMiss =
    Object.entries(shapeCounts)
      .sort(([, a], [, b]) => b - a)
      [0]?.[0] ?? null;

  const dominantFeel =
    Object.entries(feelCounts)
      .sort(([, a], [, b]) => b - a)
      [0]?.[0] ?? null;

  let rootCause: string | null = null;
  if (fatRate >= 40) {
    rootCause = 'Low point control — hitting behind the ball';
  } else if (thinRate >= 40) {
    rootCause = 'Early extension — coming up through impact';
  } else if (dominantMiss === 'fade' || dominantMiss === 'slice') {
    rootCause = 'Over the top path — club coming outside in';
  } else if (dominantMiss === 'draw' || dominantMiss === 'hook') {
    rootCause = 'Inside out path — face closing through impact';
  }

  let kevinSummary = '';
  if (flushRate >= 70) {
    kevinSummary = flushRate + '% solid contact with the ' + club + '. That\'s a good session.';
  } else if (fatRate >= 40) {
    kevinSummary =
      'You\'re hitting it heavy with the ' + club + '. Low point is behind the ball. Work on ball first contact.';
  } else if (thinRate >= 40) {
    kevinSummary =
      'You\'re coming up through impact. Stay down through the ' + club + ' longer.';
  } else if (dominantMiss === 'fade' || dominantMiss === 'slice') {
    kevinSummary =
      'Fading the ' + club + ' consistently. Path is slightly out to in. Work on the pump drill.';
  } else {
    kevinSummary = total + ' shots with the ' + club + '. ' + flushRate + '% solid. Keep building.';
  }

  const half = Math.floor(total / 2);
  const firstHalfFlush = half > 0
    ? shots.slice(0, half).filter(s => s.feel === 'flush' || s.feel === 'solid').length / half
    : 0;
  const secondHalfFlush = total - half > 0
    ? shots.slice(half).filter(s => s.feel === 'flush' || s.feel === 'solid').length / (total - half)
    : 0;
  const improvement = secondHalfFlush > firstHalfFlush + 0.15;

  return {
    dominantMiss,
    dominantFeel,
    flushRate,
    fatRate,
    thinRate,
    totalShots: total,
    rootCause,
    kevinSummary,
    improvement,
  };
};

export const getDominantMissLabel = (miss: string | null): string => {
  if (!miss) return 'Straight';
  const labels: Record<string, string> = {
    'fade': 'Fade / Slice',
    'draw': 'Draw / Hook',
    'straight': 'Straight',
    'slice': 'Slice',
    'hook': 'Hook',
    'push': 'Push Right',
    'pull': 'Pull Left',
  };
  return labels[miss] ?? miss;
};
