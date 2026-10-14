/**
 * 2026-10-13 (course-engine audit #5) — plays-like had no altitude term: in Denver a 150 that plays ~141
 * was called 150. Altitude comes from the weather's station pressure; 1.2% carry per 1,000 ft (the
 * conservative middle of published 1.1–1.6% figures).
 */
import { playsLikeDistance, altitudeFromStationPressure, ALTITUDE_CARRY_PER_1000FT } from '../../utils/playsLike';
import type { WeatherSnapshot } from '../../services/weatherService';

const still = (station: number | null): WeatherSnapshot => ({
  temp_f: 70, humidity: 40, pressure_hpa: 1013, station_pressure_hpa: station, wind_speed_mph: 0,
  wind_direction_deg: null, wind_gust_mph: null, conditions: 'Clear', description: 'clear sky', timestamp: Date.now(),
});

describe('a mile high plays short', () => {
  it('station pressure → altitude (standard atmosphere)', () => {
    expect(Math.round(altitudeFromStationPressure(1013.25)!)).toBe(0);
    const denver = altitudeFromStationPressure(835)!;
    expect(denver).toBeGreaterThan(5100);
    expect(denver).toBeLessThan(5500);
    expect(altitudeFromStationPressure(null)).toBeNull();
    expect(altitudeFromStationPressure(300)).toBeNull();     // implausible reading → no term
  });
  it('Denver: a 150 plays about 141', () => {
    const b = playsLikeDistance(150, still(835));
    expect(ALTITUDE_CARRY_PER_1000FT).toBe(0.012);
    expect(b.plays_like_yards).toBeGreaterThanOrEqual(140);
    expect(b.plays_like_yards).toBeLessThanOrEqual(142);
    expect(b.altitude_component_yards).toBeLessThan(0);
  });
  it('sea level, or no station pressure: unchanged', () => {
    expect(playsLikeDistance(150, still(1013)).plays_like_yards).toBe(150);
    expect(playsLikeDistance(150, still(null)).plays_like_yards).toBe(150);
  });
  it('the caddie hears why', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../api/kevin.ts'), 'utf8');
    expect(src).toMatch(/pl\.fromAltitude \? `\$\{Math\.abs\(pl\.fromAltitude\)\} for the altitude` : null/);
    const body = require('fs').readFileSync(require('path').join(__dirname, '../../services/caddieRequestBody.ts'), 'utf8');
    expect(body).toMatch(/fromAltitude: b\.altitude_component_yards,/);
    const route = require('fs').readFileSync(require('path').join(__dirname, '../../api/weather.ts'), 'utf8');
    expect(route).toMatch(/station_pressure_hpa: main\.grnd_level \?\? null,/);
  });
});
