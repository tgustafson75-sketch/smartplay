/**
 * 2026-10-10 (Tim: "double triple check the course engine correctness") — the audit's findings, each
 * pinned. Behaviour where the logic is reachable; source (comments stripped) where it lives in a screen
 * or the brain prompt.
 */
import fs from 'fs';
import path from 'path';
import { playsLikeDistance } from '../../utils/playsLike';
import { computeHazardIntelligence } from '../../services/hazardIntelligence';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const calm = { temp_f: 70, wind_speed_mph: 0, wind_direction_deg: null } as never;
const wind = (fromDeg: number, mph: number) => ({ temp_f: 70, wind_speed_mph: mph, wind_direction_deg: fromDeg }) as never;

describe('plays-like: a crosswind never out-weighs the headwind it rides on', () => {
  it('a 15 mph quartering headwind plays no longer than the same wind straight into the face', () => {
    const straight = playsLikeDistance(150, wind(0, 15), 0).plays_like_yards;      // shot north, wind from north
    const quarter = playsLikeDistance(150, wind(45, 15), 0).plays_like_yards;     // from the north-east
    expect(straight).toBeGreaterThan(165);
    expect(quarter).toBeLessThanOrEqual(straight);
  });
  it('a pure 20 mph crosswind adds a few yards at most, not 15', () => {
    const r = playsLikeDistance(150, wind(270, 20), 0).plays_like_yards;
    expect(r - playsLikeDistance(150, calm, 0).plays_like_yards).toBeLessThanOrEqual(4);
  });
  it('the cross component is positive for wind FROM THE LEFT (the convention the labels below rely on)', () => {
    expect(playsLikeDistance(150, wind(270, 16), 0).cross_wind_mph).toBeGreaterThan(0);  // from the west on a northbound shot
  });
});

describe('the wind is named from the side it comes from', () => {
  it('the shot read says "off the left" for a positive (from-the-left) crosswind', () => {
    expect(code('services/cnsShotRead.ts')).toMatch(/cross off the \$\{b\.cross_wind_mph > 0 \? 'left' : 'right'\}/);
    expect(code('services/cnsShotRead.ts')).not.toMatch(/'off the right' : 'off the left'/);
  });
  it('the shot shape holds against the wind: draw into left-to-right, fade into right-to-left', () => {
    expect(code('services/metaCourseIntelligence.ts')).toMatch(/return wind\.cross_mph > 0 \? 'draw' : 'fade';/);
  });
});

describe('hazards: only the ones ahead are in play', () => {
  const LAT = 33.7;
  const k = Math.cos((LAT * Math.PI) / 180);
  const at = (north: number, east = 0) => ({ lat: LAT + (north * 0.9144) / 110540, lng: -117.1 + (east * 0.9144) / (111320 * k) });
  const player = at(0);
  it('a bunker already passed 25 yards BEHIND is not the hazard; the water 140 ahead is', () => {
    const geometry = { hazards: [{ label: 'Bunker', location: at(-25, 5) }, { label: 'Water', location: at(140, -5) }] } as never;
    const intel = computeHazardIntelligence(player, geometry, null, 0)!;
    expect(intel.kind).toBe('water');
    expect(intel.center).toBeGreaterThan(130);
  });
  it('nothing ahead → no hazard rather than one behind', () => {
    const geometry = { hazards: [{ label: 'Bunker', location: at(-25) }] } as never;
    expect(computeHazardIntelligence(player, geometry, null, 0)).toBeNull();
  });
  it('without a shot line, hazards are still reported (the old behaviour)', () => {
    const geometry = { hazards: [{ label: 'Bunker', location: at(-25) }] } as never;
    expect(computeHazardIntelligence(player, geometry, null, null)?.kind).toBe('bunker');
  });
});

describe('a metre is shown as a metre', () => {
  it('the cockpit distance card converts every number it shows', () => {
    const d = code('components/caddie/cockpit/DistanceCard.tsx');
    expect(d).toMatch(/const middle = toDisplayDistance\(fmb\?\.middle \?\? baseYardage \?\? null, unit\);/);
    expect(d).toMatch(/const front = toDisplayDistance\(fmb\?\.front \?\? null, unit\);/);
    expect(d).toMatch(/const back = toDisplayDistance\(fmb\?\.back \?\? null, unit\);/);
  });
  it('the data strip PLAYS cell and its delta convert', () => {
    const s = code('components/CaddieDataStrip.tsx');
    expect(s).toMatch(/const playsShown = toDisplay\(playsLike\);/);
    expect(s).not.toMatch(/String\(playsLike\)/);
  });
});

describe('one yardage, everywhere — voice included', () => {
  const q = code('services/intents/queryStatusHandler.ts');
  it('"how far" and "plays like" speak the resolver\'s number (pin + stated yardage), raw GPS only as a checked fallback', () => {
    expect(q).toMatch(/const resolvedY = resolveYardage\(greenHole\);/);
    expect(q).toMatch(/if \(isImplausibleYardage\(yds, 700\)\)/);
    expect(q).toMatch(/const r = resolveYardage\(context\.current_hole \?\? round\.currentHole\);/);
  });
});

describe('the caddie is told the truth about the pin', () => {
  it('the resolver marks a pin it applied; the payload says whether the yardages include it', () => {
    expect(code('services/yardageResolver.ts')).toMatch(/value: adj\.yards,\s*pin_applied: true,/);
    expect(code('services/caddieRequestBody.ts')).toMatch(/const inYardages = declared\.pin\.depth === 'middle' \|\| resolveYardage\(currentHole \?\? undefined\)\.pin_applied === true;/);
  });
  it('the brain only hears "already plays to that flag" when it does', () => {
    const k = code('api/kevin.ts');
    expect(k).toMatch(/pin\.inYardages === false\s*\?\s*`The yardages you have been given are to the MIDDLE of the green/);
  });
  it('heat is not "from the cold"', () => {
    expect(code('api/kevin.ts')).toMatch(/pl\.fromTemp > 0 \? "from the cold" : "off for the heat"/);
  });
});

describe('the app sweep', () => {
  it('a discovered course resolves to the database course nearest where it was found — both callers', () => {
    const p = code('app/(tabs)/play.tsx');
    expect((p.match(/resolveDiscoveredCourseId\(s\.club_name \?\? '', s\.lat != null && s\.lng != null \? \{ lat: s\.lat, lng: s\.lng \} : null\)/g) ?? []).length).toBe(2);
    expect(p).not.toMatch(/found\.find\(r => !r\._error && r\.id\)/);
    // 2026-10-13: one owner (nearestRecordId), and 3 km — 5 miles only ever admitted a different course
    expect(code('services/golfCourseApi.ts')).toMatch(/if \(best\) return best\.m <= SAME_COURSE_M \? best\.id : null;/);
    expect(code('services/golfCourseApi.ts')).toMatch(/return nearestRecordId\(found\.map/);
  });
  it('a strip score never overwrites one entered elsewhere during its settle', () => {
    const s = code('components/CaddieDataStrip.tsx');
    expect(s).toMatch(/if \(sc != null && !scoreMoved\) onScoreStep\?\.\(sc, h\);/);
    expect(s).toMatch(/if \(pt != null && !puttsMoved\) onPuttsStep\?\.\(pt, h\);/);
  });
  it('/api/kevin survives null list fields', () => {
    expect(code('api/kevin.ts')).toMatch(/for \(const k of \['topObservations', 'recentHeroMoments', 'recentBreakthroughs', 'recentCageSessions'\] as const\)/);
  });
});
