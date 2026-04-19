/**
 * features/smartCaddie/hooks/useHoleContext.ts
 *
 * Assembles all per-hole context needed by SmartCaddieEngine from round
 * store state and the active course data.
 */

import { useMemo } from 'react';
import { useRoundStore } from '../../../store/roundStore';
import { COURSE_DB } from '../../../data/courses';
import type { CourseHole, Course } from '../../../data/courses';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HoleContext {
  /** Current 1-based hole number */
  holeNumber: number;
  /** Current par */
  par: number;
  /** Course-listed distance (yards) */
  holeDistance: number;
  /** Rich hole data including hazards, GPS coords, notes */
  holeData: CourseHole | null;
  /** Full course record */
  course: Course | null;
  /** Strokes taken on this hole so far (from scores array) */
  strokesThisHole: number;
  /** Shots recorded this round */
  totalShots: number;
  /** Cumulative score vs par this round */
  scoreVsPar: number;
  /** Whether this is a water-risk hole (note text analysis) */
  isWaterHole: boolean;
  /** Whether this is a par-3 requiring a full carry */
  isCarryHole: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useHoleContext(): HoleContext {
  const currentHole    = useRoundStore((s) => s.currentHole);
  const currentPar     = useRoundStore((s) => s.currentPar);
  const activeCourse   = useRoundStore((s) => s.activeCourse);
  const scores         = useRoundStore((s) => s.scores);
  const shots          = useRoundStore((s) => s.shots);

  const course = useMemo(
    () => COURSE_DB.find((c) => c.name === activeCourse || c.id === activeCourse) ?? null,
    [activeCourse],
  );

  const holeData = useMemo(
    () => course?.holes.find((h) => h.hole === currentHole) ?? null,
    [course, currentHole],
  );

  // scoreVsPar = sum of (score - par) for completed holes
  const scoreVsPar = useMemo(() => {
    let diff = 0;
    for (let i = 0; i < Math.min(currentHole - 1, 18); i++) {
      const holeObj = course?.holes[i];
      const par = holeObj?.par ?? 4;
      diff += (scores[i] || 0) - par;
    }
    return diff;
  }, [scores, currentHole, course]);

  const noteText = (holeData?.note ?? '').toLowerCase();
  const isWaterHole = noteText.includes('water') || noteText.includes('lake') || noteText.includes('creek');
  const isCarryHole = holeData?.par === 3 && (noteText.includes('carry') || noteText.includes('island'));

  return {
    holeNumber:       currentHole,
    par:              currentPar,
    holeDistance:     holeData?.distance ?? 0,
    holeData,
    course,
    strokesThisHole:  scores[currentHole - 1] ?? 0,
    totalShots:       shots.length,
    scoreVsPar,
    isWaterHole,
    isCarryHole,
  };
}
