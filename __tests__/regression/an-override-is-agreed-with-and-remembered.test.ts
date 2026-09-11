/**
 * 2026-09-11 — THE OVERRIDE LOOP: the caddie agrees, names one thing, and remembers how it went.
 *
 * Tim: "It says okay, we're on the driver, and you nominate something else, and it goes into… I
 * don't kind of have the context loop. The caddie's job is to agree, but point out — okay, but we're
 * gonna have to really swing smooth. And you say okay, we'll go for the hero shot, and that's part
 * of the data of when that worked and when it didn't, when the user overrode."
 *
 * Two things were broken and this file pins both.
 *
 * THE LIVE HALF — `pendingKevinRec` had never been sent to the brain, so the caddie did not know it
 * had just called a club and had no contradiction to notice.
 *
 * THE LEARNED HALF — adviceOutcome's rule 2 ("the player took that club") is CORRECT and stays, so
 * every override was discarded. The most interesting decision a golfer makes was unlearnable.
 *
 * The last describe block is the one that matters most: the two loops must never merge.
 */
import {
  readOverride, overrideRecord, overrideWorked, describeOverrideRecord,
} from '../../services/overrideLoop';
import { adviceOutcomes } from '../../services/adviceOutcome';
import fs from 'fs';
import path from 'path';

/** A deliberately dumb normalizer — the real one is clubNormalize; these tests are about the rule. */
const norm = (c: string | null | undefined) => (c ? c.trim().toLowerCase() : null);
const BAG = { driver: 250, '3 wood': 225, '5 wood': 210, '7 iron': 155, '8 iron': 145, '9 iron': 132 };

describe('there is nothing to agree with', () => {
  it('returns null when the caddie never called a club', () => {
    expect(readOverride({ advisedClub: null, chosenClub: '7 iron', bag: BAG, normalize: norm })).toBeNull();
  });

  it('returns null when the player has not named one', () => {
    expect(readOverride({ advisedClub: '7 iron', chosenClub: null, bag: BAG, normalize: norm })).toBeNull();
  });

  it('returns null when it is the same club in another vocabulary', () => {
    expect(readOverride({ advisedClub: '7 Iron', chosenClub: '7 iron ', bag: BAG, normalize: norm })).toBeNull();
  });
});

describe('the adjustment is the one thing that has to be true', () => {
  it('a FULL-SWING player taking more club is told where to AIM, not to swing smooth', () => {
    // Tim: "all I do right now is full swing and not good with dialing down yardages." Telling him
    // to take something off is telling him to do the thing he has said he cannot do.
    const r = readOverride({
      advisedClub: '8 iron', chosenClub: '7 iron', bag: BAG, normalize: norm,
      yardsToTarget: 145, distanceControl: 'full_swings',
    })!;
    expect(r.lean).toBe('more');
    expect(r.demand).toBe('take_the_middle');
    expect(r.adjustment).not.toMatch(/smooth/i);
    expect(r.adjustment).toMatch(/aim|front half/i);
  });

  it('a player who CAN dial down is told to swing smooth — the advice they can actually follow', () => {
    const r = readOverride({
      advisedClub: '8 iron', chosenClub: '7 iron', bag: BAG, normalize: norm,
      yardsToTarget: 145, distanceControl: 'dial_down',
    })!;
    expect(r.demand).toBe('swing_smooth');
    expect(r.adjustment).toMatch(/smooth/i);
  });

  it('quotes the room behind the pin when the extra club would run out of green', () => {
    const r = readOverride({
      advisedClub: '8 iron', chosenClub: '7 iron', bag: BAG, normalize: norm,
      yardsToTarget: 145, distanceControl: 'some_partials', roomBehindYards: 6,
    })!;
    expect(r.demand).toBe('take_the_middle');
    expect(r.adjustment).toMatch(/6 yards behind the pin/);
  });

  it('less club has to be committed to, and says what it leaves', () => {
    const r = readOverride({
      advisedClub: 'driver', chosenClub: '3 wood', bag: BAG, normalize: norm, yardsToTarget: 380,
    })!;
    expect(r.lean).toBe('less');
    expect(r.deltaYards).toBe(-25);
    expect(r.leavesYards).toBe(155);
    expect(r.adjustment).toMatch(/155 in/);
  });

  it('names the carry when their club does not clear the trouble', () => {
    const r = readOverride({
      advisedClub: 'driver', chosenClub: '3 wood', bag: BAG, normalize: norm,
      yardsToTarget: 380, carryNeededYards: 240,
    })!;
    expect(r.demand).toBe('carry_the_trouble');
    expect(r.adjustment).toMatch(/240 to carry/);
  });

  it('invents no layup number when the club covers the target', () => {
    // "The 3 wood leaves you this" is only honest when they genuinely cannot reach it.
    const r = readOverride({
      advisedClub: '8 iron', chosenClub: '7 iron', bag: BAG, normalize: norm, yardsToTarget: 140,
    })!;
    expect(r.leavesYards).toBeNull();
  });

  it('treats a same-number swap as sideways and just goes with it', () => {
    const r = readOverride({
      advisedClub: '3 wood', chosenClub: '5 wood', bag: { '3 wood': 212, '5 wood': 210 }, normalize: norm,
    })!;
    expect(r.lean).toBe('sideways');
    expect(r.demand).toBe('none');
  });

  it('still reads as an override when the bag has no number for a club', () => {
    const r = readOverride({ advisedClub: '7 iron', chosenClub: 'hybrid', bag: BAG, normalize: norm })!;
    expect(r).not.toBeNull();
    expect(r.deltaYards).toBeNull();
    expect(r.lean).toBe('sideways');
  });
});

describe('did the override cost a stroke', () => {
  it('a penalty is a failed decision whoever picked the club', () => {
    expect(overrideWorked({ feel: 'flush', outcome: 'water' })).toBe(false);
    expect(overrideWorked({ feel: 'flush', penalty_strokes: 1 })).toBe(false);
  });

  it('a fat strike is EXECUTION and is not counted either way', () => {
    // The same discipline adviceOutcome applies to itself. Counting this would teach the caddie to
    // punish independence.
    expect(overrideWorked({ feel: 'fat', outcome: 'clean' })).toBeNull();
    expect(overrideWorked({ feel: null })).toBeNull();
  });

  it('clean strike, no trouble, is the one that worked', () => {
    expect(overrideWorked({ feel: 'flush' })).toBe(true);
    expect(overrideWorked({ feel: 'solid', outcome: 'clean' })).toBe(true);
  });
});

describe('the record only ever reads overrides', () => {
  const shot = (o: Record<string, unknown>) => ({ kevin_adhered: false, feel: 'flush', ...o } as never);

  it('ignores every shot where the player took the club', () => {
    const rec = overrideRecord([
      { kevin_adhered: true, kevin_rec_club: '7 iron', club: '7 iron', feel: 'flush' },
      { kevin_adhered: null, kevin_rec_club: '7 iron', club: '8 iron', feel: 'flush' },
    ], norm, BAG);
    expect(rec.n).toBe(0);
  });

  it('says nothing at all below four — a run of decisions is not a habit', () => {
    const rec = overrideRecord([
      shot({ kevin_rec_club: '8 iron', club: '7 iron' }),
      shot({ kevin_rec_club: '8 iron', club: '7 iron' }),
      shot({ kevin_rec_club: '8 iron', club: '7 iron' }),
    ], norm, BAG);
    expect(rec.n).toBe(3);
    expect(describeOverrideRecord(rec)).toBeNull();
  });

  it('reports a good self-read and tells the caddie to stop selling', () => {
    const rec = overrideRecord([
      shot({ kevin_rec_club: '8 iron', club: '7 iron' }),
      shot({ kevin_rec_club: '8 iron', club: '7 iron' }),
      shot({ kevin_rec_club: '8 iron', club: '7 iron' }),
      shot({ kevin_rec_club: '9 iron', club: '8 iron' }),
    ], norm, BAG);
    expect(rec.n).toBe(4);
    expect(rec.workedShare).toBe(1);
    expect(rec.lean).toBe('more');
    expect(rec.topSwap).toEqual({ from: '8 iron', to: '7 iron', n: 3, worked: 3 });
    const line = describeOverrideRecord(rec)!;
    expect(line).toMatch(/stop selling/);
    expect(line).toMatch(/MORE club/);
  });

  it('reports a costly one as information, never as a scold', () => {
    const rec = overrideRecord([
      shot({ kevin_rec_club: '8 iron', club: 'driver', outcome: 'ob' }),
      shot({ kevin_rec_club: '8 iron', club: 'driver', outcome: 'water' }),
      shot({ kevin_rec_club: '8 iron', club: 'driver', penalty_strokes: 1 }),
      shot({ kevin_rec_club: '9 iron', club: '7 iron' }),
    ], norm, BAG);
    const line = describeOverrideRecord(rec)!;
    expect(line).toMatch(/costs him a stroke 75%/);
    expect(line).toMatch(/still agree/);
    // No blame vocabulary — this is handed to the caddie to steer with, not to read back.
    expect(line).not.toMatch(/wrong|should have|stubborn|ignore/i);
  });

  it('does not claim a lean when he goes both ways', () => {
    const rec = overrideRecord([
      shot({ kevin_rec_club: '8 iron', club: '7 iron' }),
      shot({ kevin_rec_club: '8 iron', club: '7 iron' }),
      shot({ kevin_rec_club: '7 iron', club: '9 iron' }),
      shot({ kevin_rec_club: '7 iron', club: '9 iron' }),
    ], norm, BAG);
    expect(rec.lean).toBeNull();
  });
});

describe('the two loops must never merge', () => {
  /**
   * This is the guard the whole design rests on. adviceOutcome calibrates the caddie's OWN calling
   * and may only ever see clubs the player took. If an override ever counted there, the caddie
   * would start grading itself on decisions it did not make.
   */
  const overrides = [
    { kevin_adhered: false, kevin_rec_club: '8 iron', club: '7 iron', feel: 'flush', distance_yards: 160 },
    { kevin_adhered: false, kevin_rec_club: '8 iron', club: '7 iron', feel: 'flush', distance_yards: 158 },
    { kevin_adhered: false, kevin_rec_club: '8 iron', club: '7 iron', feel: 'solid', distance_yards: 162 },
    { kevin_adhered: false, kevin_rec_club: '8 iron', club: '7 iron', feel: 'pure', distance_yards: 159 },
  ];

  it('adviceOutcomes sees none of them', () => {
    expect(adviceOutcomes(overrides as never, () => 145, norm)).toEqual([]);
  });

  it('overrideRecord sees all of them', () => {
    expect(overrideRecord(overrides as never, norm, BAG).n).toBe(4);
  });

  it('and adviceOutcome still requires the player to have taken the club', () => {
    // If this line ever softens, override data silently enters the club calibration.
    const src = fs.readFileSync(path.join(__dirname, '../../services/adviceOutcome.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(src).toMatch(/if \(s\.kevin_adhered !== true\) continue;/);
  });
});

describe('it is wired to the caddie at both ends', () => {
  const kevin = fs.readFileSync(path.join(__dirname, '../../api/kevin.ts'), 'utf8');
  const body = fs.readFileSync(path.join(__dirname, '../../services/caddieRequestBody.ts'), 'utf8');
  const memory = fs.readFileSync(path.join(__dirname, '../../services/caddieMemoryRetrieval.ts'), 'utf8');

  const resolver = fs.readFileSync(path.join(__dirname, '../../services/shotClubResolver.ts'), 'utf8');

  it('the payload composes the live read', () => {
    expect(body).toMatch(/clubCall: safe\(/);
    expect(body).toMatch(/readOverride\(\{/);
  });

  /**
   * THE TIMING BUG THIS EXISTS TO PREVENT. `club_change` dispatches AFTER the brain has answered
   * the turn, so a payload that only spoke up once the player's club had landed in the store would
   * arrive one turn late — agreeing with an override the caddie had already talked past. The
   * standing call must be sent whether or not an override has been detected yet.
   */
  it('sends the standing call unconditionally, not only when an override is already detected', () => {
    const at = body.indexOf('clubCall: safe(');
    const block = body.slice(at, at + 2200);
    // `advised` is set from the standing call with no dependency on the player having declared one.
    expect(block).toMatch(/const standing = pendingAdviceIfFresh\(\);/);
    expect(block).toMatch(/if \(!standing\) return null;/);
    expect(block).toMatch(/advised: standing\.club,/);
    // and the override read is the part gated on the player's club, not the whole payload
    expect(block).toMatch(/override: club\s*\n?\s*\? readOverride\(\{/);
  });

  it('an app INFERENCE is not an override — a guess the caddie never spoke cannot be overruled', () => {
    const at = resolver.indexOf('export function pendingAdviceIfFresh');
    expect(at).toBeGreaterThan(-1);
    expect(resolver.slice(at, at + 600)).toMatch(/isAdvice\(rec\.kind/);
  });

  it('the standing call expires on the SAME window as the declared club — one owner', () => {
    // A second `12 * 60 * 1000` elsewhere is the defect waiting for the day somebody tunes one.
    const at = resolver.indexOf('export function pendingAdviceIfFresh');
    expect(resolver.slice(at, at + 600)).toMatch(/nowMs - at > FRESH_MS/);
  });

  it('the brain knows its own standing call even before the player has changed club', () => {
    const at = kevin.indexOf('YOUR STANDING CLUB CALL');
    expect(at).toBeGreaterThan(-1);
    const block = kevin.slice(at, at + 600);
    expect(block).toMatch(/he is overriding you/);
    expect(block).toMatch(/AGREE with him/);
    expect(block).toMatch(/do not re-sell/);
  });

  it('the brain renders the override, and the instruction is to AGREE', () => {
    const at = kevin.indexOf('HE IS OVERRIDING YOUR CLUB');
    expect(at).toBeGreaterThan(-1);
    const block = kevin.slice(at, at + 900);
    expect(block).toMatch(/AGREE WITH HIM/);
    expect(block).toMatch(/name ONE thing, once/);
    expect(block).toMatch(/Do NOT re-sell your club/);
    expect(block).toMatch(/do NOT say "are you sure"/);
  });

  it('the learned record reaches the caddie through the CNS block, like the calibration line', () => {
    expect(memory).toMatch(/describeOverrideRecord\(/);
    expect(memory).toMatch(/if \(overrideLine\) lines\.push\(overrideLine\);/);
    // Told to steer with it, never to quote it at him.
    expect(memory).toMatch(/never quote it at him/);
  });
});
