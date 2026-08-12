/**
 * 2026-08-12 (Tim) — "I've been saying to the caddie, I got a bogey. And it'll say, okay, how many
 * putts? And I'll say two. And I know we supposedly fixed it, but if you say two, it could say you
 * got an eagle, and it'll go with that. And then you have to argue to get it fixed."
 *
 * The fix existed and covered ONE path. When the caddie asked "How many putts?", an intercept inside
 * runFollowUpListenLoop caught a bare number and logged it as putts. But that loop only runs when
 * the mic auto-reopens. Tap the mic to answer, answer after the loop times out, or answer on the
 * earbud path — and "two" reached the score parser instead, which read it as a two on the hole. On
 * a par 4 that's an eagle, and it overwrote the bogey he had just logged.
 *
 * The bug isn't the parse. It's that "the caddie is waiting for a putt count" was a LOCAL VARIABLE
 * inside one loop rather than a fact about the conversation. Every voice surface needs to know it,
 * so it lives here — set when the caddie asks, consulted before ANY transcript is classified.
 *
 * Why this is worse than a normal misparse: it silently rewrites a score the player already gave
 * correctly, and the only way back is to argue with the caddie. That is the opposite of
 * [[feels-like-a-real-caddie]] — a person you asked "how many putts?" does not hear "two" and
 * decide you meant you holed out in two.
 */

/** How long a putt question stays open. Long enough to think and answer; short enough that a bare
 *  number ten minutes later is a score again, which is what it almost certainly is. */
const ASK_TTL_MS = 90_000;

let askedAt = 0;
let askedForHole: number | null = null;

/** The caddie just asked for a putt count. Call at every site that asks. */
export function markAwaitingPutts(hole: number | null): void {
  askedAt = Date.now();
  askedForHole = typeof hole === 'number' && hole >= 1 && hole <= 18 ? hole : null;
}

/** Is a putt question still open? */
export function isAwaitingPutts(): boolean {
  return askedAt > 0 && Date.now() - askedAt < ASK_TTL_MS;
}

/** The hole the question was about (the SCORED hole, which may not be the nav hole). */
export function awaitingPuttsHole(): number | null {
  return isAwaitingPutts() ? askedForHole : null;
}

/** Answered, abandoned, or superseded. */
export function clearAwaitingPutts(): void {
  askedAt = 0;
  askedForHole = null;
}

const PUTT_WORDS: Record<string, number> = {
  zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  // Whisper transcribes a bare spoken digit as a word surprisingly often, and "to"/"too" for "two"
  // is the single most common mishearing of an answer to this question.
  to: 2, too: 2, for: 4, won: 1,
};

/**
 * Read a putt count out of an answer to "how many putts?".
 *
 * Deliberately STRICT: only a bare number, a number word, or a number with an explicit putt word.
 * A sentence that says anything else ("no, I made a five", "what's my score") must fall through to
 * normal routing — hijacking it would be the same class of bug in the other direction, where the
 * player can't correct the caddie because every utterance becomes a putt count.
 */
export function parsePuttAnswer(transcript: string): number | null {
  const t = (transcript ?? '').trim().toLowerCase().replace(/[.!,]+$/, '');
  if (!t) return null;

  // "two putts" / "2 putts" / "two-putted" — explicit, accept anywhere in a short phrase.
  const explicit = /\b(\d{1,2}|zero|none|one|two|three|four|five|six)[\s-]*putt/.exec(t);
  if (explicit) {
    const raw = explicit[1];
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : PUTT_WORDS[raw];
    return typeof n === 'number' && n >= 0 && n <= 10 ? n : null;
  }

  // A BARE answer — the common case, and the one that was being read as a score.
  // Fillers often carry a comma the transcriber inserted ("uh, two"), so allow one after the word.
  const bare = t.replace(/^(?:uh|um|ah|well|it was|i had|i hit|just|only)[,\s]+/, '').trim();
  if (/^\d{1,2}$/.test(bare)) {
    const n = parseInt(bare, 10);
    return n >= 0 && n <= 10 ? n : null;
  }
  if (PUTT_WORDS[bare] !== undefined) return PUTT_WORDS[bare];

  return null;
}
