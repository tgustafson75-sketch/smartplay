/**
 * 2026-09-11 — THE SAME QUESTION GOT A DIFFERENT ANSWER DEPENDING ON WHICH SCREEN ASKED.
 *
 * Tim: "We have a very complex app and it's very likely the hundreds of factors are not currently
 * sharing connections and data in the best possible way. We're close but I'm sure have disconnects."
 *
 * Measured. services/cnsShotRead is the club-and-plays-like engine and it is PURE, so whoever calls
 * it decides what it is allowed to know. Four call sites, four different answers:
 *
 *   app/smartfinder.tsx              14 of 15 inputs
 *   services/localStatusResponder    7 of 15 on "what does this play like"
 *   app/smartvision.tsx              6 of 15 — `weather: null` outright, so NO WIND
 *   services/localStatusResponder    4 of 15 on "can I reach it" — a go/no-go with NO ELEVATION
 *
 * No file was wrong. They grew at different times and nobody re-fed the older ones when a fact was
 * added. The visible cost: SmartVision SPEAKS its read, so the player heard a club picked with no
 * wind and no miss bias; ask on SmartFinder and get a different club for the same shot. The offline
 * reach answer ignoring elevation is Greenhill hole 2 — "230 yards downhill considerably; if I'd
 * taken the caddie's recommendation I'd have smoked it into the woods."
 *
 * Patching four call sites fixes today and guarantees the repeat, because the next fact has four
 * places to be remembered. One composer removes the possibility.
 *
 * THIS GUARD IS THE POINT: every input the engine accepts must be supplied by the composer. Add a
 * field to composeShotRead and forget to fill it here, and this fails on the day you write it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/** Comments stripped — prose describing a field must never count as supplying it. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Every field composeShotRead accepts, read off the engine rather than restated here. */
const INPUTS = (() => {
  const src = code('services/cnsShotRead.ts');
  const at = src.indexOf('export function composeShotRead(input: {');
  expect(at).toBeGreaterThan(-1);
  const body = src.slice(at, src.indexOf('}): ShotRead | null', at));
  return [...new Set([...body.matchAll(/^\s{2}([a-zA-Z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1]))];
})();

const CALLERS = [
  'app/smartfinder.tsx',
  'app/smartvision.tsx',
  'services/localStatusResponder.ts',
];

describe('the guard is reading the real contract', () => {
  it('found a realistic number of inputs', () => {
    expect(INPUTS.length).toBeGreaterThanOrEqual(14);
    // the ones whose absence was measurably costing a decision
    for (const f of ['weather', 'elevationDeltaFeet', 'dominantMiss', 'distanceControl',
                     'greenFrontYards', 'greenBackYards', 'nearestHazard', 'risk']) {
      expect(INPUTS).toContain(f);
    }
  });
});

describe('one composer supplies every fact the read can use', () => {
  const live = code('services/shotReadLive.ts');

  it.each(INPUTS)('liveShotReadInputs fills %s', (field) => {
    // Assigned in the composed object, not merely mentioned.
    expect(live).toMatch(new RegExp(`\\b${field}\\s*:`));
  });

  it('lets the caller win on what it genuinely knows better', () => {
    // SmartFinder's tapped target, SmartVision's own bearing, the responder's measured yardage.
    expect(live).toMatch(/for \(const \[k, v\] of Object\.entries\(known\)\)/);
    expect(live).toMatch(/if \(v !== undefined\)/);
  });

  it('an explicit null from a caller still wins — "I know there is no hazard" is an answer', () => {
    expect(live).toMatch(/undefined` means "you fill it"|v !== undefined/);
  });

  it('every fact is independently guarded, so one cold cache cannot empty the read', () => {
    const safes = (live.match(/safe\(\(\) =>/g) || []).length;
    expect(safes).toBeGreaterThanOrEqual(8);
  });
});

describe('no surface decides for itself — it asks the brain', () => {
  /**
   * 2026-09-11 (Tim) — "Reaching a decision and touching decisions at multiple points are two
   * different things. It all needs to be totally orchestrated by the Caddie's brain."
   *
   * This guard originally asserted every surface called composeShotRead(liveShotReadInputs(...)).
   * That fixed the WIRING and left the SHAPE: nine places still decided which club to recommend,
   * merely well-fed. Feeding nine deciders the same facts is not orchestration.
   *
   * The property now is stronger and simpler: a surface does not call the club engine at all. It
   * asks services/caddieDecision.decideShot and renders what comes back.
   */
  it.each(CALLERS)('%s asks decideShot', (f) => {
    expect(code(f)).toMatch(/decideShot\(/);
  });

  it.each(CALLERS)('%s never calls the club engine itself', (f) => {
    const src = code(f);
    expect(src).not.toMatch(/composeShotRead\(/);
  });

  it('decideShot is the ONLY place the read is composed', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'dist', '.expo', 'ios', 'android', '__tests__', 'scripts'].includes(e.name)) continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name)) {
          const rel = p.slice(2);
          if (rel === 'services/cnsShotRead.ts' || rel === 'services/caddieDecision.ts') continue;
          if (/composeShotRead\s*\(/.test(code(rel))) offenders.push(rel);
        }
      }
    };
    walk('.');
    expect(offenders).toEqual([]);
  });

  it('and the brain composes it through the one input composer', () => {
    const brain = code('services/caddieDecision.ts');
    expect(brain).toMatch(/composeShotRead\(liveShotReadInputs\(known\)\)/);
  });
});

describe('the facts that were actually missing are now supplied', () => {
  const live = code('services/shotReadLive.ts');

  it('WIND — SmartVision passed weather: null outright', () => {
    expect(code('app/smartvision.tsx')).not.toMatch(/weather:\s*null/);
    expect(live).toMatch(/getCachedWeatherEvenIfStale/);
  });

  it('ELEVATION — the offline go/no-go treated every shot as flat', () => {
    expect(live).toMatch(/getCachedPlaysLikeElevation/);
    // and it warms the cache rather than inventing a slope it does not have
    expect(live).toMatch(/warmElevation/);
  });

  it('DISTANCE CONTROL — without it every player is treated as some_partials', () => {
    expect(live).toMatch(/distanceControl: safe\(/);
  });

  it('pastScoreNote finally has a producer — every caller passed null before', () => {
    expect(live).toMatch(/getHoleScoringHistory/);
    // gated on its own honesty bar: one visit is not a record
    expect(live).toMatch(/h\.played < 2\) return null/);
  });
});
