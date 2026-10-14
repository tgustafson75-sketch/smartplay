/**
 * 2026-10-13 (course-engine audit #2) — every build of ANOTHER course during a round sent the active
 * course's tee centroid to the geometry server, which snapped that course's greens onto the other
 * course's holes. The active round's tees now count only for the course being built.
 */
import { useRoundStore } from '../../store/roundStore';
import { deriveCentroidFromActiveCourseHoles } from '../../services/courseGeometryService';

describe('a course map is built around its own course', () => {
  beforeEach(() => {
    useRoundStore.setState({
      activeCourseId: 'local:menifee-palms',
      courseHoles: [
        { hole: 1, par: 4, yards: 380, teeLat: 33.687, teeLng: -117.171 },
        { hole: 2, par: 3, yards: 160, teeLat: 33.689, teeLng: -117.169 },
      ] as never,
    });
  });

  it('the active round\'s tees place the active course', () => {
    const c = deriveCentroidFromActiveCourseHoles('local:menifee-palms');
    expect(c?.lat).toBeCloseTo(33.688, 3);
  });

  it('THE BUG: building a different course mid-round does not borrow the active course\'s centre', () => {
    expect(deriveCentroidFromActiveCourseHoles('local:menifee-lakes')).toBeNull();
    expect(deriveCentroidFromActiveCourseHoles('8c6dnfpj')).toBeNull();
  });

  it('no round: nothing to borrow', () => {
    useRoundStore.setState({ activeCourseId: null });
    expect(deriveCentroidFromActiveCourseHoles('local:menifee-palms')).toBeNull();
  });
});
