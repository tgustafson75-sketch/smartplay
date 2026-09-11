/**
 * ONE DECISION FROM THE CADDIE'S BRAIN.
 *
 * 2026-09-11 (Tim). "Reaching a decision and touching decisions at multiple points are two
 * different things. It all needs to be totally orchestrated by the Caddie's brain."
 *
 * ─── WHAT THIS FIXES, AND WHY THE EARLIER FIX WAS NOT IT ───────────────────────────────────────
 *
 * Earlier today four callers of cnsShotRead were each passing a different subset of its inputs, and
 * that was fixed by composing the inputs once. That made the wiring correct. It did not change the
 * SHAPE: there were still nine independent places deciding which club to recommend, now merely
 * well-fed. Feeding nine deciders the same facts is not orchestration — it is nine deciders.
 *
 * This codebase already knows the pattern and applies it three times:
 *   services/caddieBrain.askCaddie      — one conversation, one payload, one endpoint
 *   services/smartAnalysisEngine.analyze — one entrypoint in front of every analyzer
 *   services/metaCourseIntelligence      — one strategic fusion of the camera signals
 *
 * The fourth was missing, and it is the one the app is named for: WHAT DO I HIT, what is the plan,
 * how am I doing against it. Every screen answered that for itself.
 *
 * ─── THE RULE ──────────────────────────────────────────────────────────────────────────────────
 *
 * The brain decides. A surface asks and renders. A screen that computes a club, a plays-like number
 * or a plan for itself is a second caddie, and the player can tell — that is the "generic, and then
 * the tone changes, and the information's more accurate" split Tim described, in the visual half of
 * the app rather than the spoken one.
 *
 * So this returns the WHOLE decision in one call: the shot, the plan, the budget, who they are, and
 * whether they have overruled it. Surfaces take the parts they draw. services/caddieRequestBody
 * sends the SAME object to the cloud brain, so what the caddie SAYS and what the screen SHOWS are
 * not two answers that happen to agree — they are one answer, rendered twice.
 *
 * LOCAL-FIRST. Every part of this is computed on the device, with no network, from facts the app
 * already holds. The cloud brain adds language and reasoning on top; it is never the source of the
 * arithmetic. [[caddie-brain-lens]] [[arithmetic-belongs-in-code-not-the-model]]
 */
import type { ShotRead } from './cnsShotRead';
import type { HolePlan } from './holePlan';
import type { PlayProfile, PlayFinding } from './playProfile';
import type { OverrideRead } from './overrideLoop';
import type { CallerKnown } from './shotReadLive';

export interface CaddieDecision {
  /** The shot in front of them — club, plays-like, the why, the room on the green. */
  shot: ShotRead | null;
  /** The hole played backwards under the bogey budget. Null when the hole is unknown. */
  plan: HolePlan | null;
  /** Shots in hand against the round's goal, phrased as hand rather than deficit. */
  budget: string | null;
  /** Who this golfer is — level, strengths, weaknesses, and how sure we are. */
  profile: PlayProfile | null;
  /** They have named a club other than the one the caddie called. */
  override: OverrideRead | null;
  /** In-play reminders still worth saying, already decayed by what has been said. */
  cues: PlayFinding[];
  /**
   * 2026-09-11 (Tim) — WHAT THE POST-ROUND ANSWERS HAVE ACTUALLY BEEN WORTH.
   *
   * "It asks feel, weather, mindset etc but I have a suspicion that does not feed information for
   * future rounds and situations and data."
   *
   * It did not. The four questions asked after every round were read once, by the recap of that same
   * round, and never again. These are the ones that have repeated enough to mean something, and
   * `todayMatches` is the subset that describes the round being played RIGHT NOW — a finding about
   * wind is worth far more on a windy tee than in a season summary.
   */
  conditions: string | null;
  todayMatches: string | null;
}


/**
 * 2026-09-11 — an EMPTY constant and a noDecision() export were written here and both deleted: the
 * orphan guard refused noDecision within a minute of it landing, because nothing needed it.
 * decideShot() with no arguments already returns every field present and null, which is the shape a
 * surface destructures on the first render of a round. [[orphans-are-live-bugs-not-dead-code]]
 */
function safe<T>(fn: () => T, fallback: T): T {
  try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; }
}

/**
 * The caddie's decision, right now.
 *
 * `known` is what the ASKING SURFACE genuinely knows better than live state — the yardage to a
 * tapped target rather than to the middle of the green, the bearing to that target, a measured
 * slope. Everything else is composed. A surface passes what it has and renders what comes back; it
 * never reaches past this for a number it intends to show.
 *
 * Never throws and never blocks. Every part is independently guarded, so an unmapped hole costs the
 * plan and nothing else. All synchronous and all local — safe to call from a render path.
 */
export function decideShot(known: CallerKnown = { rawYards: null }): CaddieDecision {
  const shot = safe(() => {
    const { composeShotRead } = require('./cnsShotRead') as typeof import('./cnsShotRead');
    const { liveShotReadInputs } = require('./shotReadLive') as typeof import('./shotReadLive');
    return composeShotRead(liveShotReadInputs(known));
  }, null);

  const plan = safe(() => {
    const { composeLiveHolePlan } = require('./holePlanLive') as typeof import('./holePlanLive');
    return composeLiveHolePlan().plan;
  }, null);

  const profile = safe(() => composeProfile(), null);

  return {
    shot,
    plan,
    /**
     * Composed HERE from the profile above rather than inside holePlanLive, which used to build its
     * own profile for exactly this line. The budget is a statement about the player, so it belongs
     * to the one place that decides who the player is.
     */
    budget: safe(() => composeBudget(profile), null),
    profile,
    override: safe(() => composeOverride(known), null),
    cues: safe(() => composeCues(profile), []),
    conditions: safe(() => composeConditions().all, null),
    todayMatches: safe(() => composeConditions().today, null),
  };
}

/**
 * What the post-round answers have been worth across rounds, and which of them describe TODAY.
 *
 * Today's weather comes from the app's own measurement rather than waiting to be told: the player
 * answers the weather question at the END of a round, which is no use during one.
 */
function composeConditions(): { all: string | null; today: string | null } {
  const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
  const rc = require('./roundConditions') as typeof import('./roundConditions');
  const r = useRoundStore.getState();
  const findings = rc.conditionFindings((r.roundHistory ?? []) as never);
  if (findings.length === 0) return { all: null, today: null };

  const weatherNow = safe(() => {
    const { getCachedWeatherEvenIfStale } = require('./weatherService') as typeof import('./weatherService');
    const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
    const fix = getLastFix();
    if (!fix || fix.lat == null || fix.lng == null) return null;
    const w = getCachedWeatherEvenIfStale({ lat: fix.lat, lng: fix.lng });
    if (!w) return null;
    // Mapped onto the SAME words the post-round screen offers, or the buckets can never match.
    const mph = typeof w.wind_speed_mph === 'number' ? w.wind_speed_mph : 0;
    const f = typeof w.temp_f === 'number' ? w.temp_f : null;
    if (mph >= 12) return 'Windy';
    if (f != null && f >= 85) return 'Hot';
    if (f != null && f <= 50) return 'Cold';
    return null;
  }, null);

  const today = rc.findingsForToday(findings, { weather: weatherNow });
  return {
    all: rc.describeConditions(findings, 2),
    today: rc.describeConditions(today, 1),
  };
}

/** Shots IN HAND against the round's goal — never a deficit. Null when there is no goal. */
function composeBudget(profile: PlayProfile | null): string | null {
  if (!profile) return null;
  const { bogeyBudgetLine } = require('./playProfile') as typeof import('./playProfile');
  const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
  const r = useRoundStore.getState();
  const stats = typeof r.getHoleStats === 'function' ? (r.getHoleStats() ?? []) : [];
  const overPar = typeof r.getScoreVsPar === 'function' ? r.getScoreVsPar() : null;
  return bogeyBudgetLine(profile, overPar, stats.length);
}

/** Who this golfer is. Composed from what has been measured, labelled with where it came from. */
function composeProfile(): PlayProfile | null {
  const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
  const { usePlayerProfileStore } = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
  const { useRelationshipStore } = require('../store/relationshipStore') as typeof import('../store/relationshipStore');
  const { composePlayProfile } = require('./playProfile') as typeof import('./playProfile');
  const { deriveComplexityLevel } = require('./coachingAdaptation') as typeof import('./coachingAdaptation');

  const r = useRoundStore.getState();
  const p = usePlayerProfileStore.getState();
  const stats = typeof r.getHoleStats === 'function' ? (r.getHoleStats() ?? []) : [];
  const played = stats.length;
  const penalties = stats.reduce((a: number, h: { penalties?: number }) => a + (h.penalties ?? 0), 0);
  const putts = stats.reduce((a: number, h: { putts?: number }) => a + (h.putts ?? 0), 0);
  const coursePar = (r.courseHoles ?? []).reduce(
    (a: number, h: { par?: number }) => a + (h.par ?? 0), 0,
  ) || null;
  const rounds = safe(() => useRelationshipStore.getState().roundsTogether ?? 0, 0);

  return composePlayProfile({
    level: deriveComplexityLevel({
      handicap: p.handicap ?? null,
      experienceContext: p.experienceContext ?? null,
      physicalLimitation: p.physicalLimitation ?? null,
    }),
    goal: (r.mode ?? null) as never,
    coursePar,
    distanceControl: p.distanceControl ?? null,
    dominantMiss: (p.dominantMiss ?? null) as never,
    // Per-18 rates only mean something once a round is actually under way.
    penaltiesPerRound: played > 0 ? (penalties / played) * 18 : null,
    puttsPerRound: played > 0 ? (putts / played) * 18 : null,
    roundsPlayed: rounds,
  });
}

/**
 * Have they overruled the caddie? Composed here rather than at each surface, so the screen showing
 * the club and the caddie speaking about it agree on whether it was even the caddie's club.
 */
function composeOverride(known: CallerKnown): OverrideRead | null {
  const { pendingAdviceIfFresh, declaredClubIfFresh } = require('./shotClubResolver') as typeof import('./shotClubResolver');
  const standing = pendingAdviceIfFresh();
  const chosen = declaredClubIfFresh();
  if (!standing || !chosen) return null;
  const { readOverride } = require('./overrideLoop') as typeof import('./overrideLoop');
  const { normalizeClub } = require('./clubNormalize') as typeof import('./clubNormalize');
  const { bagDistances } = require('./shotStrategy') as typeof import('./shotStrategy');
  const { usePlayerProfileStore } = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
  return readOverride({
    advisedClub: standing.club,
    chosenClub: chosen,
    bag: safe(() => bagDistances() as Record<string, number>, {}),
    normalize: normalizeClub,
    yardsToTarget: known.rawYards ?? null,
    distanceControl: (usePlayerProfileStore.getState().distanceControl ?? null) as never,
  });
}

/**
 * The reminders worth saying, minus the ones already said.
 *
 * The decay lives here rather than at each surface: a cue the caddie has spoken twice must not
 * reappear on a chip, and "has this been said" is one fact with one owner. [[no-push-nagging-no-ads]]
 */
function composeCues(profile: PlayProfile | null): PlayFinding[] {
  if (!profile) return [];
  const { cuesFor } = require('./playProfile') as typeof import('./playProfile');
  const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
  const spoken = (useRoundStore.getState().spokenHoleEvents ?? {}) as Record<string, true>;
  const counts: Record<string, number> = {};
  for (const c of profile.cues) {
    counts[c.text] = Object.keys(spoken).filter((k) => k.startsWith(`cue:${c.text}`)).length;
  }
  return cuesFor(profile, counts, 2);
}
