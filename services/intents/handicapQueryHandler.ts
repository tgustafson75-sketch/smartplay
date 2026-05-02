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

    switch (topic) {
      case 'course_handicap': {
        // Need rating + slope. If we don't have them in courseHoles (typical
        // when upstream rating data isn't present), fall back to a neutral
        // 113 slope and explain.
        const rating = (tee && (tee as { course_rating?: number }).course_rating) ?? null;
        const slope = (tee && (tee as { slope_rating?: number }).slope_rating) ?? null;
        if (rating != null && slope != null) {
          const ch = computeCourseHandicap(idx, rating, slope, par);
          return {
            success: true,
            voice_response: `Your Course Handicap here is ${ch}.`,
            side_effects: [`handicap:course:${ch}`],
            follow_up_needed: false,
          };
        }
        // No course rating loaded — give the neutral-slope estimate.
        const ch = computeCourseHandicap(idx, par, 113, par);
        return {
          success: true,
          voice_response: `I don't have this course's rating loaded — at neutral slope your Course Handicap would be about ${ch}. Pull up Course Detail to get the real numbers.`,
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
        const holePar = Number.isFinite(requestedPar) ? requestedPar : (round.currentHole ? round.courseHoles.find(h => h.hole === round.currentHole)?.par ?? 4 : 4);
        const rating = (tee && (tee as { course_rating?: number }).course_rating) ?? par;
        const slope = (tee && (tee as { slope_rating?: number }).slope_rating) ?? 113;
        const ch = computeCourseHandicap(idx, rating, slope, par);
        const strokes = strokesReceivedOnHole(ch, round.currentHole || 1);
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
