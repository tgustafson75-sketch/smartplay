/**
 * 2026-09-09 (Tim: "make sure swing capture and yardage do not clash") — THEY DID, THREE WAYS.
 *
 * Both bridges resolve the SAME native module and the native `start()`/`stop()` register and remove
 * ONE `MessageClient` listener for the whole app. Every inbound path rides it: `/smartplay/swing`,
 * `/smartplay/voice` (the watch mic), `/smartplay/tap`, and `/smartplay/hello` — the presence ping
 * that is the only thing that fires `onWatchConnection`.
 *
 *   1. Only watchSwingBridge ever called `start()`. So with swing capture off, the caddie bridge had
 *      NO inbound at all: outbound yardage worked (sending needs no listener) while the mic, taps and
 *      presence were dead. Decoupling yardage from the toggle without fixing this would have shipped
 *      half a feature that looked whole.
 *   2. `stopWatchSwingBridge` called `stop()` unconditionally, removing the listener out from under a
 *      live caddie bridge — and called `setConnected(false)`, declaring the watch gone while the
 *      caddie bridge was proving otherwise every 18 seconds.
 *   3. The Settings toggle called `stopWatchCaddieBridge()` on the way off, so switching off SWING
 *      CAPTURE also killed pin yardage — the exact coupling removed from `_layout.tsx`, living in a
 *      second file, able to re-break it with one tap.
 *
 * [[two-owners-is-the-root-cause]] [[no-half-fixes-enforce-every-surface]]
 */
import fs from 'fs';
import path from 'path';
/**
 * The native module is MOCKED rather than absent. Without it `acquireWatchDataLayer` short-circuits
 * and the refcount never populates, so a test on the real import would assert nothing while looking
 * like it passed — and the property under test (release does not steal the listener from the other
 * holder) is exactly the one that only exists when a module is there. Mocking also lets us prove the
 * native start/stop are called ONCE, which is the whole reason the count exists.
 */
const nativeStart = jest.fn(async () => {});
const nativeStop = jest.fn(async () => {});
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: { WearSwingBridge: { start: () => nativeStart(), stop: () => nativeStop() } },
}));

import {
  acquireWatchDataLayer, releaseWatchDataLayer, isWatchDataLayerListening, __resetWatchDataLayerForTest,
} from '../../services/watchDataLayer';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

beforeEach(() => {
  __resetWatchDataLayerForTest();
  nativeStart.mockClear();
  nativeStop.mockClear();
});

describe('the shared inbound listener is refcounted', () => {
  it('starts out unheld', () => {
    expect(isWatchDataLayerListening()).toBe(false);
  });

  it('registers the native listener ONCE, however many bridges want it', async () => {
    await acquireWatchDataLayer('swing');
    await acquireWatchDataLayer('caddie');
    expect(nativeStart).toHaveBeenCalledTimes(1);
    expect(nativeStop).not.toHaveBeenCalled();
  });

  it('removes it exactly once, and only when the last holder leaves', async () => {
    await acquireWatchDataLayer('swing');
    await acquireWatchDataLayer('caddie');
    await releaseWatchDataLayer('swing');
    expect(nativeStop).not.toHaveBeenCalled();   // the mic must survive capture going off
    await releaseWatchDataLayer('caddie');
    expect(nativeStop).toHaveBeenCalledTimes(1);
  });

  it('one bridge releasing does not take the listener from the other', async () => {
    await acquireWatchDataLayer('swing');
    await acquireWatchDataLayer('caddie');
    await releaseWatchDataLayer('swing');
    // The caddie bridge is still holding it — this is the mic staying alive when capture goes off.
    expect(isWatchDataLayerListening()).toBe(true);
    await releaseWatchDataLayer('caddie');
    expect(isWatchDataLayerListening()).toBe(false);
  });

  it('a double acquire by one holder is not a second claim', async () => {
    await acquireWatchDataLayer('caddie');
    await acquireWatchDataLayer('caddie');
    await releaseWatchDataLayer('caddie');
    expect(isWatchDataLayerListening()).toBe(false);
  });

  it('releasing something that never held it is a no-op, not an underflow', async () => {
    await acquireWatchDataLayer('caddie');
    await releaseWatchDataLayer('swing');
    expect(isWatchDataLayerListening()).toBe(true);
  });

  /**
   * 2026-09-09 (triple-check) — A FAILED START MUST LEAVE NOBODY BELIEVING THEY ARE LISTENING.
   *
   * The first version returned `true` to the second acquirer the instant it saw a non-empty holder
   * set, while the first was still awaiting start(). If that start failed, the first rolled back its
   * own holder and the second stayed registered with no listener behind it — and
   * isWatchDataLayerListening() is load-bearing now: the swing bridge asks it before clearing the
   * connected flag, so the lie would have left Settings claiming a watch nobody could hear.
   */
  it('a start that fails leaves NOBODY holding, including whoever joined mid-flight', async () => {
    nativeStart.mockRejectedValueOnce(new Error('no wearable api'));
    const both = await Promise.all([acquireWatchDataLayer('caddie'), acquireWatchDataLayer('swing')]);
    expect(both).toEqual([false, false]);
    expect(isWatchDataLayerListening()).toBe(false);
  });

  it('concurrent acquirers share ONE start, not one each', async () => {
    await Promise.all([acquireWatchDataLayer('caddie'), acquireWatchDataLayer('swing')]);
    expect(nativeStart).toHaveBeenCalledTimes(1);
    expect(isWatchDataLayerListening()).toBe(true);
  });
});

describe('a failed init never leaves a claim behind', () => {
  it('both bridges release on their init failure path', () => {
    // acquire runs early in initWatchCaddieBridge, so anything throwing after it used to leak the
    // holder forever: the listener could never be removed and isWatchDataLayerListening() lied.
    const caddie = code('services/watchCaddieBridge.ts');
    const caddieCatch = caddie.slice(caddie.indexOf("init failed"));
    expect(caddieCatch.slice(0, 400)).toContain("releaseWatchDataLayer('caddie')");
    const swing = code('services/watchSwingBridge.ts');
    expect(swing).toContain("releaseWatchDataLayer('swing')");
  });
});

describe('the yardage trace does not evict the evidence', () => {
  it('success is traced on CHANGE, failures every time', () => {
    // roundTrace is a 2000-row ring buffer; an 18s tick would have spent ~900 rows of a 4.5h round
    // on "nothing wrong", pushing out the GPS/voice/shot rows that diagnose something.
    const caddie = code('services/watchCaddieBridge.ts');
    expect(caddie).toContain('if (sentKey !== lastYardageSent)');
    expect(caddie).toContain("lastYardageSent = '';");
    // the failure paths stay unconditional
    expect(caddie).toContain("traceWatch('yardage_undelivered'");
    expect(caddie).toContain("traceWatch('yardage_error'");
  });
});

describe('neither bridge touches the native listener directly', () => {
  it('the swing bridge goes through the shared owner', () => {
    const swing = code('services/watchSwingBridge.ts');
    expect(swing).not.toContain('NativeMod.start()');
    expect(swing).not.toContain('NativeMod.stop()');
    expect(swing).toContain("acquireWatchDataLayer('swing')");
    expect(swing).toContain("releaseWatchDataLayer('swing')");
  });

  it('the caddie bridge CLAIMS it — it never used to, so its mic was never plugged in', () => {
    const caddie = code('services/watchCaddieBridge.ts');
    expect(caddie).toContain("acquireWatchDataLayer('caddie')");
    expect(caddie).toContain("releaseWatchDataLayer('caddie')");
  });

  it('swing capture going off does not declare the watch disconnected for everyone', () => {
    expect(code('services/watchSwingBridge.ts'))
      .toContain('if (!isWatchDataLayerListening()) useWatchStore.getState().setConnected(false);');
  });
});

describe('the Settings toggle owns swing capture and nothing else', () => {
  const settings = code('app/settings.tsx');

  it('turning it off does not stop the caddie bridge', () => {
    const off = settings.slice(settings.indexOf('void stopWatchSwingBridge()'));
    expect(off.slice(0, 300)).not.toContain('stopWatchCaddieBridge');
  });

  it('turning it on still ensures the bridge is up — init is idempotent', () => {
    expect(settings).toContain('initWatchCaddieBridge()');
  });
});

describe('a failed send does not flicker a live watch offline', () => {
  it('defers to the heartbeat before clearing the connected flag', () => {
    const caddie = code('services/watchCaddieBridge.ts');
    expect(caddie).toContain('WATCH_HEARTBEAT_GRACE_MS');
    expect(caddie).toContain('if (!heardRecently) w.setConnected(false, watchDeviceLabel());');
  });
});
