/**
 * 2026-09-21 — TWO WAYS TODAY'S WATCH WORK COULD HAVE LIED, ONE OF WHICH WOULD HAVE SHIPPED.
 *
 * 1. "Watch connected." FROM A QUERY THAT CANNOT KNOW IT.
 *
 *    `getConnectedNodeCount` is a NodeClient query — it counts PAIRED Wear nodes, not nodes
 *    running the SmartPlay watch app. The Kotlin says so and explains why CapabilityClient was
 *    rejected. So the answer is trustworthy in ONE direction: `false` means nothing is paired and
 *    therefore nothing is reachable; `true` means only that a watch exists nearby.
 *
 *    The merge resolution read `(watchConnected || watchReach === true) ? ' Watch connected.'`,
 *    which told a player with a paired watch who had never opened the watch app that everything
 *    was fine — exactly the blank-wrist confusion the sprint was spent removing. It would have
 *    gone live in build 28+, where the native method first exists.
 *
 * 2. THE BACK-COMPAT GUARD WAS A SOURCE-TEXT GREP.
 *
 *    the-watch-command-path-exists-on-both-ends asserted the literal line
 *    `if (!NativeMod?.getConnectedNodeCount) return null;`. That passes on a reworded guard and
 *    fails on a semantically identical rewrite — it pins characters, not behaviour. The runtime
 *    question is whether an OLD shell (builds 17-27, and every iOS build, where the method does
 *    not exist at all) gets `null` rather than a throw. This drives it.
 *
 *    WHAT THIS PINS AND WHAT IT DOES NOT, established by break-testing rather than assumed:
 *    removing the `?.getConnectedNodeCount` check does NOT fail these tests, because calling an
 *    absent method throws a TypeError that watchReachable's own catch already turns into `null`.
 *    The two implementations are indistinguishable from outside, so no test can separate them —
 *    the optional-method check is defence in depth, not the thing keeping old shells alive. The
 *    OUTCOME is the invariant worth pinning, and it is what these assert: null, never a throw,
 *    never a fabricated boolean. Anyone tightening this should not expect a guard on that literal
 *    line to mean more than it does. [[guards-that-copy-the-line-they-guard]]
 */

describe('only proven traffic may claim a watch is connected', () => {
  const read = () => require('fs').readFileSync(
    require('path').join(__dirname, '../../app/settings.tsx'), 'utf8');

  it('the toggle description never infers "connected" from reachability', () => {
    const src = read();
    const line = src.split('\n').find((l: string) => l.includes("' Watch connected.'"));
    expect(line).toBeDefined();
    // reachability may gate the NEGATIVE, never the positive claim.
    expect(line).not.toMatch(/watchReach === true\s*\)?\s*\?\s*' Watch connected/);
    expect(line).toMatch(/watchConnected \? ' Watch connected\./);
  });

  it('a false reachability reading is still allowed to say nothing is there', () => {
    expect(read()).toMatch(/watchReach === false \?/);
  });
});

/**
 * The behavioural half. Mocks the native module the way an OLD BINARY actually presents it —
 * present, but without the method — and asserts the JS degrades to "cannot ask" rather than
 * throwing or inventing an answer.
 */
describe('watchReachable() on a shell that predates the native method', () => {
  afterEach(() => { jest.resetModules(); });

  const withNativeModule = (mod: Record<string, unknown> | null) => {
    jest.resetModules();
    jest.doMock('react-native', () => {
      const actual = jest.requireActual('react-native');
      return { ...actual, NativeModules: { ...actual.NativeModules, WearSwingBridge: mod } };
    });
    return require('../../services/watchCaddieBridge');
  };

  it('returns null when the module exists but the method does not (builds 17-27, all iOS)', async () => {
    const bridge = withNativeModule({ sendToWatch: jest.fn(), addListener: jest.fn(), removeListeners: jest.fn() });
    await expect(bridge.watchReachable()).resolves.toBeNull();
  });

  it('returns null when there is no native module at all', async () => {
    const bridge = withNativeModule(null);
    await expect(bridge.watchReachable()).resolves.toBeNull();
  });

  it('returns null when the query REJECTS — a failed query is not an absent watch', async () => {
    const bridge = withNativeModule({
      getConnectedNodeCount: jest.fn().mockRejectedValue(new Error('data layer wedged')),
      sendToWatch: jest.fn(), addListener: jest.fn(), removeListeners: jest.fn(),
    });
    await expect(bridge.watchReachable()).resolves.toBeNull();
  });

  it('reports true only when a node is actually counted', async () => {
    const bridge = withNativeModule({
      getConnectedNodeCount: jest.fn().mockResolvedValue(1),
      sendToWatch: jest.fn(), addListener: jest.fn(), removeListeners: jest.fn(),
    });
    await expect(bridge.watchReachable()).resolves.toBe(true);
  });
});
