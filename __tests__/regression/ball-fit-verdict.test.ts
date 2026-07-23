/**
 * Bag Vision 2b — classifyBall / ballFitVerdict: map the player's gamer to a profile and give an
 * honest owned-vs-recommended read. Unknown balls must NOT assert a mismatch.
 */
import { classifyBall, ballFitVerdict } from '../../services/cnsBallFitting';

describe('classifyBall', () => {
  it('classifies common tour balls', () => {
    expect(classifyBall('Titleist Pro V1')).toBe('tour');
    expect(classifyBall('pro v1x')).toBe('tour');
    expect(classifyBall('TaylorMade TP5')).toBe('tour');
  });
  it('classifies soft-feel and distance and value balls', () => {
    expect(classifyBall('Callaway Supersoft')).toBe('soft-feel');
    expect(classifyBall('Titleist Velocity')).toBe('distance');
    expect(classifyBall('Nitro')).toBe('value');
  });
  it('prefers the more specific match (Pro V1x before Pro V1, Chrome Soft X before Chrome Soft)', () => {
    expect(classifyBall('pro v1x')).toBe('tour');
    expect(classifyBall('Chrome Soft X')).toBe('tour');
    expect(classifyBall('Chrome Soft')).toBe('soft-feel');
  });
  it('returns null for unknown / empty', () => {
    expect(classifyBall('some random ball 9000')).toBeNull();
    expect(classifyBall('')).toBeNull();
    expect(classifyBall(null)).toBeNull();
  });
});

describe('ballFitVerdict', () => {
  it('aligned when owned profile matches the recommendation', () => {
    const v = ballFitVerdict('Pro V1', 'tour');
    expect(v.aligned).toBe(true);
  });
  it('flags a mismatch (aligned=false) with a trial suggestion', () => {
    const v = ballFitVerdict('Supersoft', 'tour');
    expect(v.aligned).toBe(false);
    expect(v.line.toLowerCase()).toContain('tour');
  });
  it('is honest (aligned=null) for an unknown ball — no false mismatch', () => {
    expect(ballFitVerdict('mystery ball', 'tour').aligned).toBeNull();
  });
  it('prompts to add a ball when none is set', () => {
    expect(ballFitVerdict('', 'tour').aligned).toBeNull();
    expect(ballFitVerdict(null, 'distance').aligned).toBeNull();
  });
});
