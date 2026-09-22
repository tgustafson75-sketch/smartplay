/**
 * 2026-09-09 (Tim: "write them now") — A FEATURE THAT ONLY EVER HAD A MIDDLE.
 *
 * `services/watchCaddieBridge` has subscribed to `onWatchCommand` since 2026-08-07 ("record button
 * on the watch to control SmartMotion record + stop"), routing four commands into the command bus.
 * The 72-hour audit found the phone's native module has no command path and never emits that event.
 * Checking the other end showed the watch never sent one either: the "Record swings" button starts
 * the watch's OWN sensor service and talks to nobody.
 *
 * So both ends were missing and only the middle was written. The JS handler could not fire under any
 * circumstances — not a race, not a config problem, simply unreachable code that read as a shipped
 * feature. [[orphans-are-live-bugs-not-dead-code]]
 *
 * These are NATIVE files: they cannot ride an OTA, and `scripts/ota-preflight.mjs` now refuses to let
 * them try. They ship in the next store build.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const phone = read('android-native/WearSwingBridgeModule.kt');
const watch = read('wear-os-app/app/src/main/java/com/smartplaycaddie/wear/MainActivity.kt');
const js = read('services/watchCaddieBridge.ts');

describe('the command path is complete end to end', () => {
  it('the watch SENDS a command', () => {
    expect(watch).toContain('private const val COMMAND_PATH = "/smartplay/command"');
    expect(watch).toContain('sendToPhone(COMMAND_PATH,');
  });

  it('the phone ROUTES that path and emits the event JS listens for', () => {
    expect(phone).toContain('private val commandPath = "/smartplay/command"');
    expect(phone).toContain('commandPath -> emitCommand(event)');
    expect(phone).toContain('emit("onWatchCommand", payload)');
  });

  it('JS still listens for it — the end that was already there', () => {
    expect(js).toContain("emitter.addListener('onWatchCommand'");
  });

  it('the three paths agree on the literal, which is the whole contract', () => {
    const literal = '"/smartplay/command"';
    expect(phone).toContain(literal);
    expect(watch).toContain(literal);
  });

  /**
   * 2026-09-21 — DERIVED, not hardcoded. This asserted the literal "smartmotion_toggle", so the day
   * the watch started sending a different verb ("smartmotion_countdown", when the long-press became
   * a tap) the guard failed on a correct change while proving nothing about the new verb. Pinning
   * the value made it blind to the only thing that matters.
   *
   * The invariant was always: WHATEVER the watch sends on the command path, JS must handle. So the
   * verb is now read out of the Kotlin and checked against the whitelist — which means a verb added
   * to the watch tomorrow is covered on the day it lands, and one that JS silently ignores fails
   * here instead of on a wrist. [[guards-that-copy-the-line-they-guard]]
   */
  it('every command the watch sends is one JS actually handles', () => {
    const sent = [...watch.matchAll(/sendToPhone\(\s*COMMAND_PATH\s*,\s*"([a-z_]+)"/g)].map(m => m[1]);
    expect(sent.length).toBeGreaterThan(0);
    for (const verb of sent) expect(js).toContain(`c === '${verb}'`);
  });

  it('native forwards unknown commands rather than filtering — JS ships by OTA, this file does not', () => {
    // Whitelisting natively would mean a store build for every new command.
    expect(phone).not.toMatch(/commandPath[\s\S]{0,400}?(smartmotion_record|open_smartmotion)/);
  });

  /**
   * 2026-09-21 — RETIRED, because the thing it guarded no longer exists.
   *
   * This required the "hold -> SmartMotion" hint on the label in both capture states, on the
   * reasoning that an undiscoverable gesture is the same as no feature. That reasoning was right,
   * and Tim removed the gesture rather than the hint: "I hate long press, should just be tap".
   * One tap now starts the wrist capture and the phone's camera together, so there is no second
   * gesture to announce.
   *
   * Kept as a note rather than deleted so the next person does not re-add the hint from the git
   * history and wonder why nothing responds to a hold. The replacement invariant — that no
   * long-click handler is registered at all, and that the tap drives both ends — lives in
   * __tests__/regression/one-tap-records-both-ends.test.ts.
   */
  it('registers no long-press, because the gesture was removed rather than hidden', () => {
    expect(watch).not.toMatch(/setOnLongClickListener/);
  });
});

describe('reachability can be asked, not only discovered by failing', () => {
  it('the phone exposes a query that sends nothing', () => {
    expect(phone).toContain('fun getConnectedNodeCount(promise: Promise)');
    expect(phone).toContain('Wearable.getNodeClient');
  });

  it('Settings actually USES it — an unwired query is the orphan class all over again', () => {
    // The sim's orphan guard caught this one built-and-unconnected on its first run.
    const settings = read('app/settings.tsx');
    expect(settings).toContain('m.watchReachable()');
    expect(settings).toContain('watchReach === false');
    // ...and "cannot ask" must not render as "not connected".
    expect(settings).toContain('watchReach === true');
  });

  it('JS treats "cannot ask" as unknown, never as "not connected"', () => {
    // Older shells and iOS have no such method; an OTA reaches all of them.
    expect(js).toContain('getConnectedNodeCount?(): Promise<number>;');
    expect(js).toContain('if (!NativeMod?.getConnectedNodeCount) return null;');
    expect(js).toContain('export async function watchReachable(): Promise<boolean | null>');
  });
});
