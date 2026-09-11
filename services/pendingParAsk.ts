/**
 * 2026-09-11 (Tim, ~50th report of "I said bogey and it logged an eagle") — THE PAR QUESTION.
 *
 * `parseScoreName` returns null the moment par is unknown, so "I got a bogey" on a hole whose par we
 * do not have logged NOTHING and fell into logScoreHandler's generic clarifier: "How many strokes?"
 *
 * To a player who has been asked about putts on every other hole, that question sounds like the putt
 * question. He answers "2". Nothing was logged, so no putt question is open, and 2 goes in as the
 * STROKE COUNT — an eagle on a par 4, from a caddie that asked the wrong thing. The putt intercept
 * cannot help here: there was never a putt question to intercept.
 *
 * He already told us what he made. The fact WE are missing is par, so that is what gets asked, and
 * the answer lands here instead of in a stroke parser. Same shape as pendingPuttAsk: an open
 * question is a fact about the conversation, consulted by every transcript path through one owner.
 */

const ASK_TTL_MS = 90_000;

let askedAt = 0;
let askedForHole: number | null = null;
let originalUtterance = '';

/** The caddie just asked for this hole's par, holding the score the player already named. */
export function markAwaitingPar(hole: number, utterance: string | null | undefined): void {
  askedAt = Date.now();
  askedForHole = hole;
  originalUtterance = String(utterance ?? '');
}

export function isAwaitingPar(): boolean {
  return askedAt > 0 && Date.now() - askedAt < ASK_TTL_MS;
}

export function clearAwaitingPar(): void {
  askedAt = 0;
  askedForHole = null;
  originalUtterance = '';
}

/** A golf hole is a par 3, 4 or 5. Nothing else is an answer to "what's the par here?". */
const PAR_WORDS: Record<string, number> = { three: 3, four: 4, five: 5, 'par three': 3, 'par four': 4, 'par five': 5 };

export function parseParAnswer(raw: string): number | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[.!?]+$/, '');
  if (!s) return null;
  const direct = /^(?:it(?:'s| is)?\s+a?\s*|a\s+|par\s+)?(3|4|5)$/.exec(s);
  if (direct) return Number(direct[1]);
  for (const [word, n] of Object.entries(PAR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(s)) return n;
  }
  const m = /\bpar\s*(3|4|5)\b/.exec(s);
  return m ? Number(m[1]) : null;
}

/**
 * The player answered "what's the par?". Resolve the score they ALREADY named against it, log it,
 * and hand back the line to speak. Returns null when this was not an answer — the question closes
 * so a later number is not swallowed.
 */
export function tryAnswerPendingPar(transcript: string): { line: string; strokes: number; hole: number; par: number } | null {
  if (!isAwaitingPar()) return null;
  const par = parseParAnswer(transcript);
  const hole = askedForHole;
  const said = originalUtterance;
  if (par === null || hole === null) {
    clearAwaitingPar();
    return null;
  }
  const { parseScoreName, scoreLabel } = require('./intents/scoreParse') as typeof import('./intents/scoreParse');
  const strokes = parseScoreName(said, par);
  if (strokes == null) {
    clearAwaitingPar();
    return null;
  }
  const rs = (require('../store/roundStore') as typeof import('../store/roundStore')).useRoundStore.getState();
  rs.logScore(hole, strokes);
  clearAwaitingPar();
  // The score is in — now the putt question is the honest next one, on the SAME hole.
  (require('./pendingPuttAsk') as typeof import('./pendingPuttAsk')).markAwaitingPutts(hole);
  return {
    line: `Par ${par} — that's a ${scoreLabel(strokes, par)}, ${strokes}. How many putts?`,
    strokes, hole, par,
  };
}
