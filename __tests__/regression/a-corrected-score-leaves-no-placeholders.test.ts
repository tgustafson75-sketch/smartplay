/**
 * 2026-10-15 (review) — the scorecard's quick-score chip writes one `qs-<hole>-<n>` placeholder per
 * stroke, then the score. Every OTHER way of changing that score (voice, scorecard ±, strip, cockpit,
 * "scratch that") left the old placeholders behind, so the instant recap listed six "shots" on a hole
 * corrected to four, and strokesPlayedOnHole — the caddie's current-stroke number — counted them.
 */
import { useRoundStore, strokesPlayedOnHole } from '../../store/roundStore';
import { synthesizeRecapFromRecord } from '../../services/recapSynth';

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));
const qs = (hole: number, n: number) => Array.from({ length: n }, (_, i) => ({
  id: `qs-${hole}-${i}`, feel: null, direction: null, shape: null, club: null, hole, timestamp: i, acousticContact: null, outcome: 'clean', penalty_strokes: 0,
}));
const placeholders = (hole: number) => useRoundStore.getState().shots.filter((s) => typeof s.id === 'string' && s.id.startsWith(`qs-${hole}-`));

function quickScore(hole: number, score: number) {
  // exactly what scorecard.tsx handleQuickScore does
  const r = useRoundStore.getState();
  r.clearQuickScorePlaceholders(hole);
  for (const p of qs(hole, score)) r.logShot(p as never);
  r.logScore(hole, score);
}

describe('quick-score placeholders always match the score', () => {
  beforeEach(() => {
    useRoundStore.setState({ roundHistory: [] } as never);
    useRoundStore.getState().startRound('QS GC', card as never, {
      nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'qs',
    } as never);
  });

  it('a quick-score write keeps its own placeholders', () => {
    quickScore(1, 6);
    expect(placeholders(1)).toHaveLength(6);
  });

  it('correcting the score on another surface drops the stale placeholders', () => {
    quickScore(1, 6);
    useRoundStore.getState().logScore(1, 4); // voice / ± / strip / cockpit
    expect(useRoundStore.getState().scores[1]).toBe(4);
    expect(placeholders(1)).toHaveLength(0);
  });

  it('undoing a quick score drops its placeholders too', () => {
    quickScore(2, 5);
    useRoundStore.getState().undoLastMutation();
    expect(useRoundStore.getState().scores[2]).toBeUndefined();
    expect(placeholders(2)).toHaveLength(0);
  });

  it('the caddie stroke count never counts a placeholder', () => {
    useRoundStore.setState({ shots: [...qs(3, 5), { id: 'real-1', hole: 3, penalty_strokes: 0 }] } as never);
    expect(strokesPlayedOnHole(useRoundStore.getState(), 3)).toBe(1);
  });

  it('the instant recap lists real shots only', () => {
    const rec = synthesizeRecapFromRecord({
      id: 'r', courseId: 'c', courseName: 'C', mode: 'free_play', startedAt: 0, endedAt: 1, totalScore: 5,
      scores: { 1: 5 }, shots: [...qs(1, 5), { id: 'real-1', hole: 1 }],
    } as never);
    expect(rec.hole_comparisons[0].actual_shots.map((s) => s.id)).toEqual(['real-1']);
  });
});
