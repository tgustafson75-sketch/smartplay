/**
 * contextBuilder.js
 *
 * Unified context assembly for the AI caddie.
 * Combines pattern analysis, strategy, course memory, scoring state,
 * player model, dispersion, and learned club distances.
 */

import { getAdvancedPatterns } from './patternEngine';
import { getHoleStrategy } from './holeStrategy';
import { getRiskProfile } from './riskEngine';
import { getClubRecommendation } from './clubEngine';
import { getCourseMemory } from './courseMemory';
import { getRoundStatus } from './scoringEngine';
import { getHandicapMode } from './handicapEngine';
import { getPlayerModel } from './playerModel';
import { getDispersion } from './dispersionEngine';
import { getClubDistance } from './clubTracker';
import { menifeeLakes } from '../data/menifeeLakes';

/**
 * buildContext(params)
 *
 * @param {object} params
 * @returns {object}
 */
export const buildContext = ({
  shots = [],
  distance,
  lie,
  wind,
  lastShot,
  par,
  holeNumber,
  hazards = [],
  club,
}) => {
  const yardage = Number(distance) || 0;
  const patterns = getAdvancedPatterns(shots);

  const holeStrategy = getHoleStrategy({
    par,
    distanceToPin: yardage,
    hazards,
    playerMissPattern: patterns.missBias,
  });

  const riskProfile = getRiskProfile({
    holeStrategy,
    shotHistory: shots,
    pressurePattern: patterns.pressureBias,
  });

  const clubRecommendation = getClubRecommendation({
    distanceToPin: yardage,
    wind,
    riskLevel: riskProfile.riskLevel,
  });

  const courseBias = holeNumber ? getCourseMemory(holeNumber) : null;
  const holeData = holeNumber ? menifeeLakes[holeNumber] ?? null : null;
  const roundStatus = getRoundStatus();
  const handicapMode = getHandicapMode({ roundStatus });

  const playerModel = getPlayerModel();
  const dispersion = getDispersion({
    playerModel,
    recentShots: shots,
  });

  const learnedDistance = getClubDistance(clubRecommendation?.club || club);

  return {
    distance: yardage || distance,
    lie: lie ?? 'fairway',
    wind: wind ?? null,
    lastShot,
    missPattern: patterns.missBias,
    pressurePattern: patterns.pressureBias,
    shotCount: shots.length,
    holeStrategy,
    riskProfile,
    clubRecommendation,
    courseBias,
    holeData,
    roundStatus,
    handicapMode,
    playerModel,
    dispersion,
    learnedDistance,
    par,
    holeNumber,
    hazards,
    club,
  };
};

export { getAdvancedPatterns };
