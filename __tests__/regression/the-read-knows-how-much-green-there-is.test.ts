/**
 * 2026-09-11 (Tim — "plays like factors really need that info") — THE READ KNOWS THE ROOM, NOT JUST
 * THE NUMBER.
 *
 * composeShotRead answered "158, hit 7 iron" with no idea whether there were fourteen yards of green
 * behind the pin or three and a bunker. SmartFinder had computed front and back yardages since it
 * was written and DISPLAYED them on the same screen — it simply never told the read.
 *
 * Depth is what makes a yardage a decision. It is stated as a fact the player can act on, never as
 * an instruction: the club pick is deliberately unchanged by it.
 *
 * Guarded hard against inventing room that is not there, because a bad geometry read is the normal
 * failure here and "22y behind the pin" spoken over a green that is actually 9 deep is worse than
 * silence. [[illustration-data-points]]
 */
import { composeShotRead } from '../../services/cnsShotRead';

const base = {
  rawYards: 150,
  weather: null,
  shotBearingDeg: null,
  bag: { '7I': 150, '8I': 140, '6I': 160 },
};

describe('the read knows how much green there is', () => {
  it('says nothing at all when there is no green geometry', () => {
    expect(composeShotRead({ ...base })?.greenRoomNote).toBeNull();
  });

  it('reports real depth behind the pin', () => {
    const r = composeShotRead({ ...base, greenFrontYards: 142, greenBackYards: 168 });
    expect(r?.greenRoomNote).toMatch(/18y of green behind the pin/);
  });

  it('warns when the pin is cut at the back', () => {
    const r = composeShotRead({ ...base, greenFrontYards: 140, greenBackYards: 152 });
    expect(r?.greenRoomNote).toMatch(/only 2y behind the pin — miss short/);
  });

  it('warns when the front edge is right there', () => {
    const r = composeShotRead({ ...base, greenFrontYards: 147, greenBackYards: 175 });
    expect(r?.greenRoomNote).toMatch(/don't come up light/);
  });

  it('REFUSES a back-before-front reading rather than inventing depth', () => {
    const r = composeShotRead({ ...base, greenFrontYards: 170, greenBackYards: 140 });
    expect(r?.greenRoomNote).toBeNull();
  });

  it('REFUSES an implausible green — 300 yards deep is a geometry failure, not a green', () => {
    const r = composeShotRead({ ...base, greenFrontYards: 100, greenBackYards: 400 });
    expect(r?.greenRoomNote).toBeNull();
  });

  it('REFUSES a green too shallow to be real', () => {
    const r = composeShotRead({ ...base, greenFrontYards: 149, greenBackYards: 151 });
    expect(r?.greenRoomNote).toBeNull();
  });

  it('does not change the club — room is information, not an instruction', () => {
    const without = composeShotRead({ ...base });
    const with_ = composeShotRead({ ...base, greenFrontYards: 142, greenBackYards: 168 });
    expect(with_?.club).toBe(without?.club);
    expect(with_?.playsLikeYards).toBe(without?.playsLikeYards);
  });
});
