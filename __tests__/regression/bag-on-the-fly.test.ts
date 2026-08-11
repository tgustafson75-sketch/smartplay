/**
 * 2026-08-10 (Tim) — "You need to be able to change the bag ON THE FLY. I can't be, like, Arccos —
 * switch, I still two weeks later haven't had time to set up. But if I say I'm gonna use an eighteen
 * degree driving iron, DON'T ASK ME WHICH IRON. Add that, put it in the bag, and correlate distances."
 *
 * Nothing parsed a driving iron. Only WEDGE lofts (46-64°) were handled, so "18 degree driving iron"
 * fell through to null and the caddie asked which iron — the exact interrogation he's describing.
 * Swapping a club in mid-round has to cost one sentence, not a setup session.
 */
import { parseSpokenClub } from '../../services/clubRecognition';

describe("Tim's sentence must just work", () => {
  it('"eighteen degree driving iron" resolves without asking — nearest iron slot', () => {
    // Spoken numbers are normalized up front, so the word form must work too.
    const r = parseSpokenClub('eighteen degree driving iron');
    expect(r).not.toBeNull();
    expect(r!.club_id).toBe('3I');
    expect(r!.club_type).toBe('iron');
  });

  it('"18 degree driving iron" (digits) resolves the same', () => {
    expect(parseSpokenClub('18 degree driving iron')!.club_id).toBe('3I');
  });

  it('a driving iron with NO loft still resolves — never a dead end', () => {
    expect(parseSpokenClub('driving iron')!.club_id).toBe('3I');
    expect(parseSpokenClub('utility iron')!.club_id).toBe('3I');
  });
});

describe('loft maps to the right FAMILY, not just the right number', () => {
  it.each([
    ['20 degree iron', '3I'],
    ['23 degree iron', '4I'],
    ['26 degree iron', '5I'],
    ['29 degree iron', '6I'],
  ])('%s → %s', (phrase, id) => {
    expect(parseSpokenClub(phrase)!.club_id).toBe(id);
  });

  it('a HYBRID loft is not filed as an iron', () => {
    expect(parseSpokenClub('19 degree hybrid')!.club_id).toBe('3H');
    expect(parseSpokenClub('22 degree hybrid')!.club_id).toBe('4H');
    expect(parseSpokenClub('19 degree hybrid')!.club_type).toBe('hybrid');
  });

  it('a WOOD loft is not filed as an iron', () => {
    expect(parseSpokenClub('15 degree wood')!.club_id).toBe('3W');
    expect(parseSpokenClub('18 degree wood')!.club_id).toBe('5W');
    expect(parseSpokenClub('21 degree wood')!.club_type).toBe('wood');
  });
});

describe('no regressions on what already worked', () => {
  it.each([
    ['driver', 'DR'],
    ['7 iron', '7I'],
    ['seven iron', '7I'],
    ['3 wood', '3W'],
    ['4 hybrid', '4H'],
    ['pitching wedge', 'PW'],
    ['56 degree', 'SW'],
    ['60 degree', 'LW'],
  ])('%s → %s', (phrase, id) => {
    expect(parseSpokenClub(phrase)!.club_id).toBe(id);
  });

  it('a bare "wedge" is still ambiguous — the caddie should ask, not guess', () => {
    expect(parseSpokenClub('wedge')).toBeNull();
  });

  it('a bare long loft with no club word stays ambiguous rather than guessing a family', () => {
    // "18 degrees" alone could be a hybrid, a wood or a driving iron — asking is correct here.
    expect(parseSpokenClub('18 degrees')).toBeNull();
  });
});
