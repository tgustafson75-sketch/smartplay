/**
 * 2026-08-24 (Tim's screenshot) — THE TITLE AND THE CHIP CANNOT DISAGREE.
 *
 * The swing detail screen showed "Smart Motion down-the-line swing" as its title with a chip reading
 * "Face-on" directly beneath. Two owners of one fact: the title was a string FROZEN at capture with
 * the angle baked into it, and the chip reads `upload.angleOverride`, which exists precisely to be
 * corrected afterwards. Only one of them tracked the correction.
 *
 * The capture path no longer embeds the angle at all. These cases pin the healing of the swings
 * already saved with it — and pin that nothing else in a player's or coach's note is disturbed.
 */
import { titleForUpload } from '../../services/swing/swingTitle';

describe('the swing title never contradicts the angle chip', () => {
  it('heals the exact case from the screenshot', () => {
    expect(titleForUpload('Smart Motion down-the-line swing', 'face_on', '7I swing'))
      .toBe('Smart Motion face-on swing');
  });

  it('heals the mirror case', () => {
    expect(titleForUpload('Smart Motion face-on swing', 'down_the_line', '7I swing'))
      .toBe('Smart Motion down-the-line swing');
  });

  it('leaves an already-correct title alone', () => {
    expect(titleForUpload('Smart Motion face-on swing', 'face_on', '7I swing'))
      .toBe('Smart Motion face-on swing');
  });

  it('does NOT rewrite when there is no override — an absent correction is not an authority', () => {
    expect(titleForUpload('Smart Motion down-the-line swing', null, '7I swing'))
      .toBe('Smart Motion down-the-line swing');
  });

  it("never touches a note that carries no angle — a coach's words survive", () => {
    expect(titleForUpload('Keep the head still on this one', 'face_on', '7I swing'))
      .toBe('Keep the head still on this one');
  });

  it('falls back to the club when there is no note', () => {
    expect(titleForUpload(null, 'face_on', '7I swing')).toBe('7I swing');
    expect(titleForUpload('   ', null, '7I swing')).toBe('7I swing');
  });

  it('new captures carry no angle in the title at all, so nothing can go stale', () => {
    // What the capture path writes now.
    expect(titleForUpload('Smart Motion swing', 'face_on', '7I swing')).toBe('Smart Motion swing');
    expect(titleForUpload('Smart Motion swing', 'down_the_line', '7I swing')).toBe('Smart Motion swing');
  });
});
