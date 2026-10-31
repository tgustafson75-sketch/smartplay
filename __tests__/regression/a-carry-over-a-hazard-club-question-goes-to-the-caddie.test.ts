/**
 * 2026-10-31 (Brain recheck r23, BRAIN-PLAYER-2) — A CLUB QUESTION THAT ASKS ABOUT A HAZARD GOES TO THE CADDIE.
 *
 * "How far do I hit my 7 iron to clear the water" matched the club_distance bag read, and the answer was the bag
 * number. The hazard was never heard. The club-phrase guard tested DECISION_OR_REASON_RX and SITUATION_RX only; HAZARD_RX
 * (already used for the offline yardage branches) now joins them, with the club's own name taken off the front so
 * "sand wedge" and "3 woods" (which contain "sand" and "woods") stay the bag read.
 *
 * BEHAVIOURAL: the real precheckLocalIntent.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const intentOf = (t: string) => precheckLocalIntent(t);
const topic = (t: string) =>
  (intentOf(t)?.parameters as { query_topic?: string } | undefined)?.query_topic ?? null;

describe('a club question about a carry over a hazard is the caddie\'s', () => {
  it.each([
    'how far do I hit my 7 iron to clear the water',
    'how far do I hit my 7 iron over the creek',
    'how far do I hit my 6 iron past the pond',
    'how far do I hit my driver to carry the bunker',
  ])('"%s" is conversational, not a bag read', (t) => {
    expect(intentOf(t)?.intent_type).toBe('conversational');
  });
});

describe('control: a bag question whose club name contains a hazard word stays the bag read', () => {
  it.each([
    'how far do I hit my sand wedge',
    'how far do I hit my 3 woods',
    'how far do I hit my 7 iron',
  ])('"%s" stays the bag read', (t) => {
    expect(intentOf(t)?.intent_type).toBe('query_status');
    expect(topic(t)).toBe('club_distance');
  });
});
