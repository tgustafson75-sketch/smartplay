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

  async execute(intent): Promise<IntentResult> {
    const subtopic = String((intent.parameters as { subtopic?: unknown }).subtopic ?? 'tank_advice');
    const useContext = (intent.parameters as { use_context?: unknown }).use_context !== false;

    const round = useRoundStore.getState();
    const locType = round.currentLocationType;
    const currentHole = round.currentHole;

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
