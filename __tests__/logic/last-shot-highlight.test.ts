/**
 * 2026-10-10 (Tim: "surface showing last shot distance with particular emphasis on drives and shots where
 * user is getting better than their baseline").
 */
import { lastShotHighlight, lastShotLine, lastShotSpokenLine, clubSpokenName, LAST_SHOT_FRESH_MS } from '../../services/round/lastShotHighlight';

const T0 = 1_800_000_000_000;
const shot = (o: Record<string, unknown>) => ({ hole: 1, timestamp: T0, ...o }) as never;
const usual = (map: Record<string, number | null>) => (club: string) => ({ totalYards: map[club] ?? null });

describe('the last shot, and whether it beat the player', () => {
  it('a drive past the usual: highlighted, and said once with the margin', () => {
    const shots = [
      shot({ id: 'a', club: 'Driver', shot_in_hole_index: 1, gps_distance_yards: 262, timestamp: T0 }),
      shot({ id: 'b', club: '8I', shot_in_hole_index: 2, timestamp: T0 + 120_000 }),
    ];
    const h = lastShotHighlight(shots, usual({ Driver: 245 }), T0 + 130_000)!;
    expect(h).toMatchObject({ club: 'Driver', yards: 262, usualYards: 245, delta: 17, isDrive: true, beatUsual: true });
    expect(lastShotLine(h, (c) => c)).toBe('DRIVER 262 · +17 on your usual');
    expect(lastShotSpokenLine(h, clubSpokenName)).toBe('That drive went 262 — 17 past your usual.');
  });

  it('an iron past the usual is called out by its spoken name', () => {
    const shots = [
      shot({ id: 'a', club: '7I', shot_in_hole_index: 2, gps_distance_yards: 168 }),
      shot({ id: 'b', club: 'PW', shot_in_hole_index: 3, timestamp: T0 + 60_000 }),
    ];
    const h = lastShotHighlight(shots, usual({ '7I': 152 }), T0 + 61_000)!;
    expect(lastShotSpokenLine(h, clubSpokenName)).toBe('That 7 iron went 168 — 16 past your usual.');
  });

  it('GPS noise is not a story: a few yards over is shown, not celebrated', () => {
    const h = lastShotHighlight([shot({ id: 'a', club: '7I', gps_distance_yards: 155 })], usual({ '7I': 152 }), T0)!;
    expect(h.beatUsual).toBe(false);
    expect(lastShotSpokenLine(h, clubSpokenName)).toBeNull();     // an ordinary iron is not worth interrupting for
    expect(lastShotLine(h, (c) => c)).toBe('7I 155');
  });

  it('no real usual for the club: shows the distance, never claims "past your usual"', () => {
    const h = lastShotHighlight([shot({ id: 'a', club: 'Driver', shot_in_hole_index: 1, gps_distance_yards: 280 })], usual({}), T0)!;
    expect(h.usualYards).toBeNull();
    expect(h.beatUsual).toBe(false);
    expect(lastShotSpokenLine(h, clubSpokenName)).toBe('That drive went 280.');
  });

  it('placeholders, penalties and shots with no distance are skipped; a stale shot shows nothing', () => {
    const shots = [
      shot({ id: 'real', club: '6I', gps_distance_yards: 170 }),
      shot({ id: 'qs-1-1' }),
      shot({ id: 'pen', outcome: 'manual_penalty' }),
      shot({ id: 'nodist', club: '9I' }),
    ];
    expect(lastShotHighlight(shots, usual({}), T0)?.shotId).toBe('real');
    expect(lastShotHighlight(shots, usual({}), T0 + LAST_SHOT_FRESH_MS + 1)).toBeNull();
  });

  it('spoken club names', () => {
    expect(['Driver', '3W', '4H', '7I', 'SW', 'Putter'].map((c) => clubSpokenName(c as never)))
      .toEqual(['driver', '3 wood', '4 hybrid', '7 iron', 'sand wedge', 'putter']);
  });
});
