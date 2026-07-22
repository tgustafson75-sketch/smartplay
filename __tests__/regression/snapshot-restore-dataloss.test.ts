/**
 * REGRESSION — QA audit 2026-07-21, finding #1 (HIGH, data-loss).
 *
 * Bug: applySnapshot() (the single restore primitive for cloud/server/local-file
 * restore) special-cased ONLY 'round-store-v1' for union-with-local. Every other
 * grow-mostly learned store (caddie-memory, club-stats, practice, family, …) was
 * blind-overwritten by AsyncStorage.multiSet, so a Restore silently destroyed
 * offline-accumulated data by replacing it with an older, emptier cloud copy.
 *
 * Guard: on restore, a near-empty incoming grow-mostly blob must NOT clobber a
 * meaningfully richer on-device blob — parity with the upload-side unionSnapshots.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applySnapshot } from '../../services/cloudSync/snapshot';

beforeEach(async () => {
  await AsyncStorage.clear();
});

// A rich local blob is one with more learned content ⇒ longer serialized JSON.
const rich = (entries: number) =>
  JSON.stringify({ state: { tendencies: Array.from({ length: entries }, (_, i) => ({ id: i, note: `learned-${i}` })) }, version: 0 });
const sparse = JSON.stringify({ state: { tendencies: [] }, version: 0 });

describe('applySnapshot — grow-mostly restore protection (finding #1)', () => {
  it('does NOT overwrite a richer local learned store with an emptier cloud copy', async () => {
    const localRich = rich(50);
    await AsyncStorage.setItem('caddie-memory-v1', localRich);
    await AsyncStorage.setItem('club-stats-v1', localRich);

    // Cloud snapshot is older/emptier (the reinstall-elsewhere / stale-backup case).
    await applySnapshot({ 'caddie-memory-v1': sparse, 'club-stats-v1': sparse });

    expect(await AsyncStorage.getItem('caddie-memory-v1')).toBe(localRich);
    expect(await AsyncStorage.getItem('club-stats-v1')).toBe(localRich);
  });

  it('DOES apply the cloud copy onto a fresh/empty device (normal reinstall restore)', async () => {
    const cloud = rich(50);
    // No local value (fresh install).
    await applySnapshot({ 'caddie-memory-v1': cloud });
    expect(await AsyncStorage.getItem('caddie-memory-v1')).toBe(cloud);
  });

  it('applies a cloud copy that is genuinely richer than the local copy', async () => {
    await AsyncStorage.setItem('club-bag-v1', rich(2));
    const richerCloud = rich(80);
    await applySnapshot({ 'club-bag-v1': richerCloud });
    expect(await AsyncStorage.getItem('club-bag-v1')).toBe(richerCloud);
  });

  it('still unions round history rather than dropping local-only offline rounds', async () => {
    const local = JSON.stringify({ state: { roundHistory: [{ id: 'A', endedAt: 100, shots: [1, 2] }] }, version: 0 });
    const cloud = JSON.stringify({ state: { roundHistory: [{ id: 'B', endedAt: 90, shots: [1] }] }, version: 0 });
    await AsyncStorage.setItem('round-store-v1', local);

    await applySnapshot({ 'round-store-v1': cloud });

    const merged = JSON.parse((await AsyncStorage.getItem('round-store-v1'))!);
    const ids = merged.state.roundHistory.map((r: any) => r.id).sort();
    expect(ids).toEqual(['A', 'B']); // local-only round A preserved, cloud round B added
  });
});
