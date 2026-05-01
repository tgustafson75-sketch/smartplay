import type { WeatherSnapshot } from '../services/weatherService';

/**
 * Phase C — Plays-like distance calculation.
 *
 * Approximate v1 model. Future phases can replace the internals with a calibrated
 * regression on the user's own historical shot-vs-actual-carry data once enough
 * rounds are logged. The signature stays stable.
 *
 * Convention: returned value is the *effective* distance the player should club
 * to. So a 152y shot into a 10mph headwind plays like ~167y; a 152y shot
 * downwind plays like ~144y. Mike says "club it like 167" — that's plays-like.
 *
 * Factors:
 *   - Wind: ~1% per mph headwind (extends), ~0.5% per mph tailwind (shortens),
 *     half-effect for crosswind component (slight extend due to time of flight).
 *   - Air density via temperature: standard 70°F. Each 10°F colder adds ~0.5%
 *     (denser air → ball travels less); each 10°F warmer subtracts ~0.5%.
 *     Pressure and humidity are second-order and ignored at v1.
 *   - Elevation: ~1 yard per 3 feet of elevation delta (uphill positive,
 *     downhill negative). Optional argument; default 0.
 *
 * If `shotBearingDeg` is null (unknown shot direction — e.g. first shot of a
 * round before any course-bearing reference), only air-density and elevation
 * factors apply. Wind component is omitted rather than guessed.
 */

export type PlaysLikeBreakdown = {
  actual_yards: number;
  plays_like_yards: number;
  delta_yards: number;
  wind_component_yards: number;
  temp_component_yards: number;
  elevation_component_yards: number;
  /** Wind component along shot direction (positive = tailwind, negative = headwind). null when bearing unknown. */
  along_wind_mph: number | null;
  /** Crosswind component (positive = right cross, negative = left cross). null when bearing unknown. */
  cross_wind_mph: number | null;
};

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function decomposeWind(
  windFromDeg: number,
  windSpeedMph: number,
  shotBearingDeg: number,
): { along: number; cross: number } {
  // OpenWeatherMap wind_direction_deg is meteorological — degrees the wind comes FROM.
  // Wind blows TO (windFromDeg + 180). Shot bearing is the direction the player aims.
  // Tailwind = wind blowing in the same direction as the shot.
  const windToDeg = (windFromDeg + 180) % 360;
  let rel = windToDeg - shotBearingDeg;
  rel = ((rel + 540) % 360) - 180; // normalize to -180..180
  const r = toRad(rel);
  return {
    along: Math.cos(r) * windSpeedMph,   // + tailwind, − headwind
    cross: Math.sin(r) * windSpeedMph,   // + right cross, − left cross
  };
}

export function playsLikeDistance(
  actualYards: number,
  weather: WeatherSnapshot,
  shotBearingDeg: number | null = null,
  elevationDeltaFeet = 0,
): PlaysLikeBreakdown {
  // Wind component
  let windYards = 0;
  let along: number | null = null;
  let cross: number | null = null;
  if (
    shotBearingDeg != null &&
    weather.wind_direction_deg != null &&
    weather.wind_speed_mph > 0
  ) {
    const decomposed = decomposeWind(
      weather.wind_direction_deg,
      weather.wind_speed_mph,
      shotBearingDeg,
    );
    along = decomposed.along;
    cross = decomposed.cross;
    // Tailwind shortens (along > 0); headwind extends (along < 0).
    // 1%/mph headwind, 0.5%/mph tailwind.
    if (along < 0) {
      windYards += -along * actualYards * 0.01;
    } else {
      windYards -= along * actualYards * 0.005;
    }
    // Crosswind: half-effect on distance (slight extension from extra time of flight)
    windYards += Math.abs(cross) * actualYards * 0.005;
  }

  // Temperature component — colder adds yards, warmer subtracts
  let tempYards = 0;
  if (weather.temp_f != null) {
    const delta = 70 - weather.temp_f; // positive when colder than 70
    tempYards = (delta / 10) * 0.005 * actualYards;
  }

  // Elevation: ~1 yard per 3 feet uphill
  const elevYards = elevationDeltaFeet / 3;

  const playsLike = actualYards + windYards + tempYards + elevYards;

  return {
    actual_yards: actualYards,
    plays_like_yards: Math.round(playsLike),
    delta_yards: Math.round(playsLike - actualYards),
    wind_component_yards: Math.round(windYards),
    temp_component_yards: Math.round(tempYards),
    elevation_component_yards: Math.round(elevYards),
    along_wind_mph: along != null ? Math.round(along) : null,
    cross_wind_mph: cross != null ? Math.round(cross) : null,
  };
}

/**
 * Verbal phrasing helper — produces a short one-line description of the
 * adjustment for use in voice responses. Returns "" when the delta is zero.
 */
export function playsLikePhrase(b: PlaysLikeBreakdown): string {
  if (b.delta_yards === 0) return '';
  const dir = b.delta_yards > 0 ? 'plays longer' : 'plays shorter';
  const parts: string[] = [];
  if (b.along_wind_mph != null) {
    if (b.along_wind_mph < -2) parts.push(`${Math.abs(b.along_wind_mph)} into your face`);
    else if (b.along_wind_mph > 2) parts.push(`${b.along_wind_mph} at your back`);
  }
  return parts.length > 0 ? `${dir} with ${parts.join(' and ')}` : dir;
}
