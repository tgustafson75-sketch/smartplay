/**
 * 2026-08-14 — WATCH-CONFIRMED SHOTS.
 *
 * Tim's idea, and it is the right one: "if we can get the watch to work, a swing is confirmatory of
 * that final stopping spot as well as timing, but not messing up the logic."
 *
 * The two signals we have are each unreliable, and they fail in OPPOSITE directions:
 *
 *   GPS   over-counts — a cart stop, or walking to a partner's ball, looks like a shot
 *   Watch over-counts — a waggle or a rehearsal looks like a swing (services/round/roundSwingRead
 *                       says so outright: an IMU cannot tell a rehearsal from the real one)
 *
 * Neither can fix itself. Together they can: a stop with a swing beside it in time is a shot, a stop
 * with no swing is probably not, and a swing with no stop is probably a rehearsal. That intersection
 * is what makes a drawn shot line trustworthy rather than decorative — which is why this ships with
 * the map rather than after it.
 *
 * DELIBERATELY NON-DESTRUCTIVE. This never deletes, reorders or invents a shot. It annotates the
 * shots we already logged, so a wrong match costs a badge and nothing else. The round, the scorecard
 * and the handicap are untouched by anything in this file.
 *
 * PURE + SYNC — no store reads, no network, no React. The caller passes both lists in.
 */

/** Minimal shot shape — matches store/roundStore's ShotResult without importing it. */
export interface ConfirmableShot {
  timestamp: number;
  hole: number;
  club?: string | null;
}

/** Minimal swing shape — matches the watch swings persisted on RoundRecord. */
export interface ConfirmingSwing {
  timestamp: number;
  hole?: number | null;
  club?: string | null;
  tempoRatio?: number;
}

export interface ShotConfirmation {
  /** Index into the shots array this refers to. */
  shotIndex: number;
  /** True when a watch swing sits close enough in time to corroborate this shot. */
  confirmed: boolean;
  /** How far apart they were, ms. Null when unconfirmed. */
  deltaMs: number | null;
  /** The swing's tempo, when we matched one — the honest on-course metric. */
  tempoRatio: number | null;
  /** The club the WATCH recorded, which can differ from the club logged on the shot. */
  swingClub: string | null;
}

/**
 * How close in time a swing has to be to count as the same event.
 *
 * A shot's timestamp is when the app RESOLVED the shot (GPS settling, or the player logging it), and
 * the swing is stamped when the wrist felt it — so the swing reliably lands FIRST, by an amount that
 * depends on how fast GPS settled. 90s is generous enough to survive a slow fix without being so wide
 * that the previous shot on the same hole starts matching.
 */
export const CONFIRM_WINDOW_MS = 90_000;

/**
 * Annotate each shot with whether a watch swing corroborates it.
 *
 * Greedy nearest-match, and each swing is consumed at most once: two shots cannot both claim the same
 * swing, because that would manufacture confirmation out of one real event. Shots are matched in the
 * order given so the pairing is deterministic and testable.
 */
export function confirmShotsWithSwings(
  shots: readonly ConfirmableShot[],
  swings: readonly ConfirmingSwing[],
  windowMs: number = CONFIRM_WINDOW_MS,
): ShotConfirmation[] {
  const used = new Set<number>();
  return shots.map((shot, shotIndex) => {
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;
      const sw = swings[i];
      // A swing tagged to a DIFFERENT hole is not this shot, however close in time — that tag was
      // stamped at capture from the live round and is better evidence than proximity.
      if (sw.hole != null && sw.hole !== shot.hole) continue;
      if (!Number.isFinite(sw.timestamp) || !Number.isFinite(shot.timestamp)) continue;
      const delta = Math.abs(shot.timestamp - sw.timestamp);
      if (delta <= windowMs && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) {
      return { shotIndex, confirmed: false, deltaMs: null, tempoRatio: null, swingClub: null };
    }
    used.add(bestIdx);
    const sw = swings[bestIdx];
    return {
      shotIndex,
      confirmed: true,
      deltaMs: bestDelta,
      tempoRatio: typeof sw.tempoRatio === 'number' && sw.tempoRatio > 0 ? sw.tempoRatio : null,
      swingClub: sw.club ?? null,
    };
  });
}

/**
 * One honest line for the UI. Says what was corroborated and what wasn't, without implying the
 * unconfirmed ones are wrong — the watch simply may not have been on, or may have missed it (putts
 * and short chips never register).
 */
export function confirmationSummary(confirmations: readonly ShotConfirmation[]): string | null {
  const total = confirmations.length;
  if (total === 0) return null;
  const n = confirmations.filter((c) => c.confirmed).length;
  if (n === 0) return null;
  return `${n} of ${total} shot${total === 1 ? '' : 's'} confirmed by your watch`;
}
