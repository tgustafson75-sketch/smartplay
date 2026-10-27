/**
 * 2026-10-27 (capture-half audit C8) — PRACTICE takes the acoustics as final and levels out the next
 * bay's strikes (strikeDetector.levelStrikes: a strike more than LEVEL_DROP_DB under the session's
 * loudest is dropped). The live HUD meter did not, so "Ball Smash Detected" lit for a neighbour's strike
 * that the set would then not count. The meter takes the same levelling when the screen asks for it
 * (practice, chip sensitivity off), and the same rule: a lone strike is never levelled away.
 */
import { createLiveStrikeMeter } from '../../services/swing/liveStrikeMeter';
import { levelStrikes, LEVEL_DROP_DB } from '../../services/swing/strikeDetector';

/** A quiet bay, ~-60 dBFS, 50ms readings. */
const room = (m: ReturnType<typeof createLiveStrikeMeter>, from: number, ms: number) => {
  for (let t = from; t < from + ms; t += 50) m.push(t, -60 + ((t / 50) % 3));
};

describe('the live meter levels the next bay like the set does', () => {
  it('THE REPORT: after your strike, a neighbour 20 dB down does not light the badge', () => {
    const m = createLiveStrikeMeter(30, { levelDropDb: LEVEL_DROP_DB });
    room(m, 0, 2000);
    expect(m.push(2000, -5).hit).toBe(true);           // yours
    room(m, 2050, 3000);
    const neighbour = m.push(5050, -25);
    expect(neighbour.hit).toBe(false);
    // ...and that is exactly what the set does with it.
    expect(levelStrikes([{ peakDb: -5 }, { peakDb: -25 }]).dropped).toHaveLength(1);
  });

  it('your next strike, a few dB softer, still lights it', () => {
    const m = createLiveStrikeMeter(30, { levelDropDb: LEVEL_DROP_DB });
    room(m, 0, 2000);
    m.push(2000, -5);
    room(m, 2050, 3000);
    expect(m.push(5050, -9).hit).toBe(true);
  });

  it('a lone strike is never levelled away (the first one always lights)', () => {
    const m = createLiveStrikeMeter(30, { levelDropDb: LEVEL_DROP_DB });
    room(m, 0, 2000);
    expect(m.push(2000, -25).hit).toBe(true);
  });

  it('without levelling (range, course, chip sensitivity) the meter is unchanged', () => {
    const m = createLiveStrikeMeter(30);
    room(m, 0, 2000);
    m.push(2000, -5);
    room(m, 2050, 3000);
    expect(m.push(5050, -25).hit).toBe(true);
  });
});
