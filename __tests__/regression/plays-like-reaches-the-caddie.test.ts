/**
 * 2026-08-23 (Tim, Greenhill hole 2) — "it's 230 yards DOWNHILL considerably, and if I took the
 * caddie's recommendation I would have smoked it into the woods past the hole."
 *
 * Everything needed already worked: /api/elevation, the elevation cache, the plays-like model, the
 * UI hook, and the local plays_like voice answer. The caddie BRAIN was the one consumer never wired
 * to any of it, so it quoted the raw card number while the app beside it knew the shot was falling
 * away. Same shape as the wind: the app knows, the caddie does not.
 */
import { playsLikeDistance } from '../../utils/playsLike';
import type { WeatherSnapshot } from '../../services/weatherService';

const wx = (o: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  temp_f: 70, wind_speed_mph: 0, wind_direction_deg: 0, wind_gust_mph: null,
  conditions: 'Clear', description: 'clear sky', timestamp: Date.now(),
  ...(o as object),
} as WeatherSnapshot);

describe('plays-like carries every factor the caddie needs', () => {
  it('a downhill shot plays SHORTER — the hole 2 failure', () => {
    // 230 yards, 60 feet of drop. ~1 yard per 3 feet → plays ~20 shorter.
    const b = playsLikeDistance(230, wx(), null, -60);
    expect(b.elevation_component_yards).toBe(-20);
    expect(b.plays_like_yards).toBeLessThan(230);
    // The defect was quoting 230. Anything that still says 230 has not used the elevation.
    expect(b.plays_like_yards).toBe(210);
  });

  it('an uphill shot plays LONGER', () => {
    expect(playsLikeDistance(150, wx(), null, 30).elevation_component_yards).toBe(10);
  });

  it('rain costs carry — the condition that started this', () => {
    const dry = playsLikeDistance(150, wx());
    const wet = playsLikeDistance(150, wx({ conditions: 'Rain', description: 'light rain' }));
    expect(wet.wet_component_yards).toBeGreaterThan(0);
    expect(wet.plays_like_yards).toBeGreaterThan(dry.plays_like_yards);
  });

  it('a headwind extends the shot and a tailwind shortens it', () => {
    // Playing due north; wind FROM the north is in the face.
    const into = playsLikeDistance(150, wx({ wind_speed_mph: 16, wind_direction_deg: 0 }), 0);
    const down = playsLikeDistance(150, wx({ wind_speed_mph: 16, wind_direction_deg: 180 }), 0);
    expect(into.plays_like_yards).toBeGreaterThan(150);
    expect(down.plays_like_yards).toBeLessThan(150);
  });

  it('omits wind entirely when the shot direction is unknown, rather than guessing', () => {
    const b = playsLikeDistance(150, wx({ wind_speed_mph: 16, wind_direction_deg: 270 }), null);
    expect(b.wind_component_yards).toBe(0);
    expect(b.along_wind_mph).toBeNull();
  });

  it('the caddie payload actually sends it, and passes elevation in', () => {
    const src = (require('fs') as typeof import('fs')).readFileSync('services/caddieRequestBody.ts', 'utf8');
    expect(src).toMatch(/playsLikeDistance\(yds, w, bearing, elevFeet\)/);
    expect(src).toMatch(/getCachedPlaysLikeElevation/);
    const brain = (require('fs') as typeof import('fs')).readFileSync('api/kevin.ts', 'utf8');
    expect(brain).toMatch(/IT PLAYS \$\{pl\.playsLikeYds\}/);
    expect(brain).toMatch(/DOWNHILL/);
  });
});
