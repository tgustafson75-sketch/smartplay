/**
 * 2026-09-29 — the tee-time rate category joined player-profile-v2 WITHOUT a version bump, on the
 * premise that persist merges a stored blob over the initial state. A premise is a thing to prove:
 * a blob written by 1.0.2 (no `rateCategory`) must rehydrate to 'none' with every other field
 * intact, and a written category must survive a cold launch.
 *
 * `window` must exist or services/ssrSafeStorage hands every store a no-op storage and this would
 * assert on a store that never persisted (see whats-new-must-survive-the-ota).
 */
(globalThis as { window?: unknown }).window = globalThis;

const storage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => storage[k] ?? null,
    setItem: async (k: string, v: string) => { storage[k] = v; },
    removeItem: async (k: string) => { delete storage[k]; },
  },
}));

async function coldLaunch(): Promise<Record<string, unknown>> {
  let state: Record<string, unknown> = {};
  await jest.isolateModulesAsync(async () => {
    const mod = require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore');
    await mod.usePlayerProfileStore.persist.rehydrate();
    state = mod.usePlayerProfileStore.getState() as unknown as Record<string, unknown>;
  });
  return state;
}

describe('the rate category survives persistence', () => {
  it('a 1.0.2 profile with no rateCategory rehydrates to none, and keeps everything else', async () => {
    storage['player-profile-v2'] = JSON.stringify({
      state: { name: 'Tim', handicap: 14, currentBall: 'Pro V1', preferredTee: 'back', homeCourses: [] },
      version: 5,
    });
    const s = await coldLaunch();
    expect(s.rateCategory).toBe('none');
    expect(s.name).toBe('Tim');
    expect(s.currentBall).toBe('Pro V1');
    expect(s.preferredTee).toBe('back');
  });

  it('a chosen category is written and read back on the next launch', async () => {
    storage['player-profile-v2'] = JSON.stringify({ state: { name: 'Tim', homeCourses: [] }, version: 5 });
    await jest.isolateModulesAsync(async () => {
      const mod = require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore');
      await mod.usePlayerProfileStore.persist.rehydrate();
      mod.usePlayerProfileStore.getState().setRateCategory('veteran_military');
      await new Promise((r) => setTimeout(r, 10));
    });
    const s = await coldLaunch();
    expect(s.rateCategory).toBe('veteran_military');
  });
});
