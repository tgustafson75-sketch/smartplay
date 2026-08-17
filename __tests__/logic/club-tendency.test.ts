/**
 * 2026-08-17 (Tim — "wire in the club tendencies… this driving iron, I got it from the thrift shop,
 * and the thing gets two hundred and fifteen yards and a baby fade every single time. And I'd like
 * to see that before even looking — in the bag tendency or something, or the club properties").
 *
 * Shape and direction existed per SHOT, and distance existed per CLUB, and nothing ever joined
 * them: services/patternDetection aggregates miss direction across the WHOLE BAG, so a hooked
 * driver and a pulled wedge pooled into one number and no individual club had a character.
 */
import {
  clubTendencies,
  describeClubTendency,
  describeBagTendencies,
  MIN_SHAPE_SHOTS,
  type TendencyShot,
} from '../../services/clubTendency';
import { normalizeClub } from '../../services/clubNormalize';

const idNorm = (c: string | null | undefined) => (c == null ? null : String(c).trim() || null);
const noCarry = () => null;
const rep = (n: number, s: TendencyShot): TendencyShot[] => Array(n).fill(0).map(() => ({ ...s }));

describe('a club gets a character of its own', () => {
  it('finds the thrift-shop driving iron: 215 yards and a fade', () => {
    const shots = [
      ...rep(8, { club: '3I', shape: 'fade', direction: 'right' }),
      { club: '3I', shape: 'straight', direction: 'straight' } as TendencyShot,
    ];
    const [t] = clubTendencies(shots, (c) => (c === '3I' ? 215 : null), idNorm);
    expect(t.club).toBe('3I');
    expect(t.shape).toBe('fade');
    expect(t.carryYds).toBe(215);
    expect(describeClubTendency(t)).toBe('3I — 215y carry, fade (8 of 9)');
  });

  it('keeps each club separate — a hooked driver does not make the wedge hook', () => {
    // This is the whole defect: bag-wide aggregation gave every club the same miss.
    const shots = [...rep(6, { club: 'Driver', shape: 'draw', direction: 'left' }),
                   ...rep(6, { club: 'SW', shape: 'fade', direction: 'right' })];
    const t = clubTendencies(shots, noCarry, idNorm);
    expect(t.find((x) => x.club === 'Driver')!.shape).toBe('draw');
    expect(t.find((x) => x.club === 'SW')!.shape).toBe('fade');
  });

  it('says nothing about a club it has barely seen', () => {
    const shots = rep(MIN_SHAPE_SHOTS - 1, { club: '7I', shape: 'draw', direction: 'left' });
    const [t] = clubTendencies(shots, noCarry, idNorm);
    expect(t.shape).toBeNull();
    expect(t.miss).toBeNull();
    // …and it contributes nothing to what the caddie reads.
    expect(describeBagTendencies([t])).toEqual([]);
  });

  it('says nothing when the club has no settled shape', () => {
    // Two fades, two draws, two straight: a real sample with no character. Claiming one would be
    // inventing a tendency the shots do not support.
    const shots = [...rep(2, { club: '5I', shape: 'fade' }), ...rep(2, { club: '5I', shape: 'draw' }),
                   ...rep(2, { club: '5I', shape: 'straight' })];
    const [t] = clubTendencies(shots, noCarry, idNorm);
    expect(t.shapeN).toBe(6);
    expect(t.shape).toBeNull();
  });

  it('collapses club vocabularies so one club is one row', () => {
    // Shots written as "8 iron" / "8I" / "8i" / "my 8 iron" must not split a club's evidence four
    // ways — the exact failure services/clubNormalize exists to prevent. Uses the REAL normalizer,
    // so this also pins that tendencies and the learned bag key on the same club identity.
    const shots = [...rep(2, { club: '8 iron', shape: 'fade' }), ...rep(2, { club: '8I', shape: 'fade' }),
                   ...rep(2, { club: '8i', shape: 'fade' }), ...rep(2, { club: 'my 8 iron', shape: 'fade' })];
    const t = clubTendencies(shots, noCarry, normalizeClub);
    expect(t).toHaveLength(1);
    expect(t[0].club).toBe('8I');
    expect(t[0].shapeN).toBe(8);
    expect(t[0].shape).toBe('fade');
  });

  it('a loft-named wedge lands on the same club as its canonical name', () => {
    // "fifty six" and "SW" are one club; before the 2026-08-17 vocabulary fix they were two rows,
    // and neither would have reached the evidence bar on its own.
    const shots = [...rep(3, { club: 'fifty six', shape: 'fade' }), ...rep(3, { club: 'SW', shape: 'fade' })];
    const t = clubTendencies(shots, noCarry, normalizeClub);
    expect(t).toHaveLength(1);
    expect(t[0].club).toBe('SW');
    expect(t[0].shape).toBe('fade');
  });

  it('drops shots whose club cannot be resolved rather than inventing a row', () => {
    const shots = [...rep(6, { club: 'wedge', shape: 'fade' })];
    expect(clubTendencies(shots, noCarry, () => null)).toEqual([]);
  });

  it('a miss side is a side — straight is not a miss', () => {
    const shots = rep(6, { club: 'PW', shape: 'straight', direction: 'straight' });
    const [t] = clubTendencies(shots, noCarry, idNorm);
    expect(t.missN).toBe(0);
    expect(t.miss).toBeNull();
  });

  it('reports nothing at all for a club with neither distance nor shape', () => {
    const [t] = clubTendencies(rep(2, { club: '4H' }), noCarry, idNorm);
    expect(describeClubTendency(t)).toBeNull();
  });

  it('leads with the clubs actually played', () => {
    const shots = [...rep(2, { club: 'LW' }), ...rep(9, { club: '7I' })];
    expect(clubTendencies(shots, noCarry, idNorm)[0].club).toBe('7I');
  });

  it('survives empty and malformed input', () => {
    expect(clubTendencies(null, noCarry, idNorm)).toEqual([]);
    expect(clubTendencies([], noCarry, idNorm)).toEqual([]);
    expect(clubTendencies([{}, { club: null }], noCarry, idNorm)).toEqual([]);
  });
});
