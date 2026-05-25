import type { SwingMetrics } from '../store/watchStore';

// ─── TEMPO ANALYSIS ───────────────────────

export const analyzeTempoRatio = (
  backswingMs: number,
  downswingMs: number,
): { ratio: number; tempoGood: boolean; assessment: string } => {
  const ratio = backswingMs / Math.max(downswingMs, 1);
  const tempoGood = ratio >= 2.5 && ratio <= 3.5;

  let assessment = '';
  if (ratio < 2.0) {
    assessment = 'Way too fast — no time to load the backswing.';
  } else if (ratio < 2.5) {
    assessment = 'A little quick. Let the backswing breathe.';
  } else if (ratio <= 3.5) {
    assessment = 'Good tempo.';
  } else if (ratio <= 4.0) {
    assessment = "A little slow. Keep some athleticism in it.";
  } else {
    assessment = 'Too slow — losing power and timing.';
  }

  return { ratio, tempoGood, assessment };
};

// ─── CLUB SPEED ESTIMATE ──────────────────

export const estimateClubSpeed = (peakWristSpeed: number): number => {
  // Club head moves ~4.5x faster than wrist; convert m/s to mph
  return Math.round(peakWristSpeed * 4.5 * 2.237);
};

// ─── KEVIN TEMPO LINE ─────────────────────

export const getKevinTempoLine = (metrics: SwingMetrics, club: string): string => {
  const { tempoRatio, tempoGood, earlyTransition, clubHeadSpeedEst } = metrics;

  if (earlyTransition && !tempoGood) {
    return "You're rushing the transition and your tempo is off. One thing: pause at the top before you start down.";
  }

  if (earlyTransition) {
    return "You're starting down before you finish going back. Feel a half-second pause at the top.";
  }

  if (tempoRatio < 2.5) {
    return (
      'Tempo is too fast at ' +
      tempoRatio.toFixed(1) +
      ':1. Count "one-two-three" on the backswing, "one" on the way down.'
    );
  }

  if (tempoRatio > 3.5) {
    return "Tempo is a little slow. Stay athletic through the swing — don't decelerate.";
  }

  if (tempoGood) {
    return (
      'Tempo is good at ' +
      tempoRatio.toFixed(1) +
      ':1. ' +
      (clubHeadSpeedEst > 0
        ? 'Estimated ' + clubHeadSpeedEst + ' mph with the ' + club + '.'
        : 'Keep that rhythm.')
    );
  }

  return 'One more — feeling out the tempo.';
};

// ─── FUTURE: REAL SDK HOOK ─────────────────
// When Samsung Health SDK is integrated:
//
// import { SamsungHealth } from '@samsung/health-sdk';
// SamsungHealth.onSwingDetected((data) => {
//   useWatchStore.getState().recordSwing(parseWatchData(data));
// });
