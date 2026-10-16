/**
 * 2026-10-15 (review #9) — Refresh GPS near the 10th tee after a FRONT NINE snapped to hole 10, and
 * setCurrentHole read that as "kept playing" and expanded the round to eighteen. reconcileCurrentHole
 * scanned every course hole and ignored the round's own range. Driven through the real reconcile and
 * the real store.
 */
const mockTees: Record<number, { lat: number; lng: number }> = {};
for (let h = 1; h <= 18; h++) mockTees[h] = { lat: 33.7 + h * 0.004, lng: -116.97 };
jest.mock('../../services/holeDetection', () => ({
  teeForHole: (_c: string, h: number) => mockTees[h] ?? null,
  greenForHole: () => null,
}));
jest.mock('../../services/courseGeometryService', () => {
  const actual = jest.requireActual('../../services/courseGeometryService');
  return { ...actual, getHoleGeometry: () => null };
});
jest.mock('../../services/courseDataOrchestrator', () => ({ getSustainedHeading: () => null, pushSustainedFix: () => undefined }));

import { reconcileCurrentHole } from '../../services/holeReconciliation';
import { useRoundStore } from '../../store/roundStore';

const holes = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));
const fixAtTee = (h: number) => ({ ...mockTees[h], accuracy_m: 4, speed: 0, timestamp: Date.now(), source: 'live' as const });

function round(over: Record<string, unknown>) {
  useRoundStore.setState({
    isRoundActive: true, activeCourseId: 'unbundled-course', courseHoles: holes,
    twiceAround: false, scores: {}, ...over,
  } as never);
}

describe('a "where am I?" tap cannot leave the round', () => {
  it('THE BUG: front nine finished, standing on the 10th tee — stays on 9, still a nine-hole round', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 8; h++) scores[h] = 4;
    round({ nineHoleMode: true, roundStartHole: 1, currentHole: 9, scores });
    const r = reconcileCurrentHole(fixAtTee(10) as never, true);
    expect(r.applied).toBe(false);
    expect(useRoundStore.getState().currentHole).toBe(9);
    expect(useRoundStore.getState().nineHoleMode).toBe(true);
  });

  it('inside the round it still snaps forward', () => {
    round({ nineHoleMode: true, roundStartHole: 1, currentHole: 3, scores: { 1: 4, 2: 5 } });
    const r = reconcileCurrentHole(fixAtTee(6) as never, true);
    expect(r.applied).toBe(true);
    expect(useRoundStore.getState().currentHole).toBe(6);
  });

  it('a full round is unchanged — the 10th is in range', () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 8; h++) scores[h] = 4;
    round({ nineHoleMode: false, roundStartHole: 1, currentHole: 9, scores });
    const r = reconcileCurrentHole(fixAtTee(10) as never, true);
    expect(r.applied).toBe(true);
    expect(useRoundStore.getState().currentHole).toBe(10);
  });
});
