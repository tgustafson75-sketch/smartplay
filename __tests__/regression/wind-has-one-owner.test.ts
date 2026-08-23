/**
 * 2026-08-23 — The app has always known which way the wind blows relative to the shot:
 * queryStatusHandler decomposed it against the tee→green bearing and answered "11 into your face".
 * The caddie BRAIN was sent `windFromDeg: 270` and no bearing, so it could not derive the direction
 * and had two ways to fail — drop the wind, or guess "into" and state the guess as fact. Both were
 * observed live, and three prompt rewrites tried to fix the club call before anyone checked whether
 * the brain had the information to answer at all.
 *
 * One owner, because two derivations of "which way is the wind" would eventually disagree and the
 * player would be TOLD one thing while the club was chosen from another.
 */
import { decomposeWind } from '../../services/windRelative';

describe('relative wind', () => {
  it('reads a wind blowing straight back down the shot line as INTO the face', () => {
    // Playing due north (0°); wind FROM the north (0°) blows south, into the player.
    const r = decomposeWind(0, 16, 0)!;
    expect(r.kind).toBe('into');
    expect(Math.round(r.alongMph)).toBe(-16);
    expect(r.phrase).toMatch(/into your face/);
  });

  it('reads a following wind as behind, not into', () => {
    const r = decomposeWind(180, 16, 0)!;
    expect(r.kind).toBe('behind');
    expect(Math.round(r.alongMph)).toBe(16);
    expect(r.phrase).toMatch(/at your back/);
  });

  it('names the side a crosswind comes from', () => {
    const r = decomposeWind(270, 16, 0)!;
    expect(r.kind).toBe('cross');
    expect(r.phrase).toMatch(/crosswind from the left/);
  });

  it('stays UNKNOWN without a bearing rather than defaulting to "into"', () => {
    // The whole defect: no mapped hole line means no direction, and a guess is worse than silence.
    expect(decomposeWind(270, 16, null)).toBeNull();
    expect(decomposeWind(null, 16, 90)).toBeNull();
    expect(decomposeWind(270, null, 90)).toBeNull();
  });

  it('the caddie payload and the spoken answer share this ONE module', () => {
    const fs = require('fs') as typeof import('fs');
    const body = fs.readFileSync('services/caddieRequestBody.ts', 'utf8');
    const voice = fs.readFileSync('services/intents/queryStatusHandler.ts', 'utf8');
    expect(body).toMatch(/decomposeWind/);
    expect(voice).toMatch(/decomposeWind/);
    // ...and neither may keep a private copy of the maths.
    expect(voice).not.toMatch(/Math\.cos\(rel \* Math\.PI/);
  });
});
