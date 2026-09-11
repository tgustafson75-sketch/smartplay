/**
 * THE PLAN RIGHT NOW — one owner, read by the caddie AND by the screen.
 *
 * 2026-09-11. services/holePlan is deliberately pure: no stores, no hooks, so it can be unit-tested
 * and run in the harness. That purity means somebody has to read the stores and hand it the numbers,
 * and there are now TWO callers that need to — services/caddieRequestBody, which sends the plan to
 * the brain, and components/HolePlanChip, which shows it on the screen.
 *
 * Two hand-built compositions of the same plan is precisely the defect this codebase keeps finding:
 * the rangefinder said 205 and the card clubbed him to 180; the caddie quoted a handicap index the
 * dashboard disagreed with; SmartFinder spoke a plays-like number it was not displaying. A plan the
 * player can SEE that differs from the plan the caddie SAYS would be the worst one yet, because both
 * would be confidently wrong at each other in the same moment.
 *
 * So the composition lives here, once, and both sides call it. [[two-owners-is-the-root-cause]]
 */
import type { HolePlan } from './holePlan';

export interface LiveHolePlan {
  plan: HolePlan | null;
  /** "11 shots in hand for 12 holes" — null when the round has no goal. */
  budgetLine: string | null;
}

const EMPTY: LiveHolePlan = { plan: null, budgetLine: null };

/**
 * Compose the plan for the shot in front of the player, from live state.
 *
 * Returns `{ plan: null }` rather than a guess whenever the hole, the par, the bag or the working
 * number is unknown — a plan is read at a glance and trusted, and an invented one is worse than
 * none. Never throws: this is called from a render path and from the request builder, and neither
 * may be taken down by a missing course. [[illustration-data-points]]
 */
export function composeLiveHolePlan(): LiveHolePlan {
  try {
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const { usePlayerProfileStore } = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    const { planHole } = require('./holePlan') as typeof import('./holePlan');
    const { parForHole } = require('./holeParLookup') as typeof import('./holeParLookup');
    const { bagDistances } = require('./shotStrategy') as typeof import('./shotStrategy');

    const r = useRoundStore.getState();
    const p = usePlayerProfileStore.getState();
    if (!r.isRoundActive) return EMPTY;

    const hole = r.currentHole ?? null;
    if (hole == null) return EMPTY;

    const par = parForHole(r.courseHoles ?? [], hole);
    if (par == null) return EMPTY;

    /**
     * The number in front of them, through the one resolver that owns it. Never the card: the plan's
     * whole value is that "leaves you 145" is true, and a scorecard length two shots in is not the
     * distance they are hitting.
     */
    const yards = (() => {
      try {
        const { buildYardageInsight } = require('./yardageResolver') as typeof import('./yardageResolver');
        const v = buildYardageInsight()?.yardage;
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
      } catch { /* fall through */ }
      const c = r.currentYardage;
      return typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : null;
    })();
    if (yards == null) return EMPTY;

    const bag = (() => {
      try { return bagDistances() as Record<string, number>; } catch { return {}; }
    })();

    // The one owner of this count — the prompt's currentStroke is the same number plus one.
    const { strokesPlayedOnHole } = require('../store/roundStore') as typeof import('../store/roundStore');
    const strokesPlayed = strokesPlayedOnHole(r as never, hole);

    const plan = planHole({
      hole,
      par,
      holeYards: yards,
      bag,
      strokesPlayed,
      distanceControl: (p.distanceControl ?? null) as never,
      hazards: liveHazards(hole, yards),
    });

    return { plan, budgetLine: budgetLine() };
  } catch {
    return EMPTY;
  }
}

/** Mapped trouble ahead, measured from where they stand. Empty when the hole is unmapped. */
function liveHazards(hole: number, yards: number) {
  try {
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const courseId = useRoundStore.getState().activeCourseId;
    if (!courseId) return [];
    const cg = require('./courseGeometryService') as typeof import('./courseGeometryService');
    const hz = require('./hazardIntelligence') as typeof import('./hazardIntelligence');
    const wr = require('./windRelative') as typeof import('./windRelative');
    const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
    const fix = getLastFix();
    if (!fix || fix.lat == null || fix.lng == null) return [];
    const intel = hz.computeHazardIntelligence(
      { lat: fix.lat, lng: fix.lng }, cg.getHoleGeometry(courseId, hole), yards, wr.shotBearingDeg(hole),
    );
    if (!intel || !(intel.carryToClear > intel.front)) return [];
    return [{ label: intel.label, startsAt: intel.front, carryToClear: intel.carryToClear }];
  } catch {
    return [];
  }
}

/** The bogey budget as shots IN HAND — the same line the brain is given. */
function budgetLine(): string | null {
  try {
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const { usePlayerProfileStore } = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    const { composePlayProfile, bogeyBudgetLine } = require('./playProfile') as typeof import('./playProfile');
    const { deriveComplexityLevel } = require('./coachingAdaptation') as typeof import('./coachingAdaptation');
    const r = useRoundStore.getState();
    const p = usePlayerProfileStore.getState();
    const stats = typeof r.getHoleStats === 'function' ? (r.getHoleStats() ?? []) : [];
    const coursePar = (r.courseHoles ?? []).reduce(
      (a: number, h: { par?: number }) => a + (h.par ?? 0), 0,
    ) || null;
    const profile = composePlayProfile({
      level: deriveComplexityLevel({
        handicap: p.handicap ?? null,
        experienceContext: p.experienceContext ?? null,
        physicalLimitation: p.physicalLimitation ?? null,
      }),
      goal: (r.mode ?? null) as never,
      coursePar,
      distanceControl: p.distanceControl ?? null,
    });
    const overPar = typeof r.getScoreVsPar === 'function' ? r.getScoreVsPar() : null;
    return bogeyBudgetLine(profile, overPar, stats.length);
  } catch {
    return null;
  }
}
