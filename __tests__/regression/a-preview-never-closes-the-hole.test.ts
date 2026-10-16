/**
 * 2026-10-15 (review) — setCurrentHole closed the previous hole's last shot at the green on ANY hole
 * change. The data strip previews the next hole through setCurrentHole (▶, then back after
 * HOLE_PREVIEW_MS or ◀), so a look ahead mid-hole pinned the shot just hit to the green — and the next
 * shot then measured from the green (shotTracking reads prev.end_location).
 *
 * Now: only moving FORWARD off a SCORED hole closes it; a hole scored after the player moved on is
 * closed by logScore.
 */
import { useRoundStore } from '../../store/roundStore';
import { getGreenCentroid } from '../../services/shotLocationService';

const seed = (scores: Record<number, number>) => {
  useRoundStore.setState({
    isRoundActive: true, activeCourseId: 'test-course', currentHole: 1,
    roundStartHole: 1, nineHoleMode: false, scores,
    courseHoles: [
      { hole: 1, par: 4, distance: 380, middleLat: 37.72, middleLng: -122.52 },
      { hole: 2, par: 4, distance: 400, middleLat: 37.7, middleLng: -122.5 },
    ] as never,
    shots: [{ id: 's1', hole: 1, shot_in_hole_index: 1, start_location: { lat: 37.71, lng: -122.51 } }] as never,
  } as never);
};
const endLoc = () =>
  (useRoundStore.getState().shots.find((s) => s.id === 's1') as { end_location?: unknown }).end_location ?? null;

describe('a hole preview never closes the hole being played', () => {
  it('▶ then ◀ on an unscored hole leaves the last shot open', () => {
    seed({});
    useRoundStore.getState().setCurrentHole(2);
    useRoundStore.getState().setCurrentHole(1);
    expect(endLoc()).toBeNull();
  });

  it('a backward move never closes the hole being left', () => {
    seed({ 1: 4 });
    useRoundStore.setState({ currentHole: 2, shots: [{ id: 's1', hole: 2, shot_in_hole_index: 1 }] } as never);
    useRoundStore.getState().setCurrentHole(1);
    expect(endLoc()).toBeNull();
  });

  it('advancing off a SCORED hole still closes it at the green', () => {
    seed({ 1: 4 });
    useRoundStore.getState().setCurrentHole(2);
    expect(endLoc()).toEqual(getGreenCentroid(1));
  });

  it('a hole scored after moving on is closed by the score', () => {
    seed({});
    useRoundStore.getState().setCurrentHole(2);
    expect(endLoc()).toBeNull();
    useRoundStore.getState().logScore(1, 5);
    expect(endLoc()).toEqual(getGreenCentroid(1));
  });
});
