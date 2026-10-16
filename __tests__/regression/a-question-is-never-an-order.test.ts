/**
 * 2026-10-15 (review) — A QUESTION OR A STORY IS NEVER AN ORDER.
 *
 * services/localIntentPrecheck runs BEFORE the brain and dispatches at confidence 'high'. Verified on
 * the pre-fix file, each of these changed the round instead of reaching the caddie:
 *
 *   "Should I go for it?"                          → risk_mode = aggressive
 *   "I birdied this hole last year"                → log_score (a 3)
 *   "How long is the next hole?"                   → navigate next_hole
 *   "What did I make on the previous hole?"        → navigate previous_hole
 *   "I need to find my swing"                      → find_my_data (pushed off the round)
 *   "I wish I could take that back"                → undo (reverted the last score)
 *   "Should I just go home?"                       → navigate home
 *
 * BEHAVIOURAL: the real precheckLocalIntent runs on every phrase. A blocked phrase must come back
 * 'conversational' (the route both routers send straight to the brain) — null would hand it to the
 * cloud classifier, which can make the same mistake. The commands must keep their fast path.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { isNotACommand } from '../../services/utteranceIsCommand';

const ACTING = new Set([
  'change_setting', 'log_score', 'navigate', 'undo', 'find_my_data', 'open_tool', 'open_course',
  'correct_last_shot', 'set_club_distance', 'media_capture',
]);

describe('questions and stories reach the caddie, never a round-changing command', () => {
  it.each([
    'Should I go for it?',
    'Should I go for it or play it safe?',
    'Do you think I should be aggressive here?',
    "I haven't had a birdie all day, what am I doing wrong",
    'I birdied this hole last year',
    'How long is the next hole?',
    'Is the next hole a par 5?',
    "What's the next hole like?",
    'the next hole is a par 5',
    'What did I make on the previous hole?',
    'I need to find my swing',
    "I can't get my swing going today",
    'Did you see that swing?',
    "Let's see how this round goes",
    'I wish I could take that back',
    'Should I just go home?',
    'Kevin, should I go aggressive here?',
    'I never made a five on this hole',
    'Yesterday I shot a seven here',
    'Would you go for it?',
  ])('"%s" is not acted on', (t) => {
    const r = precheckLocalIntent(t);
    expect(r && ACTING.has(r.intent_type) ? `${r.intent_type} ${JSON.stringify(r.parameters)}` : 'not acted').toBe('not acted');
  });

  // (The next/previous-hole and find-my-data phrasings no longer match their patterns at all — those
  // are anchored to the imperative now — so they fall through exactly as any unmatched phrase does.)
  it.each([
    ['Should I go for it?', 'change_setting'],
    ['I birdied this hole last year', 'log_score'],
    ['Should I just go home?', 'navigate'],
    ["I haven't had a birdie all day, what am I doing wrong", 'log_score'],
  ])('"%s" (which used to be %s) goes STRAIGHT to the brain, not to the cloud classifier', (t) => {
    expect(precheckLocalIntent(t)?.intent_type).toBe('conversational');
  });
});

describe('real commands keep their fast path', () => {
  it.each([
    ['I made a five', 'log_score'],
    ['I got a 4', 'log_score'],
    ['I birdied it', 'log_score'],
    ['put me down for a six', 'log_score'],
    ['next hole', 'navigate'],
    ['go to the next hole', 'navigate'],
    ["alright we're done here, next hole", 'navigate'],
    ['on to the next', 'navigate'],
    ['previous hole', 'navigate'],
    ['go back a hole', 'navigate'],
    ['undo that', 'undo'],
    ['scratch that', 'undo'],
    ['oops, undo that', 'undo'],
    ['take that back', 'undo'],
    ['go aggressive', 'change_setting'],
    ["let's be aggressive", 'change_setting'],
    ['play it safe', 'change_setting'],
    ["let's play it safe", 'change_setting'],
    ["I'm going for it", 'change_setting'],
    ['show me my last swing', 'find_my_data'],
    ['pull up my last round', 'find_my_data'],
    ['can you pull up my last round', 'find_my_data'],
    ['go home', 'navigate'],
    ['take me home', 'navigate'],
    ['open SmartFinder', 'open_tool'],
    ['can you open smart finder', 'open_tool'],
    ['mark the pin', 'open_tool'],
    ['switch to dark mode', 'change_setting'],
    ['my 7 iron goes 165', 'set_club_distance'],
    ["how's my read", 'open_tool'],
    ['ok next hole', 'navigate'],
    ['alright, next hole', 'navigate'],
    ['Kevin, undo that', 'undo'],
    ['okay previous hole', 'navigate'],
    // a time word inside an explicit open is WHAT to open, not a story
    ['show me my round from yesterday', 'find_my_data'],
    ['pull up my swings from last week', 'find_my_data'],
    ['can you read this putt', 'open_tool'],
  ])('"%s" → %s', (t, type) => {
    expect(precheckLocalIntent(t)?.intent_type).toBe(type);
  });

  it('local QUERIES are untouched — a question answered from the card is still answered locally', () => {
    expect(precheckLocalIntent("what's my score")?.intent_type).toBe('query_status');
    expect(precheckLocalIntent('how many putts do I have')?.intent_type).toBe('query_status');
    expect(precheckLocalIntent('what hole am I on')?.intent_type).toBe('query_status');
  });
});

describe('the shared guard itself', () => {
  it('treats polite requests as commands and opinions as questions', () => {
    expect(isNotACommand('can you open SmartFinder')).toBe(false);
    expect(isNotACommand('could you mark the pin')).toBe(false);
    expect(isNotACommand('would you go for it')).toBe(true);
    expect(isNotACommand('is that out of bounds')).toBe(true);
    expect(isNotACommand('add a penalty')).toBe(false);
  });
});
