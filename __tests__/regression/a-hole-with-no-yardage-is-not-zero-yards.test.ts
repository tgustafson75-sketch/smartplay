/**
 * 2026-10-31 (Brain recheck r20, BRAIN-ENG-3) — A HOLE WITH NO RECORDED YARDAGE IS NOT "0 YDS".
 *
 * A custom course saved from a scorecard photo with an unread yardage carries 0 (data/courses getBundledHoles).
 * The card the caddie reads printed "Hole 4: Par 3, 0 yds" as a fact, inside the block Kevin is told to use without
 * a lookup, and the round's current yardage took the same 0. Now the card says the yardage was not recorded, and
 * the round's yardage is null.
 *
 * BEHAVIOURAL: the real courseContextCache card and knownYardage.
 */
const mockRound = {
  roundStartTime: 1 as number | null,
  activeCourseId: null as string | null,
  courseHoles: [] as { hole: number; par: number; distance: number }[],
};
jest.mock('../../store/roundStore', () => ({ useRoundStore: { getState: () => mockRound } }));

import fs from 'fs';
import path from 'path';
import { getCourseContextSync } from '../../services/courseContextCache';
import { knownYardage } from '../../utils/knownYardage';

const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  mockRound.roundStartTime = 1;
  mockRound.activeCourseId = 'custom:home-abc123';
  mockRound.courseHoles = [{ hole: 1, par: 4, distance: 0 }, { hole: 2, par: 3, distance: 160 }];
});

describe('the course card never states 0 yards', () => {
  it('a hole with no recorded yardage says so; a recorded one keeps its yards', () => {
    expect(getCourseContextSync('custom:home-abc123')).toBe('Hole 1: Par 4, yardage not recorded. Hole 2: Par 3, 160 yds.');
  });

  it('the card never prints "0 yds" for any hole', () => {
    expect(getCourseContextSync('custom:home-abc123')).not.toMatch(/\b0 yds\b/);
  });
});

describe('knownYardage: 0, null and missing are all "no yardage", a real distance is kept', () => {
  it('maps the unknown forms to null', () => {
    expect(knownYardage(0)).toBeNull();
    expect(knownYardage(null)).toBeNull();
    expect(knownYardage(undefined)).toBeNull();
  });

  it('keeps a real distance', () => {
    expect(knownYardage(160)).toBe(160);
  });
});

describe("the round's own yardage takes the same rule", () => {
  it('every currentYardage the store sets goes through knownYardage, so a 0 never becomes the yardage', () => {
    const src = code(fs.readFileSync(path.join(__dirname, '..', '..', 'store', 'roundStore.ts'), 'utf8'));
    const sets = [...src.matchAll(/currentYardage:\s*([^,\n}]+)/g)].map((m) => m[1].trim()).filter((e) => /\.distance/.test(e));
    expect(sets.length).toBeGreaterThanOrEqual(3);
    for (const expr of sets) expect(expr).toMatch(/^knownYardage\(/);
  });
});
