/**
 * 2026-05-24 — "Ask the Golf Father" intent handler (v1 — hardcoded rules).
 *
 * Triggered by phrases like "what would Tank do here", "what's the play",
 * "Tank's advice", "Golf Father help". Routes to a hardcoded decision
 * cascade that reads currentLocationType (tee / fairway / green) +
 * distance-to-pin from the existing geometry resolver. Per spec: NO
 * LLM call — instant <200ms response is the contract. The cascade
 * encodes Tank's archetypal voice and the user's stated tee-vs-approach
 * mental model so the response is context-aware without latency.
 *
 * Inputs (read at execute time, not from AppContext — saves a context-
 * shape change):
 *   - useRoundStore.getState().currentLocationType → tee | fairway | green | unknown
 *   - useRoundStore.getState().currentHole
 *   - getOneShotFix({ maxAgeMs: 3_000 }) → fresh GPS for distance
 *   - resolveGreenCoords(currentHole).middle → pin coord
 *
 * Deferred signals (spec called for them; data sources don't surface
 * to handler cleanly yet):
 *   - wind direction      — weatherService caches a snapshot but no
 *                            "into / with / cross" reduction. Follow-up:
 *                            derive from snapshot.wind_deg vs hole bearing.
 *   - user shot pattern   — there's a pattern detector somewhere in the
 *                            insights pipeline but not packaged for sync
 *                            lookup. Follow-up: surface most-recent
 *                            "miss_right" / "miss_left" tag.
 *   - lie                  — round.pendingLieAnalysis exists; not wired
 *                            yet because the v1 rule set doesn't branch
 *                            on lie. Add when fairway/rough advice
 *                            diverges.
 *
 * Tank's "Tank: ..." prefix is preserved per spec even though the active
 * persona's voice already identifies the speaker. Drop the prefix later
 * if the user requests a non-redundant variant per persona.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { getOneShotFix } from '../gpsManager';
import { resolveGreenCoords } from '../smartFinderService';
import { haversineYards } from '../../utils/geoDistance';
import { usePracticeStore } from '../../store/practiceStore';
import i18n from '../../i18n';

// 2026-05-24 — Tier-1 Tank rules. Keyed by `${topic}_${subtopic}` so the
// classifier emits a rule pointer directly (e.g. topic=rules,
// subtopic=red_vs_yellow → 'rules_red_vs_yellow'). Strings are static;
// functions receive a `ctx` shape that merges AppContext + roundStore +
// practiceStore signals and return a tailored line. When a rule isn't
// matched, execute() falls through to the existing location × distance
// cascade so the older subtopic='tank_advice' path keeps working.
type TankCtx = {
  currentLocationType?: 'tee' | 'fairway' | 'green' | 'unknown';
  distance_to_pin?: number;
  wind?: 'into' | 'with' | 'cross' | null;
  lie?: string;
  user_handicap?: number;
  // Practice signals merged in below.
  overTheTopCount: number;
  swingCount: number;
  avgCarryDriver: number;
  avgCarry3Wood: number;
  typicalMiss: 'left' | 'right' | 'straight';
  fatShotCount: number;
};

type TankRule = string | ((ctx: TankCtx) => string);

// 2026-05-24 v1.2 — Rule strings now come from i18n (en + es). Function
// rules keep their TypeScript branching logic; static rules collapse to
// a single i18n key. The function rules read i18n.t() for the actual
// strings so EN and ES variants ship without code change.
const TANK_RULES: Record<string, TankRule> = {
  rules_red_vs_yellow: () => i18n.t('tank.red_vs_yellow'),

  course_management_driver_or_3wood: (ctx) => {
    if (ctx.currentLocationType !== 'tee') return i18n.t('tank.driver_or_3wood_clean');
    const dist = ctx.distance_to_pin;
    if (ctx.wind === 'into' && typeof dist === 'number' && dist > 240) {
      return i18n.t('tank.par3_wind');
    }
    if (ctx.overTheTopCount > 3 && ctx.swingCount > 5) {
      return i18n.t('tank.driver_or_3wood');
    }
    if (ctx.avgCarryDriver > 0 && typeof dist === 'number' && dist > ctx.avgCarryDriver + 20) {
      // Number-bearing branch keeps a templated string; i18n's
      // interpolation could replace this later if Spanish needs a
      // different word order.
      return `It's ${dist}. Your gamer averages ${Math.round(ctx.avgCarryDriver)}. You don't have it. 3-wood.`;
    }
    return i18n.t('tank.driver_or_3wood_clean');
  },

  course_management_lay_up: () => i18n.t('tank.layup'),

  rules_nearest_point_relief: () => i18n.t('tank.nearest_point_relief'),

  rules_can_ground_club: (ctx) => {
    const lie = String(ctx.lie ?? 'unknown').toLowerCase();
    if (lie === 'hazard' || lie === 'bunker' || lie === 'penalty_area') {
      return i18n.t('tank.can_ground_club_no');
    }
    return i18n.t('tank.can_ground_club_yes');
  },

  course_management_flag_or_center: (ctx) => {
    const hcp = ctx.user_handicap ?? 18;
    if (hcp > 15) return i18n.t('tank.flag_or_center_safe');
    if (typeof ctx.distance_to_pin === 'number' && ctx.distance_to_pin < 125) {
      return i18n.t('tank.flag_or_center_attack');
    }
    return i18n.t('tank.flag_or_center_balanced');
  },

  // 2026-06-04 — Golf Father optical-illusion chapter. When the player
  // asks "why did my fade leak?" / "I was sure I was aimed left enough"
  // / similar, Tank checks alignment-trust BEFORE diagnosing swing
  // mechanics. Static line keeps the <200ms contract; deeper signal-
  // weighted diagnosis lives in
  // services/knowledge/golfFather/opticalIllusionFadeAlignment.ts and
  // will plug into the brain path (cage-coach / kevin) on a follow-up.
  swing_alignment_check: () =>
    'Tank: Before we touch your swing — many righties get a visual illusion when they aim left for a fade. The further left the start line, the harder it is to trust it from over the ball. Most of the time, the shape was fine; the line moved on you in setup. Pick the line behind the ball, walk in, commit to it, swing. If the miss keeps showing up with the same shape, it\'s alignment, not mechanics.',

  // 2026-06-04 — Companion entry for the inverse case (draw target line
  // looking too far right). Same principle, weaker illusion.
  swing_alignment_draw: () =>
    'Tank: Draw setups look closer to natural — the illusion is smaller. If your draw is starting on target instead of right of it, that\'s usually mechanics or face control, not alignment. Worth checking alignment first anyway. Cheap to rule out.',
};

export const askGolfFatherHandler: IntentHandler = {
  intent_type: 'ask_golf_father',

  parameter_schema: {
    topic: 'string — high-level area (course_management, mental, swing). Currently advisory only.',
    subtopic: '"tank_advice" — the only subtopic v1 routes on.',
    use_context: 'boolean — whether to weave in current location/distance. Defaults true.',
  },

  examples: [
    'what would Tank do here',
    "what's the play here",
    'tell me what to do',
    'Golf Father help',
    'Tank advice',
  ],

  async execute(intent, context): Promise<IntentResult> {
    const topic = String((intent.parameters as { topic?: unknown }).topic ?? '');
    const subtopic = String((intent.parameters as { subtopic?: unknown }).subtopic ?? 'tank_advice');
    const useContext = (intent.parameters as { use_context?: unknown }).use_context !== false;

    const round = useRoundStore.getState();
    const locType = round.currentLocationType;
    const currentHole = round.currentHole;

    // ── Tier-1 rule lookup (BEFORE the location cascade) ──────────
    // If the classifier emitted a rules- or course-management-keyed
    // subtopic, return the Tank rule for that key directly.
    // Functions receive a merged context with practice signals so the
    // rule can branch on swing history (e.g. "you've been over the top").
    const ruleKey = `${topic}_${subtopic}`;
    const rule = TANK_RULES[ruleKey];
    if (rule) {
      // Best-effort distance for rule branches that read it. Cheap GPS
      // lookup; if it fails the rule's distance branches just don't fire.
      let distYds: number | undefined = undefined;
      if (useContext) {
        try {
          const fix = await getOneShotFix({ maxAgeMs: 3_000 });
          const green = resolveGreenCoords(currentHole).middle;
          if (fix && green) {
            distYds = Math.round(haversineYards({ lat: fix.lat, lng: fix.lng }, green));
          }
        } catch { /* distance optional */ }
      }
      const practice = usePracticeStore.getState();
      const ctxShape: TankCtx = {
        currentLocationType: locType,
        distance_to_pin: distYds,
        wind: null,
        lie: undefined,
        user_handicap: 18,
        overTheTopCount: practice.overTheTopCount,
        swingCount: practice.swingCount,
        avgCarryDriver: practice.avgCarryDriver,
        avgCarry3Wood: practice.avgCarry3Wood,
        typicalMiss: practice.typicalMiss,
        fatShotCount: practice.fatShotCount,
      };
      void context;
      const answer = typeof rule === 'function' ? rule(ctxShape) : rule;
      return tank(answer, ['tank_advice_given', ruleKey, `loc:${locType}`]);
    }

    // Best-effort distance to pin. Cap at 3s freshness so the cascade
    // doesn't hang on a GPS retry.
    let distYds: number | null = null;
    if (useContext) {
      try {
        const fix = await getOneShotFix({ maxAgeMs: 3_000 });
        const green = resolveGreenCoords(currentHole).middle;
        if (fix && green) {
          distYds = Math.round(haversineYards({ lat: fix.lat, lng: fix.lng }, green));
        }
      } catch {
        // Distance fallback: handler still answers from location alone.
      }
    }

    // Branch on subtopic — only tank_advice today.
    if (subtopic !== 'tank_advice') {
      return tank("Pick a topic and I'll get specific. Tee shot? Approach? Putt?", ['no_subtopic', `loc:${locType}`]);
    }

    // GPS-less fallback. Distance-conditional rules can't fire — return
    // the most useful location-only advice.
    if (distYds == null) {
      if (locType === 'tee') return tank("On the tee. Get it in play. Don't try to be a hero with the driver if you've been spraying it.", ['no_dist', `loc:${locType}`]);
      if (locType === 'green') return tank("Green read. First read is usually right — trust it. Pace over line.", ['no_dist', `loc:${locType}`]);
      return tank("Walk a few steps so I can lock GPS. Then I'll tell you the play.", ['no_dist', `loc:${locType}`]);
    }

    // ── Tee box advice ──────────────────────────────────────────────
    if (locType === 'tee') {
      if (distYds > 450) return tank("Big par 5. Tee shot in the fairway. You can't reach in two anyway — give yourself a clean second.", ['tee', `dist:${distYds}`]);
      if (distYds > 280) return tank("Driver hole. Pick a target on the FAR side of the fairway and commit. Don't steer it.", ['tee', `dist:${distYds}`]);
      if (distYds > 200) return tank("Short par 4. 3-wood or hybrid — take driver out of the bag. Position over distance.", ['tee', `dist:${distYds}`]);
      // Short par 3 / driveable
      return tank("Short hole. Pick a club you can swing smooth at 80%. Pin-high is the win.", ['tee', `dist:${distYds}`]);
    }

    // ── Approach / fairway advice ───────────────────────────────────
    if (locType === 'fairway') {
      if (distYds < 100) return tank("Wedge in hand. Attack the pin. Commit and finish balanced.", ['fairway', `dist:${distYds}`]);
      if (distYds < 150) return tank("Scoring zone. Pick the number, swing smooth, hold the finish.", ['fairway', `dist:${distYds}`]);
      if (distYds < 200) return tank("Mid iron. Aim center of the green — pin-hunting from here loses you strokes.", ['fairway', `dist:${distYds}`]);
      return tank("Long way home. Lay up to a number you love. Don't force the hero shot.", ['fairway', `dist:${distYds}`]);
    }

    // ── Green ───────────────────────────────────────────────────────
    if (locType === 'green') {
      return tank("Putter time. Read it once, trust it. Speed first, line second.", ['green', `dist:${distYds}`]);
    }

    // ── Unknown location (GPS hasn't tagged yet) ────────────────────
    return tank("Give me a second to figure out where you are. Walk a step or two.", ['unknown', `dist:${distYds}`]);
  },
};

function tank(line: string, sideEffects: string[]): IntentResult {
  return {
    success: true,
    voice_response: `Tank: ${line}`,
    side_effects: ['ask_golf_father', ...sideEffects],
    follow_up_needed: false,
  };
}
