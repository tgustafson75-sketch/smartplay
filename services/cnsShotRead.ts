/**
 * 2026-06-13 — CNS Shot Read (the SmartFinder moat).
 *
 * "This is exactly what the caddie brain is for." (Tim) — SmartFinder shouldn't
 * compute its own recommendation; it asks the BRAIN, and the brain composes one
 * answer-first read from the signals the CNS already holds: distance, wind,
 * elevation/plays-like, the player's real bag, miss tendency, and hazards.
 *
 * This function is the composition layer. It is PURE, SYNC, OFFLINE-SAFE, and
 * never throws — no React, no hooks, no network, no store access (the caller
 * passes the player's bag in). That keeps it unit-testable AND usable with no
 * signal (exactly when the course connection dies). SmartFinder is just the
 * display surface for what this returns.
 *
 * The output discipline is Tim's "don't beat up the user" rule: lead with the
 * ANSWER (club + plays-like), one short line of WHY (wind + slope), hazard +
 * tendency as light single lines, and past-performance ONLY in competitive/ghost
 * mode. See memory: smartfinder-unified-brain-read, caddie-brain-lens.
 */

import type { WeatherSnapshot } from './weatherService';
import { STANDARD_LADDER as SHARED_LADDER, CLUB_LABEL as SHARED_CLUB_LABEL, personalBagScale } from './standardBag';
import { playsLikeDistance } from '../utils/playsLike';

export interface ShotRead {
  /** The answer: which club. */
  club: string | null;
  /** Raw GPS yards to the target. */
  rawYards: number | null;
  /** What it plays like after wind + elevation + temp. */
  playsLikeYards: number | null;
  /** Yards added/removed by plays-like (playsLike − raw). */
  deltaYards: number;
  /** Short "why" factor lines, in priority order (wind, slope, learned carry). */
  why: string[];
  /** One light hazard line, or null. */
  hazardNote: string | null;
  /**
   * How much green there is to work with — "14y of green behind the pin", "only 3y behind the pin —
   * miss short". A FACT about the target, not an instruction; the club pick is unchanged by it.
   * Null when the green geometry is absent or implausible.
   */
  greenRoomNote: string | null;
  /** One light tendency/line note, or null. */
  tendencyNote: string | null;
  /** Past-performance line — populated ONLY when isCompetition. */
  pastPerfNote: string | null;
  /**
   * 2026-09-11 (Tim) — THE LIE QUESTION, ASKED RATHER THAN GUESSED.
   *
   * "Caddie can offer: 'we could go with an iron here to get out, or if you feel we have a good lie,
   * let's go with hybrid.' That way no computer vision is needed. Could offer user to open TightLie
   * for a full analysis."
   *
   * Present only when the lie is UNKNOWN and the club the yardage wants is lie-sensitive — a wood or
   * a driver off the deck — and the bag holds a more forgiving club at the same number. Null the
   * rest of the time, because an offer made every shot is nagging.
   */
  lieOffer: import('./clubCharacter').LieChoice | null;
}

// Standard carry ladder — the honest fallback when the player hasn't logged a
// real bag yet. Used only when `bag` is empty so we never go silent on club.
// 2026-08-12 — was a private copy that disagreed with the other two standard tables (Driver 250 here
// vs 245 in clubStatsStore vs 230 in equipment_intelligence). Now derived from THE standard bag, so
// what the caddie SAYS a club goes and what the swing card reports for that club are one number.
const STANDARD_LADDER = SHARED_LADDER;

/**
 * How far apart two clubs' clean-strike rates must be before comfort decides between them.
 * Fifteen points is a real difference in how a player catches a club; anything less is noise.
 */
const CONFIDENCE_MARGIN = 0.15;

/**
 * 2026-08-11 — ClubName (the stores' vocabulary) → the STANDARD_LADDER's label. Without this the
 * merge produces duplicates ('7I' AND '7 Iron') and the caddie speaks a store key at the player.
 */
/**
 * 2026-08-24 (club sweep — ONE OWNER). This file declared its OWN ClubName→label map while ALREADY
 * importing the canonical one on line 22 (`CLUB_LABEL as SHARED_CLUB_LABEL`) and never using it.
 * The local copy was wrong in three places, and each error is a club the player hears by the wrong
 * name AND a measured carry landing on a neighbour's rung:
 *
 *     '7W': '5 Wood'   a measured 7-wood was spoken as "5 wood" and overwrote the 5-Wood rung (223y)
 *     '3I': '4 Iron'   a measured 3-iron was spoken as "4 iron" and overwrote the 4-Iron rung (190y)
 *     'AW': 'GW'       an approach wedge was spoken as "GW" and overwrote the Gap-Wedge rung (98y)
 *
 * STANDARD_LADDER has real rungs for 7 Wood (213), 3 Iron (205) and AW (104), so this was not a
 * deliberate collapse onto an existing rung — it was three typos, duplicated verbatim into
 * services/localStatusResponder under a comment saying the copy existed so the two could not
 * disagree. Deliberate collapsing DOES exist and is handled by the owner: CLUB_LABEL maps every
 * hybrid to 'Hybrid', and STANDARD_LADDER keeps the longest per label.
 */
const LADDER_LABEL = SHARED_CLUB_LABEL as Record<string, string>;


/**
 * THE PLAYER'S LADDER, IN ONE VOCABULARY — the one owner of the standard-chart merge.
 *
 * 2026-09-11 — extracted because a SECOND consumer appeared (the unknown-lie offer) and reading the
 * raw bag instead produced nothing at all. This file's own note names the trap: bagDistances() keys
 * are ClubName ('7I', '3W'); the ladder is LABELLED ('7 Iron', '3 Wood'). The offer looked up
 * `bag['5 Wood']`, got undefined, and silently never fired — a defect that a source-reading test
 * would have called wired. Anything reasoning about "which club at this number" has to start here.
 * [[two-owners-is-the-root-cause]]
 */
function mergedLadder(bag: Partial<Record<string, number>>): {
  merged: Map<string, number>; measured: Set<string>;
} {
  const bagScale = personalBagScale(bag as Partial<Record<string, number>>) ?? 1;
  const merged = new Map<string, number>();
  for (const [club, yds] of STANDARD_LADDER) merged.set(club, Math.round(yds * bagScale));
  // Track which clubs are the PLAYER'S OWN number vs. the chart, so the spoken "why" can't claim a
  // standard-ladder figure as his measured carry ([[illustration-data-points]] — real signals only).
  const measured = new Set<string>();
  for (const [club, d] of Object.entries(bag)) {
    if (typeof d === 'number' && d > 0) {
      // A measured club REPLACES its chart counterpart rather than sitting beside it, which is what
      // "override club by club" has to mean.
      const label = LADDER_LABEL[club] ?? club;
      merged.set(label, d);
      measured.add(label);
    }
  }
  return { merged, measured };
}

/** Closest club to the plays-like number — prefers the player's real bag, falls
 *  back to the standard ladder. Pushes a learned-carry "why" line when real. */
/**
 * 2026-08-12 (Tim — "a huge part of the app is mental state and mental coaching, hence the dynamics
 * being in play") — RISK POSTURE, the point where that becomes an actual club.
 *
 * A posture that only tints the caddie's wording is decoration. This is where safe / normal /
 * aggressive changes the recommendation itself, in the way a real caddie would: when you're between
 * clubs, safe takes the one that comfortably covers and aggressive takes the one that just reaches.
 * Normal is unchanged — nearest club wins, exactly as before.
 *
 * Deliberately only breaks TIES rather than shifting the target yardage. Nudging the number would
 * make a 150-yard shot secretly a 158-yard shot, and every downstream line ("your 7 iron carries
 * ~155") would then be quoting a distance the player never faced. [[illustration-data-points]]
 */
export type ShotRiskMode = 'safe' | 'normal' | 'aggressive';

/** What the gap decision is allowed to reason from. All optional; absent data means no claim. */
interface GapContext {
  distanceControl?: 'full_swings' | 'some_partials' | 'dial_down';
  greenFrontYards?: number | null;
  greenBackYards?: number | null;
  nearestHazard?: { label: string; yards: number } | null;
  /** Ladder labels for the clubs he owns. Absent/empty → unknown, and the ladder stands. */
  ownedLabels?: readonly string[] | null;
  /**
   * 2026-09-11 (Tim) — WHAT THE BALL IS SITTING ON.
   *
   * "I carry a 5 wood, a 5 iron, and a 5 hybrid. They all have different purpose. If Caddie knows I
   * am not on the fairway and likely not a great lie, don't suggest the wood based on distance."
   *
   * This picker had no concept of a lie, so three clubs that go the same number were one club to it.
   * Set ONLY from a real signal — TightLie's read, or the player's own words. An unknown lie makes
   * no claim: it must not penalise the wood, because that would be inventing a bad lie.
   */
  lie?: import('./clubCharacter').Lie;
  /**
   * 2026-09-11 (Tim) — THE "RECEIVED" HALF OF A CLUB'S CHARACTER.
   *
   * "Each club in the bag essentially has characteristics real and received… sometimes feel for the
   * lie or situation or comfort level."
   *
   * relationshipStore.confidenceByClub has held a real, measured number since 2026-07-09 — the
   * clean-strike rate over a player's recent RATED swings with that club, gated at three so it is
   * never a guess. It reached one practice-screen badge and never the club decision.
   *
   * Passed as a FUNCTION, not a map, on purpose: the store keys and this file's ladder speak
   * different vocabularies, and handing over a raw map is exactly how the lie offer silently never
   * fired earlier today. The caller owns the translation, because only the caller knows both sides.
   * Returns null when there is not enough rated data — and null must never break a tie.
   */
  confidenceFor?: (ladderLabel: string) => number | null;
}

function pickClub(playsLikeYards: number, bag: Partial<Record<string, number>>, why: string[], risk: ShotRiskMode = 'normal', gap: GapContext = {}): string | null {
  /**
   * 2026-08-11 (Tim — "the caddie suggestion in SmartVision is STILL showing a gap wedge for a 324
   * yard shot") — THE THIRD instance of the same defect, and the one actually on his screen.
   *
   * This built its ladder from `bag` ALONE whenever the player had logged anything at all. With a
   * single logged club — say a gap wedge at 95 — `real.length` is 1, so `longest` and `shortest` are
   * both that wedge, and a 324-yard shot takes the "past your longest" branch and returns the GAP
   * WEDGE with the line "past your gap wedge — lay up and leave a wedge". That is verbatim the
   * "324y to pin · past you…" chip in his screenshot.
   *
   * Same fix as clubStatsStore.inferClub and equipment_distance_modifier, and the same principle he
   * stated: the STANDARD LADDER IS ALWAYS PRESENT, and the player's real numbers override it club by
   * club. A sparse bag can then never collapse the ladder, and the bag-extreme lines ("past your
   * driver", "less than a full lob wedge") stay honest because they're measured against a real bag
   * instead of against the one club we happen to have seen.
   */
  /**
   * 2026-08-12 (Tim's Arccos bag vs our chart) — scale the chart to THIS player.
   *
   * His measured wedges sat 30 yards above our defaults while his driver was within 8, so a 130-yard
   * shot got him a gap wedge from a chart that thought GW went 98 when he hits it 128. Any club he
   * HAS logged still wins outright below; this only fills the ones he hasn't, using the ratio his
   * own clubs prove. See services/standardBag.personalBagScale.
   */
  const { merged, measured } = mergedLadder(bag);
  /**
   * 2026-09-11 — never recommend a club he does not have. The ladder still holds every rung for the
   * bag-extreme reasoning above; it is the CHOICE that is restricted. Skipped entirely when the
   * registered bag is unknown, and skipped if filtering would leave nothing to choose from — a
   * narrowed-to-empty ladder would be worse than a chart club.
   */
  const ownedSet = gap.ownedLabels && gap.ownedLabels.length > 0 ? new Set(gap.ownedLabels) : null;
  const allEntries = [...merged.entries()] as [string, number][];
  const ownedEntries = ownedSet ? allEntries.filter(([c]) => ownedSet.has(c)) : allEntries;
  const real = ownedEntries.length >= 2 ? ownedEntries : allEntries;
  if (real.length > 0) {
    let best: [string, number] | null = null;
    let longest = real[0];
    let shortest = real[0];
    for (const entry of real) {
      /**
       * 2026-08-11 — the player's OWN club wins a tie against a chart club.
       *
       * Merging the standard ladder in (so a sparse bag can't collapse it) introduced a subtle
       * regression the sim caught: at 165 yards a CHART 6-iron (165) tied his MEASURED 7-iron (165)
       * and won on iteration order. A chart average must never outrank a number the player has
       * actually produced — that is the whole point of learning his bag. Ties, and near-ties within
       * a yard, go to the measured club.
       */
      const dNew = Math.abs(entry[1] - playsLikeYards);
      const dBest = best ? Math.abs(best[1] - playsLikeYards) : Infinity;
      const newIsMeasured = measured.has(entry[0]);
      const bestIsMeasured = best ? measured.has(best[0]) : false;
      // Posture only speaks on a NEAR-TIE (within a yard): safe prefers the club that covers the
      // number, aggressive the one that just reaches. Outside a tie the closest club still wins —
      // a posture must never hand you a club that doesn't fit the shot.
      const postureBreak =
        risk === 'safe' ? (entry[1] > (best?.[1] ?? -Infinity) ? true : false)
        : risk === 'aggressive' ? (entry[1] < (best?.[1] ?? Infinity) ? true : false)
        : null;
      /**
       * 2026-09-11 — COMFORT BREAKS A DEAD HEAT, and nothing more.
       *
       * It sits BELOW posture deliberately: a posture is a stance the player or the caddie chose,
       * and a measured tendency must not overrule a choice. It only speaks when the strike rates
       * differ MATERIALLY — a couple of points is noise, and noise must never pick a club.
       */
      const cNew = gap.confidenceFor?.(entry[0]) ?? null;
      const cBest = best ? (gap.confidenceFor?.(best[0]) ?? null) : null;
      const confidenceBreak =
        cNew != null && cBest != null && Math.abs(cNew - cBest) >= CONFIDENCE_MARGIN
          ? cNew > cBest
          : null;
      const better =
        dNew < dBest - 1 ? true
        : dNew > dBest + 1 ? false
        : newIsMeasured && !bestIsMeasured ? true      // near-tie: measured beats chart
        : !newIsMeasured && bestIsMeasured ? false
        : postureBreak !== null ? postureBreak         // near-tie, same provenance: posture decides
        : confidenceBreak !== null ? confidenceBreak   // still tied: the club he actually strikes
        : dNew < dBest;                                 // same provenance: closest wins
      if (!best || better) best = entry;
      if (entry[1] > longest[1]) longest = entry;
      if (entry[1] < shortest[1]) shortest = entry;
    }
    if (best) {
      /**
       * 2026-09-11 (Tim) — THE LIE COMES BEFORE THE YARDAGE.
       *
       * "If Caddie knows I am not on the fairway and likely not a great lie, don't suggest the wood
       * based on distance. The iron is better to get out, but user and caddie can consider if the
       * lie allows better for the hybrid."
       *
       * Fires ONLY on a known lie — TightLie's read or the player's own words. An unknown lie makes
       * no claim and this whole block is skipped, because inventing a bad lie to justify a shorter
       * club is the same fabrication as inventing a good one.
       *
       * It swaps CLASS, never distance band: the replacement is the most playable club within a
       * normal club's reach of the number, so this can never hand back something wildly short.
       */
      const lie = gap.lie ?? 'unknown';
      if (lie !== 'unknown') {
        const cc = require('./clubCharacter') as typeof import('./clubCharacter');
        const bestPlay = cc.playabilityFromLie(best[0], lie);
        if (bestPlay != null && bestPlay < cc.POOR_FROM_LIE) {
          /**
           * 2026-09-11 — THE WINDOW HAS TO WIDEN WHEN THE SHOT IS OUT OF REACH.
           *
           * Found by the 100-player market sim: "Driver @ 312y from heavy_rough". The swap only
           * looked for a more playable club within 20 yards of the number, and from 312 the only
           * club near 312 IS the driver — so nothing qualified and the driver stood, out of deep
           * rough, which is the exact shot Tim said not to recommend.
           *
           * When the number is past what the player can reach anyway, the yardage stops being the
           * constraint: he is advancing the ball, not going for it. So the search widens to the
           * whole bag and takes the LONGEST playable club — get it out, get it forward. Within
           * reach, the tight window still governs, because there the yardage genuinely matters.
           */
          /**
           * 2026-09-11 — REWRITTEN TWICE, BOTH TIMES BY THE 100-PLAYER MARKET SIM.
           *
           * First it found "Driver @ 312y from heavy_rough": the swap only looked within 20 yards of
           * the number, and from 312 the only club near 312 IS the driver, so nothing qualified.
           * Then it found "3 Wood @ 158y from heavy_rough" on a scaled sparse bag, for the same
           * reason at a different number.
           *
           * The old rule asked for a club that was MORE PLAYABLE than the one it was replacing,
           * which has two faults. It finds nothing when the window is empty. And it prefers the MOST
           * playable club, so a wedge beats an iron out of deep rough — bad golf, because from 200
           * yards in the rough you want the longest club that still gets OUT, not the one that gets
           * out best.
           *
           * So: take every club that CLEARS the playability bar, and choose among those. Within
           * reach, the one closest to the number, because the yardage still matters. Out of reach,
           * the longest, because the job is advancing it — he cannot get there anyway.
           */
          const reachable = playsLikeYards <= longest[1] + 8;
          let swap: [string, number] | null = null;
          for (const e of real) {
            const pl = cc.playabilityFromLie(e[0], lie);
            if (pl == null || pl < cc.POOR_FROM_LIE) continue;
            if (reachable && e[1] > playsLikeYards + 8) continue;  // never hand back more club than the shot
            if (!swap) { swap = e; continue; }
            const better = reachable
              ? Math.abs(e[1] - playsLikeYards) < Math.abs(swap[1] - playsLikeYards)
              : e[1] > swap[1];
            if (better) swap = e;
          }
          if (swap && swap[0] !== best[0]) {
            const line = cc.describeLieChoice(swap[0], best[0], lie);
            if (line) why.unshift(line);
            return swap[0];
          }
        }
      }

      // 2026-06-27 — honest read at the BAG EXTREMES. The closest club to a
      // too-big / too-small number is already `longest` / `shortest`, so the club
      // returned is unchanged; only the "why" is more honest. Lead with it
      // (unshift) so it survives the voice responder's first-two-lines trim.
      const BEYOND_MARGIN = 8;   // matches localStatusResponder.clubBeyond
      const PARTIAL_MARGIN = 12; // under the shortest = a partial, not a full carry
      if (playsLikeYards > longest[1] + BEYOND_MARGIN) {
        // "past your driver" is only true of a club he's actually shown us. Against a chart value it
        // would be a guess dressed as a fact, so the line drops to a neutral one.
        why.unshift(measured.has(longest[0])
          ? `past your ${longest[0].toLowerCase()} (${Math.round(longest[1])}) — lay up and leave a wedge`
          : `that's past a full ${longest[0].toLowerCase()} — lay up and leave a wedge`);
        return longest[0];
      }
      if (playsLikeYards < shortest[1] - PARTIAL_MARGIN) {
        why.unshift(`less than a full ${shortest[0].toLowerCase()} — partial swing`);
        return shortest[0];
      }
      void measured;

      /**
       * 2026-09-11 (Tim) — "PLAYS LIKE FOR ME": AN IN-BETWEEN NUMBER IS A CHOICE, NOT A DIAL.
       *
       * Everything above picks the club CLOSEST to the number. That is the right answer for a player
       * who can flight a shot to a yardage, and the wrong one for a player who makes full swings:
       * "all I do right now is full swing and not good with dialing down yardages so I play according
       * to my yardages and feel."
       *
       * For that player 138 yards is not a club. It is two full swings — the one that comes up six
       * short and the one that goes six long — and which is correct depends on what the green and
       * the trouble forgive. Every other app answers this with arithmetic. This answers it with the
       * player's own bag and the room in front of them.
       *
       * Only fires when the number genuinely sits in a GAP (no club within GAP_MARGIN) and only for
       * a player who told us they swing full. Everyone else keeps the nearest-club answer exactly as
       * it was.
       */
      const GAP_MARGIN = 6;
      const bestMiss = Math.abs(best[1] - playsLikeYards);
      if (gap.distanceControl === 'full_swings' && bestMiss >= GAP_MARGIN) {
        let shortClub: [string, number] | null = null;   // longest club still SHORT of the number
        let longClub: [string, number] | null = null;    // shortest club still PAST it
        for (const e of real) {
          if (e[1] <= playsLikeYards && (!shortClub || e[1] > shortClub[1])) shortClub = e;
          if (e[1] >= playsLikeYards && (!longClub || e[1] < longClub[1])) longClub = e;
        }
        if (shortClub && longClub && shortClub[0] !== longClub[0]) {
          const overBy = Math.round(longClub[1] - playsLikeYards);
          const shortBy = Math.round(playsLikeYards - shortClub[1]);
          const back = typeof gap.greenBackYards === 'number' ? gap.greenBackYards : null;
          const roomBehind = back != null ? Math.round(back - playsLikeYards) : null;
          const hazardShort =
            gap.nearestHazard && gap.nearestHazard.yards > 0 &&
            gap.nearestHazard.yards < playsLikeYards &&
            playsLikeYards - gap.nearestHazard.yards <= shortBy + 10
              ? gap.nearestHazard : null;

          let choice: [string, number];
          let reason: string;
          if (roomBehind != null && roomBehind >= overBy + 3) {
            choice = longClub;
            reason = `${roomBehind}y of green behind it`;
          } else if (roomBehind != null && roomBehind < overBy) {
            choice = shortClub;
            reason = `only ${Math.max(0, roomBehind)}y behind — long is over the green`;
          } else if (hazardShort) {
            choice = longClub;
            reason = `${hazardShort.label} short`;
          } else {
            // No geometry to reason from. Name the gap honestly and keep the nearest club rather
            // than inventing a reason to move off it. [[illustration-data-points]]
            why.unshift(`no full swing at ${Math.round(playsLikeYards)} — ${best[0].toLowerCase()} is your closest`);
            if (measured.has(best[0])) why.push(`your ${best[0].toLowerCase()} carries ~${Math.round(best[1])}`);
            return best[0];
          }
          why.unshift(
            `no full swing at ${Math.round(playsLikeYards)} — ${choice[0].toLowerCase()} (${Math.round(choice[1])}), ${reason}`,
          );
          return choice[0];
        }
      }

      // Only call it HIS carry when it actually is; otherwise stay silent on the number rather than
      // passing a chart average off as measured.
      if (measured.has(best[0])) why.push(`your ${best[0].toLowerCase()} carries ~${Math.round(best[1])}`);
      return best[0];
    }
  }
  let bestStd: readonly [string, number] | null = null;
  for (const entry of STANDARD_LADDER) {
    if (!bestStd || Math.abs(entry[1] - playsLikeYards) < Math.abs(bestStd[1] - playsLikeYards)) bestStd = entry;
  }
  return bestStd ? bestStd[0] : null;
}

/**
 * 2026-09-11 — a `clubForYards` export lived here for a few hours: a thin way to get a club without
 * a whole read, written when app/smartfinder still chose its own club for the strategy lines.
 *
 * Orchestrating the decision made it dead the same day. Surfaces now ask
 * services/caddieDecision.decideShot and read `.shot.club`, so there is no caller that wants a club
 * without the read it came from — and a second way to get a club is a second club. The orphan guard
 * refused it within a minute of the last caller going away, which is exactly its job.
 * [[orphans-are-live-bugs-not-dead-code]]
 */
export function composeShotRead(input: {
  rawYards: number | null;
  weather: WeatherSnapshot | null;
  shotBearingDeg: number | null;
  elevationDeltaFeet?: number;
  /** Player's REAL measured bag (from shotStrategy.bagDistances()). Empty → ladder. */
  bag?: Partial<Record<string, number>>;
  /** CNS-learned dominant miss (e.g. "right"). */
  dominantMiss?: string | null;
  /** Hole-specific learned line note (beats the generic miss when present). */
  holeLineNote?: string | null;
  /** Nearest hazard ahead + its yards from the player. */
  nearestHazard?: { label: string; yards: number } | null;
  /**
   * The caddie's risk posture for this shot (roundStore.riskMode). Only breaks near-ties between
   * clubs — see pickClub. Omitted → 'normal', so every existing caller is unchanged.
   */
  risk?: ShotRiskMode;
  /** Competitive/ghost round → surface past performance; otherwise hide it. */
  isCompetition?: boolean;
  /** Past-performance one-liner for this hole (only used when isCompetition). */
  pastScoreNote?: string | null;
  /**
   * 2026-09-11 (Tim — "plays like factors really need that info") — HOW MUCH GREEN IS THERE.
   *
   * Front and back yardages to the green. SmartFinder has computed and DISPLAYED these since it was
   * written and never passed them here, so the read knew the distance to a point and nothing about
   * the room around it. That is the difference between "158, hit 7 iron" and "158, and there are 14
   * yards of green behind the pin" — the second is a decision, the first is a number.
   *
   * Optional: every existing caller is unchanged, and a read with no green data simply omits the
   * room line rather than guessing at it.
   */
  greenFrontYards?: number | null;
  greenBackYards?: number | null;
  /** How this player covers an in-between yardage (playerProfileStore.distanceControl). */
  distanceControl?: 'full_swings' | 'some_partials' | 'dial_down';
  /** What the ball is sitting on — TightLie's read, or the player's words. */
  lie?: import('./clubCharacter').Lie;
  /** Clean-strike rate for a LADDER-LABELLED club, or null when not enough rated swings. */
  confidenceFor?: (ladderLabel: string) => number | null;
  /**
   * 2026-09-11 — THE CLUBS HE ACTUALLY OWNS, when he has told us.
   *
   * Found by giving the market sim STARTER SETS: a player whose bag is a driver, a 7 iron and a sand
   * wedge was told to hit a 3 Iron. The standard ladder is merged in deliberately — so a sparse bag
   * cannot collapse it and produce "gap wedge for 324 yards" — but that merge also makes chart rungs
   * eligible as RECOMMENDATIONS, and a club he does not own is never the answer.
   *
   * Only applied when the registered bag is genuinely known. A player who has not scanned or entered
   * one gets the ladder exactly as before, because an empty list is "we do not know", not "he owns
   * nothing". [[illustration-data-points]]
   */
  ownedLabels?: readonly string[] | null;
}): ShotRead | null {
  const {
    rawYards, weather, shotBearingDeg, elevationDeltaFeet = 0,
    bag = {}, dominantMiss, holeLineNote, nearestHazard, isCompetition, pastScoreNote,
    greenFrontYards = null, greenBackYards = null, distanceControl, lie, confidenceFor, ownedLabels,
  } = input;
  if (rawYards == null || !Number.isFinite(rawYards)) return null;

  const why: string[] = [];

  // 1) Plays-like. With weather we get the full wind+temp+elevation model; with
  //    no weather we still honor elevation (so uphill/downhill never goes dark).
  let playsLikeYards = rawYards;
  if (weather) {
    const b = playsLikeDistance(rawYards, weather, shotBearingDeg, elevationDeltaFeet);
    playsLikeYards = b.plays_like_yards;
    if (b.along_wind_mph != null && Math.abs(b.along_wind_mph) >= 3) {
      why.push(b.along_wind_mph < 0
        ? `${Math.abs(b.along_wind_mph)} into the wind`
        : `${b.along_wind_mph} downwind`);
    }
    if (b.cross_wind_mph != null && Math.abs(b.cross_wind_mph) >= 5) {
      why.push(`${Math.abs(b.cross_wind_mph)} cross ${b.cross_wind_mph > 0 ? 'off the right' : 'off the left'}`);
    }
  } else if (elevationDeltaFeet !== 0) {
    playsLikeYards = Math.round(rawYards + elevationDeltaFeet / 3);
  }

  // Elevation "why" line (independent of weather presence).
  const elevYds = Math.round(elevationDeltaFeet / 3);
  if (Math.abs(elevYds) >= 2) why.push(`${Math.abs(elevYds)} ${elevYds > 0 ? 'uphill' : 'downhill'}`);

  // 2) Club — the answer. Pushes a learned-carry why line when the bag is real.
  const club = pickClub(playsLikeYards, bag, why, input.risk ?? 'normal', {
    distanceControl, greenFrontYards, greenBackYards, nearestHazard, lie, confidenceFor, ownedLabels,
  });

  // 3) Hazard — only when it's actually in play for this shot (ahead, within reach).
  let hazardNote: string | null = null;
  if (nearestHazard && nearestHazard.yards > 0 && nearestHazard.yards <= playsLikeYards + 25) {
    hazardNote = `${nearestHazard.label} ${nearestHazard.yards}y`;
  }

  /**
   * 3b) ROOM ON THE GREEN — the half of the decision a yardage alone cannot carry.
   *
   * Depth is back − front. A pin with 15 yards behind it forgives a club too much; one with 4 yards
   * and a bunker behind does not. This is stated as a FACT the player can act on, never as an
   * instruction — the club pick stays where it is, and this tells them what the miss costs.
   *
   * Only spoken when the numbers are real and sane: front < back, and a depth a green can actually
   * have. A bad geometry read must not invent room that isn't there. [[illustration-data-points]]
   */
  let greenRoomNote: string | null = null;
  if (
    typeof greenFrontYards === 'number' && typeof greenBackYards === 'number' &&
    Number.isFinite(greenFrontYards) && Number.isFinite(greenBackYards) &&
    greenBackYards > greenFrontYards
  ) {
    const depth = Math.round(greenBackYards - greenFrontYards);
    if (depth >= 4 && depth <= 60) {
      const behind = Math.round(greenBackYards - playsLikeYards);
      const inFront = Math.round(playsLikeYards - greenFrontYards);
      /**
       * ORDER MATTERS, and it is the urgency order, not the arithmetic one.
       *
       * A tight edge beats a roomy one. Sitting three yards onto the green means short-siding into
       * whatever guards the front, and that is a worse outcome than the comfort of room behind — so
       * it is said first even when there are twenty yards long. The back-pin warning comes next for
       * the same reason. "Plenty behind" is the reassurance, and reassurance goes last.
       */
      if (inFront >= 0 && inFront < 5) greenRoomNote = `front edge is ${inFront}y short — don't come up light`;
      else if (behind >= 0 && behind < 5) greenRoomNote = `only ${behind}y behind the pin — miss short`;
      else if (behind >= 8) greenRoomNote = `${behind}y of green behind the pin`;
      else greenRoomNote = `${depth}y of green to work with`;
    }
  }

  // 4) Tendency — hole-specific learned line beats the generic miss.
  let tendencyNote: string | null = null;
  if (holeLineNote && holeLineNote.trim()) tendencyNote = holeLineNote.trim();
  else if (dominantMiss && dominantMiss.trim()) tendencyNote = `you miss ${dominantMiss.trim()} — favor the safe side`;

  // 5) Past performance — competitive/ghost only (don't nag a casual round).
  const pastPerfNote = isCompetition ? (pastScoreNote ?? null) : null;

  return {
    club,
    rawYards,
    playsLikeYards,
    deltaYards: playsLikeYards - rawYards,
    why,
    hazardNote,
    greenRoomNote,
    /**
     * The player standing over the ball knows the lie better than any sensor, and answering costs
     * him one word. TightLie remains the full read when he wants it — this is the version that needs
     * no camera. [[feels-like-a-real-caddie]]
     */
    lieOffer: (() => {
      try {
        const cc = require('./clubCharacter') as typeof import('./clubCharacter');
        // The picker speaks LABELS ('5 Wood'), so the offer must look up the same ladder it chose
        // from — not the raw ClubName-keyed bag, which is how this silently never fired.
        const ladder = Object.fromEntries(mergedLadder(bag).merged) as Record<string, number>;
        return club ? cc.offerFromUnknownLie({ yardageClub: club, bag: ladder, lie }) : null;
      } catch { return null; }
    })(),
    tendencyNote,
    pastPerfNote,
  };
}
