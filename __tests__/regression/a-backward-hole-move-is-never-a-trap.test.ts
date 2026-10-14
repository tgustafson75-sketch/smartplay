/**
 * 2026-10-13 (SmartVision/GPS audit #2) — the re-entry rule jumped back to an already-played hole on a
 * 10-second stop within 20y of its tee (a cart path past an old tee), and from that old hole the
 * forward search (current+1..+2, skipping scored holes) could never reach the hole he was really on.
 * Stuck, silently. Now: going back needs him ON the old tee, far from his green, held 45 s (flagged
 * `backward`); and from a played hole the forward search sees the FRONTIER, his first unscored hole.
 */
import { detectCurrentHole } from '../../services/holeDetection';
import { useRoundStore, type CourseHole } from '../../store/roundStore';
import { purgeCourseGeometry } from '../../services/courseGeometryService';

const COURSE = 'gca-backward-test';
// Seven holes in a column, ~1.1 km apart; each tee→green ~385 y north.
const tee = (n: number) => ({ lat: 33.70 + n * 0.01, lng: -117.0 });
const green = (n: number) => ({ lat: 33.70 + n * 0.01 + 0.0035, lng: -117.0 });
const hole = (n: number): CourseHole => ({
  hole: n, par: 4, distance: 385, front: 375, back: 395,
  teeLat: tee(n).lat, teeLng: tee(n).lng,
  middleLat: green(n).lat, middleLng: green(n).lng,
  frontLat: green(n).lat, frontLng: green(n).lng, backLat: green(n).lat, backLng: green(n).lng,
  note: '', estimated: false,
} as CourseHole);
const scored = (upTo: number) => Object.fromEntries(Array.from({ length: upTo }, (_, i) => [i + 1, 4]));

beforeEach(() => {
  purgeCourseGeometry(COURSE);
  useRoundStore.setState({
    isRoundActive: true, activeCourseId: COURSE, currentHole: 7,
    courseHoles: [1, 2, 3, 4, 5, 6, 7].map(hole),
  } as never);
});

describe('going back needs real evidence', () => {
  it('passing 18 y from an old tee (a cart path) is not a re-entry', () => {
    const nearOldTee = { lat: tee(3).lat + 0.00016, lng: tee(3).lng };   // ~18 y
    const r = detectCurrentHole(nearOldTee, COURSE, 7, scored(6));
    expect(r.transition_recommended && r.hole_number === 3).toBe(false);
  });

  it('standing ON an old tee, far from the current green, is a re-entry — flagged backward (held 45 s)', () => {
    const r = detectCurrentHole(tee(3), COURSE, 7, scored(6));
    expect(r.hole_number).toBe(3);
    expect(r.transition_recommended).toBe(true);
    expect((r as { backward?: boolean }).backward).toBe(true);
  });
});

describe('and is never a trap', () => {
  it('THE BUG: from the old hole, walking to his real next tee brings him back (the frontier)', () => {
    useRoundStore.setState({ currentHole: 3 } as never);
    // holes 1-6 scored; he is on hole 3 after a re-entry; he walks to hole 7's tee
    const r = detectCurrentHole(tee(7), COURSE, 3, scored(6));
    expect(r.hole_number).toBe(7);
    expect(r.transition_recommended).toBe(true);
  });

  it('normal play is unchanged: the next hole is still found in the lookahead', () => {
    useRoundStore.setState({ currentHole: 4 } as never);
    const r = detectCurrentHole(tee(5), COURSE, 4, scored(4));
    expect(r.hole_number).toBe(5);
    expect(r.transition_recommended).toBe(true);
  });
});

describe('the consumer says so', () => {
  it('a backward move toasts, and the poll holds a backward candidate 45 s', () => {
    const strip = (f: string) => require('fs').readFileSync(require('path').join(__dirname, '../..', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(strip('app/_layout.tsx')).toMatch(/if \(nextHole < prevHole\) \{[\s\S]{0,200}GPS moved you back to hole \$\{nextHole\}/);
    expect(strip('services/holeDetection.ts')).toMatch(/const held = result\.backward\s*\? now - candidateSince >= REENTRY_SUSTAINED_MS/);
  });
});
