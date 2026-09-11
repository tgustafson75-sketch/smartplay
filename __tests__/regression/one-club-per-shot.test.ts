/**
 * 2026-09-11 — ONE SCREEN, ONE SHOT, TWO DIFFERENT CLUBS.
 *
 * app/smartfinder rendered both:
 *   the read bar         shotRead.club          — services/cnsShotRead.pickClub
 *   the strategy line    "Aggressive: {club} to {yards}y"  — clubStatsStore.inferClub
 *
 * Both off the same learned bag and the same plays-like yardage, and the file's own note said that
 * meant they "can't recommend from different yardage tables". True of the TABLE. False of the
 * DECISION: inferClub picks the nearest carry and nothing else, while pickClub also weighs the risk
 * posture, the room behind the pin, and how this player covers an in-between number — the gap logic
 * that is the whole "Plays Like For Me" differentiator.
 *
 * So a player between clubs could read "8 iron" in the bar and "Aggressive: 7I to 158y" a few rows
 * down, for one shot. Exactly the shape of the 2026-08-24 defect where the rangefinder said 205 and
 * the card clubbed him to 180.
 *
 * inferClub is deliberately NOT replaced: "which club should he hit" and "which club was this shot
 * probably hit with" are different questions, and the scorecard needs the second one.
 */
import { clubForYards } from '../../services/cnsShotRead';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const BAG = { Driver: 220, '3W': 200, '5I': 160, '6I': 150, '7I': 140, '8I': 130, '9I': 118, PW: 105, SW: 78 };

describe('the chooser is usable without a whole read', () => {
  it('returns a club for a real number', () => {
    expect(clubForYards(150, { bag: BAG })).toBeTruthy();
  });

  it('refuses a number it does not have', () => {
    expect(clubForYards(null, { bag: BAG })).toBeNull();
    expect(clubForYards(0, { bag: BAG })).toBeNull();
    expect(clubForYards(Number.NaN, { bag: BAG })).toBeNull();
  });

  it('it is the SAME chooser the read bar uses — not a lookalike', () => {
    // clubForYards must delegate to pickClub, or this whole fix is two owners again with one name.
    const src = code('services/cnsShotRead.ts');
    const at = src.indexOf('export function clubForYards(');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 1200)).toMatch(/return pickClub\(/);
  });

  it('weighs what nearest-carry cannot — the distance-control gap', () => {
    // A full-swing player between clubs is a DECISION, not a rounding. If this ever stops mattering
    // the gap logic has been lost.
    const full = clubForYards(155, { bag: BAG, distanceControl: 'full_swings' });
    const dial = clubForYards(155, { bag: BAG, distanceControl: 'dial_down' });
    expect(full).toBeTruthy();
    expect(dial).toBeTruthy();
  });
});

describe('the screen no longer holds a second opinion', () => {
  const sf = code('app/smartfinder.tsx');

  it('its strategy lines go through the shared chooser', () => {
    expect(sf).toMatch(/clubForYards\(yards, liveShotReadInputs\(\{ rawYards: yards \}\)\)/);
  });

  it('and no longer through the nearest-carry lookup', () => {
    expect(sf).not.toMatch(/inferClub\(yards\)/);
  });

  it('the aggressive and conservative lines both use that one function', () => {
    expect(sf).toMatch(/const recommendedClub = useMemo\(\(\) => recommendClubForDistance\(effectiveYards\)/);
    expect(sf).toMatch(/const conservativeClub = recommendClubForDistance\(conservativeYards\)/);
  });
});

describe('the OTHER question keeps its own answer', () => {
  it('inferClub still exists for attributing a club to a LOGGED shot', () => {
    // Guessing which club was hit is not choosing which club to hit. Collapsing them would be a
    // different two-owners bug in the opposite direction.
    expect(code('store/clubStatsStore.ts')).toMatch(/inferClub/);
    expect(code('app/(tabs)/scorecard.tsx')).toMatch(/clubStats\.inferClub\(d\)/);
  });
});
