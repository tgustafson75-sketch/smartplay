/**
 * 2026-09-09 (Tim, first round on the Play Store build — "the yardage would not populate on my
 * watch") — A FEATURE GATED BEHIND AN UNRELATED TOGGLE THAT DEFAULTS OFF.
 *
 * `app/_layout.tsx` started BOTH watch bridges behind one early return:
 *
 *     if (!useSettingsStore.getState().watchSwingEnabled) return;
 *
 * `watchSwingEnabled` is the Galaxy Watch SWING-IMU setting — labelled "swing capture", described
 * only in terms of capturing swings. It also silently controlled pin yardage, the watch mic, watch
 * taps and the round-state/score push: four features it does not name, behind a switch nobody would
 * think to look under.
 *
 * It defaults to FALSE and is persisted per install. Tim's dev build carried a toggle he had flipped
 * on months earlier; a Play Store install starts with empty storage, so `initWatchCaddieBridge()`
 * never ran and the watch sat blank for a whole round. "It worked until it was on the Play Store" is
 * precisely what a persisted-default-off gate looks like from the outside — nothing about the build
 * changed, only the storage it started from.
 *
 * The second half is that NONE of it could be diagnosed: `sendToWatch` resolves FALSE when no watch
 * node is connected and the result was discarded, so "never tried", "nothing to send" and "sent to
 * nobody" were one blank screen with no trace. Three different fixes, one symptom.
 *
 * [[orphans-are-live-bugs-not-dead-code]] [[missing-log-entry-is-the-evidence]]
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
/** Prose naming a thing is not the code doing it — the lesson run-sim.ts wrote down on 08-31. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the caddie bridge does not ride the swing-capture toggle', () => {
  const layout = code('app/_layout.tsx');

  it('no early return puts watchSwingEnabled in front of BOTH bridges', () => {
    expect(layout).not.toContain('if (!useSettingsStore.getState().watchSwingEnabled) return;');
  });

  it('swing capture stays opt-in — it costs watch battery and is a real choice', () => {
    expect(layout).toContain('const swingCaptureEnabled = useSettingsStore.getState().watchSwingEnabled;');
    expect(layout).toMatch(/if \(swingCaptureEnabled\) \{[\s\S]{0,200}?initWatchSwingBridge\(\)/);
  });

  it('the caddie bridge starts on module availability alone', () => {
    // Not nested inside the swing-capture branch.
    const caddieAt = layout.indexOf('initWatchCaddieBridge()');
    const branchAt = layout.indexOf('if (swingCaptureEnabled)');
    expect(caddieAt).toBeGreaterThan(-1);
    const between = layout.slice(branchAt, caddieAt);
    // The swing-capture block must have closed before the caddie bridge is reached.
    expect(between).toContain('}');
    expect(layout).toContain('if (active && c.isWatchCaddieBridgeAvailable()) await c.initWatchCaddieBridge();');
  });

  it('the toggle still defaults off — this fix is decoupling, not switching a feature on', () => {
    expect(code('store/settingsStore.ts')).toContain('watchSwingEnabled: false,');
  });
});

describe('a yardage that does not arrive says why', () => {
  const bridge = code('services/watchCaddieBridge.ts');

  it.each([
    ['no_native_module'],
    ['no_active_round'],
    ['no_connected_node'],
  ])('traces the %s case', (reason) => {
    expect(bridge).toContain(reason);
  });

  it('honours the native result instead of discarding it', () => {
    // sendToWatch resolves false when connectedNodes is empty — a pairing problem, not a yardage one.
    expect(bridge).toContain('const delivered = await NativeMod.sendToWatch(CADDIE_PATH, JSON.stringify(payload));');
    expect(bridge).toContain('if (delivered === false)');
    expect(bridge).toContain("traceWatch('yardage_undelivered'");
  });

  it('carries the yardage funnel’s OWN reason rather than restating that numbers were absent', () => {
    // getGreenYardagesSync already distinguishes no_fix / no_hole / no_green_coords.
    expect(bridge).toContain('reason: y.reason ?? ');
  });

  it('a delivered push proves the watch is alive, and an undelivered one un-proves it', () => {
    expect(bridge).toContain('markWatchAlive();');
    expect(bridge).toContain('setConnected(false, watchDeviceLabel())');
  });
});

describe('the settings row no longer implies the toggle owns yardage', () => {
  it('says pin yardage and the mic do not need it', () => {
    expect(read('app/settings.tsx')).toContain('Pin yardage and the watch mic do not need this');
  });
});
