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
import { greenHeatInput } from '../services/putting/greenHeatInput';

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
    /**
     * 2026-09-13 — the assembly moved to services/putting/greenHeatInput so the CADDIE PAYLOAD feeds
     * the model from the same decisions this card does (sim rounds excluded, the live round folded in,
     * par resolved only where real holes exist). Writing them twice is how the card and the caddie
     * would come to disagree about which rounds count.
     */
    const { rounds, holesByCourse } = greenHeatInput(
      { roundHistory, activeCourseId, courseHoles, scores: liveScores, putts: livePutts, isRoundActive, isSimRound },
      scope,
    );

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
