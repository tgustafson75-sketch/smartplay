/**
 * 2026-09-17 (Tim, launch night) — "make sure the initial tutorials are set up and that What's New
 * doesn't go out until the second load, or after the OTAs are effective."
 *
 * Checking that turned up a live bug rather than a timing question, and it had been shipping since
 * 2026-09-03.
 *
 * `seenCount` defaults to WHATS_NEW.length so a fresh install is not met with a patch-notes dump
 * about a product it has never used. Correct intent. But zustand's persist middleware writes on a
 * state CHANGE, and a launch that only READS the initial state never causes one — so nothing was
 * ever written to storage, and the default was re-evaluated against whichever bundle was running,
 * every launch. Being by definition equal to WHATS_NEW.length, it made the unseen count
 * permanently ZERO.
 *
 * So What's New was dead for every fresh install: no Tools badge, no Play-tab hero card, not on the
 * second launch, not after any OTA. Only players carrying a seenCount stored BEFORE 09-03 ever saw
 * one — precisely the population the feature was tested on, which is why it looked healthy.
 *
 * The OTA case below is the one that matters tonight: build 27 is in both stores, and the next OTA
 * adds entries. A player who installs today must see those, and must not see the 90-odd that
 * predate them.
 */

/**
 * TWO THINGS THIS FILE HAS TO DO BEFORE IT CAN TEST ANYTHING, both of which silently produced a
 * green-looking nothing on the first attempt:
 *
 *  - `window` must exist. services/ssrSafeStorage decides `isServer()` by `typeof window ===
 *    'undefined'`, and in the node logic project it IS undefined — so every persisted store gets
 *    noopStorage, reads null and writes nowhere. A persistence test without this asserts on a store
 *    that was never persisting.
 *  - the AsyncStorage mock needs a `default` export, because that is how ssrSafeStorage imports it.
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

const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, title: `t${i}` }));

/** One cold app launch running a bundle whose changelog has `count` entries. */
async function launch(count: number): Promise<number> {
  let unseen = 0;
  await jest.isolateModulesAsync(async () => {
    jest.doMock('../../services/knowledgeBase/whatsNew', () => ({ WHATS_NEW: entries(count) }));
    const mod = require('../../store/whatsNewStore') as typeof import('../../store/whatsNewStore');
    await mod.useWhatsNewStore.persist.rehydrate();
    await new Promise((r) => setTimeout(r, 10));
    unseen = mod.unseenWhatsNewCount();
  });
  return unseen;
}

const wipe = () => { for (const k of Object.keys(storage)) delete storage[k]; };

describe("What's New survives the bundle it was installed with", () => {
  beforeEach(wipe);

  it('a fresh install sees nothing — it has no history to have missed', async () => {
    expect(await launch(96)).toBe(0);
  });

  it('and the baseline is actually WRITTEN, not just defaulted', async () => {
    // The whole bug in one assertion: storage stayed `{}`, so there was no baseline to compare
    // against later and the count could only ever be zero.
    await launch(96);
    expect(Object.keys(storage)).toContain('whats-new-v1');
    expect(JSON.parse(storage['whats-new-v1']).state.seenCount).toBe(96);
  });

  it('entries added by an OTA after install DO show', async () => {
    await launch(96);            // launch 1 — embedded bundle, store build 27
    expect(await launch(98)).toBe(2);  // launch 2 — OTA applied, two entries added
  });

  it('and they keep showing until the player opens the panel', async () => {
    await launch(96);
    expect(await launch(98)).toBe(2);
    expect(await launch(98)).toBe(2);
  });

  it('an existing tester keeps their real progress — the baseline must not overwrite it', async () => {
    // Someone mid-changelog from before the flag existed: a stored seenCount, no baselineStamped.
    storage['whats-new-v1'] = JSON.stringify({ state: { seenCount: 30 }, version: 0 });
    expect(await launch(96)).toBe(66);
    // ...and still, on the next launch, rather than being quietly re-baselined to zero.
    expect(await launch(96)).toBe(66);
  });

  it('a player who reads the panel goes back to zero and stays there across an OTA-less launch', async () => {
    await launch(96);
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../services/knowledgeBase/whatsNew', () => ({ WHATS_NEW: entries(98) }));
      const mod = require('../../store/whatsNewStore') as typeof import('../../store/whatsNewStore');
      await mod.useWhatsNewStore.persist.rehydrate();
      await new Promise((r) => setTimeout(r, 10));
      mod.useWhatsNewStore.getState().markAllSeen();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(await launch(98)).toBe(0);
  });
});
