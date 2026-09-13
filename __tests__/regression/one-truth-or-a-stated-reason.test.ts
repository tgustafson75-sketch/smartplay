/**
 * 2026-09-13 (Tim) — "This means we should check that every major element has one truth or reason for
 * other structure."
 *
 * The principle, made mechanical for the one shape a test can actually police: a THRESHOLD exported
 * under the same name from two different files. That is how the green scatter presented — `greenHeat`
 * had `GREEN_HEAT_MIN_HOLES = 9` and `puttingRead` had `MIN_PUTT_HOLES = 9`, the same fact about the
 * same raw input (`RoundRecord.putts`), with no wire between them. Tune one and the heat card renders
 * while the hole plan still calls the read 'forming'.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: flag two constants that merely share a VALUE. A sweep for that
 * returns `MAX_FILE_SIZE_MB = 200` beside `LAYUP_THRESHOLD_YARDS = 200`, and "unifying" those would be
 * the opposite mistake — manufacturing a shared owner for two facts that have nothing to do with each
 * other. A coincidence of magnitude is not a duplicated truth. The signal worth policing is a shared
 * NAME, because that is a claim that the two are the same thing.
 *
 * A collision may be BASELINED with a reason, which is the "or reason for other structure" half.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const walk = (dir: string, out: string[] = []): string[] => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.ts')) out.push(rel);
  }
  return out;
};

const FILES = ['services', 'store', 'constants', 'data', 'utils', 'lib', 'hooks'].flatMap((d) => walk(d));

/** exported SCREAMING_CASE constants → the files that export them. */
const OWNERS = (() => {
  const map = new Map<string, string[]>();
  for (const f of FILES) {
    const src = strip(fs.readFileSync(path.join(root, f), 'utf8'));
    for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]{3,})\s*(?::[^=]+)?=/g)) {
      const list = map.get(m[1]) ?? [];
      list.push(f);
      map.set(m[1], list);
    }
  }
  return map;
})();

/**
 * Same NAME, different FACT — documented, so the collision is a decision rather than a drift.
 * A name may only sit here with a reason that says why the two are not the same thing.
 */
const ACCEPTED_COLLISIONS: Record<string, string> = {
  MIN_SAMPLES:
    'Different measurements that happen to share a name and a value (5). '
    + 'services/rangefinderCalibration counts RANGEFINDER HEIGHT READINGS before it claims a '
    + 'calibration; services/practice/tempoSelfRead counts SWINGS before its EWMA is worth showing. '
    + 'Unifying them would couple a camera calibration to a tempo read, which is the opposite of one '
    + 'truth — it would invent a shared fact where there is none. Each is local to its own module and '
    + 'neither is imported across that line.',
};

describe('a threshold is not exported from two places', () => {
  it('found the constants (the scan must not silently match nothing)', () => {
    expect(OWNERS.size).toBeGreaterThan(100);
  });

  it('no name has two owners unless the collision is documented', () => {
    const split: string[] = [];
    for (const [name, files] of OWNERS) {
      const distinct = [...new Set(files)];
      if (distinct.length > 1 && !ACCEPTED_COLLISIONS[name]) {
        split.push(`${name} → ${distinct.join(', ')}`);
      }
    }
    expect(split).toEqual([]);
  });

  it('every accepted collision still actually collides — no stale entries', () => {
    // A baseline that outlives its collision is a note nobody will question. If the name has one
    // owner again, the entry must go, the same rule the orphan baseline follows.
    for (const name of Object.keys(ACCEPTED_COLLISIONS)) {
      const distinct = [...new Set(OWNERS.get(name) ?? [])];
      expect(distinct.length).toBeGreaterThan(1);
    }
  });

  it('every accepted collision carries a real reason, not a shrug', () => {
    for (const [name, reason] of Object.entries(ACCEPTED_COLLISIONS)) {
      expect(reason.length).toBeGreaterThan(80);
      expect(reason).toMatch(/services\/|store\/|constants\//); // names where the two owners live
      expect(name).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });
});

describe('the putting floor specifically, since that is the one that was split', () => {
  it('is declared once and re-exported, never declared twice', () => {
    const owners = [...new Set(OWNERS.get('MIN_PUTT_HOLES') ?? [])];
    expect(owners).toEqual(['services/puttingRead.ts']);
  });

  it('the surface-specific alias is gone', () => {
    expect(OWNERS.has('GREEN_HEAT_MIN_HOLES')).toBe(false);
  });
});
