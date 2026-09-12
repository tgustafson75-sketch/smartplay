/**
 * THE SHOT READ'S INPUTS — assembled once, so every surface answers the same question the same way.
 *
 * 2026-09-11 (Tim). "We have a very complex app and it's very likely the hundreds of factors are not
 * currently sharing connections and data in the best possible way. We're close but I'm sure have
 * disconnects."
 *
 * He was right, and this is the biggest one measured. services/cnsShotRead is the club-and-plays-like
 * engine, and it is PURE — which is correct, and which means whoever calls it decides what it gets to
 * know. Three callers, three different answers to the same question:
 *
 *   app/smartfinder.tsx        14 of 15 inputs
 *   services/localStatusResponder  7 of 15 — no ELEVATION, no green depth, no distance control
 *   app/smartvision.tsx            6 of 15 — `weather: null` outright, so no WIND at all
 *
 * None of that is a bug in any file. Every call site is internally correct. They simply grew at
 * different times and nobody re-fed the older ones when a fact was added — so the club the caddie
 * names depended on WHICH SCREEN YOU ASKED FROM. SmartVision speaks its read aloud
 * (registerSmartVisionRead), so the player hears a club chosen with no wind and no miss bias; ask the
 * same thing on SmartFinder and get a different one. The offline path missing elevation is the
 * Greenhill report exactly — "230 yards downhill considerably; if I'd taken the caddie's
 * recommendation I'd have smoked it into the woods past the hole."
 *
 * Patching three call sites would fix today and guarantee tomorrow's repeat, because the next fact
 * added has three places to be remembered. So the inputs are assembled HERE, once, from live state.
 * A caller passes only what it genuinely knows better — its own target yardage, its own bearing, its
 * own elevation to its own aim point — and everything else arrives filled in.
 *
 * Wire a fact into this file and it reaches every surface at once. That is the whole point.
 * [[two-owners-is-the-root-cause]] [[no-half-fixes-enforce-every-surface]]
 */
import type { WeatherSnapshot } from './weatherService';

export type ShotRiskMode = 'safe' | 'normal' | 'aggressive';

/** Exactly the shape services/cnsShotRead.composeShotRead accepts. */
export interface ShotReadInputs {
  rawYards: number | null;
  weather: WeatherSnapshot | null;
  shotBearingDeg: number | null;
  elevationDeltaFeet?: number;
  bag?: Partial<Record<string, number>>;
  dominantMiss?: string | null;
  holeLineNote?: string | null;
  nearestHazard?: { label: string; yards: number } | null;
  /** What the ball is sitting on — from TightLie's read or the player's own words. */
  lie?: import('./clubCharacter').Lie;
  /** Clean-strike rate for a ladder-labelled club, or null when not enough rated swings. */
  confidenceFor?: (ladderLabel: string) => number | null;
  /** Ladder labels for the clubs he owns. Null/empty means unknown, not "owns nothing". */
  ownedLabels?: readonly string[] | null;
  risk?: ShotRiskMode;
  isCompetition?: boolean;
  pastScoreNote?: string | null;
  greenFrontYards?: number | null;
  greenBackYards?: number | null;
  distanceControl?: 'full_swings' | 'some_partials' | 'dial_down';
}

/** What a caller knows better than this file does. Everything else is filled from live state. */
export type CallerKnown = Partial<ShotReadInputs> & { rawYards: number | null };

function safe<T>(fn: () => T, fallback: T): T {
  try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; }
}

/**
 * Fill every input the shot read accepts from live state, then let the caller's own values win.
 *
 * Never throws and never blocks: every read is independently guarded, so a missing course or a cold
 * weather cache costs that ONE fact rather than the whole read. A field that genuinely is not known
 * stays null — the engine omits the line it would have driven rather than guessing.
 */
export function liveShotReadInputs(known: CallerKnown): ShotReadInputs {
  const round = safe(() => {
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    return useRoundStore.getState();
  }, null as never);

  const hole: number | null = safe(() => (round?.isRoundActive ? round.currentHole ?? null : null), null);
  const courseId: string | null = safe(() => round?.activeCourseId ?? null, null);

  const filled: ShotReadInputs = {
    rawYards: known.rawYards,
    shotBearingDeg: known.shotBearingDeg ?? null,

    /**
     * SmartVision passed `weather: null` outright, so the one screen that reads the WHOLE hole aloud
     * was clubbing with no wind. The cache is read even when stale — a five-minute-old wind is a far
     * better input than none, and cnsShotRead already degrades honestly without it.
     */
    weather: safe(() => {
      const { getCachedWeatherEvenIfStale } = require('./weatherService') as typeof import('./weatherService');
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
      const fix = getLastFix();
      if (!fix || fix.lat == null || fix.lng == null) return null;
      return getCachedWeatherEvenIfStale({ lat: fix.lat, lng: fix.lng }) ?? null;
    }, null),

    bag: safe(() => {
      const { bagDistances } = require('./shotStrategy') as typeof import('./shotStrategy');
      return bagDistances();
    }, {}),

    risk: safe(() => (round?.riskMode ?? 'normal') as ShotRiskMode, 'normal'),
    isCompetition: safe(() => !!round?.isCompetition, false),

    /** Manual miss first, else the miss learned from his own shots — one owner already exists. */
    dominantMiss: safe(() => {
      const { getEffectiveDominantMiss } = require('./effectiveMiss') as typeof import('./effectiveMiss');
      return getEffectiveDominantMiss();
    }, null),

    /** "Favor left — you miss right here." Beats the generic miss when the hole has a history. */
    holeLineNote: safe(() => {
      const { getCourseHoleGuidance } = require('./caddieMemoryRetrieval') as typeof import('./caddieMemoryRetrieval');
      return getCourseHoleGuidance({ courseId, hole })?.bestLine ?? null;
    }, null),

    /**
     * 2026-09-11 — pastScoreNote had NO producer. Every caller passed null, including SmartFinder,
     * so the `isCompetition` branch that surfaces it could never fire. getHoleScoringHistory has
     * held the number all along; it is gated on its own honesty bar because one visit is not a
     * record. [[illustration-data-points]]
     */
    pastScoreNote: safe(() => {
      const { getHoleScoringHistory } = require('./caddieMemoryRetrieval') as typeof import('./caddieMemoryRetrieval');
      const h = getHoleScoringHistory({ courseId, hole });
      if (!h || h.avgScore == null || h.played < 2) return null;
      const avg = Math.round(h.avgScore * 10) / 10;
      return h.par != null
        ? `you average ${avg} here (par ${h.par}, ${h.played} plays)`
        : `you average ${avg} here over ${h.played} plays`;
    }, null),

    /** How much green there is. SmartFinder displayed it for months before anything read it. */
    greenFrontYards: safe(() => {
      const yr = require('./yardageResolver') as typeof import('./yardageResolver');
      return yr.resolvedToFmb(yr.resolveYardage(hole ?? undefined))?.front ?? null;
    }, null),
    greenBackYards: safe(() => {
      const yr = require('./yardageResolver') as typeof import('./yardageResolver');
      return yr.resolvedToFmb(yr.resolveYardage(hole ?? undefined))?.back ?? null;
    }, null),

    /** The "plays like for ME" input. Without it every player is treated as 'some_partials'. */
    distanceControl: safe(() => {
      const { usePlayerProfileStore } = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
      return (usePlayerProfileStore.getState().distanceControl ?? undefined) as never;
    }, undefined as never),

    /**
     * 2026-09-11 (Tim — "we already have TightLie for this very thing") — THE LIE READ, TIED IN.
     *
     * TightLie has produced a full lie analysis since Phase 409 and written it to
     * roundStore.pendingLieAnalysis, which reached the caddie's PROMPT as prose and reached the club
     * picker not at all — a retired handler's own header carried a "lie … exists; not wired" note
     * about it the whole time.
     *
     * So the tool was built, the player was already using it, and the one decision it should change
     * never saw it. Its description is read into the structured lie the picker understands, and the
     * player's own words about the hole are read the same way — because a golfer saying "I'm in the
     * rough sitting down" is a lie read that costs nobody a camera.
     *
     * The analysis is cleared on hole change and consumed on shot log, so it cannot outlive the shot
     * it describes. [[close-the-loop-strategy]]
     */
    lie: safe(() => {
      const { lieFromWords } = require('./clubCharacter') as typeof import('./clubCharacter');
      const la = round?.pendingLieAnalysis as { situation_description?: string } | null;
      const fromCamera = lieFromWords(la?.situation_description ?? null);
      if (fromCamera !== 'unknown') return fromCamera;
      // Then what he told us about this hole, in his own words.
      const note = hole != null ? (round?.holeNotes?.[hole] as string | undefined) : undefined;
      return lieFromWords(note ?? null);
    }, 'unknown' as never),

    /**
     * 2026-09-11 (Tim) — HOW WELL HE ACTUALLY STRIKES EACH CLUB.
     *
     * "Each club in the bag essentially has characteristics real and received… sometimes feel for
     * the lie or situation or comfort level."
     *
     * relationshipStore.confidenceByClub is the received half and it is genuinely measured: the
     * clean-strike rate over recent RATED swings, written by services/clubConfidence, gated at three
     * so it is never a guess. It reached one practice-screen badge and never a club decision.
     *
     * THE VOCABULARY IS TRANSLATED HERE, at the boundary, because only here are both sides known.
     * The store is keyed by whatever a swing session called the club; cnsShotRead's ladder is
     * LABELLED ('7 Iron'). Handing the raw map across is precisely how the lie offer silently never
     * fired earlier today. [[two-owners-is-the-root-cause]]
     */
    confidenceFor: safe(() => {
      const { useRelationshipStore } = require('../store/relationshipStore') as typeof import('../store/relationshipStore');
      const { normalizeClub } = require('./clubNormalize') as typeof import('./clubNormalize');
      const { CLUB_LABEL } = require('./standardBag') as typeof import('./standardBag');
      const raw = useRelationshipStore.getState().confidenceByClub ?? {};
      const byLabel: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const canon = normalizeClub(k);
        const label = canon ? ((CLUB_LABEL as Record<string, string>)[canon] ?? canon) : k;
        byLabel[label] = v;
      }
      return (label: string) => {
        const v = byLabel[label];
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      };
    }, undefined as never),

    /**
     * 2026-09-11 — THE CLUBS HE ACTUALLY OWNS.
     *
     * The market sim, once given starter sets, had the read telling a player with a driver, a 7 iron
     * and a sand wedge to hit a 3 Iron — a rung of the merged standard ladder he does not have. The
     * registered bag is the one place that knows, and it was never asked.
     *
     * Translated onto ladder labels here, at the boundary, for the same reason the confidence map is:
     * clubBagStore speaks ClubId, the ladder speaks labels, and handing either across raw is how the
     * lie offer silently never fired. An empty bag means UNKNOWN and the ladder stands.
     */
    ownedLabels: safe(() => {
      const { useClubBagStore } = require('../store/clubBagStore') as typeof import('../store/clubBagStore');
      const { clubIdToClubName } = require('../store/clubStatsStore') as typeof import('../store/clubStatsStore');
      const { CLUB_LABEL } = require('./standardBag') as typeof import('./standardBag');
      const out: string[] = [];
      for (const c of useClubBagStore.getState().bagList()) {
        const canon = clubIdToClubName(c.club_id);
        if (!canon) continue;
        out.push((CLUB_LABEL as Record<string, string>)[canon] ?? canon);
      }
      return out;
    }, [] as string[]),

    /** Nearest trouble ahead on the line, when the hole is mapped. */
    nearestHazard: safe(() => {
      if (!courseId || hole == null) return null;
      const cg = require('./courseGeometryService') as typeof import('./courseGeometryService');
      const hz = require('./hazardIntelligence') as typeof import('./hazardIntelligence');
      const wr = require('./windRelative') as typeof import('./windRelative');
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
      const fix = getLastFix();
      if (!fix || fix.lat == null || fix.lng == null) return null;
      const intel = hz.computeHazardIntelligence(
        { lat: fix.lat, lng: fix.lng }, cg.getHoleGeometry(courseId, hole),
        known.rawYards ?? null, wr.shotBearingDeg(hole),
      );
      return intel ? { label: intel.label, yards: Math.round(intel.front) } : null;
    }, null),

    /**
     * Elevation from the cache. The offline responder never passed it at all, which is the exact
     * gap behind Greenhill hole 2 — a 230-yard shot playing considerably downhill, clubbed as if
     * it were flat. A caller with a measured delta to its OWN aim point overrides this below.
     */
    elevationDeltaFeet: safe(() => {
      if (hole == null) return 0;
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
      const { resolveGreenCoords } = require('./smartFinderService') as typeof import('./smartFinderService');
      const el = require('./elevationService') as typeof import('./elevationService');
      const fix = getLastFix();
      const green = resolveGreenCoords(hole)?.middle ?? null;
      if (!fix || fix.lat == null || fix.lng == null || !green) return 0;
      const here = { lat: fix.lat, lng: fix.lng };
      const cached = el.getCachedPlaysLikeElevation(here, green);
      if (cached) return cached.deltaFeet;
      // Not resolved yet: warm it so the NEXT read has it, and stay flat for this one — which is
      // what composeShotRead already defaults to when the field is absent.
      el.warmElevation([here, green]);
      return 0;
    }, 0),
  };

  // The caller wins on anything it actually supplied — its own target, bearing, or measured slope.
  // `undefined` means "you fill it"; an explicit null means "I know there isn't one".
  for (const [k, v] of Object.entries(known)) {
    if (v !== undefined) (filled as unknown as Record<string, unknown>)[k] = v;
  }
  return filled;
}
