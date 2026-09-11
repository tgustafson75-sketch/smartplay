/**
 * 2026-09-11 (Tim, ~50th report): "I say I got a bogey, it asks how many putts, I say 2, and it
 * still says eagle."
 *
 * The 08-12 fix moved "a putt question is open" out of a loop-local variable into pendingPuttAsk —
 * then hand-copied the INTERCEPT into three of the four transcript paths. hooks/useCaddieTabMic, the
 * caddie-tab mic, never got one: a bare "2" answered there went to the score parser, and a 2 on a
 * par 4 is an eagle that overwrites the bogey just logged. And nothing marked the question open when
 * the BRAIN asked in its own words rather than through logScoreHandler.
 *
 * Both are now single-owner: tryAnswerPendingPutts is the one intercept, noteCaddieAskedForPutts is
 * called once inside askCaddie. This test drives the real functions.
 */
import {
  markAwaitingPutts, isAwaitingPutts, clearAwaitingPutts,
  tryAnswerPendingPutts, tryAnswerOpenQuestion, noteCaddieAskedForPutts, parsePuttAnswer,
} from '../../services/pendingPuttAsk';
import { markAwaitingPar, clearAwaitingPar, parseParAnswer, tryAnswerPendingPar } from '../../services/pendingParAsk';
import { useRoundStore } from '../../store/roundStore';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  clearAwaitingPutts();
  useRoundStore.setState({
    isRoundActive: true,
    currentHole: 4,
    scores: {},
    putts: {},
    lastMutation: null,
    courseHoles: [{ hole: 4, par: 4, distance: 400, front: 400, back: 400, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false }],
  } as never);
});

describe('the exact exchange Tim keeps reporting', () => {
  it('bogey → "how many putts?" → "2" logs TWO PUTTS and never touches the score', () => {
    useRoundStore.getState().logScore(4, 5);          // bogey on a par 4
    markAwaitingPutts(4);
    const answered = tryAnswerPendingPutts('2');
    expect(answered).not.toBeNull();
    expect(answered!.putts).toBe(2);
    expect(answered!.hole).toBe(4);
    // The score he gave correctly is untouched — this is the whole complaint.
    expect(useRoundStore.getState().scores[4]).toBe(5);
    expect(useRoundStore.getState().putts[4]).toBe(2);
  });

  it.each([
    '2', 'two', 'to', 'too', 'Two.', 'two putts', 'I had 2 putts',
    // 2026-09-11 — the phrasings a player actually uses when answering a question the caddie just
    // asked. "had two" fell through to the score parser, and the precheck routes it to log_score:
    // a 2 on a par 4, the eagle again.
    'had two', 'I had two', 'took two', 'just two', 'only two', 'about two', 'like two',
    'uh two', 'it was two', 'that was two', 'I two putted', 'I had a two putt',
  ])('claims "%s" as an answer, not a score', (said) => {
    markAwaitingPutts(4);
    expect(tryAnswerPendingPutts(said)?.putts).toBe(2);
  });

  it('the brain wording Tim actually gets opens the question, and the answer lands', () => {
    useRoundStore.getState().logScore(6, 5);
    noteCaddieAskedForPutts('Okay, a bogey on hole six. How many putts did you have?', 6);
    expect(isAwaitingPutts()).toBe(true);
    expect(tryAnswerOpenQuestion('I had two putts')).toEqual({ line: 'Got it — 2 putts.' });
    expect(useRoundStore.getState().scores[6]).toBe(5);
    expect(useRoundStore.getState().putts[6]).toBe(2);
  });
});

describe('it does not become over-sensitive the other way', () => {
  it('an explicit score correction still falls through to the score parser', () => {
    markAwaitingPutts(4);
    expect(tryAnswerPendingPutts('no, I made a five')).toBeNull();
    // ...and the question is closed, so the NEXT bare number is a score again.
    expect(isAwaitingPutts()).toBe(false);
  });

  it('claims nothing at all when no putt question is open', () => {
    expect(isAwaitingPutts()).toBe(false);
    expect(tryAnswerPendingPutts('2')).toBeNull();
    expect(useRoundStore.getState().putts[4]).toBeUndefined();
  });

  it('a stale question does not swallow a score minutes later', () => {
    markAwaitingPutts(4);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 120_000;   // past the 90s TTL
      expect(isAwaitingPutts()).toBe(false);
      expect(tryAnswerPendingPutts('2')).toBeNull();
    } finally { Date.now = realNow; }
  });

  it('parsePuttAnswer refuses things that are plainly not a putt count', () => {
    for (const said of ['what club', 'driver', 'I hit it 250', 'hole 7', 'nine']) {
      expect(parsePuttAnswer(said)).toBeNull();
    }
  });
});

describe('the caddie asking in his own words opens the question', () => {
  it.each([
    'Nice. How many putts?',
    'Bogey on four — how many putts on that one?',
    'Got it. And the putts?',
  ])('marks it open for: %s', (reply) => {
    noteCaddieAskedForPutts(reply, 4);
    expect(isAwaitingPutts()).toBe(true);
  });

  it.each([
    'Nice putt!',                       // no question
    'That was a good two-putt.',        // no question
    'What club did you hit?',           // a question, not about putts
    'Want me to read the green?',
  ])('does NOT mark it open for: %s', (reply) => {
    noteCaddieAskedForPutts(reply, 4);
    expect(isAwaitingPutts()).toBe(false);
  });
});

describe('every transcript path uses the one intercept', () => {
  const PATHS = [
    'hooks/useVoiceCaddie.ts',
    'hooks/useCaddieTabMic.ts',
    'services/listeningSession.ts',
  ];

  // Every path answers EVERY open question through one call, so a surface cannot be wired for putts
  // and not for par — which is the mistake that left the caddie-tab mic uncovered for a month.
  it.each(PATHS)('%s calls tryAnswerOpenQuestion', (rel) => {
    expect(code(read(rel))).toContain('tryAnswerOpenQuestion');
  });

  it('no path re-implements the parse/log itself', () => {
    for (const rel of PATHS) {
      const src = code(read(rel));
      expect(src).not.toContain('parsePuttAnswer(');
      expect(src).not.toContain('awaitingPuttsHole(');
    }
  });

  it('the brain marks the question in exactly one place', () => {
    const callers = ['services/caddieBrain.ts', 'hooks/useVoiceCaddie.ts', 'hooks/useCaddieTabMic.ts', 'services/listeningSession.ts']
      .filter((f) => code(read(f)).includes('noteCaddieAskedForPutts('));
    expect(callers).toEqual(['services/caddieBrain.ts']);
  });
});

describe('a NAMED score with no par asks for par, never for a bare number', () => {
  beforeEach(() => clearAwaitingPar());

  it('logs the score the player already named once par arrives, then asks putts', () => {
    markAwaitingPar(4, 'I got a bogey');
    const res = tryAnswerPendingPar('four');
    expect(res).not.toBeNull();
    expect(res!.strokes).toBe(5);            // bogey on a par 4
    expect(useRoundStore.getState().scores[4]).toBe(5);
    expect(res!.line).toContain('bogey');
    // ...and the putt question is now open on that same hole, so the exchange continues.
    expect(isAwaitingPutts()).toBe(true);
  });

  it.each(['3', '4', '5', 'four', 'par four', "it's a 4", 'a 5', 'par 3'])('reads "%s" as par', (said) => {
    expect(parseParAnswer(said)).toBeGreaterThan(2);
  });

  it.each(['two', '7', 'I do not know', 'driver', '12'])('refuses "%s" as par', (said) => {
    expect(parseParAnswer(said)).toBeNull();
  });

  it('the handler asks for PAR, not for strokes, when a score name was said', () => {
    const src = read('services/intents/logScoreHandler.ts');
    expect(src).toContain('mentionsScoreName(intent.raw_text)');
    expect(src).toContain('markAwaitingPar(hole');
  });

  it('scoreLabel exists once, shared by both owners', () => {
    const copies = ['services/intents/scoreParse.ts', 'services/intents/logScoreHandler.ts', 'services/pendingParAsk.ts']
      .filter((f) => /function scoreLabel\(/.test(code(read(f))));
    expect(copies).toEqual(['services/intents/scoreParse.ts']);
  });
});
