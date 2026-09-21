/**
 * Phase T — Handicap query handler.
 *
 * Voice queries about WHS handicap calculations route here. Math runs
 * entirely in services/handicapCalculator.ts (no LLM call needed —
 * computation is deterministic). Sonnet/Haiku not used; this is the
 * fastest possible path so handicap voice queries return well under
 * 500ms total.
 *
 * Handles:
 *   • "what's my course handicap from these tees"
 *   • "what does a 95 do to my index"
 *   • "what's my net double bogey on this hole"
 *   • "how does my handicap work"
 */

import { holePar as parForHole, holeData as resolvedHoleData } from '../smartFinderService';
import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import {
  computeCourseHandicap, computeScoreDifferential, netDoubleBogeyCap,
  estimateNewIndex, explainHandicapImpact, strokesReceivedOnHole,
} from '../handicapCalculator';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';

export const handicapQueryHandler: IntentHandler = {
  intent_type: 'handicap_query',

  parameter_schema: {
    handicap_topic: 'one of: course_handicap, score_differential, net_double_bogey, index_impact, explain',
    score_value: 'optional integer score, used by score_differential / index_impact',
    par_value: 'optional integer par, used by net_double_bogey',
  },

  examples: [
    'what is my course handicap',
    'what does a 95 do to my index',
    'what is my net double bogey',
    'how does my handicap work',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const profile = usePlayerProfileStore.getState();
    const round = useRoundStore.getState();
    const idx = profile.handicap_index;
    const topic = String(intent.parameters.handicap_topic ?? 'course_handicap').toLowerCase();

    if (idx == null) {
      return {
        success: true,
        voice_response: "I don't have your Index yet. Set it in Settings → Profile → Handicap and I can answer that.",
        side_effects: ['handicap:no_index'],
        follow_up_needed: false,
      };
    }

    // Pull course rating/slope/par from active round when available.
    const tee = round.courseHoles[0];
    const par = round.courseHoles.reduce((a, h) => a + h.par, 0) || 72;
    /**
     * 2026-09-20 (Tim, from Echo Hills) — IS THIS A NINE?
     *
     * `par` above sums the loaded holes, so a nine-hole course gives 35 rather than 72 — and every
     * branch below then fed that into an EIGHTEEN-hole formula. At Echo Hills, which carries no
     * rating on its card, `computeCourseHandicap(idx, par, 113, par)` reduces to exactly `idx`, so
     * the caddie told an 18-index player "your Course Handicap would be about 18" on a nine-hole
     * course. The right answer is about nine, and stating the wrong one as fact is the failure
     * mode the 2026-09-13 stroke-index note on this same handler warned about.
     *
     * Same two signals the round store already uses, so one answer to "how long is this round":
     * the player's declared nine, or a natively-nine course. [[two-owners-is-the-root-cause]]
     */
    const holeCount: 9 | 18 = (() => {
      try {
        if (round.nineHoleMode) return 9;
        const { getCourseHoleCount } = require('../../data/courses') as typeof import('../../data/courses');
        return getCourseHoleCount(round.activeCourseId, round.courseHoles.length) === 9 ? 9 : 18;
      } catch { return round.courseHoles.length === 9 ? 9 : 18; }
    })();
    const lengthWord = holeCount === 9 ? 'nine-hole ' : '';

    switch (topic) {
      case 'course_handicap': {
        // Need rating + slope. If we don't have them in courseHoles (typical
        // when upstream rating data isn't present), fall back to a neutral
        // 113 slope and explain.
        const rating = (tee && (tee as { course_rating?: number }).course_rating) ?? null;
        const slope = (tee && (tee as { slope_rating?: number }).slope_rating) ?? null;
        if (rating != null && slope != null) {
          const ch = computeCourseHandicap(idx, rating, slope, par, holeCount);
          return {
            success: true,
            voice_response: `Your ${lengthWord}Course Handicap here is ${ch}.`,
            side_effects: [`handicap:course:${ch}`],
            follow_up_needed: false,
          };
        }
        // No course rating loaded — give the neutral-slope estimate.
        const ch = computeCourseHandicap(idx, par, 113, par, holeCount);
        return {
          success: true,
          voice_response: `I don't have this course's rating loaded — at neutral slope your ${lengthWord}Course Handicap would be about ${ch}. Pull up Course Detail to get the real numbers.`,
          side_effects: ['handicap:no_rating'],
          follow_up_needed: false,
        };
      }

      case 'score_differential': {
        const score = Number(intent.parameters.score_value);
        if (!Number.isFinite(score)) {
          return {
            success: true,
            voice_response: "Tell me the score — like 'what does a 95 do to my Index?'",
            side_effects: ['handicap:no_score'],
            follow_up_needed: true,
          };
        }
        const rating = (tee && (tee as { course_rating?: number }).course_rating) ?? par;
        const slope = (tee && (tee as { slope_rating?: number }).slope_rating) ?? 113;
        const diff = computeScoreDifferential(score, rating, slope);
        return {
          success: true,
          voice_response: `That's a ${diff.toFixed(1)} differential.`,
          side_effects: [`handicap:diff:${diff}`],
          follow_up_needed: false,
        };
      }

      case 'net_double_bogey': {
        const requestedPar = Number(intent.parameters.par_value);
        const holePar = Number.isFinite(requestedPar) ? requestedPar : (round.currentHole ? parForHole(round.currentHole) ?? 4 : 4);
        const rating = (tee && (tee as { course_rating?: number }).course_rating) ?? par;
        const slope = (tee && (tee as { slope_rating?: number }).slope_rating) ?? 113;
        const ch = computeCourseHandicap(idx, rating, slope, par, holeCount);
        /**
         * 2026-09-13 — THIS PASSED THE HOLE NUMBER WHERE WHS WANTS THE STROKE INDEX.
         *
         * `strokesReceivedOnHole(courseHandicap, holeStrokeIndex)` allocates by the scorecard's HCP
         * column — 1 = hardest … 18 = easiest — and this called it with `round.currentHole`. Hole 1
         * might be stroke index 7, so with a Course Handicap of 7 the old code granted a stroke on
         * hole 1 that the player does not get, and withheld one on the hole where they do. Then it
         * stated the result as fact: "Your max for handicap is 7 (par 4 plus 2 plus 1 stroke)."
         *
         * golfcourseapi supplies the column and normalizeHole always captured it; the mapping into
         * CourseHole dropped it (now fixed). When it is genuinely absent — the bundled catalog, or a
         * partially-populated course — the honest answer is the par+2 floor plus what we cannot work
         * out, NOT a stroke allocation invented from the hole number.
         */
        /**
         * Through smartFinderService.holeData, NOT an inline `courseHoles.find` — one-truth-per-fact
         * pins that, and my first version of this fix used the inline lookup and failed it. The reason
         * the rule exists applies directly here: the inline find skips the bundled fallback, so before
         * `courseHoles` hydrates it returns undefined and the answer silently degrades.
         */
        const holeRecord = resolvedHoleData(round.currentHole || 1);
        const strokeIndex = typeof holeRecord?.strokeIndex === 'number' && holeRecord.strokeIndex > 0
          ? holeRecord.strokeIndex
          : null;
        if (strokeIndex == null) {
          const floor = netDoubleBogeyCap(holePar, 0);
          return {
            success: true,
            voice_response: ch > 0
              ? `On par ${holePar} it's at least ${floor} — par plus two. Your Course Handicap is ${ch}, so you may get a stroke here on top of that, but I don't have this scorecard's handicap column to say whether this is one of your stroke holes.`
              : `Your max for handicap is ${floor} — par ${holePar} plus 2. Off a Course Handicap of ${ch} you don't get a stroke anywhere.`,
            side_effects: [`handicap:ndb:no_stroke_index:${floor}`],
            follow_up_needed: false,
          };
        }
        // `ch` above is now length-aware, so the allocation must use the SAME length or the two
        // stop cancelling: a nine-hole CH of 15 spread over eighteen hands out one stroke a hole
        // instead of two on the six hardest.
        const strokes = strokesReceivedOnHole(ch, strokeIndex, holeCount);
        const max = netDoubleBogeyCap(holePar, strokes);
        const strokeNote = strokes > 0 ? ` (par ${holePar} plus 2 plus ${strokes} stroke${strokes > 1 ? 's' : ''})` : ` (par ${holePar} plus 2)`;
        return {
          success: true,
          voice_response: `Your max for handicap is ${max}${strokeNote}.`,
          side_effects: [`handicap:ndb:${max}`],
          follow_up_needed: false,
        };
      }

      case 'index_impact': {
        const score = Number(intent.parameters.score_value);
        if (!Number.isFinite(score)) {
          return {
            success: true,
            voice_response: "Give me the score and I'll tell you the impact.",
            side_effects: ['handicap:no_score'],
            follow_up_needed: true,
          };
        }
        const rating = (tee && (tee as { course_rating?: number }).course_rating) ?? par;
        const slope = (tee && (tee as { slope_rating?: number }).slope_rating) ?? 113;
        const diff = computeScoreDifferential(score, rating, slope);
        const recent = profile.recent_differentials ?? [];
        const impact = explainHandicapImpact({
          newDifferential: diff,
          currentIndex: idx,
          recentDifferentials: recent,
        });
        return {
          success: true,
          voice_response: impact,
          side_effects: [`handicap:impact:${diff}`],
          follow_up_needed: false,
        };
      }

      case 'explain':
      default: {
        const recent = profile.recent_differentials ?? [];
        const est = estimateNewIndex(recent);
        if (est.newIndex != null) {
          return {
            success: true,
            voice_response: `Your Index is ${idx.toFixed(1)}. Estimate from your last ${est.differentialsUsed} rounds: ${est.newIndex}. ${est.estimateNote}`,
            side_effects: ['handicap:explain'],
            follow_up_needed: false,
          };
        }
        return {
          success: true,
          voice_response: `Your Index is ${idx.toFixed(1)}. ${est.estimateNote}`,
          side_effects: ['handicap:explain_no_recent'],
          follow_up_needed: false,
        };
      }
    }
  },
};
