/**
 * 2026-09-12 (Tim — "I'm going to talk to him about my bag and distances, hoping he understands a
 * conversation versus trying to take me to a tool or screen I didn't ask for").
 *
 * The yardage precheck carried a bare `how far` alternative, so "how far do I hit my 7-iron" — a
 * question about HIS BAG, which the caddie already carries clubDistances / bagClubs /
 * club_tendencies to answer — matched `distance_to_green` at confidence 'high'. The router
 * dispatches a high-confidence precheck intent locally, so the brain never saw it: in a round he
 * got the yardage to the green instead of his 7-iron number, and off the course queryStatusHandler's
 * off-round gate answered "You're not in a round yet. Want to start one?" to a question that has
 * nothing to do with being in a round.
 *
 * The green-referential phrasings must keep their fast path; the bag questions must fall through.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const topic = (t: string) =>
  (precheckLocalIntent(t)?.parameters as { query_topic?: string } | undefined)?.query_topic ?? null;

describe('the yardage precheck claims the hole, not the bag', () => {
  it('still claims a distance asked about the hole', () => {
    expect(topic('how far to the green')).toBe('distance_to_green');
    expect(topic('how far is the green')).toBe('distance_to_green');
    expect(topic('how far am I')).toBe('distance_to_green');
    expect(topic('how many yards left')).toBe('distance_to_green');
    expect(topic('distance to the green')).toBe('distance_to_green');
    expect(topic("what's the yardage")).toBe('distance_to_green');
  });

  it('keeps the more specific green targets ahead of it', () => {
    expect(topic('how many yards to the front')).toBe('green_front');
    expect(topic('yards to the back')).toBe('green_back');
    expect(topic('middle of the green')).toBe('green_middle');
    // "to the pin" is the middle of the green, and has been since before this change.
    expect(topic('how far to the pin')).toBe('green_middle');
    expect(topic('yards to the flag')).toBe('green_middle');
  });

  /**
   * The possessive forms were already safe — the club_distance block inside precheckLocalIntent
   * runs ahead of the pattern list and claims them. These are the ones that were NOT: without a
   * "my" in front of the club, they fell past that block into the generic yardage pattern and came
   * back as the distance to the green.
   */
  it('sends a club question to the bag read, with or without the possessive', () => {
    for (const t of [
      'how far do I hit my 7 iron',
      'how far do I hit my driver',
      'how far do I carry my 3 wood',
      'what is my yardage with a 5 wood',
      'how many yards do I hit a pitching wedge',
    ]) {
      expect(topic(t)).toBe('club_distance');
    }
  });

  /**
   * 2026-09-12 — the loft forms. clubFromLoftPhrase was handed the capture group with the
   * determiner already stripped ("60"), and its determiner branch cannot match a bare number, so
   * the 2026-09-11 fix had never fired once: "how far do I hit my 60" answered with the yardage to
   * the green. It reads the whole transcript now, which is what it was written for.
   */
  it('reads a wedge named by its loft', () => {
    expect(topic('how far do I hit my 60')).toBe('club_distance');
    expect(topic('how far do I hit my 52')).toBe('club_distance');
    expect(topic("what's my 60")).toBe('club_distance');
    expect(topic('how far do I hit a 60 degree')).toBe('club_distance');
  });

  it('does NOT answer bag talk with the hole\'s yardage', () => {
    for (const t of [
      'how far do I usually hit it',
      'what are the gaps in my bag',
      "what's my yardage gapping",
      'talk to me about my bag',
    ]) {
      expect(topic(t)).toBeNull();
    }
  });

  it('does not mistake a course feature for a club', () => {
    // "how far to the wood line" captures "to the wood line", whose club-word test passes on `wood`.
    expect(topic('how far to the wood line')).not.toBe('club_distance');
    expect(topic('how far to the tree line')).toBe('distance_to_green');
    expect(topic('how far is the 60 yards to the pin')).not.toBe('club_distance');
  });

  it('leaves a hazard carry to the classifier rather than answering it as the green', () => {
    expect(topic('how far to carry that bunker')).toBeNull();
  });
});

/**
 * 2026-09-12 — the same class one pattern further down: the bare `rangefinder` alternative in the
 * SmartFinder open. "My rangefinder says 205" is the player feeding the system a number that
 * services/yardageResolver ranks ABOVE live GPS and the card; it opened a screen and dropped the
 * number instead. An explicit open must still open.
 */
describe('a spoken rangefinder number is a statement, not a screen request', () => {
  const tool = (t: string) =>
    (precheckLocalIntent(t)?.parameters as { tool_name?: string } | undefined)?.tool_name ?? null;

  it('still opens SmartFinder on an explicit command', () => {
    expect(tool('open smartfinder')).toBe('smartfinder');
    expect(tool('open the rangefinder')).toBe('smartfinder');
    expect(tool('pull up smart finder')).toBe('smartfinder');
    expect(tool('smartfinder')).toBe('smartfinder');
    expect(tool('lock the distance')).toBe('smartfinder');
  });

  it('does NOT open it when the player is stating a yardage', () => {
    expect(tool('my rangefinder says 205')).toBeNull();
    expect(tool('rangefinder reads 148')).toBeNull();
    expect(tool('the rangefinder has me at 172')).toBeNull();
  });

  it('keeps the 2026-08-06 guard — talking ABOUT the tool does not open it', () => {
    expect(tool('log an issue with smartfinder')).toBeNull();
    expect(tool('the rangefinder is broken')).toBeNull();
  });
});
