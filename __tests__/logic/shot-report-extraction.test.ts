/**
 * Recording a shot the player already hit — and nothing else.
 *
 * 2026-08-20. log_shot was INTERMITTENT live: fired on "I hit my 7 iron and pulled it left of the
 * green", missed on "I striped my drive right down the middle" and "I chunked my wedge, came up 20
 * yards short". Same fast-tier cause as recommend_club and log_emotional_state.
 *
 * This extractor is the strictest of the three ON PURPOSE. A wrong shot record does not merely miss
 * data, it CORRUPTS the history the caddie learns distances and tendencies from — and a corrupted
 * ladder stays invisible until it gives bad advice on the course. Every "does not fire" case below
 * is therefore load-bearing, not defensive padding.
 */
import { extractShotReport } from '../../api/_brain';

describe('the shots that were being lost', () => {
  it('I striped my drive right down the middle', () => {
    expect(extractShotReport('I striped my drive right down the middle')).toEqual({
      club: 'driver', direction: 'right', contactQuality: 'striped', outcome: 'middle',
    });
  });

  it('I chunked my wedge, came up 20 yards short', () => {
    const r = extractShotReport('I chunked my wedge, came up 20 yards short');
    expect(r?.club).toBe('wedge');
    expect(r?.contactQuality).toBe('chunked');
  });

  it('I hit my 7 iron and pulled it left of the green', () => {
    const r = extractShotReport('I hit my 7 iron and pulled it left of the green');
    expect(r?.club).toBe('7 iron');
    expect(r?.direction).toBe('left');
  });

  it('reads a tee shot as the driver even when the word never appears', () => {
    expect(extractShotReport('I blocked my tee shot right into the trees')?.club).toBe('driver');
  });
});

describe('what it must never mistake for a shot', () => {
  it('does not record ADVICE as a shot the player hit', () => {
    // The caddie's own recommendation. No strike happened.
    expect(extractShotReport("I'd go with a 7 iron here")).toBeNull();
  });

  it('does not record a PLAN as a shot', () => {
    // This is plan_shot, and it is in the future.
    expect(extractShotReport("I'm going to lay up with my 7 iron to about 100")).toBeNull();
    expect(extractShotReport("I'll hit 3 wood off this tee and leave it short")).toBeNull();
  });

  it('does not record general club talk', () => {
    expect(extractShotReport('my 7 iron goes about 165')).toBeNull();
    expect(extractShotReport('your 7 iron goes about 165')).toBeNull();
  });

  it('does not record a question', () => {
    expect(extractShotReport('should I hit 7 iron here')).toBeNull();
    expect(extractShotReport('did I hit that 7 iron well')).toBeNull();
  });

  it('refuses a strike with NO club — a row that teaches nothing still costs a row', () => {
    expect(extractShotReport('I pulled it left again')).toBeNull();
  });

  it('refuses a club with NO descriptive signal — "a swing happened" is noise, not data', () => {
    expect(extractShotReport('I hit my 7 iron')).toBeNull();
  });

  it('is not fooled by someone else hitting it', () => {
    expect(extractShotReport('he striped his drive down the middle')).toBeNull();
  });
});
