/**
 * 2026-09-11 (Tim) — "Course engine could have a chip that you could auto spool your bag for that
 * course." And: "what should I bring for this course?"
 *
 * services/bagRecommendation answers the backward-looking half — which clubs did the work at a
 * course you have PLAYED — and its own header calls the forward-looking half "NOT built here".
 * This is that half, and it is the one that matters, because at a course you have played you can
 * just remember.
 *
 * It is also what makes the Sunday bag real: "you're gonna have a three-club bag on a par-three
 * nine-hole course." A packer reasoning from the actual card arrives there on its own.
 */
import { packBagForCourse, demandYardages, type PackClub, type PackHole } from '../../services/bagPack';

const FULL: PackClub[] = [
  { club: 'Driver', yards: 250 }, { club: '3W', yards: 225 }, { club: '5W', yards: 210 },
  { club: '4H', yards: 195 }, { club: '5I', yards: 180 }, { club: '6I', yards: 168 },
  { club: '7I', yards: 155 }, { club: '8I', yards: 142 }, { club: '9I', yards: 128 },
  { club: 'PW', yards: 115 }, { club: 'GW', yards: 100 }, { club: 'SW', yards: 85 },
  { club: 'LW', yards: 68 }, { club: '2I', yards: 200 }, { club: '7W', yards: 190 },
  { club: '58 Wedge', yards: 78 }, { club: 'Putter', yards: 0 },
];

const par72: PackHole[] = [
  { par: 4, yards: 400 }, { par: 4, yards: 380 }, { par: 3, yards: 165 }, { par: 5, yards: 520 },
  { par: 4, yards: 420 }, { par: 4, yards: 350 }, { par: 3, yards: 195 }, { par: 5, yards: 495 },
  { par: 4, yards: 410 }, { par: 4, yards: 395 }, { par: 4, yards: 365 }, { par: 3, yards: 140 },
  { par: 5, yards: 540 }, { par: 4, yards: 430 }, { par: 4, yards: 375 }, { par: 3, yards: 180 },
  { par: 4, yards: 405 }, { par: 5, yards: 510 },
];

/** Nine holes, nothing longer than a 7 iron. The case the whole feature was asked for. */
const par3Nine: PackHole[] = [
  { par: 3, yards: 120 }, { par: 3, yards: 145 }, { par: 3, yards: 95 }, { par: 3, yards: 160 },
  { par: 3, yards: 110 }, { par: 3, yards: 135 }, { par: 3, yards: 80 }, { par: 3, yards: 150 },
  { par: 3, yards: 125 },
];

describe('the putter is not negotiable', () => {
  it('goes in on every course', () => {
    expect(packBagForCourse({ holes: par72, owned: FULL }).carry).toContain('Putter');
    expect(packBagForCourse({ holes: par3Nine, owned: FULL }).carry).toContain('Putter');
    expect(packBagForCourse({ holes: [], owned: FULL }).carry).toContain('Putter');
  });

  it('survives the competition trim — losing it to an arbitrary slice would be the worst possible call', () => {
    const p = packBagForCourse({ holes: par72, owned: FULL, limit: 14 });
    expect(p.carry).toContain('Putter');
    expect(p.carry.length).toBeLessThanOrEqual(14);
  });
});

describe('a par-3 nine packs a Sunday bag, because that is what the card asks for', () => {
  const p = packBagForCourse({ holes: par3Nine, owned: FULL, courseName: 'Par 3 at the Park' });

  it('does not send a man out with seventeen clubs to hit nine wedges', () => {
    expect(p.carry.length).toBeLessThanOrEqual(8);
    expect(p.carry.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves the driver and the woods at home', () => {
    expect(p.carry).not.toContain('Driver');
    expect(p.carry).not.toContain('3W');
    expect(p.leave).toContain('Driver');
  });

  it('says WHY, naming the clubs nothing on the card asks for', () => {
    expect(p.reasons.join(' ')).toContain('Nothing on this card asks for');
    expect(p.reasons.join(' ')).toContain('Driver');
  });

  it('reads the card in the headline rather than asserting a category', () => {
    expect(p.holesRead).toBe(9);
    expect(p.headline).toContain('9 holes');
    expect(p.headline).toContain('Par 3 at the Park');
  });
});

describe('a full par 72 packs a full bag', () => {
  const p = packBagForCourse({ holes: par72, owned: FULL });

  it('takes the driver', () => {
    expect(p.carry).toContain('Driver');
  });

  it('takes wedges — a course of long par 4s must not pack four woods and nothing to chip with', () => {
    expect(p.carry.some((c) => c === 'SW' || c === 'LW' || c === '58 Wedge')).toBe(true);
  });

  it('is ordered long to short with the putter last, the way a bag is actually read', () => {
    expect(p.carry[p.carry.length - 1]).toBe('Putter');
    const yards = p.carry.slice(0, -1).map((c) => FULL.find((f) => f.club === c)!.yards);
    expect([...yards].sort((a, b) => b - a)).toEqual(yards);
  });

  it('leaves no club-and-a-half hole inside what it packed', () => {
    const yards = p.carry.slice(0, -1).map((c) => FULL.find((f) => f.club === c)!.yards);
    for (let i = 0; i < yards.length - 1; i++) expect(yards[i] - yards[i + 1]).toBeLessThanOrEqual(25);
  });
});

describe('the USGA cap', () => {
  it('cites the rule and the cost, not just the number', () => {
    const p = packBagForCourse({ holes: par72, owned: FULL, limit: 14 });
    const why = p.reasons.join(' ');
    if (p.limitBit) {
      expect(why).toContain('USGA Rule 4.1b(1)');
      expect(why).toContain('two strokes per hole');
    }
    expect(p.carry.length).toBeLessThanOrEqual(14);
  });

  it('does not claim a trim it did not make', () => {
    // Nine par 3s need nowhere near fourteen clubs, so the cap is present and idle.
    const p = packBagForCourse({ holes: par3Nine, owned: FULL, limit: 14 });
    expect(p.limit).toBe(14);
    expect(p.limitBit).toBe(false);
    expect(p.reasons.join(' ')).not.toContain('USGA');
  });
});

describe('what it refuses to pretend', () => {
  it('with no hole data it says so instead of inventing a course read', () => {
    const p = packBagForCourse({ holes: [], owned: FULL });
    expect(p.holesRead).toBe(0);
    expect(p.reasons.join(' ')).toContain('No hole yardages');
    expect(p.headline).toContain('full bag');
  });

  it('with no carries set it packs nothing and points at the ladder', () => {
    const p = packBagForCourse({ holes: par72, owned: [{ club: 'Putter', yards: 0 }, { club: '7I', yards: 0 }] });
    expect(p.carry).toEqual(['Putter']);
    expect(p.headline).toContain('Not enough bag data');
  });

  it('names a club it could not place rather than silently dropping it', () => {
    const p = packBagForCourse({ holes: par72, owned: [...FULL, { club: '4W', yards: 0 }] });
    expect(p.reasons.join(' ')).toContain('No carry set for 4W');
  });

  it('never invents a club he does not own', () => {
    const p = packBagForCourse({ holes: par72, owned: FULL });
    for (const c of p.carry) expect(FULL.map((f) => f.club)).toContain(c);
  });
});

describe('a club he has never swung is the last one packed', () => {
  it('loses a tie to one he uses', () => {
    const twins: PackClub[] = [
      { club: 'Putter', yards: 0 },
      { club: 'NeverHit', yards: 155, everUsed: false },
      { club: 'Trusted', yards: 155, everUsed: true, strong: true },
      { club: 'Driver', yards: 250 }, { club: '5I', yards: 180 }, { club: 'SW', yards: 85 },
      { club: 'PW', yards: 115 }, { club: 'GW', yards: 100 }, { club: '8I', yards: 142 },
      { club: '6I', yards: 168 }, { club: '3W', yards: 225 }, { club: '4H', yards: 195 },
      { club: '9I', yards: 128 }, { club: 'LW', yards: 68 }, { club: '2I', yards: 210 },
    ];
    const p = packBagForCourse({ holes: par72, owned: twins, limit: 14 });
    expect(p.carry).toContain('Trusted');
    expect(p.carry).not.toContain('NeverHit');
  });

  it('still packs a club that needs work when the course asks for it, and says to play it carefully', () => {
    const owned = FULL.map((c) => (c.club === '7I' ? { ...c, needsWork: true } : c));
    const p = packBagForCourse({ holes: par72, owned });
    expect(p.carry).toContain('7I');
    expect(p.reasons.join(' ')).toContain('conservatively');
  });
});

describe('the demand read', () => {
  it('a par 3 asks for the number on the card, once', () => {
    expect(demandYardages([{ par: 3, yards: 165 }], 250)).toEqual([165]);
  });

  it('a par 5 asks for a tee ball, a long second and an approach', () => {
    expect(demandYardages([{ par: 5, yards: 540 }], 250)).toEqual([250, 250, 40]);
  });

  it('a par 4 asks for a tee ball and what is left', () => {
    expect(demandYardages([{ par: 4, yards: 400 }], 250)).toEqual([250, 150]);
  });

  it('does not invent a shot for the last few yards', () => {
    // 520 off two 250s leaves 20 — a chip, not a club decision. Counting it would have the packer
    // arguing for a wedge on the evidence of a yardage nobody hits a full shot from.
    expect(demandYardages([{ par: 5, yards: 520 }], 250)).toEqual([250, 250]);
  });

  it('skips a hole with no yardage rather than guessing at it', () => {
    expect(demandYardages([{ par: 4, yards: 0 }, { par: 0, yards: 400 }], 250)).toEqual([]);
  });
});
