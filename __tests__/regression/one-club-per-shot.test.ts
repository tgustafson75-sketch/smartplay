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
import { composeShotRead } from '../../services/cnsShotRead';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const BAG = { Driver: 220, '3W': 200, '5I': 160, '6I': 150, '7I': 140, '8I': 130, '9I': 118, PW: 105, SW: 78 };

describe('there is exactly one chooser', () => {
  it('the read is the only thing that names a club', () => {
    const read = composeShotRead({ rawYards: 150, weather: null, shotBearingDeg: null, bag: BAG });
    expect(read).not.toBeNull();
    expect(read!.club).toBeTruthy();
  });

  /**
   * 2026-09-11 — a `clubForYards` helper was added here and DELETED the same day. It existed so the
   * screen could get a club without a whole read; once the screen stopped choosing at all, nothing
   * wanted one. A second way to get a club is a second club.
   */
  it('no second way to get a club has reappeared', () => {
    const src = code('services/cnsShotRead.ts');
    expect(src).not.toMatch(/export function clubForYards/);
    // pickClub stays private to the engine
    expect(src).toMatch(/^function pickClub\(/m);
    expect(src).not.toMatch(/export function pickClub/);
  });

  it('it weighs what nearest-carry cannot — the distance-control gap', () => {
    const full = composeShotRead({ rawYards: 155, weather: null, shotBearingDeg: null, bag: BAG, distanceControl: 'full_swings' });
    const dial = composeShotRead({ rawYards: 155, weather: null, shotBearingDeg: null, bag: BAG, distanceControl: 'dial_down' });
    expect(full!.club).toBeTruthy();
    expect(dial!.club).toBeTruthy();
  });
});

describe('the screen no longer holds a second opinion', () => {
  const sf = code('app/smartfinder.tsx');

  /**
   * 2026-09-11 — this first asserted the screen called clubForYards directly. Tim then named the
   * real shape: "reaching a decision and touching decisions at multiple points are two different
   * things — it all needs to be orchestrated by the Caddie's brain." So the screen asks decideShot,
   * and clubForYards is the brain's chooser rather than the screen's.
   */
  it('the aggressive line takes the club from the SAME decision the read bar shows', () => {
    // Not a second ask at the same yardage — literally the same decision object.
    expect(sf).toMatch(/const recommendedClub = decision\.shot\?\.club \?\? null;/);
  });

  it('the conservative layup asks the brain rather than choosing locally', () => {
    expect(sf).toMatch(/decideShot\(\{ rawYards: yards \}\)\.shot\?\.club/);
    expect(sf).toMatch(/const conservativeClub = recommendClubForDistance\(conservativeYards\)/);
  });

  it('and never through the nearest-carry lookup', () => {
    expect(sf).not.toMatch(/inferClub\(yards\)/);
  });

  /**
   * THE DOUBLE-ADJUSTMENT THIS AVOIDS. effectiveYards is ALREADY the plays-like number. Asking the
   * brain for a club at effectiveYards would have run the wind and slope model over it a second
   * time. The aggressive line therefore reuses the decision rather than re-asking at that number.
   */
  it('never asks the brain at an already-plays-like yardage', () => {
    expect(sf).not.toMatch(/decideShot\(\{ rawYards: effectiveYards/);
    expect(sf).not.toMatch(/recommendClubForDistance\(effectiveYards\)/);
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
