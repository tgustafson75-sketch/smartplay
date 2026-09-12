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
  /**
   * 2026-09-11 (Tim) — "Maybe there are mitigation or at least mindset strategies we can derive."
   *
   * Present only when TODAY is a condition this player has a MEASURED penalty in. Carries what the
   * app has already done to the numbers (so he does not club up twice), what is worth doing, and
   * the target the round should actually be measured against.
   */
  conditionPlay: import('./roundConditions').ConditionPlay | null;
  /**
   * 2026-09-11 (Tim — "same way we are handling pre round stretch and warmup drills data") — DID HE
   * WARM UP TODAY, AND WHAT HAS WARMING UP BEEN WORTH.
   *
   * Exactly the gap the post-round answers had: services/practice/warmupPerformance measures it,
   * app/(tabs)/dashboard shows it, and the caddie — standing with him on the first tee having NOT
   * warmed up — knew nothing about it. Measured, displayed, and absent from the one moment it could
   * change anything.
   */
  warmup: { warmedToday: boolean; worthStrokes: number | null; line: string | null } | null;
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
  /**
   * 2026-09-11 — composed ONCE. This was three separate `safe(() => composeConditions()...)` calls,
   * one per field, and each walked the whole round history to recompute the same findings. Three
   * passes to fill three properties of one answer.
   */
  const conditions = safe(
    () => composeConditions(),
    { all: null, today: null, play: null } as ReturnType<typeof composeConditions>,
  );

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
    conditions: conditions.all,
    todayMatches: conditions.today,
    conditionPlay: conditions.play,
    warmup: safe(() => composeWarmup(), null),
  };
}

/**
 * What the post-round answers have been worth across rounds, and which of them describe TODAY.
 *
 * Today's weather comes from the app's own measurement rather than waiting to be told: the player
 * answers the weather question at the END of a round, which is no use during one.
 */
function composeConditions(): {
  all: string | null;
  today: string | null;
  play: import('./roundConditions').ConditionPlay | null;
} {
  const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
  const rc = require('./roundConditions') as typeof import('./roundConditions');
  const r = useRoundStore.getState();
  const findings = rc.conditionFindings((r.roundHistory ?? []) as never);
  if (findings.length === 0) return { all: null, today: null, play: null };

  const weatherNow = safe(() => {
    const { getCachedWeatherEvenIfStale } = require('./weatherService') as typeof import('./weatherService');
    const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
    const fix = getLastFix();
    if (!fix || fix.lat == null || fix.lng == null) return null;
    const w = getCachedWeatherEvenIfStale({ lat: fix.lat, lng: fix.lng });
    if (!w) return null;
    /**
     * Mapped onto the SAME words the post-round screen offers, or the buckets can never match.
     *
     * Order is by how much the condition actually changes a round, not by severity of weather: rain
     * and cold beat wind because they change the ball AND the player, and a golfer will name them
     * as THE thing about the round. Sunny is last because it is the baseline, not a finding.
     */
    const mph = typeof w.wind_speed_mph === 'number' ? w.wind_speed_mph : 0;
    const f = typeof w.temp_f === 'number' ? w.temp_f : null;
    const cond = typeof w.conditions === 'string' ? w.conditions.toLowerCase() : '';
    if (/rain|drizzle|shower|thunderstorm/.test(cond)) return 'Rainy';
    if (f != null && f <= 50) return 'Cold';
    if (f != null && f >= 85) return 'Hot';
    if (mph >= 12) return 'Windy';
    if (/clear|sun/.test(cond)) return 'Sunny';
    return null;
  }, null);

  const today = rc.findingsForToday(findings, { weather: weatherNow });
  return {
    all: rc.describeConditions(findings, 2),
    today: rc.describeConditions(today, 1),
    play: rc.playForToday(findings, { weather: weatherNow }),
  };
}

/**
 * Whether he warmed up for THIS round, and what warming up has been worth across his rounds.
 *
 * Uses the existing owners rather than re-deriving either: wasRoundWarmed for today, and
 * computeWarmupPerformance for the pattern, both of which already carry the honesty bars (three
 * rounds each side, association never causation). Rebuilding them here would be the two-owners bug
 * that had the dashboard's own two cards disagreeing this morning. [[two-owners-is-the-root-cause]]
 */
function composeWarmup(): { warmedToday: boolean; worthStrokes: number | null; line: string | null } | null {
  const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
  const wp = require('./practice/warmupPerformance') as typeof import('./practice/warmupPerformance');
  const r = useRoundStore.getState();
  if (!r.isRoundActive) return null;

  // The same union of warm-up EVENTS the dashboard builds — a pre-round practice session or a
  // pre-round workout. A warm-up is a warm-up.
  const events = safe(() => {
    const { usePracticeSessionStore } = require('../store/practiceSessionStore') as typeof import('../store/practiceSessionStore');
    const { useWorkoutStore } = require('../store/workoutStore') as typeof import('../store/workoutStore');
    const practice = (usePracticeSessionStore.getState().history ?? [])
      .filter((x) => (x as { focus?: string; environment?: string }).focus === 'preround'
        || (x as { environment?: string }).environment === 'preround')
      .map((x) => (x as { startedAt?: number }).startedAt);
    const workouts = (useWorkoutStore.getState().history ?? [])
      .filter((w) => (w as { source?: string }).source === 'preround_warmup')
      .map((w) => (w as { date?: number }).date);
    return [...practice, ...workouts].filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  }, [] as number[]);

  const warmedToday = wp.wasRoundWarmed(r.roundStartTime ?? null, events);
  const perf = safe(() => wp.computeWarmupPerformance({
    warmups: events.map((t) => ({ completedAt: t })),
    rounds: (r.roundHistory ?? []).map((x) => ({
      startedAt: (x as { startedAt?: number }).startedAt as number,
      scoreVsPar: (x as { scoreVsPar?: number | null }).scoreVsPar ?? null,
    })),
  }), null);

  const worth = perf?.enough ? (perf.deltaStrokes ?? null) : null;
  /**
   * Only worth saying when he did NOT warm up and warming up has measurably helped him. Telling a
   * man who warmed up that warming up is good is noise; telling one who did not that his own record
   * says it costs him is the expectation-setting the cold line does. It is one sentence, at the
   * start, and never again.
   */
  const line = (!warmedToday && typeof worth === 'number' && worth >= 1)
    ? `He did not warm up today, and on his own record he averages ${Math.round(worth * 10) / 10} strokes better when he does. Say it ONCE, early, as a expectation rather than a scolding — the first few holes are where it shows, so a conservative club early is the play, not a lecture.`
    : null;
  return { warmedToday, worthStrokes: worth, line };
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

  /**
   * 2026-09-11 (Tim — "make sure this works both ways with fit profile in dashboard") — THE BAG
   * GAPS, WHICH THE CADDIE COULD NEVER SEE.
   *
   * playProfile has had a measured weakness line for gaps — "N real gaps in your set, some numbers
   * have no full swing" — and `bagGapCount` had NO WRITER anywhere in the app. services/practice/
   * fitProfile computes the gaps and app/practice/fit-profile was its only caller, so the dashboard
   * knew and the caddie did not, and that branch could never fire. Same shape as distanceControl:
   * a reader with no writer. [[sweep-the-missing-half-not-the-unused-export]]
   */
  const bagGapCount = safe(() => {
    const { composeFitProfile } = require('./practice/fitProfile') as typeof import('./practice/fitProfile');
    const { useClubStatsStore, CLUB_ORDER } = require('../store/clubStatsStore') as typeof import('../store/clubStatsStore');
    const st = useClubStatsStore.getState();
    const clubs = CLUB_ORDER
      .filter((c) => c !== 'Putter')
      .map((c) => ({ club: c, yards: st.carryFor(c), measured: st.hasCarry(c), stated: st.hasManual(c) }));
    return composeFitProfile(clubs as never).gaps.length;
  }, null);

  return composePlayProfile({
    bagGapCount,
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
