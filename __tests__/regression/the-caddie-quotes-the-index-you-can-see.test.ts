/**
 * 2026-09-11 (Tim) — THE CADDIE QUOTED AN INDEX THE DASHBOARD DID NOT SHOW.
 *
 * `explainHandicapImpact` receives `currentIndex` — the player's stored index, passed by its only
 * caller from the profile — and never read it. The reply quoted `before.newIndex`, an index
 * recomputed inside this module from recent differentials.
 *
 * Those are different numbers. A WHS index from a federation, or one the player typed in, is not
 * our best-8-of-20 estimate. So the caddie could answer "currently 12.4" while every other surface
 * in the app said 14.2 — one fact, two owners, and the player sees both.
 *
 * Tim's call: anchor on the real index, and use the estimate only for the MOVEMENT, because the
 * movement is the one thing only our model can predict.
 */
import { explainHandicapImpact } from '../../services/handicapCalculator';

/** Enough differentials for the module to produce an estimate at all. */
const RECENT = [14.2, 15.1, 13.8, 16.0, 12.9, 15.5, 14.7, 13.2];

describe('the caddie quotes the index you can see', () => {
  it('uses the stored index as the current number, not its own estimate', () => {
    const text = explainHandicapImpact({
      newDifferential: 30, currentIndex: 22.7, recentDifferentials: RECENT,
    });
    expect(text).toContain('22.7');
    expect(text).toMatch(/your Index\b/);
    expect(text).not.toMatch(/Index estimate/);
  });

  it('still says "estimate" — and quotes its own number — when the player has no index', () => {
    const text = explainHandicapImpact({
      newDifferential: 30, currentIndex: null, recentDifferentials: RECENT,
    });
    expect(text).toMatch(/Index estimate/);
    expect(text).not.toContain('22.7');
  });

  it('applies the estimated MOVEMENT to the real index, so the arithmetic holds', () => {
    // A very low differential must pull the index down from the anchor, not jump to the estimate.
    const text = explainHandicapImpact({
      newDifferential: 2, currentIndex: 22.7, recentDifferentials: RECENT,
    });
    const m = text.match(/from (\d+\.?\d*) to (\d+\.?\d*)/);
    expect(m).not.toBeNull();
    const [, from, to] = m!;
    expect(Number(from)).toBe(22.7);          // anchored on what the player sees
    expect(Number(to)).toBeLessThan(22.7);    // a 2.0 differential can only help
  });

  it('does not fabricate movement when the round misses the best 8', () => {
    const text = explainHandicapImpact({
      newDifferential: 40, currentIndex: 10.0, recentDifferentials: RECENT,
    });
    expect(text).toContain('currently 10');
    expect(text).toContain("wasn't one of your best 8");
  });
});
