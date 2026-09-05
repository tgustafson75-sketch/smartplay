/**
 * services/intents/scoreParse.ts — PURE score-utterance parsing (2026-08-10).
 *
 * Split out of logScoreHandler so the parsing that decides what goes on the scorecard can be tested
 * directly. The handler imports roundStore, which transitively pulls bundled image assets, so
 * anything living in that file is unreachable from the logic test suite — which is precisely how
 * the bug below survived: it was never testable.
 *
 * Tim, from the course: "if I say I got a par on hole with two putt, the stupid caddie goes 'oh, you
 * got a two, a fucking eagle.' No motherfucker. Read the whole context. I got a double bogey and
 * two putt."
 *
 * TWO compounding defects produced that:
 *   1. Number parsing ran BEFORE the score-name parser and unconditionally won, so any digit in the
 *      sentence beat an explicitly spoken score — "two" from "two putts" became a 2, an eagle.
 *   2. The number-word loop iterated its map in VALUE order (one, two, three…) and returned the
 *      first word merely PRESENT, so the LOWEST number word won regardless of position:
 *      "a five with three putts" logged a 3.
 */

/**
 * Remove the clauses that carry numbers which are NOT the score. A putt count is the most common —
 * it's said in the same breath as the score almost every time — and pin distances are the next.
 * Runs before any number hunting, so those numbers can never be mistaken for strokes.
 */
export function stripNonScoreClauses(s: string): string {
  return s
    // "with/and/on/took 2 putts", "2-putted", "three putt", "two putt it"
    .replace(/\b(?:with|and|on|took|had|for)?\s*(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*putt(?:s|ed|ing)?\b/gi, ' ')
    // any bare "N putt" form that survived the above
    .replace(/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*putt(?:s|ed|ing)?\b/gi, ' ')
    // distances: "from 12 feet", "a 20 footer", "8 foot"
    .replace(/\b(?:from\s+)?(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:feet|foot|footer|yards?|yd)\b/gi, ' ')
    /**
     * 2026-09-05 (Tim, from the course) — CLUBS. "if I say I am going to use a 2 iron ... it still
     * may say Eagle and score the 2 as the score."
     *
     * A club number is the most common number in golf speech after the score itself, and it is said
     * constantly outside any scoring context. Nothing here stripped it, so "a 2 iron" put a 2 on the
     * scorecard and called it an eagle. Same for "5 wood", "3 hybrid", "56 degree".
     *
     * Covers the spoken forms and the shorthand people actually say: "7 iron", "7-iron", "7i",
     * "3 wood", "3W", "4 hybrid", "56 degree", "60 deg".
     */
    .replace(/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:-\s*)?(?:iron|wood|hybrid|rescue|utility|wedge|degree|deg)\b/gi, ' ')
    .replace(/\b(\d{1,2})\s*(?:i|w|h)\b/gi, ' ')
    // named clubs carry no number but often sit beside one: "driver 280"
    .replace(/\b(?:driver|putter|pitching|sand|lob|gap)\s*wedge?\b/gi, ' ')
    /**
     * Hole references. "I got a bogey on hole 7" — the 7 is where, not what.
     */
    .replace(/\bhole\s*(?:number\s*)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Strokes stated as a bare number ("a five", "a 7"). Null when no in-range number is present. */
export function parseStrokes(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const s = stripNonScoreClauses(raw.trim().toLowerCase());
  if (!s) return null;

  // Take the EARLIEST number in the sentence — digit or word, whichever comes first. Position is the
  // only ordering that reflects how people speak: the score is stated before the trimmings.
  let best: { idx: number; n: number } | null = null;
  const digit = s.match(/\b(\d{1,2})\b/);
  if (digit && digit.index != null) {
    const n = parseInt(digit[1], 10);
    if (n >= 1 && n <= 12) best = { idx: digit.index, n };
  }
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    const m = s.match(new RegExp(`\\b${word}\\b`));
    if (m && m.index != null && (best == null || m.index < best.idx)) best = { idx: m.index, n };
  }
  return best?.n ?? null;
}

/**
 * Par-relative score name → stroke count. Order matters: "double bogey" is matched before "bogey"
 * so the inner word can't claim it.
 */
export function parseScoreName(raw: unknown, par: number | null): number | null {
  if (par == null) return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  // Canonical tokens emitted by the classifier.
  if (s === 'eagle') return Math.max(1, par - 2);
  if (s === 'birdie') return Math.max(1, par - 1);
  if (s === 'par') return par;
  if (s === 'bogey') return par + 1;
  if (s === 'double_bogey' || s === 'double-bogey') return par + 2;
  if (s === 'triple_bogey' || s === 'triple-bogey') return par + 3;
  // Natural language, longest phrases first.
  if (/\b(triple[\s-]?bogey|tripled|triple)\b/.test(s)) return Math.min(12, par + 3);
  if (/\b(double[\s-]?bogey|doubled|double)\b/.test(s)) return Math.min(12, par + 2);
  if (/\b(eagled|eagle)\b/.test(s)) return Math.max(1, par - 2);
  if (/\b(birdied|birdie)\b/.test(s)) return Math.max(1, par - 1);
  if (/\bpar\b/.test(s)) return par;
  if (/\b(bogeyed|bogey)\b/.test(s)) return Math.min(12, par + 1);
  return null;
}

/** Does this utterance NAME a score in golf terms? If so it's the explicit statement of what they made. */
export function mentionsScoreName(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return /\b(par|bogey|bogeyed|birdie|birdied|eagle|eagled|double[\s-]?bogey|doubled|triple[\s-]?bogey|tripled|albatross)\b/i.test(raw);
}

/**
 * 2026-08-10 — the other half of "read the whole context". The player who says "par with two putts"
 * has just told us BOTH facts. Pulling the putt count out of the same sentence means we log it
 * instead of discarding it and then asking "how many putts?" — which is the kind of moment that
 * makes the caddie feel like a parser rather than a person ([[feels-like-a-real-caddie]]).
 * Returns null when no putt count was spoken. 0-6 only; anything else is a mis-transcription.
 */
export function parsePutts(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  const m = s.match(/\b(\d{1,2}|one|two|three|four|five|six|zero|no)[\s-]*putt(?:s|ed|ing)?\b/);
  if (!m) return null;
  const tok = m[1];
  const n = tok === 'no' || tok === 'zero' ? 0 : (NUMBER_WORDS[tok] ?? parseInt(tok, 10));
  return Number.isFinite(n) && n >= 0 && n <= 6 ? n : null;
}

/**
 * THE decision: read the WHOLE utterance and return the stroke count it actually states.
 *
 * A NAMED score wins whenever one is present and par is known, because a loose number alongside it
 * is almost always the putt count, the pin distance, or the hole number. Bare numeric reports
 * ("I made a five") are unaffected — there's no name to prefer.
 */
export function resolveStrokes(
  paramStrokes: unknown,
  rawText: unknown,
  par: number | null,
): number | null {
  if (mentionsScoreName(paramStrokes) || mentionsScoreName(rawText)) {
    const named = parseScoreName(paramStrokes, par) ?? parseScoreName(rawText, par);
    if (named != null) return named;
    /**
     * 2026-09-05 — A NAMED SCORE THAT CANNOT BE RESOLVED MUST NOT FALL THROUGH TO A STRAY NUMBER.
     *
     * Score names are par-relative, so with par unknown (course holes not loaded yet, or an
     * off-book hole) parseScoreName returns null. The old code then dropped into the numeric path
     * and took whatever digit was in the sentence — which, in "bogey with 2 putt", is the putt
     * count. The player said "bogey" and got a 2 logged as an eagle.
     *
     * The player naming a score is itself the evidence that no other number in that sentence is the
     * score. Returning null asks one short question instead of writing a wrong number silently, and
     * a wrong scorecard is far more expensive to the player than one clarifier.
     */
    return null;
  }
  return (
    parseStrokes(paramStrokes) ??
    parseStrokes(rawText) ??
    parseScoreName(paramStrokes, par) ??
    parseScoreName(rawText, par)
  );
}
