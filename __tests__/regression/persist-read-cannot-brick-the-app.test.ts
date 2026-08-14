/**
 * 2026-08-14 (Tim's round) — the app opened to a white screen with no splash greeting, taps landed but
 * nothing responded, and rolling the OTA back changed nothing. That last part is the tell: the fault
 * was on the DEVICE, not in the bundle.
 *
 * services/ssrSafeStorage guarded setItem and left getItem unguarded. One unreadable or truncated
 * persisted value made rehydration reject, and app/_layout.tsx gates EIGHT effects behind
 * whenRoundStoreHydrated() — greeting, round lifecycle, GPS. Hydration never reports finished, none of
 * them run, the shell paints and nothing behind it is alive.
 *
 * 49 stores share this adapter, so any one of them could take the whole app down.
 *
 * A store that cannot read its state must start EMPTY. These are behavioural: a lexical check would
 * not prove the corrupt value is actually survivable.
 */
import { getPersistStorage } from '../../services/ssrSafeStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('a bad persisted value can never brick the app', () => {
  // getPersistStorage() returns a NOOP adapter when `window` is undefined (the SSR guard), and jest
  // runs in node — so without this the tests exercise a stub that returns null for everything and
  // pass while proving nothing. Found exactly that way: two of these went green against the noop.
  beforeAll(() => { (globalThis as { window?: unknown }).window = {}; });
  afterAll(() => { delete (globalThis as { window?: unknown }).window; });
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('MALFORMED json (the half-written record) returns null instead of throwing', async () => {
    // A round saved while Android was reclaiming memory: AsyncStorage is not atomic across a kill.
    await AsyncStorage.setItem('round-store-v1', '{"state":{"shots":[{"hole":1,');
    const store = getPersistStorage();
    await expect(store.getItem('round-store-v1')).resolves.toBeNull();
  });

  it('and it DROPS the poison, so the next launch is clean rather than failing forever', async () => {
    await AsyncStorage.setItem('round-store-v1', 'not json at all');
    const store = getPersistStorage();
    await store.getItem('round-store-v1');
    // The value that could not be read must not survive to poison every future launch — that is what
    // made this unrecoverable from inside the app.
    await expect(AsyncStorage.getItem('round-store-v1')).resolves.toBeNull();
  });

  it('a READ THROWING (not just bad json) also degrades instead of rejecting', async () => {
    const store = getPersistStorage();
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('SQLITE_FULL'));
    await expect(store.getItem('any-store')).resolves.toBeNull();
    spy.mockRestore();
  });

  it('VALID state still round-trips untouched — the guard must not cost normal launches', async () => {
    const good = JSON.stringify({ state: { isRoundActive: true }, version: 1 });
    await AsyncStorage.setItem('round-store-v1', good);
    const store = getPersistStorage();
    await expect(store.getItem('round-store-v1')).resolves.toBe(good);
    // and it is NOT removed
    await expect(AsyncStorage.getItem('round-store-v1')).resolves.toBe(good);
  });
});
