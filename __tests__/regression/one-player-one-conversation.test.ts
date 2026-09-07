/**
 * 2026-09-07 — from a fatal crash Tim found in Sentry (build 25, 2026-09-05 01:11, ~3.5s after
 * launch):
 *
 *   IllegalStateException: Player is accessed on the wrong thread.
 *   Current thread: 'pool-4-thread-1'  Expected thread: 'main'
 *   com.google.android.exoplayer2.ExoPlayerImpl.verifyApplicationThread
 *
 * ROOT CAUSE, in JS, not in the native lib. `activateMediaSession` guarded on `isRegistered` at its
 * top but only SET it ~50 lines and several awaits later. Two concurrent calls therefore both passed
 * the guard and both ran setupPlayer + reset + add against the same ExoPlayer from two different
 * async continuations. react-native-track-player resolves those on a pool thread; ExoPlayer demands
 * main. That is the exception, verbatim.
 *
 * Boot is exactly where they collide: whenRoundStoreHydrated fires one activate, and the roundStore
 * subscription can fire another the moment isRoundActive settles during hydration.
 *
 * The second hole was quieter and worse. `deactivateMediaSession` returned early on `!isRegistered`,
 * which is TRUE for the whole duration of an in-flight activation — so a deactivate arriving
 * mid-activate did nothing, left a registered session nothing would clean up, and the next activate
 * raced the leftover.
 *
 * A check-then-act guard across an await is not a guard. These lock the shape rather than the
 * symptom, because the symptom is a native crash on a device this test cannot reach.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '../../services/mediaKeyBridge.ts'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('two callers share one activation', () => {
  it('holds the in-flight activation so a second caller joins it', () => {
    expect(code).toContain('let activation: Promise<void> | null = null;');
    expect(code).toContain('if (activation) return activation;');
  });

  it('joins BEFORE any TrackPlayer call, not after', () => {
    // Joining after setupPlayer would be the same race with extra code.
    const join = code.indexOf('if (activation) return activation;');
    const setup = code.indexOf('await ensureSetup()', join === -1 ? 0 : join);
    expect(join).toBeGreaterThan(-1);
    expect(setup).toBeGreaterThan(join);
  });

  it('clears the in-flight promise even when activation throws', () => {
    // Otherwise a single failure joins every future caller to a dead promise and the media session
    // can never be established again for the life of the process.
    expect(code).toMatch(/finally \{\s*activation = null;/);
  });
});

describe('deactivate waits for an activation instead of no-opping through it', () => {
  it('awaits the in-flight activation FIRST', () => {
    const wait = code.indexOf('if (activation) { try { await activation; }');
    const guard = code.indexOf('if (!isRegistered) return;', wait === -1 ? 0 : wait);
    expect(wait).toBeGreaterThan(-1);
    // The isRegistered check must come AFTER the await, or it reads a value that is still false.
    expect(guard).toBeGreaterThan(wait);
  });

  it('does not let a failed activation block the teardown', () => {
    expect(code).toMatch(/await activation; \} catch \{/);
  });
});

describe('the guard that was not a guard', () => {
  it('isRegistered is still set only after the session is really up', () => {
    // Setting it early would fix the race by lying: a caller would skip activation before the
    // listeners exist, and earbud taps would silently stop working.
    const set = code.indexOf('isRegistered = true;');
    const listeners = code.indexOf('addEventListener(Event.RemotePlay');
    expect(listeners).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(listeners);
  });

  it('activate still returns immediately when already registered', () => {
    expect(code).toMatch(/export async function activateMediaSession[\s\S]{0,120}if \(isRegistered\) return;/);
  });
});
