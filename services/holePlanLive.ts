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
}

const EMPTY: LiveHolePlan = { plan: null };

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

    // The one owner of this count — the prompt's currentStroke is the same number plus one.
    const { strokesPlayedOnHole } = require('../store/roundStore') as typeof import('../store/roundStore');
    const strokesPlayed = strokesPlayedOnHole(r as never, hole);

    /**
     * The number in front of them, through the one resolver that owns it.
     *
     * 2026-09-11 — AND THE CARD IS ONLY TRUE ON THE TEE.
     *
     * Caught by driving the real stores: with GPS not yet ready, buildYardageInsight falls back to
     * `static_card`, which is the hole's length FROM THE TEE. Handed that after one shot, the planner
     * told a man with 150 yards left to hit driver, and the chip showed it: "Driver from here —
     * leaving 150." Every number in the sentence was internally consistent and the starting one was
     * the scorecard.
     *
     * That is the 2026-08-22 Greenhill defect exactly — "a TEE briefing, off the scorecard, to a man
     * standing in the fairway" — and the source-level test for this file PASSED through it, because
     * the source did say buildYardageInsight(); it was the VALUE that was the card.
     *
     * Once he has hit, the one thing we know for certain is that he is closer than the card. So the
     * plan says nothing rather than briefing a tee shot. On the tee the card is a fair number and
     * the plan stands. [[illustration-data-points]] [[two-owners-is-the-root-cause]]
     */
    const insight = (() => {
      try {
        const { buildYardageInsight } = require('./yardageResolver') as typeof import('./yardageResolver');
        return buildYardageInsight() ?? null;
      } catch { return null; }
    })();
    if (strokesPlayed > 0 && insight?.source === 'static_card') return EMPTY;
    const yards = (() => {
      const v = insight?.yardage;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
      const c = r.currentYardage;
      return typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : null;
    })();
    if (yards == null) return EMPTY;

    const bag = (() => {
      try { return bagDistances() as Record<string, number>; } catch { return {}; }
    })();

    const plan = planHole({
      hole,
      par,
      holeYards: yards,
      bag,
      strokesPlayed,
      distanceControl: (p.distanceControl ?? null) as never,
      hazards: liveHazards(hole, yards),
    });

    return { plan };
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

/**
 * 2026-09-11 — a budgetLine() helper lived here and composed its OWN play profile just to work out
 * the shots in hand. services/caddieDecision already holds the profile, so that was a second answer
 * to "who is this golfer" built from the same inputs, a few files apart. The budget now comes from
 * the brain's profile. Two compositions of a player is two players.
 * [[two-owners-is-the-root-cause]]
 */
