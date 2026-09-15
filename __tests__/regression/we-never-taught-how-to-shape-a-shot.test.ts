/**
 * 2026-09-14 (Tim) — "we have shot shape drills but we dont teach how the hell to shot shape."
 *
 * Half right, and the half he was right about was the half that mattered. The SHORT-GAME set got
 * the teaching treatment on 2026-09-01 — when you'd play it, the club, the setup, the one feel, per
 * shot. FULL-SWING shaping never did: the only draw/fade material in the app was a single
 * knowledge-base entry stating the ball-flight law ("curve comes from the face relative to the
 * path"), which is physics, not a lesson — while `services/clubTendency` measured his shape and the
 * caddie commented on it. Measured, commented on, never taught.
 *
 * The honesty problem this had to solve: a single departure point reads a START DIRECTION, not a
 * curve. A draw that starts right and never turns over is indistinguishable from a push at the
 * moment the ball leaves. So a shaped swing is graded on the start line — genuinely the half a
 * player gets wrong — and the verdict says so rather than claiming to have seen the curve.
 */
import fs from 'fs';
import path from 'path';
import {
  SHOT_SHAPES, getShotShape, compareShotShape, expectedStartSide, type ActualLaunch,
} from '../../services/practice/shotShapes';

const ROOT = path.resolve(__dirname, '../..');
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const launch = (direction: ActualLaunch['direction'], height: ActualLaunch['height'] = 'medium'): ActualLaunch =>
  ({ direction, height, angleDeg: 40 });

describe('full-swing shaping is taught', () => {
  const FULL = ['draw', 'fade', 'knockdown', 'high_soft'];

  it.each(FULL)('%s exists with the same lesson shape as the short-game shots', (id) => {
    const s = getShotShape(id)!;
    expect(s).toBeTruthy();
    expect(s.family).toBe('full_swing');
    expect(s.why.length).toBeGreaterThan(60);        // when you'd actually play it
    expect(s.how.length).toBeGreaterThanOrEqual(3);  // setup first, then the feel
    expect(s.how[s.how.length - 1]).toMatch(/feel/i);
    expect(s.club.length).toBeGreaterThan(5);
  });

  it('every shape belongs to a rack, so none can be invisible on the picker', () => {
    for (const s of SHOT_SHAPES) expect(['full_swing', 'short_game']).toContain(s.family);
    expect(SHOT_SHAPES.filter((s) => s.family === 'full_swing').length).toBe(4);
    expect(SHOT_SHAPES.filter((s) => s.family === 'short_game').length).toBeGreaterThan(5);
  });

  it('the picker renders both racks', () => {
    const src = code('app/practice/shot-shapes.tsx');
    expect(src).toMatch(/'full_swing', 'short_game'/);
    expect(src).toMatch(/s\.family === fam/);
  });

  it('the teaching is setup-and-feel, never swing-plane jargon', () => {
    for (const s of SHOT_SHAPES.filter((x) => x.family === 'full_swing')) {
      const all = s.how.join(' ').toLowerCase();
      expect(all).not.toMatch(/shallow the shaft|steepen the plane|d-plane|angle of attack/);
    }
  });
});

describe('a shaped swing is graded on the half we can actually see', () => {
  it('start side follows the ball-flight law, and mirrors for a left-hander', () => {
    expect(expectedStartSide('draw', 'right')).toBe('right');
    expect(expectedStartSide('fade', 'right')).toBe('left');
    expect(expectedStartSide('draw', 'left')).toBe('left');
    expect(expectedStartSide('fade', 'left')).toBe('right');
    expect(expectedStartSide(null, 'right')).toBe('straight');
  });

  it('a right-hander who starts a draw right is on, and is told the curve was not measured', () => {
    const v = compareShotShape(getShotShape('draw')!, launch('right'), { handedness: 'right' });
    expect(v.match).toBe('on');
    expect(v.feedback).toMatch(/not the curve|curve is yours/i);
  });

  it('a left-hander is not graded against a right-hander\'s shot', () => {
    const shape = getShotShape('draw')!;
    expect(compareShotShape(shape, launch('left'), { handedness: 'left' }).match).toBe('on');
    expect(compareShotShape(shape, launch('left'), { handedness: 'right' }).match).toBe('off');
  });

  it('a miss says where it should have started and how to make that happen', () => {
    const v = compareShotShape(getShotShape('fade')!, launch('right'), { handedness: 'right' });
    expect(v.match).toBe('off');
    expect(v.feedback).toMatch(/needs to start left/);
    expect(v.feedback).toMatch(/aim the FACE at the target/i);
  });

  it('a shaped shot is NOT graded on height — a draw and a fade share one', () => {
    const draw = getShotShape('draw')!;
    // Same start line, wildly different height: still 'on', because height is not the axis.
    expect(compareShotShape(draw, launch('right', 'high'), { handedness: 'right' }).match).toBe('on');
    expect(compareShotShape(draw, launch('right', 'low'), { handedness: 'right' }).match).toBe('on');
  });

  it('the short-game shots are still graded on height, unchanged', () => {
    const flop = getShotShape('flop')!;
    expect(compareShotShape(flop, launch('straight', 'high')).match).toBe('on');
    expect(compareShotShape(flop, launch('straight', 'low')).match).toBe('off');
  });

  it('SmartMotion passes the SWINGER\'s hand, not the account holder\'s', () => {
    const sm = code('app/swinglab/smartmotion.tsx');
    expect(sm).toMatch(/compareShotShape\(shotShapeDef, actual, \{ handedness: swingerHandedness \}\)/);
  });
});

describe('the caddie can teach it out loud, not only on a screen', () => {
  it('the ball-flight entry carries the instruction, not just the law', () => {
    const kb = code('services/knowledgeBase/modules/ballFlight.ts');
    const at = kb.indexOf("id: 'bf.face-to-path'");
    expect(at).toBeGreaterThan(-1);
    const entry = kb.slice(at, at + 2000);
    expect(entry).toMatch(/aim the CLUBFACE at your target first/i);
    expect(entry).toMatch(/swing along your FEET/i);
    expect(entry).toMatch(/left-hander/i);            // not right-handed-only advice
    expect(entry).toMatch(/how to hit a draw/);       // still reachable by the obvious question
  });
});
