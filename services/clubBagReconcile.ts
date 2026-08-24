/**
 * 2026-07-23 (Tim — Bag Vision) — pure "turn the known bag around onto a live club read".
 *
 * Kept dependency-free (no expo/RN imports) so it's unit-testable in the plain-node logic project
 * and importable from services/clubRecognition without pulling that module's native deps.
 */

/**
 * THE CLUB CATALOG — driver → putter, in canonical order. One owner.
 *
 * 2026-08-24 (club sweep, step 1 — inventory every representation). This list was declared SIX
 * times: here, store/clubBagStore (whose own comment said "keep one canonical order everywhere"),
 * api/tutorial-analysis, api/bag-scan, api/club-recognition and api/arccos-import. Five were
 * byte-identical; the sixth differed on purpose. Nothing linked them, so the only thing keeping six
 * copies in step was that nobody had edited one yet.
 *
 * This module is the right owner precisely because it has ZERO imports — it is reachable from the
 * plain-node logic project, from React Native, and from the Vercel functions alike. Adding an import
 * here would break all three at once, so it stays dependency-free.
 *
 * It sat exported and unread since 2026-07-23, and was listed in
 * docs/dead-exports-inventory-2026-08-09.txt two weeks ago — an inventory with nothing to enforce it.
 * The orphan LOCK in run-sim is why it could not be ignored a third time.
 */
export const CLUB_SNAP_ORDER = [
  'DR', '3W', '5W', '7W', '2H', '3H', '4H', '5H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'GW', 'AW', 'SW', 'LW', 'PT',
] as const;

/** A club id, from the one catalog. */
export type CatalogClubId = typeof CLUB_SNAP_ORDER[number];

/**
 * The catalog minus the putter — for anything reading a FULL-SHOT distance.
 *
 * api/arccos-import deliberately excluded 'PT' ("Putter carries no full-shot distance — the model is
 * told to skip it"). That exception is real and worth keeping; hand-maintaining a whole second list
 * to express it is not. Derived, so the exception is stated once and cannot drift from the catalog.
 */
/**
 * The club TYPE vocabulary the vision routes accept. Declared twice (api/bag-scan and
 * api/club-recognition) until 2026-08-24; same story as the catalog above.
 */
export const CLUB_TYPES = ['iron', 'wedge', 'hybrid', 'wood', 'driver', 'putter', 'unknown'] as const;

export const FULL_SWING_CLUB_IDS: readonly CatalogClubId[] =
  CLUB_SNAP_ORDER.filter((id) => id !== 'PT');

type Family = 'DR' | 'W' | 'H' | 'I' | 'WEDGE' | 'PT' | '?';
// The interchangeable long-game slots: a "4" can be a 4-iron, 4-hybrid, or (rarely) 4-wood —
// players routinely swap an iron for the same-number hybrid/wood. Same-number across these
// families is the classic substitution we snap.
const LONG_GAME: Family[] = ['I', 'H', 'W'];

function parseClub(id: string): { num: number | null; fam: Family } {
  if (id === 'DR') return { num: null, fam: 'DR' };
  if (id === 'PT') return { num: null, fam: 'PT' };
  const m = /^(\d+)([WHI])$/.exec(id);
  if (m) return { num: Number(m[1]), fam: m[2] as Family };
  if (id === 'PW' || id === 'GW' || id === 'AW' || id === 'SW' || id === 'LW') return { num: null, fam: 'WEDGE' };
  return { num: null, fam: '?' };
}

/**
 * When Bag Vision has populated the set the player actually owns, use it to disambiguate a live
 * recognition. If the read isn't owned, snap to the owned club that best explains it:
 *   1. SAME NUMBER, interchangeable long-game family — read 4I but the player carries a 4H (or 4W).
 *      This is the classic iron↔hybrid replacement.
 *   2. ADJACENT NUMBER, same family — read 4I but the player carries a 5I (a plausible mis-read).
 * Conservative on purpose:
 *   - HIGH-confidence reads are trusted as-is (the bag may be incomplete — don't override truth).
 *   - Never snaps across unrelated slots; wedges/driver/putter are left alone (loft, not number).
 *   - Empty bag → no change (we don't constrain when we don't know the set).
 */
export function reconcileClubWithBag(
  club_id: string,
  confidence: 'high' | 'medium' | 'low',
  ownedIds: readonly string[],
): string {
  if (!club_id || club_id === 'unknown' || ownedIds.length === 0) return club_id;
  if (ownedIds.includes(club_id)) return club_id;   // read matches an owned club → trust it
  if (confidence === 'high') return club_id;         // confident read wins even if "not owned"

  const p = parseClub(club_id);
  if (p.num == null || !LONG_GAME.includes(p.fam)) return club_id; // only long-game reads snap

  const owned = ownedIds.map((id) => ({ id, ...parseClub(id) }));

  // 1. Same number, interchangeable long-game family (4I → 4H).
  const sameNumber = owned.find((o) => o.num === p.num && LONG_GAME.includes(o.fam));
  if (sameNumber) return sameNumber.id;

  // 2. Adjacent number, same family (4I → 5I).
  let best: string | null = null;
  let bestDist = Infinity;
  for (const o of owned) {
    if (o.fam !== p.fam || o.num == null) continue;
    const d = Math.abs(o.num - p.num);
    if (d < bestDist) { bestDist = d; best = o.id; }
  }
  return best && bestDist === 1 ? best : club_id;
}
