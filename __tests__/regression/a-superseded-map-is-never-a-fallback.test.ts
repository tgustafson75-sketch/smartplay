/**
 * 2026-10-15 — GEOMETRY_PIPELINE_VERSION 3→4 (10-13) exists because Hemet had 17 of 18 greens paired
 * to the WRONG hole. A map from the old pipeline is wrong, not merely old.
 *
 * The suspect branch deleted it before the rebuild — correctly — but kept it in the local `persisted`,
 * and both failure exits return `persisted ?? bundled…`. So a rebuild that failed (no signal, 503,
 * timeout) handed the wrong-hole map straight back as the answer for that call.
 *
 * (An offline-audit recommendation to KEEP old maps as an offline fallback was built, reviewed and
 * reverted the same day: wrong yardages served with confidence are worse than none. Greens from the
 * current engine, or nothing.)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchCourseGeometry, purgeCourseGeometry } from '../../services/courseGeometryService';

const KEY = 'course-geometry-v3::api-777';
const pt = (lat: number) => ({ lat, lng: -117.2 });
const v3map = {
  course_id: 'api-777',
  holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, tee: pt(33.4 + i / 1000), green: pt(33.5 + i / 1000) })),
  fetched_at: Date.now(),
  pipeline_version: 3,
};

const realFetch = global.fetch;
afterEach(async () => { global.fetch = realFetch; await purgeCourseGeometry(); await AsyncStorage.clear(); });

describe('a map from a superseded pipeline', () => {
  it('THE BUG: is not returned when the rebuild fails (no signal)', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(v3map));
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
    const got = await fetchCourseGeometry('api-777');
    expect((got as { pipeline_version?: number } | null)?.pipeline_version).not.toBe(3);
  });

  it('THE BUG: is not returned when the rebuild answers 503', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(v3map));
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const got = await fetchCourseGeometry('api-777');
    expect((got as { pipeline_version?: number } | null)?.pipeline_version).not.toBe(3);
  });

  it('is still deleted from disk, as before', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(v3map));
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
    await fetchCourseGeometry('api-777');
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});
