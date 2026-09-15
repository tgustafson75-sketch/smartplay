/**
 * 2026-09-14 — the lint sweep Tim asked for ("clear the 27 unused"), and the one that could not
 * simply be deleted.
 *
 * `CockpitCaddieScreen` destructured `courseHoles` and `nineHoleMode` from its roundStore selector
 * and used neither. They looked like two more leftovers. They were not: the hole range below them
 * was computed from `useRoundStore.getState()` — a NON-reactive snapshot — so the only thing making
 * those numbers refresh was the re-render those two subscriptions forced. Deleting them would have
 * frozen the Cockpit's "Hole X / Y" and its stepper bounds at whatever they were on mount.
 *
 * It was also incomplete. `roundLastHole` reads four fields and only two were subscribed, so a
 * change to `roundStartHole` or `activeCourseId` alone already left a stale range — the same class
 * as the "Hole X/18 on a nine" and back-nine stepper bugs the file's own notes record fixing.
 *
 * Both helpers are pure and exported, so the arithmetic is tested directly here; the screen is
 * checked structurally for passing all four.
 */
import fs from 'fs';
import path from 'path';
import { roundFirstHole, roundLastHole } from '../../store/roundStore';

const ROOT = path.resolve(__dirname, '../..');
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const holes = (n: number) => Array.from({ length: n }, (_, i) => ({ hole: i + 1, par: 4 })) as never;

describe('the cockpit hole range', () => {
  it('a full 18 runs 1 to 18', () => {
    const s = { nineHoleMode: false, roundStartHole: 1, activeCourseId: null, courseHoles: holes(18) };
    expect(roundFirstHole(s)).toBe(1);
    expect(roundLastHole(s)).toBe(18);
  });

  it('a FRONT nine runs 1 to 9, not 1 to 18', () => {
    // courseHoles.length is the PHYSICAL count — 18 even when playing the front nine.
    const s = { nineHoleMode: true, roundStartHole: 1, activeCourseId: null, courseHoles: holes(18) };
    expect(roundFirstHole(s)).toBe(1);
    expect(roundLastHole(s)).toBe(9);
  });

  it('a BACK nine runs 10 to 18 — the stepper must not drag it back to 9', () => {
    const s = { nineHoleMode: true, roundStartHole: 10, activeCourseId: null, courseHoles: holes(18) };
    expect(roundFirstHole(s)).toBe(10);
    expect(roundLastHole(s)).toBe(18);
  });

  it('roundStartHole alone changes the range — which is why subscribing to it matters', () => {
    const base = { nineHoleMode: true, activeCourseId: null, courseHoles: holes(18) };
    const front = { ...base, roundStartHole: 1 };
    const back = { ...base, roundStartHole: 10 };
    // Same courseHoles, same nineHoleMode. Only roundStartHole moved, and the whole range moved
    // with it — so a component subscribed to only the first two would have rendered the wrong one.
    expect([roundFirstHole(front), roundLastHole(front)]).toEqual([1, 9]);
    expect([roundFirstHole(back), roundLastHole(back)]).toEqual([10, 18]);
  });
});

describe('the cockpit computes it from subscribed values, not a snapshot', () => {
  const src = code('components/caddie/CockpitCaddieScreen.tsx');

  it('all four inputs are subscribed', () => {
    for (const f of ['courseHoles: s.courseHoles', 'nineHoleMode: s.nineHoleMode',
                     'roundStartHole: s.roundStartHole', 'activeCourseId: s.activeCourseId']) {
      expect(src).toContain(f);
    }
  });

  it('the range is no longer read off a non-reactive getState snapshot', () => {
    expect(src).not.toMatch(/roundLastHole\(useRoundStore\.getState\(\)\)/);
    expect(src).not.toMatch(/roundFirstHole\(useRoundStore\.getState\(\)\)/);
    expect(src).toMatch(/roundLastHole\(holeRangeInputs\)/);
    expect(src).toMatch(/roundFirstHole\(holeRangeInputs\)/);
  });

  it('the subscribed values are genuinely consumed, so they cannot look unused again', () => {
    expect(src).toMatch(/const holeRangeInputs = \{ nineHoleMode, roundStartHole, activeCourseId, courseHoles \}/);
  });
});
