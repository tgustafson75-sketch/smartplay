/**
 * 2026-08-12 (Tim) — "I've been saying to the caddie, I got a bogey. And it'll say, okay, how many
 * putts? And I'll say two. And I know we supposedly fixed it, but if you say two, it could say you
 * got an eagle, and it'll go with that. And then you have to argue to get it fixed."
 *
 * The fix existed and covered exactly ONE path. The intercept lived inside runFollowUpListenLoop,
 * which only runs when the mic auto-reopens after the question. Tap the mic to answer, answer after
 * that loop times out, or answer on the earbud path — and a bare "two" reached the score parser,
 * which read it as a two on the hole. On a par 4 that's an eagle, and it OVERWROTE the bogey he had
 * just logged correctly.
 *
 * The bug was never the parse. "The caddie is waiting for a putt count" was a LOCAL VARIABLE inside
 * one loop instead of a fact about the conversation, so every other surface was blind to it.
 *
 * This is a worse class than an ordinary misparse: it silently rewrites data the player already gave
 * correctly, and the only way back is to argue with your caddie.
 */
import {
  markAwaitingPutts, isAwaitingPutts, awaitingPuttsHole, clearAwaitingPutts, parsePuttAnswer,
} from '../../services/pendingPuttAsk';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

beforeEach(() => clearAwaitingPutts());

describe('the open question is a fact about the conversation, not a loop-local', () => {
  it('opens and closes', () => {
    expect(isAwaitingPutts()).toBe(false);
    markAwaitingPutts(7);
    expect(isAwaitingPutts()).toBe(true);
    expect(awaitingPuttsHole()).toBe(7);
    clearAwaitingPutts();
    expect(isAwaitingPutts()).toBe(false);
    expect(awaitingPuttsHole()).toBeNull();
  });

  it('remembers the SCORED hole, which may not be the nav hole', () => {
    // "I made a 5" auto-advances the hole; the putts belong to the hole just scored.
    markAwaitingPutts(12);
    expect(awaitingPuttsHole()).toBe(12);
  });

  it('ignores a nonsense hole rather than storing it', () => {
    markAwaitingPutts(99);
    expect(awaitingPuttsHole()).toBeNull();
    expect(isAwaitingPutts()).toBe(true); // still open — the question was asked
  });
});

describe('answering "two" means two putts', () => {
  it.each([
    ['two', 2], ['2', 2], ['one', 1], ['1', 1], ['zero', 0], ['0', 0], ['three', 3], ['four', 4],
  ])('%s → %i', (said, want) => {
    expect(parsePuttAnswer(said)).toBe(want);
  });

  it('survives the way people actually answer', () => {
    expect(parsePuttAnswer('two putts')).toBe(2);
    expect(parsePuttAnswer('I had two')).toBe(2);
    expect(parsePuttAnswer('just one')).toBe(1);
    expect(parsePuttAnswer('uh, two.')).toBe(2);
    expect(parsePuttAnswer('two-putted')).toBe(2);
  });

  it('survives the transcriber mishearing a spoken digit', () => {
    // "to" for "two" is the single most common mishearing of an answer to this question.
    expect(parsePuttAnswer('to')).toBe(2);
    expect(parsePuttAnswer('too')).toBe(2);
  });

  it('does NOT claim an utterance that means something else', () => {
    // Hijacking everything would be the same bug mirrored: the player could never correct the caddie.
    for (const said of ['no, I made a five', "what's my score", 'next hole', 'driver', '']) {
      expect(parsePuttAnswer(said)).toBeNull();
    }
  });

  it('rejects an implausible count rather than storing it', () => {
    expect(parsePuttAnswer('47')).toBeNull();
  });
});

describe('EVERY voice surface consults it — one path covered is how this bug survived', () => {
  // 2026-09-11 — the intercept itself is now ONE function (pendingPuttAsk.tryAnswerPendingPutts).
  // It used to be hand-copied per surface, and hooks/useCaddieTabMic never received a copy — which
  // is why "bogey / how many putts / 2" still came back an eagle a month after the "fix".
  it('the on-screen mic checks BEFORE any classification', () => {
    const src = read('hooks/useVoiceCaddie.ts');
    const intercept = src.indexOf('tryAnswerPendingPutts(transcript)');
    const bypasses = src.indexOf('const bypass = checkBypasses(transcript);');
    expect(intercept).toBeGreaterThan(-1);
    // Bypasses, the local precheck and the classifier will all read a bare number as a score.
    expect(intercept).toBeLessThan(bypasses);
  });

  it('the caddie-tab mic checks before it reaches the brain — the path that never had one', () => {
    const src = read('hooks/useCaddieTabMic.ts');
    const intercept = src.indexOf('tryAnswerPendingPutts(transcript)');
    const brain = src.indexOf('const turn = await askCaddie({');
    expect(intercept).toBeGreaterThan(-1);
    expect(intercept).toBeLessThan(brain);
  });

  it('the earbud / global-mic path checks before ITS classification', () => {
    const src = read('services/listeningSession.ts');
    const intercept = src.indexOf('tryAnswerPendingPutts(utterance)');
    const precheck = src.indexOf('let intent: VoiceIntent | null = precheckLocalIntent(utterance);');
    expect(intercept).toBeGreaterThan(-1);
    expect(intercept).toBeLessThan(precheck);
  });

  it('the follow-up loop uses the SHARED state, not its own sniff of the last line', () => {
    const src = read('hooks/useVoiceCaddie.ts');
    // The original: /putt/i.test(lastKevinText) && /\?/.test(lastKevinText) — a second definition of
    // "is a putt question open", which is exactly how one path got fixed and the rest didn't.
    expect(src).not.toContain('const awaitingPutts = /putt/i.test(lastKevinText)');
    // Both the follow-up loop and the primary path route through the shared owner.
    expect(src.split('tryAnswerPendingPutts(').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('both places the caddie ASKS mark the question open', () => {
    expect(read('services/intents/logScoreHandler.ts')).toContain('markAwaitingPutts(hole)');
    expect(read('services/intents/logPuttsHandler.ts')).toContain('markAwaitingPutts(hole)');
  });

  it('logging putts clears it, so the next number is a score again', () => {
    expect(read('services/intents/logPuttsHandler.ts')).toContain('clearAwaitingPutts()');
  });

  it('a non-answer clears it too — the player has moved on', () => {
    // Now a property of the shared owner rather than of each copy.
    const src = read('services/pendingPuttAsk.ts');
    const fn = src.slice(src.indexOf('export function tryAnswerPendingPutts'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('clearAwaitingPutts();');
  });

  it('the caddie asking in his OWN words opens the question, from one place', () => {
    // markAwaitingPutts used to be reachable only through logScoreHandler / logPuttsHandler, so a
    // brain-worded "how many putts?" left the next bare number to be read as a score.
    expect(read('services/caddieBrain.ts')).toContain('noteCaddieAskedForPutts(text');
  });
});

describe('the scorecard shows where putts are missing, and lets you fix it', () => {
  const src = read('app/(tabs)/scorecard.tsx');

  it('distinguishes "never recorded" from "zero putts"', () => {
    // A hole-out from off the green is a real 0. Collapsing the two would either hide the gap or
    // invent a putt count.
    expect(src).toContain('const holePuttsRecorded = holePuttsRaw != null;');
  });

  it('flags a scored hole with no putt count', () => {
    expect(src).toContain("{t('scorecard.add_putts')}");
    expect(src).toContain(') : hasScore ? (');
  });

  it('lets the player set putts inline — there was no way to do this at all before', () => {
    expect(src).toContain('logPutts(hole, n)');
    expect(src).toContain('const logPutts = useRoundStore(s => s.logPutts);');
  });

  it('offers 0 through 4 and marks the current value', () => {
    expect(src).toContain('([0, 1, 2, 3, 4] as const).map(n =>');
    expect(src).toContain('(viewPutts as Record<number, number>)[hole] === n');
  });

  it('stays optional — an unanswered hole is honestly unknown, not a guessed two', () => {
    // GIR is derived as (score − putts) ≤ par − 2, so a missing count contributes nothing rather
    // than being filled in.
    expect(src).toContain("if (putts == null) continue; // can't compute GIR without putts");
  });
});
