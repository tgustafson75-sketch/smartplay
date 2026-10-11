/**
 * 2026-10-10 (Tim: "surface showing last shot distance with particular emphasis on drives and shots where
 * user is getting better than their baseline") — THE LAST SHOT, AND WHETHER IT BEAT THE PLAYER.
 *
 * The distance already existed: roundStore.logShot back-fills a shot's GPS tee→rest total the moment the
 * NEXT shot on the hole starts, and services/round/recentShots resolves which number to trust. Nothing
 * on the round screen showed it — it lived on the Dashboard card. This decides what the round screen
 * shows and what the caddie may say about it.
 *
 * Honest by construction:
 *   - a distance is only what recentShots resolves (measured / GPS 5..500 yd) — never estimated here;
 *   - "past your usual" is only said against a REAL number for that club (measured shots or the
 *     player's own stated distance), compared like for like: a GPS total against the club's TOTAL;
 *   - a better-than-usual claim needs a clear margin (max(6 yd, 4%)) so GPS noise is not a story.
 *
 * Pure (time and the baseline are passed in) so jest drives it.
 */
import type { ShotResult } from '../../store/roundStore';
import type { ClubName } from '../../store/clubStatsStore';
import { recentShotFacts } from './recentShots';

export interface ClubBaseline {
  /** The club's usual TOTAL (tee→rest) in yards, or null when nothing real is known for it. */
  totalYards: number | null;
}

export interface LastShotHighlight {
  shotId: string | undefined;
  hole: number;
  club: ClubName | null;
  yards: number;
  /** The player's usual total with this club, when a real one exists. */
  usualYards: number | null;
  /** yards − usual, when there is a usual. */
  delta: number | null;
  isDrive: boolean;
  /** Clearly beat the player's own usual for this club. */
  beatUsual: boolean;
  /** When the distance became known (the next shot started) — for freshness. */
  knownAt: number;
}

/** How long the round screen keeps showing a last shot. Long enough to walk to the ball and hit again. */
export const LAST_SHOT_FRESH_MS = 15 * 60 * 1000;

const DRIVE_CLUBS: readonly string[] = ['Driver', '3W', '5W', '7W'];

export function beatMargin(usual: number): number {
  return Math.max(6, Math.round(usual * 0.04));
}

/**
 * The most recent shot in this round whose distance is known, with its comparison — or null when none,
 * or when it is older than the fresh window.
 */
export function lastShotHighlight(
  shots: readonly ShotResult[],
  baselineFor: (club: ClubName) => ClubBaseline,
  now: number,
): LastShotHighlight | null {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const facts = recentShotFacts(s);
    if (!facts || facts.distanceYards == null) continue;
    // Known when the next shot on the same hole began (its back-fill), else when it was logged.
    const next = shots.slice(i + 1).find((x) => x.hole === s.hole);
    const knownAt = typeof next?.timestamp === 'number' ? next.timestamp : (typeof s.timestamp === 'number' ? s.timestamp : now);
    if (now - knownAt > LAST_SHOT_FRESH_MS) return null;
    const club = facts.club;
    const firstOnHole = (s.shot_in_hole_index ?? null) === 1;
    const isDrive = club === 'Driver' || (firstOnHole && club != null && DRIVE_CLUBS.includes(club));
    const usual = club ? baselineFor(club).totalYards : null;
    const usualYards = typeof usual === 'number' && Number.isFinite(usual) && usual > 0 ? Math.round(usual) : null;
    const delta = usualYards != null ? facts.distanceYards - usualYards : null;
    const beatUsual = usualYards != null && delta != null && delta >= beatMargin(usualYards);
    return { shotId: facts.id, hole: s.hole, club, yards: facts.distanceYards, usualYards, delta, isDrive, beatUsual, knownAt };
  }
  return null;
}

/** The strip's one-line label: "DRIVER 262 · +14 on your usual" / "7I 151". */
export function lastShotLine(h: LastShotHighlight, clubLabel: (c: ClubName) => string): string {
  const head = `${h.club ? clubLabel(h.club).toUpperCase() : 'LAST SHOT'} ${h.yards}`;
  if (h.beatUsual && h.delta != null) return `${head} · +${h.delta} on your usual`;
  return head;
}

/**
 * What the caddie may SAY unprompted — only the shots worth interrupting for: a drive, or anything that
 * clearly beat the player's usual. Null otherwise (the strip still shows every shot).
 */
export function lastShotSpokenLine(h: LastShotHighlight, clubSpoken: (c: ClubName) => string): string | null {
  if (h.beatUsual && h.delta != null) {
    const what = h.isDrive ? 'That drive' : h.club ? `That ${clubSpoken(h.club)}` : 'That one';
    return `${what} went ${h.yards} — ${h.delta} past your usual.`;
  }
  if (h.isDrive) return `That drive went ${h.yards}.`;
  return null;
}

const WEDGES: Record<string, string> = { PW: 'pitching wedge', AW: 'approach wedge', GW: 'gap wedge', SW: 'sand wedge', LW: 'lob wedge' };

/** How the caddie says a club: '7I' → '7 iron', '3W' → '3 wood', '4H' → '4 hybrid'. */
export function clubSpokenName(c: ClubName): string {
  if (c === 'Driver') return 'driver';
  if (c === 'Putter') return 'putter';
  if (WEDGES[c]) return WEDGES[c];
  const m = /^(\d)([WHI])$/.exec(c);
  if (m) return `${m[1]} ${m[2] === 'W' ? 'wood' : m[2] === 'H' ? 'hybrid' : 'iron'}`;
  return c;
}
