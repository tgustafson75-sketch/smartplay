/**
 * 2026-10-15 (review #4) — liveShotReadInputs passed `shotBearingDeg: known.shotBearingDeg ?? null`,
 * and caddieRequestBody composes the brain's decision as decideShot({ rawYards }) with no bearing. So
 * the shotRead.club / playsLikeYards the brain was handed ignored the wind, while weather.playsLike in
 * the same payload accounted for it — two answers to "what does it play" in one request.
 *
 * Driven through the real composer and the real decideShot: the bearing now arrives from the one
 * owner of the shot line (windRelative.shotBearingDeg), and a caller's explicit value still wins.
 */
jest.mock('../../services/windRelative', () => {
  const actual = jest.requireActual('../../services/windRelative');
  return { ...actual, shotBearingDeg: (hole: number) => (hole === 7 ? 90 : null) };
});

import { liveShotReadInputs } from '../../services/shotReadLive';
import { useRoundStore } from '../../store/roundStore';

function onHole7() {
  useRoundStore.setState({
    isRoundActive: true, currentHole: 7, activeCourseId: 'test-gc',
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 370 })),
    shots: [],
  } as never);
}

describe('the brain\'s shot read knows which way the shot goes', () => {
  it('a caller with no bearing gets the hole\'s shot line', () => {
    onHole7();
    expect(liveShotReadInputs({ rawYards: 150 }).shotBearingDeg).toBe(90);
  });

  it('decideShot({ rawYards }) — the exact call caddieRequestBody makes — is composed with it', () => {
    onHole7();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sr = require('../../services/shotReadLive');
    const spy = jest.spyOn(sr, 'liveShotReadInputs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { decideShot } = require('../../services/caddieDecision');
    decideShot({ rawYards: 150 });
    expect(spy).toHaveBeenCalled();
    expect((spy.mock.results[0].value as { shotBearingDeg: number | null }).shotBearingDeg).toBe(90);
    spy.mockRestore();
  });

  it('a caller that brings its own bearing — or says there is none — still wins', () => {
    onHole7();
    expect(liveShotReadInputs({ rawYards: 150, shotBearingDeg: 200 }).shotBearingDeg).toBe(200);
    expect(liveShotReadInputs({ rawYards: 150, shotBearingDeg: null }).shotBearingDeg).toBeNull();
  });

  it('off-round there is no hole, so no invented bearing', () => {
    useRoundStore.setState({ isRoundActive: false } as never);
    expect(liveShotReadInputs({ rawYards: 150 }).shotBearingDeg).toBeNull();
  });
});
