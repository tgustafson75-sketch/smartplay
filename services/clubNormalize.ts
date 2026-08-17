/**
 * 2026-07-24 — THE canonical club-name normalizer.
 *
 * Why this exists: the app grew FOUR incompatible club vocabularies and a shot's club was written in
 * whichever one the producer used, then read as one:
 *   - ClubName  ("Driver" / "7I" / "Putter" / "AW")        — store/clubStatsStore (the learned-bag key)
 *   - ClubId    ("DR"     / "7I" / "PT"     / "AW")        — services/clubRecognition (voice/vision)
 *   - Acoustic  ("D"      / "7I" / —        / "H"/"GW")    — api/acoustic-detect
 *   - Words     ("driver" / "7-iron" / "putter" / "gap wedge" / generic "hybrid") — QuickLogShotSheet
 *
 * So `record(shot.club as ClubName, yds)` silently trained the bag under keys like 'DR' / 'driver' /
 * 'PT' that are NOT in CLUB_ORDER — a driver logged by voice or quick-log literally never registered
 * in the bag, and one club split into several usage rows. The `as ClubName` cast hid it at compile time.
 * That is the structural reason "club logic always causes issues."
 *
 * normalizeClub() maps ANY of the four forms → the canonical ClubName (the clubStatsStore key), or null
 * when it genuinely can't tell (e.g. a bare "hybrid" with no number). Pure + dependency-light so it's
 * unit-testable and safe to call at every write boundary. The canonical list here MUST match
 * clubStatsStore.CLUB_ORDER (a sim asserts it).
 */
import type { ClubName } from '../store/clubStatsStore';

// Canonical ClubName members (mirror of clubStatsStore.CLUB_ORDER — kept in sync by a sim check).
const CANONICAL: ClubName[] = [
  'Driver', '3W', '5W', '7W', '2H', '3H', '4H', '5H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'AW', 'GW', 'SW', 'LW', 'Putter',
];
const CANON_SET = new Set<string>(CANONICAL);

// Non-identity aliases → ClubName. Identity cases (e.g. "7I", "3W", "AW") are handled by CANON_SET.
const ALIAS_TO_NAME: Record<string, ClubName> = {
  // ClubId / acoustic forms that differ from ClubName.
  DR: 'Driver', D: 'Driver', PT: 'Putter',
  // Spoken / written words.
  DRIVER: 'Driver', PUTTER: 'Putter',
  'PITCHING WEDGE': 'PW', 'PITCHING': 'PW',
  'GAP WEDGE': 'GW', 'APPROACH WEDGE': 'AW', 'ATTACK WEDGE': 'AW',
  'SAND WEDGE': 'SW', 'LOB WEDGE': 'LW',
};

/**
 * 2026-08-17 (Tim — "if I say it's an eighteen three driver iron or a fifty two or a fifty six or a
 * fifty eight degree wedge or my driver… club logic, I don't know why we've had such issues with
 * it, but everything needs to be super super clean with it because it's the whole point of golf").
 *
 * SPOKEN NUMBERS ABOVE TEN. The number-word table in services/clubRecognition stopped at "ten", so
 * every loft a golfer actually says by name — "eighteen degree driving iron", "fifty two", "fifty
 * six" — never became a digit and never reached the loft matchers that were built for exactly those
 * phrases. The 2026-08-10 commit that added driving-iron loft parsing quotes Tim saying "eighteen
 * degree driving iron" in its own header, and that sentence could not parse: only "18 degree
 * driving iron" did. A fix reachable only by typing digits is not a fix for a voice app.
 *
 * Shared from here (this module is pure and dependency-light) so the phrase parser and the token
 * normalizer cannot drift apart on what a number is. [[no-half-fixes-enforce-every-surface]]
 */
const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};

/**
 * Convert spoken number words to digits, including the compound forms golfers actually use
 * ("fifty two", "fifty-six", "twenty one"). Leaves everything else untouched.
 */
export function digitizeNumberWords(text: string): string {
  let s = text.toLowerCase();
  // Compounds first ("fifty two" → 52) so the parts aren't consumed separately.
  const tensAlt = Object.keys(TENS).join('|');
  const onesAlt = Object.keys(ONES).join('|');
  s = s.replace(new RegExp(`\\b(${tensAlt})[\\s-]+(${onesAlt})\\b`, 'g'), (_m, t: string, o: string) =>
    String(TENS[t] + ONES[o]));
  s = s.replace(new RegExp(`\\b(${tensAlt})\\b`, 'g'), (m) => String(TENS[m]));
  s = s.replace(new RegExp(`\\b(${Object.keys(TEENS).join('|')})\\b`, 'g'), (m) => String(TEENS[m]));
  s = s.replace(new RegExp(`\\b(${onesAlt})\\b`, 'g'), (m) => String(ONES[m]));
  return s;
}

/** Wedge slots by loft — the bag's own mapping (46-49 PW, 50-53 GW, 54-57 SW, 58-64 LW). */
function wedgeForLoft(loft: number): ClubName | null {
  if (loft < 46 || loft > 64) return null;
  return loft <= 49 ? 'PW' : loft <= 53 ? 'GW' : loft <= 57 ? 'SW' : 'LW';
}

/** Long-club slots by loft, per family. Thresholds mirror services/clubRecognition exactly. */
function longClubForLoft(loft: number, family: 'iron' | 'hybrid' | 'wood'): ClubName | null {
  if (loft < 14 || loft > 32) return null;
  if (family === 'hybrid') return loft <= 18 ? '2H' : loft <= 20 ? '3H' : loft <= 23 ? '4H' : '5H';
  if (family === 'wood') return loft <= 16 ? '3W' : loft <= 19 ? '5W' : '7W';
  return loft <= 21 ? '3I' : loft <= 24 ? '4I' : loft <= 27 ? '5I' : loft <= 30 ? '6I' : '7I';
}

/**
 * Normalize any club representation to the canonical ClubName, or null when unresolvable.
 * Never throws. Case/spacing/hyphen tolerant.
 */
export function normalizeClub(raw: string | null | undefined): ClubName | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (CANON_SET.has(s)) return s as ClubName;                 // already ClubName

  const upper = s.toUpperCase();
  if (CANON_SET.has(upper)) return upper as ClubName;         // "7i" → "7I", "aw" → "AW"
  if (ALIAS_TO_NAME[upper]) return ALIAS_TO_NAME[upper];      // "DR"/"PT"/"D" or a wedge word

  // Normalize word forms: collapse separators, then match patterns like "7 iron" / "3 wood" / "5 hybrid".
  const w = upper.replace(/[\s._-]+/g, ' ').trim();
  if (ALIAS_TO_NAME[w]) return ALIAS_TO_NAME[w];
  let m: RegExpMatchArray | null;
  if ((m = w.match(/^([1-9])\s*IRON$/))) { const n = `${m[1]}I`; return CANON_SET.has(n) ? (n as ClubName) : null; }
  if ((m = w.match(/^([1-9])\s*WOOD$/))) { const n = `${m[1]}W`; return CANON_SET.has(n) ? (n as ClubName) : null; }
  if ((m = w.match(/^([1-9])\s*HYBRID$/)) || (m = w.match(/^([1-9])\s*RESCUE$/)) || (m = w.match(/^([1-9])\s*UTILITY$/))) {
    const n = `${m[1]}H`; return CANON_SET.has(n) ? (n as ClubName) : null;
  }
  /**
   * 2026-08-17 — the vocabulary a golfer actually uses for a club, which stopped here before:
   * lofts ("52", "58 degree wedge", "eighteen degree driving iron"), possessives ("my driver"),
   * and driver lofts ("9.5"). Everything above this point is unchanged, so every form that already
   * resolved still resolves by the same route.
   */
  // Digitize spoken numbers, drop possessives/articles, collapse separators.
  const d = digitizeNumberWords(s)
    .replace(/\b(my|the|a|an|his|her|their)\b/g, ' ')
    // Collapse separators but PRESERVE decimal points: a driver loft is spoken as "10.5", and
    // eating that period turned it into "10 5" and lost the club entirely.
    .replace(/\.(?!\d)/g, ' ')
    .replace(/[\s_-]+/g, ' ')
    .trim();
  if (!d) return null;

  // Re-run the cheap paths on the cleaned text ("my driver" → "driver", "seven iron" → "7 iron").
  const dUp = d.toUpperCase();
  if (CANON_SET.has(dUp)) return dUp as ClubName;
  if (ALIAS_TO_NAME[dUp]) return ALIAS_TO_NAME[dUp];
  if ((m = dUp.match(/^([1-9])\s*IRON$/))) { const n = `${m[1]}I`; if (CANON_SET.has(n)) return n as ClubName; }
  if ((m = dUp.match(/^([1-9])\s*WOOD$/))) { const n = `${m[1]}W`; if (CANON_SET.has(n)) return n as ClubName; }
  if ((m = dUp.match(/^([1-9])\s*(?:HYBRID|RESCUE|UTILITY)$/))) { const n = `${m[1]}H`; if (CANON_SET.has(n)) return n as ClubName; }
  // A DRIVING IRON is not a driver. "eighteen three driver iron" contains the word "driver", so the
  // bare-driver check below would claim it — this must be decided first.
  const saysDrivingIron = /\b(driving|utility|drivers?)\s*iron\b|\bdi\b/.test(d);
  if (saysDrivingIron) {
    const n = d.match(/\b(1[4-9]|2[0-9]|3[0-2])\b/);
    return (n ? longClubForLoft(Number(n[1]), 'iron') : null) ?? '3I';
  }
  if (/\b(DRIVER|BIG STICK)\b/.test(dUp)) return 'Driver';
  if (/\bPUTTER\b/.test(dUp)) return 'Putter';

  const family: 'iron' | 'hybrid' | 'wood' =
    /\b(hybrid|rescue)\b/.test(d) ? 'hybrid' : /\bwood\b/.test(d) ? 'wood' : 'iron';

  // Loft with an explicit degree cue — wedge range first, then the long clubs.
  const degMatch = d.match(/\b(\d{1,2})(?:\.\d)?\s*(?:degrees?|deg|°)\b/);
  if (degMatch) {
    const loft = Number(degMatch[1]);
    const wedge = wedgeForLoft(loft);
    if (wedge && !/\b(iron|hybrid|rescue|wood)\b/.test(d)) return wedge;
    if (wedge && /\bwedge\b/.test(d)) return wedge;
    const long = longClubForLoft(loft, family);
    if (long) return long;
    // A driver loft spoken with degrees ("10.5 degrees") is still the driver.
    if (loft >= 8 && loft <= 13) return 'Driver';
  }

  // A BARE loft number, no degree word — "a fifty two", "56". Only meaningful because this
  // function receives a CLUB field, where a number is a loft; the phrase parser deliberately does
  // NOT do this, since a bare number in a sentence is far more likely a yardage.
  if ((m = d.match(/^(\d{2})$/))) {
    const wedge = wedgeForLoft(Number(m[1]));
    if (wedge) return wedge;
  }
  // Driver lofts are spoken as decimals ("9.5", "10.5") — unambiguous, no iron has such a loft.
  if (/^(8|9|1[0-3])(\.\d)$/.test(d)) return 'Driver';
  // A bare loft with a family cue but no degree word ("18 3 driver iron", "19 hybrid").
  if ((m = d.match(/\b(1[4-9]|2[0-9]|3[0-2])\b/)) && /\b(iron|hybrid|rescue|wood)\b/.test(d)) {
    const long = longClubForLoft(Number(m[1]), family);
    if (long) return long;
  }

  // Bare "iron"/"wood"/"hybrid"/"wedge" with no number → genuinely ambiguous; don't guess (would corrupt
  // a specific club's learned data). Return null so the caller skips training rather than mislabel.
  return null;
}

/** True when `raw` resolves to a real full-swing club (excludes Putter + unresolvable). */
export function isFullSwingClub(raw: string | null | undefined): boolean {
  const n = normalizeClub(raw);
  return n != null && n !== 'Putter';
}
