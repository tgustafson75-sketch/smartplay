/**
 * 2026-08-12 (Tim) — "Make sure SmartMotion planned distance also correlates to the player's bag
 * and/or verified/played distances."
 *
 * It didn't. The app carried THREE independent standard-yardage tables, and they disagreed:
 *
 *                        clubStatsStore   cnsShotRead    equipment_intelligence
 *   Driver                    245             250                 230
 *   7 iron                    148             155                 150
 *   GW                         98             100                  95
 *
 * and SmartMotion then scaled the third by a handicap factor (0.86 at 18). So a player with no
 * logged data was told by the caddie that his driver goes 250, and by the swing card that the swing
 * he just hit carried 198. Same club, same player, same session, 52 yards apart — with no single
 * line of code being wrong, which is exactly why it survived this long.
 *
 * services/standardBag.ts is now the one table. A learned/verified player distance still overrides
 * it club by club — that's the point of measuring — but the DEFAULT is shared.
 */
import { STANDARD_CARRY_YARDS, STANDARD_LADDER, standardCarryFor } from '../../services/standardBag';
import { fullCarryYards } from '../../services/swing/carryEstimate';

describe('one bag, quoted by every surface', () => {
  const CLUBS = ['Driver', '3W', '5W', '4H', '5I', '6I', '7I', '8I', '9I', 'PW', 'GW', 'SW', 'LW'] as const;

  it.each(CLUBS)("SmartMotion's default carry for %s IS the standard bag number", club => {
    // No learned distance → must be the shared default, unscaled. The handicap scaling that used to
    // live here is what made this surface disagree with the caddie the player is listening to.
    expect(fullCarryYards(club as never, 18)).toBe(STANDARD_CARRY_YARDS[club]);
  });

  it('handicap no longer silently shrinks the default', () => {
    // A 30-handicap and a scratch player are quoted the same DEFAULT; personalisation comes from
    // real measured carries, not from a guess applied to one surface and not the others.
    for (const club of CLUBS) {
      expect(fullCarryYards(club as never, 30)).toBe(fullCarryYards(club as never, 0));
    }
  });

  it('a learned/verified carry still wins over the default', () => {
    expect(fullCarryYards('7I' as never, 18, 171)).toBe(171);
    expect(fullCarryYards('DR' as never, 18, 212)).toBe(212);
  });

  it('the spoken ladder is derived from the same table, not hand-copied', () => {
    for (const [, yards] of STANDARD_LADDER) {
      expect(Object.values(STANDARD_CARRY_YARDS)).toContain(yards);
    }
  });

  it('the ladder is strictly descending — no club sits below a shorter one', () => {
    const ys = STANDARD_LADDER.map(([, y]) => y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
  });

  it('never lists the same spoken club twice', () => {
    // The hybrids all collapse to "Hybrid". A hand-listed ladder is how '7I' 165 once sat beside
    // '7 Iron' 155 in one ladder, skewing the bag extremes and letting the caddie speak a store key.
    const labels = STANDARD_LADDER.map(([l]) => l);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('speaks readable labels, never store keys', () => {
    for (const [label] of STANDARD_LADDER) expect(label).not.toMatch(/^\d[IHW]$/);
  });

  it('has no opinion about a putter or an unknown club', () => {
    expect(standardCarryFor('Putter')).toBeNull();
    expect(standardCarryFor('not-a-club')).toBeNull();
    expect(standardCarryFor(null)).toBeNull();
    expect(fullCarryYards('PT' as never, 18)).toBeNull();
  });
});

describe('the private copies are gone', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

  it('clubStatsStore reads the shared table instead of declaring its own', () => {
    const src = read('store/clubStatsStore.ts');
    expect(src).toContain('const STANDARD_YARDS: Record<ClubName, number> = STANDARD_CARRY_YARDS;');
    expect(src).toContain("from '../services/standardBag'");
  });

  it('the caddie ladder is derived, not re-listed', () => {
    const src = read('services/cnsShotRead.ts');
    expect(src).toContain('const STANDARD_LADDER = SHARED_LADDER;');
    // The old hand-listed values must not linger — a stale copy is how they drifted apart.
    expect(src).not.toContain("['Driver', 250]");
  });

  it('SmartMotion no longer applies its own handicap scaling', () => {
    const src = read('services/swing/carryEstimate.ts');
    expect(src).toContain("from '../standardBag'");
    expect(src).not.toContain('handicapFactor');
  });
});
