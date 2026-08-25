/**
 * 2026-08-25 — Focus Session must rotate clubs the player actually carries. It hardcoded
 * ['7I','9I','5I','8I'] and rendered it verbatim, so a player with a hybrid instead of a 5 iron was
 * told to hit a club they do not own.
 */
import { focusClubsForBag } from '../../services/practice/sessionPlan';

describe('focus clubs reconcile to the real bag', () => {
  it('leaves the template alone when no bag is registered', () => {
    expect(focusClubsForBag(['7I', '9I', '5I', '8I'], [])).toEqual(['7I', '9I', '5I', '8I']);
  });

  it('keeps clubs the player carries', () => {
    const bag = ['7I', '9I', '5I', '8I', 'PW'];
    expect(focusClubsForBag(['7I', '9I', '5I', '8I'], bag)).toEqual(['7I', '9I', '5I', '8I']);
  });

  it('snaps a long iron to the hybrid the player actually carries', () => {
    // The common real bag: no 5 iron, a 5 hybrid instead.
    const bag = ['7I', '9I', '5H', '8I', 'PW'];
    const out = focusClubsForBag(['7I', '9I', '5I', '8I'], bag);
    expect(out).toContain('5H');
    expect(out).not.toContain('5I');
  });

  it('never rotates a club against itself', () => {
    // A sparse bag can snap two template clubs onto the same owned club.
    const out = focusClubsForBag(['5I', '6I'], ['7I', 'PW']);
    expect(new Set(out).size).toBe(out.length);
  });

  it('always returns something usable', () => {
    expect(focusClubsForBag(['PW', 'GW', 'SW'], ['PW']).length).toBeGreaterThan(0);
  });
});
