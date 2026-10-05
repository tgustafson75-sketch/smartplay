/**
 * 2026-09-29 (Tim) — "we need to hide and make user not have to move ball box in smartmotion. No other
 * app seems to make you do a setup and we need reduce friction without reducing analysis."
 *
 * The ball region is DERIVED (default rig → pose proxy under the feet → the ball detected in a setup
 * frame), hidden in the default flow, and still reaches every consumer. These lock:
 *   - the precedence, including the defect it closes (the feet proxy overwrote a real detection);
 *   - the region's SOURCE travelling into the saved session, so consumers can tell a measurement from
 *     the unmeasured default — and older sessions without a source reading as unknown;
 *   - the departure gate: an unmeasured region is discounted like a loose anchor, a measured one is not;
 *   - the box is off screen in the default full-swing flow and only appears when asked for.
 */
import fs from 'fs';
import path from 'path';
import {
  acceptBallDeparture, ballRegionFromDetection, ballRegionFromFeet, isEstimatedBallRegion, nextBallRegion,
  type SourcedBallRegion,
} from '../../services/swing/ballRegion';
import { useSwingSessionStore } from '../../store/swingSessionStore';

const DEFAULT: SourcedBallRegion = { region: { x: 0.5, y: 0.62, r: 0.08 }, source: 'default' };

describe('the ball region is derived, and a better source always wins', () => {
  it('the feet proxy replaces the default', () => {
    const r = nextBallRegion(DEFAULT, ballRegionFromFeet({ x: 0.4, y: 0.8 }));
    expect(r.source).toBe('feet');
    expect(r.region.x).toBeCloseTo(0.4, 6);
    expect(r.region.y).toBeCloseTo(0.84, 6);
    expect(r.region.r).toBe(0.08);
  });

  it('a detected ball replaces the feet proxy', () => {
    const feet = nextBallRegion(DEFAULT, ballRegionFromFeet({ x: 0.4, y: 0.8 }));
    expect(nextBallRegion(feet, ballRegionFromDetection({ x: 0.45, y: 0.83 })).source).toBe('detected');
  });

  it('THE DEFECT: the next framed tick does NOT put the feet proxy back over a detected ball', () => {
    const detected = ballRegionFromDetection({ x: 0.45, y: 0.83 });
    const after = nextBallRegion(detected, ballRegionFromFeet({ x: 0.4, y: 0.8 }));
    expect(after).toBe(detected);
  });

  it('a placement by the player outranks every automatic source', () => {
    const user: SourcedBallRegion = { region: { x: 0.6, y: 0.7, r: 0.07 }, source: 'user' };
    expect(nextBallRegion(user, ballRegionFromDetection({ x: 0.1, y: 0.1 }))).toBe(user);
    expect(nextBallRegion(user, ballRegionFromFeet({ x: 0.1, y: 0.1 }))).toBe(user);
  });

  it('a malformed candidate never replaces a real region', () => {
    const bad: SourcedBallRegion = { region: { x: NaN, y: 0.5, r: 0.08 }, source: 'detected' };
    expect(nextBallRegion(DEFAULT, bad)).toBe(DEFAULT);
  });

  it('only the unmeasured default is an estimate', () => {
    expect(isEstimatedBallRegion('default')).toBe(true);
    for (const s of ['user', 'detected', 'feet', null, undefined] as const) expect(isEstimatedBallRegion(s)).toBe(false);
  });
});

describe('the source is saved with the session — and an old session reads as unknown', () => {
  beforeEach(() => {
    useSwingSessionStore.setState({
      sessionHistory: [{ id: 's1', date: 1, club: '7i', shots: [], summary: null } as never],
      activeSession: null,
    });
  });

  it('a derived region is saved with where it came from', () => {
    useSwingSessionStore.getState().setSessionBallArea('s1', { x: 0.45, y: 0.83, r: 0.08 }, 'detected');
    const s = useSwingSessionStore.getState().sessionHistory[0];
    expect(s.ball_area_norm).toEqual({ x: 0.45, y: 0.83, r: 0.08 });
    expect(s.ball_area_source).toBe('detected');
  });

  it('a caller that passes no source stores unknown (null), the pre-existing behaviour', () => {
    useSwingSessionStore.getState().setSessionBallArea('s1', { x: 0.45, y: 0.83, r: 0.08 });
    expect(useSwingSessionStore.getState().sessionHistory[0].ball_area_source ?? null).toBeNull();
  });
});

describe('ball departure: an unmeasured region is discounted, a measured one is not', () => {
  const low = { departed: true, confidence: 'low' as const, ball_present_before: true };
  const duff = { departed: false, confidence: 'medium' as const, ball_present_before: true };
  const unseen = { departed: true, confidence: 'high' as const, ball_present_before: false };

  it('a measured region with an acoustic strike takes the read as it comes (unchanged)', () => {
    for (const src of ['detected', 'feet', 'user', null] as const) {
      expect(acceptBallDeparture(low, { videoLocated: false, regionSource: src })).toBe(low);
    }
  });

  it('the DEFAULT region drops a low-confidence read and one that never saw the ball', () => {
    expect(acceptBallDeparture(low, { videoLocated: false, regionSource: 'default' })).toBeNull();
    expect(acceptBallDeparture(unseen, { videoLocated: false, regionSource: 'default' })).toBeNull();
  });

  it('…but keeps a duff it actually saw — no analysis is lost to hiding the box', () => {
    expect(acceptBallDeparture(duff, { videoLocated: false, regionSource: 'default' })).toBe(duff);
  });

  it('the video-located rule is exactly what it was', () => {
    expect(acceptBallDeparture(duff, { videoLocated: true, regionSource: 'detected' })).toBeNull();
    const good = { departed: true, confidence: 'medium' as const, ball_present_before: true };
    expect(acceptBallDeparture(good, { videoLocated: true, regionSource: 'detected' })).toBe(good);
  });
});

describe('SmartMotion: the box is off screen by default and appears only when asked for', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../../app/swinglab/smartmotion.tsx'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

  it('hidden by default', () => {
    expect(src).toMatch(/const \[ballBoxShown, setBallBoxShown\] = useState\(false\);/);
  });

  it('the setup overlay renders only in putting, when revealed, or while placing', () => {
    expect(src).toMatch(/phase === 'setup' && draftBall && \(isPutt \|\| ballBoxShown \|\| placeBallMode\) \?/);
    expect(src).not.toMatch(/\{phase === 'setup' && draftBall \? \(/);
  });

  it('every region update goes through the precedence, including the two automatic ones', () => {
    expect(src).toMatch(/applyBallRegion\(ballRegionFromFeet\(res\.feetCenter\)\)/);
    expect(src).toMatch(/applyBallRegion\(ballRegionFromDetection\(found\)\)/);
    expect(src).toMatch(/setSessionBallArea\((?:sessionId|sid), draftBallRef\.current, ballSourceRef\.current\)/);
  });

  it('the departure gate reads the saved region source', () => {
    expect(src).toMatch(/acceptBallDeparture\(r, \{ videoLocated, regionSource: ballAreaSourceRef\.current \}\)/);
  });
});
