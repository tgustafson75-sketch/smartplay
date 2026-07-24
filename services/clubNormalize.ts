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
  // Bare "iron"/"wood"/"hybrid"/"wedge" with no number → genuinely ambiguous; don't guess (would corrupt
  // a specific club's learned data). Return null so the caller skips training rather than mislabel.
  return null;
}

/** True when `raw` resolves to a real full-swing club (excludes Putter + unresolvable). */
export function isFullSwingClub(raw: string | null | undefined): boolean {
  const n = normalizeClub(raw);
  return n != null && n !== 'Putter';
}
