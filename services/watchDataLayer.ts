/**
 * services/watchDataLayer.ts — ONE OWNER FOR THE NATIVE DATA LAYER LISTENER.
 *
 * 2026-09-09 (Tim: "make sure swing capture and yardage do not clash") — they did, in three ways,
 * and decoupling them on 09-09 is what made it matter.
 *
 * Both bridges resolve the SAME native module (`NativeModules.WearSwingBridge`) and the native
 * `start()`/`stop()` register and remove ONE `MessageClient.OnMessageReceivedListener` for the whole
 * app. Every inbound path rides it: `/smartplay/swing` (capture), `/smartplay/voice` (watch mic),
 * `/smartplay/tap`, and `/smartplay/hello` — the presence ping that is the only thing that fires
 * `onWatchConnection`.
 *
 * Only `watchSwingBridge` ever called `start()`, and it called `stop()` unconditionally on teardown.
 * So:
 *
 *   - with swing capture OFF, the caddie bridge had NO inbound at all — the watch mic and taps were
 *     dead and the watch could never announce itself, even though outbound yardage worked fine
 *     (sending needs no listener). Decoupling yardage without this would have fixed half a feature;
 *   - turning swing capture OFF mid-session removed the listener out from under a live caddie
 *     bridge, silently killing the mic for the rest of the session.
 *
 * Refcounted, because "who else still needs this" is not a question either bridge can answer about
 * the other. The native side is idempotent (`listening` is a flag), so the count is what makes
 * RELEASE safe — start was never the dangerous half. [[two-owners-is-the-root-cause]]
 */
import { NativeModules, Platform } from 'react-native';
import { devLog } from './devLog';

interface WearDataLayerModule {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

const NativeMod: WearDataLayerModule | null =
  Platform.OS === 'android' || Platform.OS === 'ios'
    ? ((NativeModules as Record<string, unknown>).WearSwingBridge as WearDataLayerModule | undefined) ?? null
    : null;

/** Who currently needs inbound watch messages. Keyed, so a double-acquire by one bridge is a no-op. */
const holders = new Set<string>();

/**
 * Register the inbound listener on behalf of `holder`. Idempotent per holder.
 * Resolves false when there is no native module (web, or a build without the watch target).
 */
/**
 * In-flight `start()`, shared by everyone who arrives while it is running.
 *
 * 2026-09-09 (triple-check, a defect in my own hours-old code) — without this, the SECOND acquirer
 * returned `true` the moment it saw a non-empty holder set, while the first was still awaiting
 * `start()`. If that start then FAILED, the first rolled its own holder back and the second was left
 * registered as a holder with no native listener behind it — `isWatchDataLayerListening()` reporting
 * true while nothing was listening. That lie is load-bearing now: the swing bridge consults it to
 * decide whether to clear the connected flag, so one failed start would have left Settings claiming
 * a watch that was not there and no inbound path to correct it.
 *
 * Everyone awaits the same attempt and gets the same answer.
 */
let starting: Promise<boolean> | null = null;

export async function acquireWatchDataLayer(holder: string): Promise<boolean> {
  if (!NativeMod) return false;
  holders.add(holder);
  if (starting) return starting;      // a start is in flight — share its outcome
  if (holders.size > 1) return true;  // already listening from an earlier, settled acquire
  starting = (async () => {
    try {
      await NativeMod.start();
      devLog(`[watchDataLayer] listening (first holder: ${holder})`);
      return true;
    } catch (e) {
      // Nobody is listening, so NOBODY may believe they are — clear every holder that joined while
      // this attempt was in flight, not just the one that started it.
      holders.clear();
      devLog(`[watchDataLayer] start failed: ${String(e)}`);
      return false;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

/**
 * Release `holder`. The native listener is removed ONLY when nobody is left — which is the whole
 * point: swing capture going off must not take the caddie bridge's mic with it.
 */
export async function releaseWatchDataLayer(holder: string): Promise<void> {
  if (!NativeMod) return;
  if (!holders.delete(holder)) return;
  if (holders.size > 0) {
    devLog(`[watchDataLayer] ${holder} released; ${holders.size} holder(s) remain — listener stays up`);
    return;
  }
  try {
    await NativeMod.stop();
    devLog('[watchDataLayer] listener removed (no holders left)');
  } catch (e) {
    devLog(`[watchDataLayer] stop failed: ${String(e)}`);
  }
}

/** Is the inbound listener up? Used to explain a silent watch rather than guess at one. */
export function isWatchDataLayerListening(): boolean {
  return holders.size > 0;
}

/** Test seam. Not called in app code. */
export function __resetWatchDataLayerForTest(): void {
  holders.clear();
}
