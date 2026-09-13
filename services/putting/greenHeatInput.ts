/**
 * 2026-09-13 (Tim — "unify Green logic and everything green related according to course play, GPS, and
 * putting practice… This is another example of scatter when unified engine of truth is the design")
 *
 * ONE OWNER FOR WHAT FEEDS THE GREEN HEAT MODEL.
 *
 * `services/putting/greenHeat` is deliberately PURE — it takes rounds plus a par lookup and imports no
 * store — so the honesty boundary stays auditable in one file. That purity is right, and it meant the
 * decisions about WHICH rounds to feed it lived in `hooks/useGreenHeat`, where only a React component
 * could reach them:
 *
 *   · simulated rounds never feed green heat — narrated sim putts are not real greens data
 *   · the live in-progress round IS folded in, as a minimal synthetic record carrying only the fields
 *     the model reads, so a player sees this round's putting without waiting for it to end
 *   · par/GIR classification uses the live course's real holes; a historical round on another course
 *     still counts toward `overall` rather than being guessed at
 *
 * Those are real judgements, and the caddie payload needs exactly the same ones. Writing them a second
 * time inside caddieRequestBody would have made the card and the caddie disagree about which rounds
 * count — the scatter this extraction exists to prevent. So the assembly moves here, the hook calls it,
 * the payload calls it, and neither owns it. [[two-owners-is-the-root-cause]]
 */
import type { RoundRecord, CourseHole } from '../../store/roundStore';

/** Exactly the slice of roundStore this needs — so a caller may pass a snapshot or a live state. */
export interface GreenHeatSource {
  roundHistory: RoundRecord[];
  activeCourseId: string | null;
  courseHoles: CourseHole[] | null | undefined;
  scores: Record<number, number>;
  putts: Record<number, number>;
  isRoundActive: boolean;
  isSimRound: boolean;
}

export type GreenHeatScope = 'career' | 'round';

export interface GreenHeatInput {
  rounds: RoundRecord[];
  holesByCourse: Record<string, CourseHole[]>;
}

export function greenHeatInput(s: GreenHeatSource, scope: GreenHeatScope = 'career'): GreenHeatInput {
  // Par for any course whose real holes we have on hand — today the live course. Historical rounds
  // elsewhere contribute to `overall` only, which is honest rather than guessed.
  const holesByCourse: Record<string, CourseHole[]> = {};
  if (s.activeCourseId && s.courseHoles && s.courseHoles.length > 0) {
    holesByCourse[s.activeCourseId] = s.courseHoles;
  }

  const realHistory = (s.roundHistory ?? []).filter((r) => !r.simulated);

  // Minimal synthetic record — only the fields buildGreenHeatModel reads. No fabricated putts: it
  // exists only when the live round has at least one real logged putt.
  const liveRound: RoundRecord | null =
    s.isRoundActive && !s.isSimRound && Object.keys(s.putts ?? {}).length > 0
      ? ({
          id: '__live__',
          courseId: s.activeCourseId,
          putts: s.putts,
          scores: s.scores,
        } as unknown as RoundRecord)
      : null;

  const rounds: RoundRecord[] = [];
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

  return { rounds, holesByCourse };
}
