import { useRoundStore } from '../store/roundStore';
import { getCachedWeather, fetchWeatherAt, type WeatherSnapshot } from './weatherService';
import { getGreenCentroid } from './shotLocationService';
import { refreshFix, getLastFix } from './smartFinderService';
import { haversineYards } from '../utils/geoDistance';

/**
 * Phase H — bundles the context the lie-analysis vision endpoint uses to
 * produce specific (rather than generic) tactical advice.
 *
 * Context fields:
 *   current_hole, par
 *   distance_to_green_yards (haversine from current GPS to green centroid
 *     when both are available)
 *   weather (the same WeatherSnapshot useCurrentWeather pulls — temp_f,
 *     wind_speed_mph, wind_direction_deg, conditions)
 *   last_shot { club, outcome, direction } when a shot has been logged
 *   lie_hint (parsed from the last shot's lie_followup utterance)
 *   play_intent ('aggressive' | 'conservative' | null) — from the voice
 *     trigger phrase ("should I go for it" → aggressive)
 *
 * Each field gracefully degrades when its source is unavailable (no GPS,
 * no weather key, no shots logged yet, etc.).
 */

export type PlayIntent = 'aggressive' | 'conservative' | null;

export type LieAnalysisContext = {
  current_hole: number | null;
  par: number | null;
  distance_to_green_yards: number | null;
  weather: WeatherSnapshot | null;
  last_shot: { club: string | null; outcome: string | null; direction: string | null } | null;
  lie_hint: string | null;
  play_intent: PlayIntent;
};

export async function bundleLieAnalysisContext(playIntent: PlayIntent = null): Promise<LieAnalysisContext> {
  const round = useRoundStore.getState();
  const currentHole = round.isRoundActive ? round.currentHole : null;
  const par = round.isRoundActive ? (round.getCurrentPar() ?? null) : null;

  // Distance to green (if both player GPS and hole green centroid are known)
  let distance_to_green_yards: number | null = null;
  if (currentHole != null) {
    const fix = getLastFix() ?? (await refreshFix());
    const green = getGreenCentroid(currentHole);
    if (fix && green) {
      distance_to_green_yards = Math.round(haversineYards(fix.location, green));
    }
  }

  // Weather (cached if fresh; fall back to a fetch attempt; null on failure)
  let weather: WeatherSnapshot | null = null;
  const fix = getLastFix();
  if (fix) {
    weather = getCachedWeather(fix.location) ?? (await fetchWeatherAt(fix.location));
  }

  // Last shot info (if any logged this round)
  const shots = round.shots;
  const last = shots.length > 0 ? shots[shots.length - 1] : null;
  const last_shot = last
    ? {
        club: last.club ?? null,
        outcome: last.outcome ?? (last.feel === 'flush' ? 'good' : last.feel === 'fat' ? 'bad' : null),
        direction: last.direction ?? null,
      }
    : null;

  // Lie hint — when the last shot's raw_utterance includes a lie keyword,
  // surface it so the analysis knows what kind of lie the player said
  // they were in last time.
  const LIE_KEYWORDS = ['rough', 'fairway', 'sand', 'bunker', 'water', 'trees', 'wood', 'rough', 'fescue', 'fluffy', 'tight', 'buried', 'hardpan', 'bare'];
  const lie_hint = last?.raw_utterance
    ? (LIE_KEYWORDS.find(k => last.raw_utterance!.toLowerCase().includes(k)) ?? null)
    : null;

  return {
    current_hole: currentHole,
    par,
    distance_to_green_yards,
    weather,
    last_shot,
    lie_hint,
    play_intent: playIntent,
  };
}
