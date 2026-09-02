/**
 * 2026-09-01 (Tim — "our shot shape drill shouldn't be here. I'll watch you do shot shape drills.
 * It should FIRST teach you how to do different shot shapes and why, in terms that users can
 * understand.")
 *
 * The picker named a shot and went straight to recording, so it graded a skill it never taught. For
 * the golfer this app is for — busy, self-taught, no lessons — that is a test with no lesson, and the
 * verdict reads as a mark rather than as coaching. [[time-constrained-golfer-lens]]
 *
 * These lock the two properties that make the lesson worth having: EVERY shot carries one, and none
 * of them quotes a number the app cannot measure.
 */
import { SHOT_SHAPES, getShotShape } from '../../services/practice/shotShapes';

describe('shot-shape teaching content', () => {
  it('every shot teaches when to play it, how to hit it, and what club', () => {
    expect(SHOT_SHAPES.length).toBeGreaterThan(0);
    for (const s of SHOT_SHAPES) {
      expect(typeof s.why).toBe('string');
      expect(s.why.length).toBeGreaterThan(40);   // a situation, not a label
      expect(Array.isArray(s.how)).toBe(true);
      expect(s.how.length).toBeGreaterThanOrEqual(3);
      expect(s.club.length).toBeGreaterThan(2);
      for (const step of s.how) expect(step.trim().length).toBeGreaterThan(10);
    }
  });

  it('teaches setup before feel — the last step is the feel, so it lands after the position', () => {
    for (const s of SHOT_SHAPES) {
      expect(s.how[s.how.length - 1].toLowerCase()).toContain('the feel');
      // ...and only the last one, so the lesson is instructions plus a single takeaway.
      expect(s.how.slice(0, -1).filter((h) => h.toLowerCase().includes('the feel:'))).toHaveLength(0);
    }
  });

  /**
   * The honesty boundary this feature already had, extended to its copy. The launch read comes from
   * ONE departure point: it can say height and direction and nothing else. A lesson that promised
   * "lands 6 yards on and checks" would be selling a measurement that never arrives.
   * [[illustration-data-points]] [[smartmotion-metrics-honesty]]
   */
  it('never quotes a number the single-point launch read cannot back up', () => {
    const FABRICATED = /\b\d+\s*(yards?|yds?|rpm|mph|degrees?|°)\b/i;
    for (const s of SHOT_SHAPES) {
      const copy = [s.why, s.club, s.blurb, ...s.how].join(' ');
      expect(copy).not.toMatch(FABRICATED);
    }
  });

  it('speaks in situations and feels, not launch-monitor jargon', () => {
    const JARGON = /\b(spin loft|smash factor|attack angle|launch angle|dynamic loft|low point|face to path)\b/i;
    for (const s of SHOT_SHAPES) {
      expect([s.why, ...s.how].join(' ')).not.toMatch(JARGON);
    }
  });

  it('ids stay resolvable — the lesson and the capture flow key off the same id', () => {
    for (const s of SHOT_SHAPES) expect(getShotShape(s.id)).toBe(s);
    expect(getShotShape('not_a_shot')).toBeNull();
    expect(getShotShape(null)).toBeNull();
  });
});
