/**
 * 2026-09-29 (Tim — "check recent shots card on Dashboard tab. It's full of ? and I don't think it's
 * wired correctly.") — THE ONE OWNER OF "YOUR RECENT SHOTS".
 *
 * `roundStore.shots` is written by eleven producers, and they do not all write SHOTS:
 *
 *   - scorecard quick-score (app/(tabs)/scorecard.tsx handleQuickScore) writes one PLACEHOLDER row
 *     per stroke, id `qs-<hole>-<i>`, with club/direction/distance all null — so tapping "5" on a
 *     hole put five rows of nothing into the list. The scorecard, the dashboard's stat tiles and
 *     correct-last-shot all skip `qs-` already; the Recent Shots card and the caddie did not, and
 *     every one of those rows drew a help-outline "?" icon, "—" for the club and "—" for distance.
 *   - addPenalty (roundStore) writes a club-less `manual_penalty` row — a stroke, not a swing.
 *   - the cockpit quick taps write club-less rows that carry ONE fact (a direction, or "short of
 *     target" in outcome_text), and the card drew neither of those facts, only the "?".
 *   - cart-mode / unparsed voice (conversationalLoggingOrchestrator.logUntagged) writes a club-less
 *     row whose only fact arrives LATER — the GPS distance, back-filled when the next shot starts.
 *   - voice / brain / quick-log / auto-tracking / sim write real shots, with `club` in any of four
 *     vocabularies ('DR', 'driver', 'Driver', '7I'), which the card printed raw.
 *   - imported scorecards land in roundHistory with `shots: []`, and are appended in IMPORT order —
 *     so "the last round" by array position could be a round from last spring with no shots at all.
 *
 * And the card and the caddie each chose their pool separately: the card fell back to the last
 * round, the caddie's `recentShots` was the live round only (nothing off the course), and neither
 * filtered the placeholders. [[two-owners-is-the-root-cause]]
 *
 * This module decides WHICH shots are "recent shots" and WHAT each one is known to say. The dashboard
 * card, the shot log, the caddie request body and the voice pattern query all read it. A value that
 * is not known is null here and is left OUT downstream — never a "?". [[silence-is-not-an-answer]]
 *
 * Pure: type imports plus two dependency-free helpers, so jest's node project can drive it.
 */
import type { ShotResult, RoundRecord } from '../../store/roundStore';
import type { ClubName } from '../../store/clubStatsStore';
import type { ShotOutcome } from '../../types/shot';
import { shotDistance } from '../../utils/geoDistance';
import { normalizeClub } from '../clubNormalize';

/** A scorecard quick-score placeholder: one synthetic row per stroke, nothing hit, nothing known. */
export function isQuickScorePlaceholder(s: Pick<ShotResult, 'id'>): boolean {
  return typeof s.id === 'string' && s.id.startsWith('qs-');
}

/** A penalty STROKE added from the scorecard / menu (roundStore.addPenalty) — not a swing. */
export function isPenaltyStrokeRow(s: Pick<ShotResult, 'outcome' | 'club'>): boolean {
  return s.outcome === 'manual_penalty' && !s.club;
}

// Same plausibility window roundStore.logShot applies to its own GPS back-fill (5..500 yards) and the
// dashboard applies to longest drive (500). A value outside it is a corrupt capture, not a shot.
const MAX_SHOT_YARDS = 500;
const MIN_GPS_YARDS = 5;

/**
 * How far this shot went, in yards, from the data that exists — or null.
 *
 *   1. distance_yards  — what the player said / typed / the tracker measured (logShot also back-fills
 *                         it from GPS when nothing else supplied one)
 *   2. gps_distance_yards — the GPS tee→rest total logShot computed when the next shot began
 *   3. start_location → end_location — the same haversine, for a row whose end was recorded but no
 *                         distance was ever stamped (older data, tracked rows)
 */
export function recentShotDistanceYards(s: ShotResult): number | null {
  const ok = (y: unknown, min: number): y is number =>
    typeof y === 'number' && Number.isFinite(y) && y > min && y <= MAX_SHOT_YARDS;
  if (ok(s.distance_yards, 0)) return s.distance_yards;
  if (ok(s.gps_distance_yards, 0)) return Math.round(s.gps_distance_yards);
  const d = shotDistance(s);
  if (d != null && d >= MIN_GPS_YARDS && ok(d, 0)) return Math.round(d);
  return null;
}

/** What one shot is KNOWN to say. Every field is null when nobody recorded it. */
export interface RecentShotFacts {
  id: string | undefined;
  hole: number;
  /** Canonical club (clubStatsStore vocabulary) when the logged value resolves to one. */
  club: ClubName | null;
  /** The club as logged, when it did NOT resolve to a canonical club — still a fact worth showing. */
  clubAsLogged: string | null;
  distanceYards: number | null;
  direction: 'left' | 'straight' | 'right' | null;
  shape: 'draw' | 'straight' | 'fade' | null;
  /** A penalty outcome only. 'clean' (and absent) means "no penalty logged", which is not news. */
  outcome: Exclude<ShotOutcome, 'clean'> | null;
  /** Free-text result ("short of target", "fairway", "in the bunker"). */
  outcomeText: string | null;
  /** How it felt — the free-text swing feel first, the contact enum second. */
  feel: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The facts of one row, or null when the row is not a shot anyone can be told about: a quick-score
 * placeholder, a penalty stroke, or a row that carries no fact at all (yet).
 */
export function recentShotFacts(s: ShotResult): RecentShotFacts | null {
  if (isQuickScorePlaceholder(s) || isPenaltyStrokeRow(s)) return null;
  // 'unknown' is the club recognizer's name for "no club" — the absence of the fact, not a club.
  const rawClub = /^(unknown|none|null)$/i.test(text(s.club) ?? '') ? null : text(s.club);
  const club = normalizeClub(rawClub);
  const facts: RecentShotFacts = {
    id: s.id,
    hole: s.hole,
    club,
    clubAsLogged: club ? null : rawClub,
    distanceYards: recentShotDistanceYards(s),
    direction: s.direction ?? null,
    shape: s.shape ?? null,
    outcome: s.outcome && s.outcome !== 'clean' ? s.outcome : null,
    outcomeText: text(s.outcome_text),
    feel: text(s.swing_feel) ?? text(s.feel),
  };
  // Shape alone is not counted: every writer that sets it sets the direction with it, and the card
  // has no cell for it — a shape-only row would draw as "Club not logged" and nothing else.
  const knowsSomething = facts.club != null || facts.clubAsLogged != null || facts.distanceYards != null
    || facts.direction != null || facts.outcome != null || facts.outcomeText != null || facts.feel != null;
  return knowsSomething ? facts : null;
}

/** The rows of `shots` that are real, describable shots — stored order (oldest first) preserved. */
export function recordedShots(shots: readonly ShotResult[] | null | undefined): ShotResult[] {
  return (shots ?? []).filter((s) => recentShotFacts(s) != null);
}

export type RecentShotsSource = 'this_round' | 'last_round' | 'none';

export interface RecentShotsView {
  source: RecentShotsSource;
  /** The live round is a harness/sim round — label it so, never pass it off as a real one. */
  simulated: boolean;
  /** Recorded shots only, oldest first (as stored). Empty when source is 'none'. */
  shots: ShotResult[];
  /** For 'last_round': when that round ended, and where. Null otherwise. */
  roundEndedAt: number | null;
  courseName: string | null;
  /**
   * True when holes were scored by TOTAL (quick-score placeholders exist) — lets an empty card say
   * "your holes were scored by total — say the club" instead of pretending nothing was ever logged.
   */
  hasQuickScoredHoles: boolean;
}

type RoundLike = Pick<RoundRecord, 'shots' | 'endedAt' | 'courseName'> & { simulated?: boolean };

/**
 * "Your recent shots": the round in progress when it has recorded shots, else the most recently
 * FINISHED real round that has any. Most recent by `endedAt`, not by array position — imported
 * scorecards are appended in import order and carry no shots.
 *
 * A live sim round IS the round in play (the caddie is playing it), so it is shown — flagged
 * `simulated` so the surface can say so. Finished sim rounds are never a fallback.
 */
export function recentShotsView(input: {
  liveShots: readonly ShotResult[] | null | undefined;
  isSimRound?: boolean;
  rounds: readonly RoundLike[] | null | undefined;
}): RecentShotsView {
  const live = input.liveShots ?? [];
  const liveRecorded = recordedShots(live);
  const anyQuickScore = (xs: readonly ShotResult[] | null | undefined) => (xs ?? []).some(isQuickScorePlaceholder);
  let hasQuickScoredHoles = anyQuickScore(live);
  if (liveRecorded.length > 0) {
    return {
      source: 'this_round', simulated: input.isSimRound === true, shots: liveRecorded,
      roundEndedAt: null, courseName: null, hasQuickScoredHoles,
    };
  }
  const real = (input.rounds ?? []).filter((r) => !r.simulated);
  const newestFirst = [...real].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  for (const r of newestFirst) {
    const rs = recordedShots(r.shots);
    if (anyQuickScore(r.shots)) hasQuickScoredHoles = true;
    if (rs.length > 0) {
      return {
        source: 'last_round', simulated: false, shots: rs,
        roundEndedAt: r.endedAt ?? null, courseName: r.courseName ?? null, hasQuickScoredHoles,
      };
    }
  }
  return { source: 'none', simulated: false, shots: [], roundEndedAt: null, courseName: null, hasQuickScoredHoles };
}

/** The shape the caddie brain reads for one recent shot (api/kevin.ts ShotLite). */
export interface CaddieRecentShot {
  hole: number;
  shotIndex: number | null;
  club: string | null;
  shape: string | null;
  direction: string | null;
  outcome: string | null;
  outcomeText: string | null;
  feel: string | null;
  distance_yards: number | null;
}

/** The last `max` recorded shots of a pool, oldest first, in the caddie's shape — same facts the card draws. */
export function recentShotsForCaddie(shots: readonly ShotResult[], max = 5): CaddieRecentShot[] {
  const out: CaddieRecentShot[] = [];
  for (const s of shots) {
    const f = recentShotFacts(s);
    if (!f) continue;
    out.push({
      hole: f.hole,
      shotIndex: s.shot_in_hole_index ?? null,
      club: f.club ?? f.clubAsLogged,
      shape: f.shape,
      direction: f.direction,
      outcome: f.outcome,
      outcomeText: f.outcomeText,
      feel: f.feel,
      distance_yards: f.distanceYards,
    });
  }
  return out.slice(-max);
}
