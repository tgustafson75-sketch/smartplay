/**
 * 2026-10-15 (offline audit) — GEOMETRY_PIPELINE_VERSION went 3→4 on 10-13. An old-pipeline map was
 * deleted from disk BEFORE its refetch, so the first open of a saved course with no signal lost the
 * map: the round had no yardages, and neither did any later launch. The fix keeps it until a fresh
 * build replaces it, serves it only when the fetch fails, and must never let it block that fresh build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchCourseGeometry, getHoleGeometry, purgeCourseGeometry } from '../../services/courseGeometryService';

const KEY = 'course-geometry-v3::api-777';
const green = (lat: number) => ({ lat, lng: -117.2 });
const hole = (n: number, withGreen = true) => ({ hole_number: n, tee: green(33.4 + n / 1000), green: withGreen ? green(33.5 + n / 1000) : null });
const geo = (pipeline: number | undefined, greens: number) => ({
  course_id: 'api-777',
  holes: Array.from({ length: 18 }, (_, i) => hole(i + 1, i < greens)),
  fetched_at: Date.now(),
  ...(pipeline != null ? { pipeline_version: pipeline } : {}),
});

const realFetch = global.fetch;
afterEach(async () => { global.fetch = realFetch; await purgeCourseGeometry(); await AsyncStorage.clear(); });

describe('an old-pipeline map with no signal', () => {
  it('THE BUG: is still served and still readable by the yardage path when the fetch fails', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(geo(3, 18)));
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
    const got = await fetchCourseGeometry('api-777');
    expect(got?.holes.filter((h) => h.green).length).toBe(18);
    expect(getHoleGeometry('api-777', 7)?.green).toEqual({ lat: 33.507, lng: -117.2 }); // the synchronous yardage reader
  });

  it('THE BUG: survives on disk for the next launch', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(geo(3, 18)));
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
    await fetchCourseGeometry('api-777');
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
  });

  it('is NOT served when a fresh build is reachable — and the corrected build replaces it even with fewer greens', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(geo(3, 18)));
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => geo(undefined, 16) })) as unknown as typeof fetch;
    const got = await fetchCourseGeometry('api-777');
    expect(got?.holes.filter((h) => h.green).length).toBe(16);
    const disk = JSON.parse((await AsyncStorage.getItem(KEY))!);
    expect(disk.pipeline_version).toBe(4);
    expect(disk.holes.filter((h: { green: unknown }) => h.green).length).toBe(16);
  });

  it('an EMPTY fresh build never replaces it', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(geo(3, 18)));
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => geo(undefined, 0) })) as unknown as typeof fetch;
    await fetchCourseGeometry('api-777');
    const disk = JSON.parse((await AsyncStorage.getItem(KEY))!);
    expect(disk.holes.filter((h: { green: unknown }) => h.green).length).toBe(18);
  });

  it('an old map with ZERO greens is still dropped (worthless at any version)', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(geo(3, 0)));
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
    await fetchCourseGeometry('api-777');
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});
