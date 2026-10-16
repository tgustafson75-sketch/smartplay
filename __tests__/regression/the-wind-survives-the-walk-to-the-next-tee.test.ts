/**
 * 2026-10-15 (offline audit gap #2) — the weather cache was keyed by a ~100m bucket of the player's
 * CURRENT fix, so walking to the next tee missed a reading taken minutes earlier and every offline
 * reader (plays-like, club call, brain context) lost the wind. After a cold start with no signal only
 * the exact bucket was ever loaded from disk.
 *
 * Rules pinned here: same course (≤1.5km) + same 30 minutes = same weather, for everyone. Older than
 * 30 minutes is used ONLY by the offline wind answer, only on proven-offline, and said with its age —
 * never folded silently into a plays-like number.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWeatherAt, getCachedWeatherEvenIfStale, _clearWeatherCache } from '../../services/weatherService';
import { useConnectivityStore } from '../../store/connectivityStore';
// Loaded loosely so the pre-fix code fails on behaviour, not on a missing export.
const lastKnownWindOffline = ((require('../../services/weatherService') as Record<string, unknown>).lastKnownWindOffline
  ?? (() => null)) as (loc: { lat: number; lng: number }) => { ageMinutes: number } | null;

const TEE_1 = { lat: 33.4958, lng: -117.2261 };
const TEE_4 = { lat: 33.5010, lng: -117.2261 }; // ~580m away, same course
const OTHER_TOWN = { lat: 33.5200, lng: -117.2261 }; // ~2.7km away

let clock = 10_000_000;
let nowSpy: jest.SpyInstance<number, []>;
beforeEach(async () => {
  clock = 10_000_000;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  _clearWeatherCache();
  await AsyncStorage.clear();
  useConnectivityStore.setState({ isOnline: true, consecutiveFailures: 0 });
  global.fetch = jest.fn(async () => new Response(JSON.stringify({
    temp_f: 68, humidity: 40, pressure_hpa: 1015, wind_speed_mph: 12, wind_direction_deg: 270,
    wind_gust_mph: null, conditions: 'Clear', description: 'clear sky', timestamp: clock,
  }), { status: 200 })) as unknown as typeof fetch;
});
afterEach(() => nowSpy.mockRestore());
const minutes = (m: number) => { clock += m * 60_000; };

describe('the wind on the next tee', () => {
  it('THE BUG: a reading from the last tee, 5 minutes ago, is still the wind', async () => {
    await fetchWeatherAt(TEE_1);
    minutes(5);
    expect(getCachedWeatherEvenIfStale(TEE_4)?.wind_speed_mph).toBe(12);
  });

  it('not from another town', async () => {
    await fetchWeatherAt(TEE_1);
    expect(getCachedWeatherEvenIfStale(OTHER_TOWN)).toBeNull();
  });

  it('the 30-minute limit for plays-like is unchanged — online or offline', async () => {
    await fetchWeatherAt(TEE_1);
    minutes(40);
    expect(getCachedWeatherEvenIfStale(TEE_1)).toBeNull();
    useConnectivityStore.setState({ isOnline: false });
    expect(getCachedWeatherEvenIfStale(TEE_1)).toBeNull();
  });

  it('THE BUG: after a cold start with no signal, a reading saved on the next tee is found', async () => {
    await fetchWeatherAt(TEE_1);
    _clearWeatherCache(); // the app was killed; the reading is only on disk now
    minutes(5);
    getCachedWeatherEvenIfStale(TEE_4); // first read kicks the one-time load
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(getCachedWeatherEvenIfStale(TEE_4)?.wind_speed_mph).toBe(12);
  });
});

describe('the offline wind answer', () => {
  it('PROVEN offline: an hour-old reading answers, with its age', async () => {
    await fetchWeatherAt(TEE_1);
    minutes(65);
    useConnectivityStore.setState({ isOnline: false });
    expect(lastKnownWindOffline(TEE_4)).toMatchObject({ ageMinutes: 65 });
  });

  it('online it does not — a fresh fetch is the honest answer there', async () => {
    await fetchWeatherAt(TEE_1);
    minutes(65);
    expect(lastKnownWindOffline(TEE_4)).toBeNull();
  });

  it('never older than 3 hours', async () => {
    await fetchWeatherAt(TEE_1);
    minutes(181);
    useConnectivityStore.setState({ isOnline: false });
    expect(lastKnownWindOffline(TEE_1)).toBeNull();
  });
});
