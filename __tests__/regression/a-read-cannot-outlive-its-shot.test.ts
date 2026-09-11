/**
 * 2026-09-10 — TWO PIECES OF CONTEXT THAT OUTLIVED WHAT THEY DESCRIBED.
 *
 * Both found by a store-wide orphan sweep: `roundStore.clearPendingLieAnalysis` was defined and
 * called by nothing, anywhere.
 *
 * 1. pendingLieAnalysis survived a hole change and is PERSISTED with no timestamp. Analyse a lie
 *    and then not log a shot — the common case, since the read is the point — and "ball sitting
 *    down in thick rough" was still in the caddie payload eight holes later, and got stamped onto
 *    whatever shot was eventually logged. It corrupted the live advice AND the shot record.
 *    setCurrentHole already expired the stated yardage and the pending club advice for exactly this
 *    reason; the lie read was simply left out of that list.
 *
 * 2. userStatedYardage's own contract says "until next shot logged OR next hole declared". Only the
 *    hole half was ever enforced. So "I'm 142" before an approach stayed the Tier 3 anchor, at
 *    confidence 'high' and beating live GPS, for the NEXT shot on the same hole — chip from 15
 *    yards, caddie still clubbing off 142. The 5-minute TTL is what made it read as intermittent.
 */
import { useRoundStore } from '../../store/roundStore';
import type { LieAnalysis } from '../../services/lieAnalysisService';
import type { ShotResult } from '../../store/roundStore';

const lie = { lie: 'thick rough', confidence: 0.9 } as unknown as LieAnalysis;

const holes = Array.from({ length: 18 }, (_, i) => ({
  hole: i + 1, par: 4, distance: 380, front: 370, back: 390,
  teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
  frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false,
}));

const shot = (hole: number): ShotResult => ({
  id: `s${hole}-${Math.random()}`,
  feel: null, direction: null, shape: null, club: '7I',
  hole, timestamp: Date.now(), acousticContact: null,
} as ShotResult);

describe('a read cannot outlive what it describes', () => {
  beforeEach(() => {
    useRoundStore.getState().startRound('Test GC', holes as never, {} as never);
  });
  afterEach(() => {
    try { useRoundStore.setState({ isRoundActive: false }); } catch { /* noop */ }
  });

  describe('the lie read expires with the hole', () => {
    it('is cleared when the player moves to the next hole', () => {
      const r = useRoundStore.getState();
      r.setPendingLieAnalysis(lie);
      expect(useRoundStore.getState().pendingLieAnalysis).not.toBeNull();

      useRoundStore.getState().setCurrentHole(2);
      expect(useRoundStore.getState().pendingLieAnalysis).toBeNull();
    });

    it('survives while the player is still ON that hole', () => {
      // The fix must not become "clear it constantly" — the read has to last long enough to be used.
      const r = useRoundStore.getState();
      r.setCurrentHole(5);
      r.setPendingLieAnalysis(lie);
      useRoundStore.getState().setCurrentHole(5); // same hole, e.g. a redundant set
      expect(useRoundStore.getState().pendingLieAnalysis).not.toBeNull();
    });

    it('cannot reach a shot logged on a LATER hole', () => {
      const r = useRoundStore.getState();
      r.setCurrentHole(4);
      r.setPendingLieAnalysis(lie);
      useRoundStore.getState().setCurrentHole(12);
      useRoundStore.getState().logShot(shot(12));
      const logged = useRoundStore.getState().shots.filter(s => s.hole === 12);
      expect(logged.length).toBe(1);
      expect(logged[0].lie_analysis ?? null).toBeNull();
    });
  });

  describe('a stated yardage is spent by the shot it was stated for', () => {
    it('is cleared once a shot is logged', () => {
      useRoundStore.setState({
        userStatedYardage: { value: 142, asOf: Date.now(), holeAtCapture: 1, source: 'voice' } as never,
      });
      expect(useRoundStore.getState().userStatedYardage).not.toBeNull();

      useRoundStore.getState().logShot(shot(1));
      expect(useRoundStore.getState().userStatedYardage).toBeNull();
    });

    it('still clears on a hole change, as it always did', () => {
      useRoundStore.setState({
        userStatedYardage: { value: 142, asOf: Date.now(), holeAtCapture: 1, source: 'voice' } as never,
      });
      useRoundStore.getState().setCurrentHole(2);
      expect(useRoundStore.getState().userStatedYardage).toBeNull();
    });
  });
});
