/**
 * 2026-09-11 (Tim) — "PLAYS LIKE FOR ME".
 *
 * "All I do right now is full swing and not good with dialing down yardages so I play according to
 * my yardages and feel."
 *
 * Every yardage app answers an in-between number with arithmetic: 138 to the pin, here is the club
 * closest to 138. That silently assumes the player can flight a shot to a yardage. For a full-swing
 * player 138 is not a club — it is two full swings, one six short and one six long — and which is
 * right depends on what the green and the trouble forgive.
 *
 * The rules this pins:
 *   - it only fires for a player who SAID they swing full, and only in a real gap;
 *   - it never moves a player who can dial down;
 *   - with no green geometry it NAMES the gap and keeps the nearest club rather than inventing a
 *     reason to move off it.
 */
import { composeShotRead } from '../../services/cnsShotRead';

/** A bag with a deliberate hole between 128 and 140. */
const bag = { 'PW': 128, '9I': 140, '8I': 152, '7I': 163 };
const at = (yards: number, extra: Record<string, unknown> = {}) =>
  composeShotRead({ rawYards: yards, weather: null, shotBearingDeg: null, bag, ...extra });

describe('an in-between yardage is a choice, not a dial', () => {
  it('a dial-down player still gets the nearest club, untouched', () => {
    const r = at(134, { distanceControl: 'dial_down', greenFrontYards: 126, greenBackYards: 150 });
    expect(r?.why.some(w => /no full swing/.test(w))).toBe(false);
  });

  it('the default player is unchanged — nobody moves until they answer', () => {
    const r = at(134, { greenFrontYards: 126, greenBackYards: 150 });
    expect(r?.why.some(w => /no full swing/.test(w))).toBe(false);
  });

  it('does not fire when a club actually fits the number', () => {
    const r = at(140, { distanceControl: 'full_swings', greenFrontYards: 130, greenBackYards: 156 });
    expect(r?.club).toBe('9 Iron');
    expect(r?.why.some(w => /no full swing/.test(w))).toBe(false);
  });

  it('takes the longer club when the green has room behind', () => {
    // 134: PW is 6 short, 9I is 6 long. 22 yards of green behind forgives the 9.
    const r = at(134, { distanceControl: 'full_swings', greenFrontYards: 126, greenBackYards: 156 });
    expect(r?.club).toBe('9 Iron');
    expect(r?.why[0]).toMatch(/no full swing at 134 — 9 iron \(140\), \d+y of green behind it/);
  });

  it('takes the shorter club when long is over the green', () => {
    // Same gap, but only 2 yards behind the pin — the 9 flies it.
    const r = at(134, { distanceControl: 'full_swings', greenFrontYards: 128, greenBackYards: 136 });
    expect(r?.club).toBe('PW');
    expect(r?.why[0]).toMatch(/long is over the green/);
  });

  it('takes the longer club to carry trouble short', () => {
    const r = at(134, {
      distanceControl: 'full_swings',
      nearestHazard: { label: 'bunker', yards: 126 },
    });
    expect(r?.club).toBe('9 Iron');
    expect(r?.why[0]).toMatch(/bunker short/);
  });

  it('with no geometry it names the gap and does NOT invent a reason to move', () => {
    const r = at(134, { distanceControl: 'full_swings' });
    expect(r?.why[0]).toMatch(/no full swing at 134 — .* is your closest/);
    // whichever club was nearest is still the answer
    expect(['PW', '9 Iron']).toContain(r?.club);
  });
});
