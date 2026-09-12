/**
 * 2026-09-11 (full-app audit, finding 2) — THE ROUND THAT SILENTLY STOPPED COUNTING.
 *
 * setCurrentHole expands a declared nine to an eighteen when the player walks onto the 10th, because
 * walking there is stronger evidence than a tap made an hour ago. It gated that on
 * `state.courseHoles.length` — a SECOND answer to "how many holes does this course have", and the
 * weaker one: courseHoles is written only by startRound, nothing backfills it, and caddie.tsx has an
 * acknowledged `startedWithoutHoles` path for a course in neither the bundle nor the API.
 *
 * On such a course the count was 0, `0 >= 10` was false, and the player was clamped back to hole 9
 * for the rest of the round — every hole after that unrecorded, while he kept playing.
 *
 * THIS TEST EXISTS BECAUSE I ALMOST DIDN'T WRITE IT. The bug was proved by driving the store and the
 * probe was then deleted, which would have left the one finding with a real user-facing cost and no
 * guard at all. [[ten-times-check-your-work]]
 */
import { useRoundStore } from '../../store/roundStore';

const card = (n: number) => Array.from({ length: n }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));

function start(holes: ReturnType<typeof card>, opts: { startHole?: number; courseId?: string | null } = {}) {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Expand GC', holes as never, {
    nineHole: true, startHole: opts.startHole ?? 1, isCompetition: false,
    notes: '', goal: null, courseId: opts.courseId ?? null,
  } as never);
}

describe('a nine on a course we have no hole data for', () => {
  it('expands when he walks onto the 10th, instead of pinning him to 9', () => {
    start([]);                                   // the startedWithoutHoles path
    useRoundStore.getState().setCurrentHole(10);
    const s = useRoundStore.getState();
    expect(s.currentHole).toBe(10);
    expect(s.nineHoleMode).toBe(false);
  });

  it('and keeps counting after that — the actual cost of the bug', () => {
    start([]);
    useRoundStore.getState().setCurrentHole(10);
    useRoundStore.getState().logScore(10, 5);
    useRoundStore.getState().setCurrentHole(14);
    useRoundStore.getState().logScore(14, 6);
    const sc = useRoundStore.getState().scores;
    expect(sc[10]).toBe(5);
    expect(sc[14]).toBe(6);
  });
});

describe('but a course that genuinely HAS nine holes still refuses', () => {
  it('stays on 9 — expanding there would invent holes that do not exist', () => {
    start(card(9), { courseId: 'a-real-nine' });
    useRoundStore.getState().setCurrentHole(10);
    const s = useRoundStore.getState();
    expect(s.currentHole).toBe(9);
    expect(s.nineHoleMode).toBe(true);
  });
});

describe('an eighteen-hole course expands as it always did', () => {
  it('front nine → walks to 10 → full round', () => {
    start(card(18), { courseId: 'a-real-eighteen' });
    useRoundStore.getState().setCurrentHole(10);
    expect(useRoundStore.getState().currentHole).toBe(10);
    expect(useRoundStore.getState().nineHoleMode).toBe(false);
  });

  it('a BACK nine is untouched — 10..18 is already its range, nothing to expand', () => {
    start(card(18), { startHole: 10, courseId: 'a-real-eighteen' });
    expect(useRoundStore.getState().currentHole).toBe(10);
    useRoundStore.getState().setCurrentHole(18);
    expect(useRoundStore.getState().currentHole).toBe(18);
    expect(useRoundStore.getState().nineHoleMode).toBe(true);
  });
});

describe('the owner, not a second opinion', () => {
  it('the expansion asks getCourseHoleCount, never the raw array length', () => {
    /**
     * Comments stripped first — the explanatory note in that branch QUOTES the old expression, and
     * asserting over raw source failed on my own prose. Third time today.
     * [[my-own-comment-defeats-my-own-guard]] [[strip-comments-before-a-guard-matches]]
     *
     * `courseHoles?.length` legitimately survives as the CATCH fallback for when data/courses cannot
     * be loaded, so the assertion is that the primary read goes through the owner — not that the
     * string is absent.
     */
    const src = (require('fs').readFileSync(
      require('path').join(__dirname, '../../store/roundStore.ts'), 'utf8',
    ) as string).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const at = src.indexOf('state.nineHoleMode && hole > maxHole');
    expect(at).toBeGreaterThan(-1);
    const branch = src.slice(at, at + 700);
    // the owner answers first…
    expect(branch).toMatch(/getCourseHoleCount\(state\.activeCourseId, state\.courseHoles\?\.length \?\? 0\)/);
    // …and the raw length appears ONLY inside the catch, never as the decision itself
    const decision = branch.slice(0, branch.indexOf('catch'));
    expect(decision).not.toMatch(/const courseHoleCount = state\.courseHoles/);
  });
});
