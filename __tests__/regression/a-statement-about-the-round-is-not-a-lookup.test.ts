/**
 * 2026-10-28 (Brain review r9) — A STATEMENT ABOUT THE ROUND IS NOT A STATUS ASK.
 *
 * The r4 fix sent goals, stories and decision words to the caddie, but a plain first-person statement
 * still became a bare readout: "I hit a 7 iron to the back of the green" → "N yards to the back",
 * "I'm not hitting the greens today" → a GIR count, "I don't care about my score today" → the score
 * (or "You're not in a round yet" off-round), "I'm on the front nine of my life" → a nine split. A
 * lookup is claimed only when the sentence ASKS: a question, a "tell me / give me", or a bare noun
 * phrase. A sentence where he is the subject and says something is the caddie's to hear.
 *
 * BEHAVIOURAL: the real precheck, which runs before /api/kevin on every voice and typed route.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const kind = (u: string) => {
  const hit = precheckLocalIntent(u);
  return hit ? `${hit.intent_type}${hit.parameters?.query_topic ? `:${String(hit.parameters.query_topic)}` : ''}` : null;
};

describe('a statement goes to the caddie', () => {
  it.each([
    'I hit a 7 iron to the back of the green',
    "I'm on the back of the green",
    "I'm not hitting the greens today",
    "I'm hitting the greens but not making putts",
    "I don't care about my score today",
    "I'm under par for the first time ever",
    "I'm over par but feeling good",
    "I'm on the front nine of my life",
  ])('"%s"', (u) => {
    expect(kind(u)).toBe('conversational');
  });
});

describe('an ask still gets its readout', () => {
  it.each([
    ['yards to the back', 'query_status:green_back'],
    ['how far to the back of the green', 'query_status:green_back'],
    ["what's my score", 'query_status:score'],
    ['my score', 'query_status:score'],
    ['tell me my score', 'query_status:score'],
    ['how many greens have I hit', 'query_status:gir'],
    ["I'd like to know how far to the back", 'query_status:green_back'],
    ['how did I do on the front nine', 'query_status:nine_split'],
  ])('"%s" → %s', (u, want) => {
    expect(kind(u)).toBe(want);
  });
});
