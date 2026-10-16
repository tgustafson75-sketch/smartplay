/**
 * 2026-10-15 (review) — A READ FAILURE ERASED THE WHOLE ROUND HISTORY.
 *
 * services/ssrSafeStorage's getItem caught any read error and called removeItem on the key. For
 * 'round-store-v1' that is every past round and the live one. The realistic trigger is size, not
 * corruption: Android's ~2MB per-row CursorWindow read limit (AsyncStorage 2.2.0, no window-size
 * config). And the history compaction meant to stay under that limit was count-based (50 full
 * rounds) — measured here, 50 realistic rounds are well over 2MB.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPersistStorage } from '../../services/ssrSafeStorage';
import { useRoundStore } from '../../store/roundStore';

// A voice-logged shot as conversationalLoggingOrchestrator writes it (GPS + weather), ~0.9KB.
const shot = (h: number, i: number, r: number) => ({
  id: `voice-${1760000000000 + r * 100000 + h * 1000 + i}`, feel: 'solid', direction: 'straight', shape: null,
  club: '7i', hole: h, timestamp: 1760000000000 + r * 100000 + h * 1000 + i, acousticContact: null,
  distance_yards: 152, raw_utterance: 'hit a seven iron pretty solid just right of the flag',
  logged_via: 'voice', gps_location: { lat: 33.724012345, lng: -116.965012345 },
  start_location: { lat: 33.724012345, lng: -116.965012345 }, end_location: { lat: 33.725012345, lng: -116.966012345 },
  hole_number: h, shot_in_round_index: i, outcome: 'clean', penalty_strokes: 0,
  weather_snapshot: { temp_f: 72.4, humidity: 41, pressure_hpa: 1013.2, station_pressure_hpa: 980.1, wind_speed_mph: 7.3, wind_direction_deg: 240, wind_gust_mph: 12.1, conditions: 'Clouds', description: 'scattered clouds', timestamp: 1760000000000 },
  pre_shot_dwell_ms: 21000, gps_distance_yards: 151, kevin_rec_club: '7i', kevin_rec_shape: 'straight', kevin_adhered: true, shot_in_hole_index: 1,
});
// A bogey golfer's 18: 90 strokes, 36 putts → 54 logged full shots.
const round = (r: number) => {
  const shots: unknown[] = []; let i = 0;
  for (let h = 1; h <= 18; h++) for (let k = 0; k < 3; k++) shots.push(shot(h, i++, r));
  const scores: Record<number, number> = {}, putts: Record<number, number> = {}, pars: Record<number, number> = {};
  for (let h = 1; h <= 18; h++) { scores[h] = 5; putts[h] = 2; pars[h] = 4; }
  return {
    id: `r${r}`, roundNumber: r, courseName: 'Some Course GC', courseId: 'abc', startedAt: 1, endedAt: 2,
    holesPlayed: 18, totalScore: 90, scoreVsPar: 18, isCompetition: false, nineHoleMode: false, mode: 'real',
    scores, putts, holePars: pars, shots,
    holeStats: Array.from({ length: 18 }, (_, k) => ({ hole: k + 1, score: 5, putts: 2, penalties: 0, fairwayHit: null, girHit: false })),
  };
};

describe('a persisted value that cannot be read is never deleted', () => {
  beforeAll(() => { (globalThis as { window?: unknown }).window = {}; });
  afterAll(() => { delete (globalThis as { window?: unknown }).window; });
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('a read that THROWS (the CursorWindow case) leaves the value on disk', async () => {
    await AsyncStorage.setItem('round-store-v1', '{"state":{"roundHistory":[1,2,3]},"version":1}');
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('Row too big to fit into CursorWindow'));
    await expect(getPersistStorage().getItem('round-store-v1')).resolves.toBeNull();
    spy.mockRestore();
    await expect(AsyncStorage.getItem('round-store-v1')).resolves.toBe('{"state":{"roundHistory":[1,2,3]},"version":1}');
  });

  it('an unparseable value is moved to quarantine, not dropped', async () => {
    await AsyncStorage.setItem('round-store-v1', '{"state":{"shots":[{"hole":1,');
    await expect(getPersistStorage().getItem('round-store-v1')).resolves.toBeNull();
    await expect(AsyncStorage.getItem('round-store-v1::quarantine')).resolves.toBe('{"state":{"shots":[{"hole":1,');
  });
});

describe('the round-store row stays well under the 2MB read limit', () => {
  it('60 realistic rounds persist under 1.5MB, with the newest rounds still in full detail', () => {
    const rounds = Array.from({ length: 60 }, (_, r) => round(r));
    // The premise, measured: what the old count rule kept (50 full rounds) is over the limit.
    expect(JSON.stringify(rounds.slice(-50)).length).toBeGreaterThan(2_000_000);

    useRoundStore.setState({ roundHistory: rounds } as never);
    const opts = (useRoundStore as unknown as { persist: { getOptions: () => { partialize: (s: unknown) => unknown } } }).persist.getOptions();
    const persisted = opts.partialize(useRoundStore.getState()) as { roundHistory: ReturnType<typeof round>[] };
    const row = JSON.stringify({ state: persisted, version: 1 });
    expect(Buffer.byteLength(row)).toBeLessThan(1_500_000);

    const kept = persisted.roundHistory;
    expect(kept[kept.length - 1].shots.length).toBe(54);       // newest keeps its shots
    expect(kept[0].shots.length).toBe(0);                      // oldest compacted
    // compaction never touches the scoring essentials
    expect(kept[0].scores).toEqual(rounds[0].scores);
    expect(kept[0].putts).toEqual(rounds[0].putts);
    expect(kept[0].holePars).toEqual(rounds[0].holePars);
  });
});
