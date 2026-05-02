/**
 * Caddie role — capture-time, present-tense, tactical.
 *
 * The Caddie layer operates on seconds. It handles per-shot decisions: club, line,
 * target, lie, wind, distance. Voice in Caddie register is short and confident.
 *
 * This module is a re-export hub — it does not own implementation. Each underlying
 * service stays where it is (services/<name>.ts); registering it under the Caddie
 * role here makes the role boundary explicit at import sites and lets future
 * register-aware code (modeSelector, prompt templates) discover Caddie surfaces
 * by import path rather than by ad-hoc convention.
 *
 * Adding a service to the Caddie role: re-export it from this file and tag it in
 * services/README.md under the Caddie row of the Pillar × Mode matrix.
 *
 * No functional impact on the running app. Existing direct imports of the
 * underlying services continue to work.
 */

// Capture-time shot data
export {
  getCurrentLocation,
  getGreenCentroid,
  getTeeCentroid,
  closeHoleAtTransition,
} from '../shotLocationService';

// Tactical shot detection + conversational logging
export { shotDetectionService } from '../shotDetectionService';
export { conversationalLoggingOrchestrator } from '../conversationalLoggingOrchestrator';

// Tactical voice query handler (shot_distance, hole_progress, distance_to_green
// topics live inside this handler)
export { queryStatusHandler } from '../intents/queryStatusHandler';

// Live distance math
export { haversineYards, shotDistance, holeProgressYards } from '../../utils/geoDistance';

// Phase C — weather + plays-like
export { fetchWeatherAt, getCachedWeather } from '../weatherService';
export type { WeatherSnapshot } from '../weatherService';
export { playsLikeDistance, playsLikePhrase } from '../../utils/playsLike';
export type { PlaysLikeBreakdown } from '../../utils/playsLike';

// Phase H — Lie Analysis (vision-based situation assessment)
export { bundleLieAnalysisContext } from '../lieAnalysisContext';
export type { LieAnalysisContext, PlayIntent } from '../lieAnalysisContext';
export { analyzeLie } from '../lieAnalysisService';
export type { LieAnalysis, LieAnalysisResult } from '../lieAnalysisService';

// Phase D-2 — SmartFinder (rangefinder data layer)
export {
  getGreenYardages,
  getGreenYardagesSync,
  refreshFix,
  getLastFix,
  classifyAccuracy,
  distanceToPoint,
} from '../smartFinderService';
export type { GreenYardages, GPSQualityReading, GPSQualityLevel } from '../smartFinderService';

export const CADDIE_ROLE_ID = 'caddie' as const;
