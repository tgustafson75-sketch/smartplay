/**
 * 2026-10-29 (Brain recheck r15) — ONE reader for a hole the player SAYS, in any of the ways a golfer
 * says it. Pure module (no store, no asset imports) so the precheck and the tests can both reach it.
 *
 * Before this, the precheck read only "on hole N" and "hole N". "I got a 4 on the 12th", "I made a 6 on
 * 12" and "I shot a 5 on the 7th" carried no hole at all, so a score written from the precheck landed on
 * the lowest unscored hole behind the player — a different hole from the one he named.
 *
 * Returns the hole number 1..18, or null. Order matters: the explicit "hole" forms win over a bare
 * "on 12", and a bare "on N" is refused when a golf unit follows it ("on 2 putts" is not hole 2).
 *
 * 2026-10-31 (Brain recheck r24, BRAIN-R24-1) — a SCORE statement never reads a bare WORD ordinal ("the first",
 * "on the second"); it is a count in a score: "I made a bogey, the first bogey of the day" named hole 1 and
 * overwrote his real hole-1 score. Digits with a suffix ("the 12th") and "hole N" still name a hole. A question
 * keeps the word ordinals ("what's the par on the twelfth" names hole 12).
 */
const CARDINAL: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
};
const ORDINAL: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18,
};

const CARDINAL_WORDS = Object.keys(CARDINAL).join('|');
const ORDINAL_WORDS = Object.keys(ORDINAL).join('|');
/** Any hole token: digits, a cardinal word, or an ordinal (digits with a suffix, or a word). */
const ANY_TOKEN = String.raw`(\d{1,2}(?:st|nd|rd|th)?|${ORDINAL_WORDS}|${CARDINAL_WORDS})`;
/** An ordinal only, so "the 12th" and "the twelfth" count and a bare "the 12" does not. */
const ORDINAL_TOKEN = String.raw`(\d{1,2}(?:st|nd|rd|th)|${ORDINAL_WORDS})`;
/** An ordinal written with digits and a suffix only ("the 12th"): the one ordinal form a score may use for a hole. */
const DIGIT_ORDINAL_TOKEN = String.raw`(\d{1,2}(?:st|nd|rd|th))`;
/** A golf unit after a bare number means it is a count, not a hole ("on 2 putts", "on 150 yards"). */
const NOT_A_COUNT = String.raw`(?!\s*(?:putts?|yards?|yds?|feet|foot|ft|strokes?|shots?|irons?|woods?|hybrids?|wedges?|driver|degrees?|times?|%))`;

const EXPLICIT_HOLE_RXS: RegExp[] = [
  new RegExp(String.raw`\b(?:on|at)\s+(?:hole|number)\s+${ANY_TOKEN}\b`, 'i'),
  new RegExp(String.raw`\bhole\s+${ANY_TOKEN}\b`, 'i'),
  new RegExp(String.raw`\b${ORDINAL_TOKEN}\s+hole\b`, 'i'),
  new RegExp(String.raw`\bon\s+(?:the\s+)?(\d{1,2})\b${NOT_A_COUNT}`, 'i'),
];

/** Every form that names a hole in a question. */
const SPOKEN_HOLE_RXS: RegExp[] = [
  EXPLICIT_HOLE_RXS[0],
  EXPLICIT_HOLE_RXS[1],
  new RegExp(String.raw`\b(?:on|at)\s+the\s+${ORDINAL_TOKEN}\b`, 'i'),
  new RegExp(String.raw`\bthe\s+${ORDINAL_TOKEN}\b`, 'i'),
  EXPLICIT_HOLE_RXS[2],
  EXPLICIT_HOLE_RXS[3],
];

/** The forms a score statement may use: no bare word ordinal, which counts ("the first bogey of the day"). */
const SCORE_HOLE_RXS: RegExp[] = [
  EXPLICIT_HOLE_RXS[0],
  EXPLICIT_HOLE_RXS[1],
  new RegExp(String.raw`\b(?:on|at)\s+the\s+${DIGIT_ORDINAL_TOKEN}\b`, 'i'),
  new RegExp(String.raw`\bthe\s+${DIGIT_ORDINAL_TOKEN}\b`, 'i'),
  EXPLICIT_HOLE_RXS[2],
  EXPLICIT_HOLE_RXS[3],
];

const tokenToHole = (tok: string): number => {
  const t = tok.toLowerCase();
  if (/^\d/.test(t)) return parseInt(t, 10);
  return CARDINAL[t] ?? ORDINAL[t] ?? NaN;
};

/**
 * 2026-10-31 (Brain recheck r23, BRAIN-PLAYER-1) — the hole the words NAME, whether or not it is a real hole.
 * parseSpokenHole returns only 1..18, so "I got a 6 on the 19th" read as "no hole named" and the caller fell back
 * to the hole he stands on. This keeps the number so the caller can refuse a named hole that does not exist.
 * Null only when no hole is named at all. `scoreStatement` reads the words as a score (see the header).
 */
export function namedSpokenHole(raw: string, scoreStatement = false): number | null {
  for (const rx of scoreStatement ? SCORE_HOLE_RXS : SPOKEN_HOLE_RXS) {
    const m = raw.match(rx);
    if (m) return tokenToHole(m[1]);
  }
  return null;
}

export function parseSpokenHole(raw: string, scoreStatement = false): number | null {
  for (const rx of scoreStatement ? SCORE_HOLE_RXS : SPOKEN_HOLE_RXS) {
    const m = raw.match(rx);
    if (!m) continue;
    const h = tokenToHole(m[1]);
    if (Number.isInteger(h) && h >= 1 && h <= 18) return h;
  }
  return null;
}
