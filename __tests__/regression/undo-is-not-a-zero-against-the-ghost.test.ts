/**
 * 2026-10-15 (review) — "scratch that" on a hole's FIRST score, with a ghost round active, called
 * ghostStore.updateHole(hole, 0): the hole read as a 0 against last time's 4 — "4 better than last
 * time" on a hole not yet played. The undone hole now leaves the ghost match entirely.
 */
import { useRoundStore } from '../../store/roundStore';
import { useGhostStore } from '../../store/ghostStore';

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));

describe('undo against a ghost round', () => {
  beforeEach(() => {
    useRoundStore.setState({ roundHistory: [] } as never);
    useRoundStore.getState().startRound('Ghost GC', card as never, {
      nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'g',
    } as never);
    useGhostStore.getState().activateGhost({ id: 'old', scores: { 1: 4, 2: 4 } } as never);
  });
  afterEach(() => useGhostStore.getState().deactivateGhost());

  it('undoing a first score removes the hole from the match, not a 0', () => {
    useRoundStore.getState().logScore(1, 5);
    useRoundStore.getState().logScore(2, 6);
    useRoundStore.getState().undoLastMutation();
    const g = useGhostStore.getState();
    expect(g.holeResults[2]).toBeUndefined();
    expect(g.overall_delta).toBe(1);      // hole 1 only: 5 vs 4
    expect(g.holes_compared).toBe(1);
  });

  it('undoing a correction restores the prior score against the ghost', () => {
    useRoundStore.getState().logScore(1, 5);
    useRoundStore.getState().logScore(1, 7);
    useRoundStore.getState().undoLastMutation();
    expect(useGhostStore.getState().holeResults[1].current_score).toBe(5);
  });
});
