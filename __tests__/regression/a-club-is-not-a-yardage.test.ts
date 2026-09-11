/**
 * 2026-09-11 — THREE CLUBS THAT GO THE SAME NUMBER WERE ONE CLUB TO THE PICKER.
 *
 * Tim: "I carry a 5 wood, a 5 iron, and a 5 hybrid. They all have different purpose. If Caddie knows
 * I am not on the fairway and likely not a great lie, don't suggest the wood based on distance. The
 * iron is better to get out, but user and caddie can consider if the lie allows better for the
 * hybrid based on the goal and layout."
 *
 * cnsShotRead.pickClub had ZERO references to lie, rough, sand or location. Plays-like, risk, green
 * room and the distance-control gap were all real and none of them knew that a fairway wood out of
 * deep rough is the wrong tool at any yardage.
 *
 * ─── AND THE FALSE SIGNAL ──────────────────────────────────────────────────────────────────────
 *
 * roundStore.currentLocationType looks like the answer and is not: its fairway branch is a DEFAULT
 * ("not within tee radius, not within green radius"), so deep rough, a bunker and the trees all
 * report 'fairway'. Reading that as a good lie would green-light the wood in exactly the situation
 * Tim describes, in the MAJORITY case. Only a real signal sets a lie here.
 *
 * ─── SO THE CADDIE ASKS ────────────────────────────────────────────────────────────────────────
 *
 * Tim: "Caddie can offer — we could go with an iron here to get out, or if you feel we have a good
 * lie, let's go with hybrid. That way no computer vision is needed. Could offer user to open
 * TightLie for a full analysis." The player standing over the ball knows the lie better than any
 * sensor, and answering costs one word.
 */
import {
  clubClassOf, playabilityFromLie, lieFromWords, loftDegrees,
  offerFromUnknownLie, describeLieChoice, POOR_FROM_LIE,
} from '../../services/clubCharacter';
import { composeShotRead } from '../../services/cnsShotRead';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Tim's actual bag problem: three clubs, one number. */
const BAG = { Driver: 230, '5W': 185, '5H': 180, '5I': 175, '7I': 150, '9I': 125, SW: 80 };

describe('a club has a class before it has a number', () => {
  it.each([
    ['Driver', 'driver'], ['5W', 'wood'], ['3W', 'wood'], ['5H', 'hybrid'], ['4H', 'hybrid'],
    ['5I', 'iron'], ['PW', 'wedge'], ['SW', 'wedge'], ['Putter', 'putter'],
  ])('%s is a %s', (club, klass) => {
    expect(clubClassOf(club)).toBe(klass);
  });

  it('reads the free text a bag scan or the player typed', () => {
    expect(clubClassOf('5 wood')).toBe('wood');
    expect(clubClassOf('5 hybrid')).toBe('hybrid');
    expect(clubClassOf('rescue')).toBe('hybrid');
    expect(clubClassOf('sand wedge')).toBe('wedge');
  });
});

describe('an unknown lie makes NO claim', () => {
  /**
   * The single most important rule in this file. Absent evidence is not evidence of a bad lie, and
   * penalising the wood on a default would be exactly the fabrication the app refuses.
   */
  it('playability is null, not zero and not one', () => {
    expect(playabilityFromLie('5W', 'unknown')).toBeNull();
    expect(playabilityFromLie('5I', 'unknown')).toBeNull();
  });

  it('the picker is untouched when the lie is unknown', () => {
    const withLie = composeShotRead({ rawYards: 182, weather: null, shotBearingDeg: null, bag: BAG, lie: 'unknown' });
    const without = composeShotRead({ rawYards: 182, weather: null, shotBearingDeg: null, bag: BAG });
    expect(withLie!.club).toBe(without!.club);
  });

  it("'fairway' from currentLocationType is never treated as a measured lie", () => {
    /**
     * It is a DEFAULT branch in roundStore: tee is a radius check, green is a radius check, and
     * FAIRWAY is what is left — so rough, sand and the trees all report 'fairway'.
     *
     * Asserted structurally, on comment-stripped source. My first version matched the words
     * "Default fairway", which is a COMMENT — the exact way a guard passes while proving nothing.
     * [[my-own-comment-defeats-my-own-guard]]
     */
    const live = code('services/shotReadLive.ts');
    expect(live).not.toMatch(/currentLocationType/);

    const rs = code('store/roundStore.ts');
    const at = rs.indexOf("set({ currentLocationType: 'fairway', currentTeeBox: null });");
    expect(at).toBeGreaterThan(-1);
    // Nothing measures anything between the green check returning and this assignment: it is the
    // fallthrough. If a real fairway-polygon test is ever added, this fails and should be rewritten.
    const between = rs.slice(rs.indexOf("currentLocationType: 'green'"), at);
    expect(between).not.toMatch(/haversineYards|polygon|insideFairway/);
  });
});

describe('the lie orders the clubs — Tim\'s 5W / 5H / 5I', () => {
  it('a wood is the wrong tool from deep rough, an iron is right', () => {
    expect(playabilityFromLie('5W', 'heavy_rough')!).toBeLessThan(POOR_FROM_LIE);
    expect(playabilityFromLie('5I', 'heavy_rough')!).toBeGreaterThan(POOR_FROM_LIE);
  });

  it('the hybrid sits between them, which is the whole point of carrying it', () => {
    const wood = playabilityFromLie('5W', 'light_rough')!;
    const hyb = playabilityFromLie('5H', 'light_rough')!;
    const iron = playabilityFromLie('5I', 'light_rough')!;
    expect(hyb).toBeGreaterThan(wood);
    expect(iron).toBeGreaterThanOrEqual(hyb);
  });

  it('from sand a wedge wins however far it is', () => {
    expect(playabilityFromLie('SW', 'sand')).toBe(1);
    expect(playabilityFromLie('5W', 'sand')!).toBeLessThan(POOR_FROM_LIE);
  });

  it('THE SHOT: 182 out of heavy rough does not come back a 5 wood', () => {
    const read = composeShotRead({
      rawYards: 184, weather: null, shotBearingDeg: null, bag: BAG, lie: 'heavy_rough',
    })!;
    expect(clubClassOf(read.club)).not.toBe('wood');
    expect(read.why.join(' ')).toMatch(/rough/i);
  });

  /**
   * NOTE — the picker speaks the LADDER'S LABELS ('5 Wood', 'Hybrid'), not the bag's ClubName keys
   * ('5W', '5H'). My first draft of these tests asserted on bag keys and passed vacuously, which is
   * the same two-vocabulary trap that made the lie OFFER silently never fire. Assert on class and on
   * the spoken label.
   */
  it('the same shot off a tee keeps the wood', () => {
    const read = composeShotRead({
      rawYards: 184, weather: null, shotBearingDeg: null, bag: BAG, lie: 'tee',
    })!;
    expect(clubClassOf(read.club)).toBe('wood');
  });

  it('never swaps to something wildly short just to be playable', () => {
    const tee = composeShotRead({ rawYards: 182, weather: null, shotBearingDeg: null, bag: BAG, lie: 'tee' })!;
    const rough = composeShotRead({ rawYards: 182, weather: null, shotBearingDeg: null, bag: BAG, lie: 'heavy_rough' })!;
    // The swap changes the CLASS, never drops a distance band.
    expect(clubClassOf(tee.club)).not.toBe(clubClassOf(rough.club));
    expect(rough.why.join(' ')).toMatch(/rough/i);
  });

  it('says WHY in the language a caddie uses, not a score', () => {
    const line = describeLieChoice('5I', '5W', 'heavy_rough')!;
    expect(line).toMatch(/get it out/i);
    expect(line).not.toMatch(/0\.\d|playability|score/i);
  });

  it('and leaves the hybrid as a live question rather than a forbidden club', () => {
    const line = describeLieChoice('5I', '5H', 'light_rough')!;
    expect(line).toMatch(/if the lie is better than it looks/i);
    expect(line).toMatch(/rough/i);   // a caddie says WHERE you are, not just what to take
  });
});

describe('the lie comes from signals that already exist', () => {
  it('from what the player said', () => {
    expect(lieFromWords("I'm in the rough sitting down")).toBe('heavy_rough');
    expect(lieFromWords('ball is in the bunker')).toBe('sand');
    expect(lieFromWords('bare lie, no grass under it')).toBe('hardpan');
    expect(lieFromWords('middle of the fairway')).toBe('fairway');
    expect(lieFromWords('what should I hit')).toBe('unknown');
  });

  it('and nothing invents a lie from a signal that arrives too late', () => {
    // A lieFromTurf helper was written and deleted: the acoustics turf read happens AFTER the
    // strike, so it cannot inform the club for that shot. The orphan guard refused it.
    expect(code('services/clubCharacter.ts')).not.toMatch(/export function lieFromTurf/);
  });

  it('and TightLie is TIED IN rather than rebuilt — it already did this job', () => {
    const live = code('services/shotReadLive.ts');
    expect(live).toMatch(/pendingLieAnalysis/);
    expect(live).toMatch(/lieFromWords\(/);
    // askGolfFatherHandler's header had said "pendingLieAnalysis exists; not wired" the whole time
    expect(code('app/lie-analysis.tsx')).toMatch(/setPendingLieAnalysis\(/);
  });
});

describe('when we do not know, the caddie asks', () => {
  it('offers the forgiving club AND the one the yardage wants', () => {
    const offer = offerFromUnknownLie({ yardageClub: '5W', bag: BAG })!;
    expect(offer.safeClub).toBe('5H');           // hybrid first — that is the real question
    expect(offer.say).toMatch(/sure of getting it out/i);
    expect(offer.ifGoodLieClub).toBe('5W');
    expect(offer.say).toMatch(/good lie/i);
    expect(offer.cameraWouldHelp).toBe(true);
  });

  it('falls to an iron when there is no hybrid in the bag', () => {
    const offer = offerFromUnknownLie({
      yardageClub: '5W', bag: { '5W': 185, '5I': 175, '7I': 150 },
    })!;
    expect(offer.safeClub).toBe('5I');
  });

  it('says nothing when the lie is KNOWN — then it just picks', () => {
    expect(offerFromUnknownLie({ yardageClub: '5W', bag: BAG, lie: 'heavy_rough' })).toBeNull();
    expect(offerFromUnknownLie({ yardageClub: '5W', bag: BAG, lie: 'fairway' })).toBeNull();
  });

  it('says nothing about a club nobody needs to be asked about', () => {
    // An offer on every shot is nagging. A 9 iron is a 9 iron.
    expect(offerFromUnknownLie({ yardageClub: '9I', bag: BAG })).toBeNull();
    expect(offerFromUnknownLie({ yardageClub: '7I', bag: BAG })).toBeNull();
  });

  it('says nothing when the bag holds no real alternative at that number', () => {
    expect(offerFromUnknownLie({ yardageClub: '5W', bag: { '5W': 185, SW: 80 } })).toBeNull();
  });

  it('rides on the read, so every surface gets it', () => {
    const read = composeShotRead({ rawYards: 184, weather: null, shotBearingDeg: null, bag: BAG })!;
    expect(read.lieOffer).not.toBeNull();
    expect(clubClassOf(read.lieOffer!.safeClub)).toBe('hybrid');
  });

  it('and is gone the moment the lie is known', () => {
    const read = composeShotRead({ rawYards: 184, weather: null, shotBearingDeg: null, bag: BAG, lie: 'fairway' })!;
    expect(read.lieOffer).toBeNull();
  });
});

describe('the equipment profile finally connects to a decision', () => {
  it('reads a loft out of the text a bag scan produces', () => {
    expect(loftDegrees('52°')).toBe(52);
    expect(loftDegrees('10.5 deg')).toBe(10.5);
    expect(loftDegrees('')).toBeNull();
    expect(loftDegrees('sand wedge')).toBeNull();
  });
});

describe('it reaches the caddie, not just the screen', () => {
  it('the payload sends the read the device already made', () => {
    expect(code('services/caddieRequestBody.ts')).toMatch(/shotRead: safe\(/);
  });

  it('the brain is told not to name a different club', () => {
    const k = code('api/kevin.ts');
    expect(k).toMatch(/do NOT recompute it, and do not name a different club/);
  });

  it('and is told to OFFER rather than guess, with TightLie as the full read', () => {
    const k = code('api/kevin.ts');
    expect(k).toMatch(/LIE UNKNOWN — OFFER, DO NOT GUESS/);
    expect(k).toMatch(/TightLie/);
    expect(k).toMatch(/Offer ONCE/);
  });
});
