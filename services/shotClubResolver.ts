/**
 * 2026-08-09 (Tim — "missing major club use logic. If user does not change the advised club then that
 * use should be logged and tied to the distances and populated. We have always had the dumbest lost
 * logic when it comes to club use.")
 *
 * ONE arbiter for "what club was this shot actually hit with", used by every shot-logging path:
 *
 *   1. EXPLICIT — the user said the club in the same breath ("hit a 7 iron 150"). Always wins.
 *   2. DECLARED vs ADVISED by RECENCY — the player's last declared club (voice club change /
 *      plan) and the caddie's last recommendation (pendingKevinRec) both carry timestamps; the
 *      MORE RECENT one stands. This is the missing rule: caddie says "this is an 8-iron", player
 *      hits it without a word → the 8-iron IS the club, it gets logged, and (via the tracked-shot
 *      confirm chain) its measured distance trains the learned bag. If the player changed club
 *      AFTER the advice, their change wins.
 *   3. Neither fresh → null (callers may fall back to distance inference, clearly lower trust).
 *
 * FRESHNESS: both signals expire after 12 minutes — a club declared three holes ago is stale, not
 * "current". (pendingKevinRec is additionally cleared on hole change and consumed on shot log by
 * the callers, so the window rarely matters for advice; it protects the declared-club side.)
 */

import { useRoundStore } from '../store/roundStore';
import { normalizeClub } from './clubNormalize';

const FRESH_MS = 12 * 60 * 1000;

/**
 * 2026-08-17 (Tim — "shot recommendation in club has always been an issue… make sure it's all
 * cleaned") — TWO defects lived in this file's own comparison, under a header describing the fix.
 *
 * ONE: adherence compared RAW STRINGS. The three sides speak different vocabularies —
 * `recommend_club` passes the brain's free text ("8 iron"), `setClub` stores whatever it was handed
 * verbatim (roundStore.ts:2409), and `inferClub` returns a canonical ClubName ("8I"). So
 * `"8 iron" === "8I"` is false and a player who hit EXACTLY the club the caddie called was recorded
 * as having ignored it. The one path that got it right was the voice-correction handler
 * (correctLastShotHandler.ts:106, which normalizes both sides) — meaning adherence would be wrong
 * when the shot was logged and then silently flip to correct if the player happened to correct it.
 *
 * TWO: not every pending stamp is advice. queryStatusHandler stamps `inferClub(yards)` — the APP
 * guessing a club from distance, which the caddie never said — through the same slot the caddie's
 * spoken recommendation uses. Adherence measured against a guess is meaningless, and it fed the
 * recap's "you took my club X% of the time" line (recapGenerator.ts:113). Perversely, the invented
 * recommendations compared cleanly (canonical on both sides) while the real spoken ones did not.
 *
 * Both are fixed HERE rather than at the call sites, because this is the one arbiter and the call
 * sites are exactly what drifted last time. [[no-half-fixes-enforce-every-surface]]
 */

/** Where a pending recommendation came from. Absent on stamps persisted before 2026-08-17. */
export type RecKind = 'spoken' | 'engine' | 'inferred';

/** Only a real recommendation can be adhered to. An app inference is attribution, not advice. */
function isAdvice(kind: RecKind | null | undefined): boolean {
  return kind !== 'inferred';
}

/**
 * Compare two club names across vocabularies. Normalizes both sides to the canonical ClubName the
 * bag and Arccos import key on; falls back to a case-insensitive trim when a side isn't a club we
 * recognise, which is still strictly better than the `===` this replaced.
 */
export function sameClub(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const na = normalizeClub(a);
  const nb = normalizeClub(b);
  if (na && nb) return na === nb;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export interface ResolvedShotClub {
  club: string | null;
  source: 'explicit' | 'declared' | 'advised' | null;
  /** True when the resolved club IS the caddie's recommendation (silent adherence included).
   *  Null when there was no advice to adhere to — including when the pending stamp was an app
   *  inference rather than something the caddie said. */
  adhered: boolean | null;
  /** The caddie's recommendation for this shot, for kevin_rec_* stamping. NULL for an inferred
   *  stamp: writing a club the caddie never recommended into kevin_rec_club would put words in
   *  their mouth and corrupt every downstream adherence read. */
  recClub: string | null;
  recShape: string | null;
  /** A pending stamp existed (ANY kind). Callers use this to decide whether to clear the slot —
   *  it must not be conditioned on recClub, or an inferred stamp would never be consumed. */
  hadPending: boolean;
}

export function resolveShotClub(explicit?: string | null): ResolvedShotClub {
  const round = useRoundStore.getState();
  const rec = round.pendingKevinRec ?? null;
  const pendingClub = rec?.club ?? null;
  const hadPending = pendingClub != null;
  // Stamps written before this change carry no kind; they came from the advice paths, so treating
  // an absent kind as advice preserves exactly the prior meaning for already-persisted state.
  const advice = isAdvice(rec?.kind as RecKind | null | undefined);
  const recClub = advice ? pendingClub : null;
  const recShape = advice ? (rec?.shape ?? null) : null;
  const adheredTo = (club: string | null): boolean | null =>
    advice && pendingClub != null && club != null ? sameClub(club, pendingClub) : null;

  if (explicit && explicit.trim()) {
    const c = explicit.trim();
    return { club: c, source: 'explicit', adhered: adheredTo(c), recClub, recShape, hadPending };
  }

  const now = Date.now();
  const declaredFresh = round.club != null && round.clubSetAt != null && now - round.clubSetAt <= FRESH_MS;
  const recAt = rec?.at ?? null;
  const advisedFresh = pendingClub != null && recAt != null && now - recAt <= FRESH_MS;

  if (declaredFresh && advisedFresh) {
    // Recency arbitration: a club change AFTER the advice overrides it; advice after a change stands.
    if ((round.clubSetAt as number) >= (recAt as number)) {
      return { club: round.club, source: 'declared', adhered: adheredTo(round.club), recClub, recShape, hadPending };
    }
    // The pending club stands as the club hit. It only counts as ADHERENCE when it was advice.
    return { club: pendingClub, source: 'advised', adhered: advice ? true : null, recClub, recShape, hadPending };
  }
  if (declaredFresh) {
    return { club: round.club, source: 'declared', adhered: adheredTo(round.club), recClub, recShape, hadPending };
  }
  if (advisedFresh) {
    return { club: pendingClub, source: 'advised', adhered: advice ? true : null, recClub, recShape, hadPending };
  }
  return { club: null, source: null, adhered: null, recClub, recShape, hadPending };
}
