import * as fs from 'fs';
import * as path from 'path';
import { leadCoachFor, extractAdvisedClub } from '../../api/_brain';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

/**
 * 2026-09-12 (Tim — "the topic will determine what coach is prevalent helping logic and speed of
 * response", then "we never want slower response that feels unnatural").
 */
describe('the topic picks which coach leads', () => {
  it.each([
    ['what should i hit from here', 'shot'],
    ['which club for 150', 'shot'],
    ['it feels like i am coming over the top', 'swing'],
    ['my tempo is all over the place', 'swing'],
    ['i get so frustrated on the back nine', 'mental'],
    ['i am in my head today', 'mental'],
    ['is my practice even showing up in my scores', 'practice'],
    ['what should i work on at the range', 'practice'],
    ['what do you know about that course', 'course'],
  ])('%s -> %s', (text, want) => {
    expect(leadCoachFor(text)).toBe(want);
  });

  /** A shot decision outranks the rest — he is standing over the ball. */
  it('a club question in swing language still leads with the shot', () => {
    expect(leadCoachFor('my swing feels steep, what should i hit')).toBe('shot');
  });

  /** Null means "no lead", not "no coaches" — guessing badly is worse than letting the panel decide. */
  it.each([['hey kevin'], ['how are you'], [''], ['   ']])('stays silent on %s', (text) => {
    expect(leadCoachFor(text)).toBeNull();
  });

  /**
   * SPEED IS THE POINT, so the decision must cost nothing: a local regex pass, no network, no second
   * model call. kevin.ts pins aiTier='quality' every turn and says the classifyQuestion() round-trip
   * "was removed for good reason and stays removed" — re-adding one to pick a coach would spend a
   * network hop before the answer even starts.
   */
  it('costs nothing to decide — no network, no model call', () => {
    const src = read('api/_brain.ts');
    const fn = src.slice(src.indexOf('export function leadCoachFor'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).not.toMatch(/await|fetch\(|completeText|runAgenticLoop/);
    // And the tier stays pinned: no topic-based model downgrade.
    expect(read('api/kevin.ts')).toMatch(/const aiTier: AiTier = 'quality';/);
  });

  /**
   * THE CACHE. The system prompt is ONE cache block; a per-turn value inside it makes every turn a 2x
   * WRITE instead of a read, which is the 08-24 defect that cost $50 in a day and made turns SLOWER.
   * So the volatile verdict rides the MESSAGE and only the stable doctrine is cached.
   */
  it('rides the message side, not the cached system prompt', () => {
    const k = read('api/kevin.ts');
    // The verdict is built next to the other volatile prefixes and injected into the message.
    expect(k).toMatch(/const leadPrefix = leadCoach/);
    expect((k.match(/\$\{leadPrefix\}\$\{baseMessage\}/g) ?? []).length).toBe(2);
    // The doctrine is in the system prompt and names no per-turn value.
    expect(k).toMatch(/THE TOPIC PICKS THE LEAD/);
    // It must NOT be registered as a cached interpolation — that is the whole point.
    expect(read('scripts/simulations/run-sim.ts')).not.toMatch(/'_leadCoach'|'_lead'/);
  });

  it('tells the brain to be brief because he is waiting', () => {
    expect(read('api/kevin.ts')).toMatch(/SHORTER IS FASTER AND HE IS WAITING/);
  });
});

/**
 * 2026-09-12 — A REGEX THAT CONTAINED CONTROL CHARACTERS INSTEAD OF WORD BOUNDARIES.
 *
 * Found while adding the above: api/_brain.ts held FIVE raw 0x08 (backspace) bytes where `\b` was
 * intended, inside LOFT_CUE — and because it is built with String.raw, each was passed to the RegExp
 * as a literal backspace. Spoken text never contains one, so every loft-named club failed to match.
 * Probed before the fix: "I'd go with your 60" → null, "Let's go the 56 here" → null, "I like your 52
 * degree" → null. Only the spelled-out "lob wedge" worked.
 *
 * That is extractAdvisedClub, which carries the club the caddie ACTUALLY advised so silent adherence
 * trains the bag with the exact club (2026-08-09, Tim — exact club attribution). Golfers name wedges
 * by loft, which is the entire premise of the 09-11 "the 60 is a club" work on the client side — so
 * the server was dropping attribution for precisely the clubs most often named that way.
 * [[state-what-you-measured-not-what-you-intended]]
 */
describe('the caddie attributes a club named by its loft', () => {
  it.each([
    ["I'd go with your 60", 'lob wedge'],
    ["Let's go the 56 here", 'sand wedge'],
    ['I like your 52 degree', 'gap wedge'],
    ['take the 60 wedge', 'lob wedge'],
    ['I would hit your 48 degree', 'pitching wedge'],
  ])('%s -> %s', (said, club) => {
    expect(extractAdvisedClub(said)?.club).toBe(club);
  });

  /** The guard the comment promises: a YARDAGE is not a club. */
  it.each([["you're 60 out"], ['from 60 yards'], ['about 56 to the pin']])('%s is not a club', (said) => {
    const got = extractAdvisedClub(said);
    expect(got?.club).not.toBe('lob wedge');
    expect(got?.club).not.toBe('sand wedge');
  });

  /** No control character may come back: the whole class of defect, not just this instance. */
  it('api/_brain.ts contains no control characters where escapes were meant', () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '../../api/_brain.ts'));
    // eslint-disable-next-line no-control-regex
    expect(raw.toString('utf-8')).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });
});
