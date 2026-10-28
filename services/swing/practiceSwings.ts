/**
 * 2026-10-26 (Tim: "Practice swings still show on old uploads") — THE ONE OWNER of "is this a swing?".
 *
 * The swing finder is told to lean permissive (a net-caught or out-of-frame strike must not be lost), and
 * since S2m its two passes are UNIONED, so a practice swing either pass saw is carved as a swing. Nothing
 * downstream ever asked again. This module is the second look, and every reader of a swing list asks it:
 *
 *  - classifyPracticeSwings: run by the read (services/videoUpload) for every source. It DEMOTES a swing
 *    (shot.practice) — never deletes it. Only positive evidence demotes: the per-swing read saw the swing
 *    made with no ball (`ball_struck: 'no'`). A missing or 'unknown' answer (a server not yet deployed, a
 *    ball out of frame) changes nothing. A heard strike is never demoted. The last swing standing is never
 *    demoted. A swing the player restored stays restored.
 *  - isPracticeSwing / countedShots: what the detail strip, the library count, the SmartMotion reel, the
 *    practice credit and the caddie use instead of `shots.length`.
 *  - resplitEligible: whether a Re-analyze may look for an old upload's swings again — only when the finder
 *    carved every window and the player has put nothing on any swing; resplitWouldRestoreRemoved: whether
 *    what it found would bring back a swing he deleted before deletes were flagged.
 *
 * Not a demotion signal (a product call): the camera's ball-departure check. A ball that never left is a
 * duff — a real swing, scored as fat — not a practice swing, and it is not persisted per swing anyway.
 */
export type PracticeReason = 'no_ball_seen';
export interface PracticeMark { reason: PracticeReason; restoredByUser?: boolean }
export type BallStruck = 'yes' | 'no' | 'unknown';

type ShotLike = {
  id: string;
  practice?: PracticeMark | null;
  detectionMethod?: 'audio_transient' | 'manual';
  locateConfidence?: 'high' | 'low';
};

/** Demoted and not restored by the player. */
export function isPracticeSwing(shot: { practice?: PracticeMark | null } | null | undefined): boolean {
  return !!shot?.practice && shot.practice.restoredByUser !== true;
}

/** The swings that count — the list a reader shows as "N swings". */
export function countedShots<T extends object>(shots: readonly T[] | null | undefined): T[] {
  return Array.isArray(shots) ? shots.filter((s) => !isPracticeSwing(s as { practice?: PracticeMark | null })) : [];
}

/** A swing the finder was unsure of and no microphone vouched for: shown as doubtful, never hidden. */
export function swingIsDoubtful(shot: ShotLike): boolean {
  return shot.locateConfidence === 'low' && shot.detectionMethod !== 'audio_transient' && !isPracticeSwing(shot);
}

function ballStruck(read: unknown): BallStruck {
  const v = (read as { ball_struck?: unknown } | null | undefined)?.ball_struck;
  return v === 'yes' || v === 'no' ? v : 'unknown';
}

/**
 * Each shot's practice mark after this read. `reads` holds the read's answer per shot id; a shot with no
 * read (not read this time, or the read failed) keeps what it had.
 */
export function classifyPracticeSwings(
  shots: readonly ShotLike[],
  reads: Record<string, unknown>,
): Record<string, PracticeMark | null> {
  const out: Record<string, PracticeMark | null> = {};
  const fresh = new Set<string>();
  for (const sh of shots) {
    const prior = sh.practice ?? null;
    if (prior?.restoredByUser === true) { out[sh.id] = prior; continue; }
    if (sh.detectionMethod === 'audio_transient') { out[sh.id] = null; continue; }
    const b = Object.prototype.hasOwnProperty.call(reads, sh.id) ? ballStruck(reads[sh.id]) : 'unknown';
    if (b === 'no') {
      out[sh.id] = prior ?? { reason: 'no_ball_seen' };
      if (!prior) fresh.add(sh.id);
    } else if (b === 'yes') {
      out[sh.id] = null;
    } else {
      out[sh.id] = prior;
    }
  }
  // Never empty a session: if nothing would count, this read's new demotions are not applied.
  if (shots.length > 0 && shots.every((sh) => isPracticeSwing({ practice: out[sh.id] }))) {
    for (const id of fresh) out[id] = null;
  }
  return out;
}

/**
 * 2026-10-27 (Phase SB4x, review "practice #1") — the finder that split an upload, stamped on the session
 * (`swings_split_version`) by both splitters. A split carries nothing of the player's, so without the stamp
 * every Re-analyze split it again: the finder ran again, every practice mark was dropped and the demoted
 * swing's read was paid for again. Only a split an OLDER finder made (no stamp, or a lower one) is looked at
 * again. Bump this when services/poseDetection.locateSwings changes what it finds. 2026-10-27 (Phase SB5) —
 * stamped only when both finder passes answered (LocateSwingsCoverage): a half look's split stays open.
 */
export const UPLOAD_FINDER_VERSION = 1;

type SessionLike = {
  id: string;
  source?: string;
  /** The finder that made this split (UPLOAD_FINDER_VERSION); absent = an older finder. */
  swings_split_version?: number;
  /** The player removed a swing from this upload: its swing list is theirs now, never re-split. */
  swings_edited_by_user?: boolean;
  /** The headline names the swings it was read from — a named swing missing from the list was removed. */
  primary_issue?: { detected_in_shots?: readonly string[] | null } | null;
  shots: readonly (ShotLike & {
    clipUri?: string | null;
    clipStartSeconds?: number;
    clipWindowSource?: 'auto' | 'user';
    isGoodRep?: boolean | null;
    userNotes?: string | null;
    review_labels?: unknown;
    review_transcript?: string | null;
    feel_narration_transcript?: string;
    feel?: string | null;
    shape?: string | null;
    contact?: string | null;
    direction?: string | null;
  })[];
};

const said = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/**
 * Something the PLAYER put on this swing — a re-split would hang it on a different swing. 2026-10-27 — the
 * feel / shape / contact / direction tags too (the swing action sheet writes them per swing).
 */
export function shotHasUserContent(sh: SessionLike['shots'][number]): boolean {
  return sh.isGoodRep != null || said(sh.userNotes) || sh.review_labels != null || said(sh.review_transcript)
    || said(sh.feel_narration_transcript) || sh.practice?.restoredByUser != null
    || sh.feel != null || sh.shape != null || sh.contact != null || sh.direction != null;
}

/**
 * May a Re-analyze look for this session's swings again? Only an upload (a live capture's split fused what
 * the microphone heard), only when the finder carved EVERY window — today's 'auto', or the pre-10-26 shape
 * of the same thing (`${id}_shot_i`, one clip, 'manual', no window source) — only when an OLDER finder made
 * the split (UPLOAD_FINDER_VERSION), and only when the player has put nothing on any swing and removed none.
 */
export function resplitEligible(session: SessionLike): boolean {
  if (session.source !== 'uploaded_video' || session.shots.length === 0) return false;
  if (typeof session.swings_split_version === 'number' && session.swings_split_version >= UPLOAD_FINDER_VERSION) return false;
  if (session.swings_edited_by_user === true) return false;
  // 2026-10-27 (Phase SB6, recheck E2) — a delete made before swings_edited_by_user existed: the headline
  // still names a carved swing (`${id}_shot_k`) that is no longer in the list.
  const held = new Set(session.shots.map((sh) => sh.id));
  if ((session.primary_issue?.detected_in_shots ?? []).some((id) => id.startsWith(`${session.id}_shot_`) && !held.has(id))) return false;
  const clip = session.shots[0].clipUri;
  if (!clip) return false;
  return session.shots.every((sh, i) =>
    sh.id === `${session.id}_shot_${i}`
    && sh.clipUri === clip
    && typeof sh.clipStartSeconds === 'number'
    && (sh.clipWindowSource === 'auto' || (sh.clipWindowSource == null && sh.detectionMethod === 'manual'))
    && !shotHasUserContent(sh));
}

/**
 * 2026-10-27 (Phase SB6, recheck E2) — WOULD THIS RE-SPLIT BRING BACK A SWING THE PLAYER DELETED? Before SB4x
 * a delete set no flag (swings_edited_by_user), and dropping the LAST swing of an old finder split leaves the
 * ids in an unbroken run, so the split still looked untouched: Re-analyze ran the finder again and
 * replaceUploadSwings carved the deleted swing back, with a new paid read. On a split in the pre-10-26 shape
 * (no window source: made before deletes were flagged), a look that finds MORE swings than the session holds
 * cannot tell a swing the old finder missed from one he removed — the stored swings stand. Undoing his delete
 * is the worse error; a missed swing can still be analyzed at its moment. Today's 'auto' splits are not
 * held back: a half look's split stays open so the next whole look finds the swing it missed (SB5).
 */
export function resplitWouldRestoreRemoved(session: Pick<SessionLike, 'shots'>, windows: readonly unknown[]): boolean {
  const legacy = session.shots.length > 0 && session.shots.every((sh) => sh.clipWindowSource == null);
  return legacy && windows.length > session.shots.length;
}

/**
 * Which swings a session holds. A re-split reuses the shot ids (`${id}_shot_i`) for different swings, so a
 * screen holding per-swing state (the selected swing, compare picks) keys on this — the ids AND when the
 * session was last split — never on the windows (a trim moves one swing's window; it is still that swing).
 */
export function swingLayoutKey(session: { shots?: readonly { id: string }[] | null; swings_split_at?: number } | null | undefined): string {
  if (!session || !Array.isArray(session.shots)) return '';
  return `${session.swings_split_at ?? 0}|${session.shots.map((s) => s.id).join(',')}`;
}
