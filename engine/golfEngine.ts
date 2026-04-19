/**
 * engine/golfEngine.ts
 *
 * Local-first golf recommendations using shot tendencies and distance.
 * Synchronous — no external calls.
 */

import type { FocusContext } from './contextBuilder';
import { getBestClubForYardage } from './memoryEngine';
import { generateRoundInsight } from './roundEngine';
import { formatCaddieResponse, applyTone, applyPersonality } from './responseFormatter';
import { getIdentityInsight } from './identityEngine';
import { getClubConfidence, getConfidenceInsight } from './learningEngine';
import { getDecisionConfidence, applyConfidence } from './confidenceEngine';

/** Simple club selection by yardage. Extend with player club distances when available. */
const pickClub = (distance: number): string => {
  if (distance >= 230) return 'Driver or 3-wood';
  if (distance >= 200) return '3-wood or hybrid';
  if (distance >= 180) return '4 or 5 iron';
  if (distance >= 170) return '5 or 6 iron';
  if (distance >= 155) return '6 or 7 iron';
  if (distance >= 145) return '7 iron';
  if (distance >= 135) return '8 iron';
  if (distance >= 120) return '9 iron';
  if (distance >= 105) return 'pitching wedge';
  if (distance >= 85)  return 'gap wedge';
  if (distance >= 65)  return 'sand wedge';
  return 'lob wedge';
};

export const golfEngine = (query: string, context: FocusContext): string => {
  const { distance, player, holeNote, memory, roundState, identity } = context;

  if (!distance) {
    return 'Get a yardage and I\'ll get you the right club.';
  }

  // Prefer learned club distances; fall back to generic table
  const learnedClub = memory ? getBestClubForYardage(memory, distance) : null;
  const club = learnedClub ?? pickClub(distance);

  const tendency    = memory?.tendencies ?? player.tendencies;
  // Insight priority: miss tendency (this round) → hazard → round momentum → identity bias → club confidence
  const missTip      = tendency !== 'neutral'
    ? (tendency === 'right' ? 'Favor left.' : 'Favor right.')
    : (identity ? getIdentityInsight(identity) : null);
  const hazardNote   = holeNote ? `Watch for ${holeNote.toLowerCase().replace(/\.$/, '')}.` : null;
  const roundInsight = roundState ? generateRoundInsight(roundState) : null;
  const confidence   = memory ? getClubConfidence(memory, club) : 'neutral';
  const confInsight  = getConfidenceInsight(confidence);

  const insight = missTip ?? hazardNote ?? roundInsight ?? confInsight ?? undefined;

  let msg = formatCaddieResponse({ distance, club, insight });
  msg = applyTone(msg, roundState);
  msg = applyConfidence(msg, getDecisionConfidence(context, club));
  msg = applyPersonality(msg, context.personality ?? { mode: 'calm', verbosity: 'short', playerOverride: false });
  return msg;
};
