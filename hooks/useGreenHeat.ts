/**
 * 2026-06-25 — useGreenHeat: the hook that feeds the HONEST green heat model
 * (services/putting/greenHeat.ts) from REAL round history.
 *
 * Honesty boundary (Tim's law + no-deferred-placeholder rule):
 *   - The ONLY input is real captured putt data:
 *       • RoundRecord.putts (per-hole putt count, logged via the cockpit →
 *         roundStore.logPutts) across roundHistory + the live in-progress round.
 *       • Real green-roll positional/break data from greenRollStore IF (and only
 *         if) the watch-the-roll CV has fed any (zero feeders today → null signal).
 *   - Par/GIR classification uses the live course's real courseHoles (and any
 *     other course whose holes we can resolve). Holes we can't classify still
 *     count toward `overall` — never guessed.
 *   - No fabrication anywhere: with too few real putt holes the model reports
 *     ready=false and the viz shows the collecting state.
 *
 * Pure assembly + memoized; the heavy lifting stays in greenHeat.ts so the
 * honesty boundary is auditable in one place.
 */

import { useMemo } from 'react';
import { useRoundStore } from '../store/roundStore';
import { useGreenRollStore } from '../store/greenRollStore';
import {
  buildGreenHeatModel,
  mergeGreenRollSignal,
  type GreenHeatModel,
} from '../services/putting/greenHeat';
import type { RoundRecord, CourseHole } from '../store/roundStore';

/**
 * Build the green heat model from real round history + the live round.
 *
 * @param scope 'career' (default) folds every completed round + the live round.
 *              'round' folds only the currently active round (or last completed
 *              if none active) — used for a per-round green snapshot.
 */
export function useGreenHeat(scope: 'career' | 'round' = 'career'): GreenHeatModel {
  const roundHistory = useRoundStore((s) => s.roundHistory);
  const activeCourseId = useRoundStore((s) => s.activeCourseId);
  const courseHoles = useRoundStore((s) => s.courseHoles);
  // Live in-progress round putts/scores (not yet pushed into history).
  const liveScores = useRoundStore((s) => s.scores);
  const livePutts = useRoundStore((s) => s.putts);
  const isRoundActive = useRoundStore((s) => s.isRoundActive);
  const isSimRound = useRoundStore((s) => s.isSimRound);
  const rollsMap = useGreenRollStore((s) => s.rolls);

  return useMemo(() => {
    // holesByCourse: resolve par for any course whose real holes we have on hand.
    // Today that's the live course's courseHoles. Historical rounds on the same
    // course classify; others contribute to `overall` only (honest, not guessed).
    const holesByCourse: Record<string, CourseHole[]> = {};
    if (activeCourseId && courseHoles && courseHoles.length > 0) {
      holesByCourse[activeCourseId] = courseHoles;
    }

    // Assemble the rounds to fold in.
    // 2026-07-06 (elite audit) — sim rounds never feed green heat: narrated
    // sim putts aren't real greens data. Same gate for the live sim round.
    const realHistory = roundHistory.filter((r) => !r.simulated);
    const rounds: RoundRecord[] = [];
    const liveRound: RoundRecord | null =
      isRoundActive && !isSimRound && Object.keys(livePutts ?? {}).length > 0
        ? ({
            // Minimal synthetic record — only the fields buildGreenHeatModel reads
            // (putts, scores, courseId). Real data only; no fabricated putts.
            id: '__live__',
            courseId: activeCourseId,
            putts: livePutts,
            scores: liveScores,
          } as unknown as RoundRecord)
        : null;

    if (scope === 'round') {
      if (liveRound) rounds.push(liveRound);
      else {
        const last = realHistory[realHistory.length - 1];
        if (last) rounds.push(last);
      }
    } else {
      rounds.push(...realHistory);
      if (liveRound) rounds.push(liveRound);
    }

    const base = buildGreenHeatModel(rounds, holesByCourse);

    // Fold REAL measured green rolls (positional break/make) when any exist.
    // Career: every green's rolls. Round: only the active course's greens.
    const allRolls = Object.entries(rollsMap ?? {}).flatMap(([key, list]) => {
      if (scope === 'round' && activeCourseId) {
        return key.startsWith(`${activeCourseId}:`) ? list : [];
      }
      return list;
    });
    return mergeGreenRollSignal(base, allRolls);
  }, [
    roundHistory,
    activeCourseId,
    courseHoles,
    liveScores,
    livePutts,
    isRoundActive,
    isSimRound,
    rollsMap,
    scope,
  ]);
}
