/**
 * 2026-09-01 (Tim, on Meta glasses: temple tap starts listening but "does not react as well to a
 * stop listening tap"; then "it just mirrors earbud behavior"; then "go deeper — it should be making
 * the bridge better and gated for tap buds or glasses").
 *
 * mediaKeyBridge subscribed to RemotePlay AND RemotePause and forwarded a tap from EACH. They are the
 * same physical button: a press toggles the transport state, so a device can emit one event or both.
 * Two taps went downstream from one press.
 *
 * Whether that survived depended on a 600ms echo guard in listeningSession tuned for earbuds:
 *   • STARTING tolerated it — the duplicate looked like an echo and was swallowed.
 *   • STOPPING did not — a duplicate landing just outside the window is honoured as a fresh tap and
 *     REOPENS the mic the player just closed.
 * Which is exactly the asymmetry Tim described.
 */
import fs from 'fs';
import path from 'path';
import {
  shouldForwardTap,
  classifyTapDevice,
  TAP_COALESCE_MS,
  type TapDevice,
} from '../../services/tapCoalescer';

describe('one physical press becomes exactly one tap', () => {
  it('THE REPORT: a glasses press that emits BOTH Play and Pause forwards once', () => {
    // RemotePlay at t=0, RemotePause 120ms later — one press, two events.
    expect(shouldForwardTap(0, null, 'glasses')).toBe(true);
    expect(shouldForwardTap(120, 0, 'glasses')).toBe(false);
  });

  it('a duplicate just PAST the old 600ms echo window is still coalesced on glasses', () => {
    // This is the one that reopened the mic: survivable downstream only by luck.
    expect(shouldForwardTap(650, 0, 'glasses')).toBe(false);
  });

  it('a deliberate second tap still counts on every device', () => {
    // ~800ms is about the fastest a person taps twice on purpose; no window may eat that.
    for (const d of ['glasses', 'earbuds', 'wired', 'unknown'] as TapDevice[]) {
      expect(TAP_COALESCE_MS[d]).toBeLessThan(800);
      expect(shouldForwardTap(800, 0, d)).toBe(true);
    }
  });

  it('the first tap of a session is always forwarded', () => {
    for (const d of ['glasses', 'earbuds', 'wired', 'unknown'] as TapDevice[]) {
      expect(shouldForwardTap(0, null, d)).toBe(true);
    }
  });

  it('a backwards clock never swallows every future tap', () => {
    // Device sleep / NTP correction. Failing open is correct: a missed tap is worse than a double.
    expect(shouldForwardTap(50, 10_000, 'glasses')).toBe(true);
  });

  it('windows are ordered by how noisy the transport actually is', () => {
    expect(TAP_COALESCE_MS.wired).toBeLessThan(TAP_COALESCE_MS.earbuds);
    expect(TAP_COALESCE_MS.earbuds).toBeLessThan(TAP_COALESCE_MS.glasses);
  });
});

describe('the gate picks the device', () => {
  it('glasses win when the DAT bridge says a pair is connected', () => {
    expect(classifyTapDevice({ glassesConnected: true, route: 'bluetooth' })).toBe('glasses');
  });

  it('bluetooth without glasses is earbuds; a wire is a wire', () => {
    expect(classifyTapDevice({ route: 'bluetooth' })).toBe('earbuds');
    expect(classifyTapDevice({ route: 'wired' })).toBe('wired');
  });

  it('an unknown device still gets coalescing, not none', () => {
    expect(classifyTapDevice({})).toBe('unknown');
    expect(TAP_COALESCE_MS.unknown).toBeGreaterThan(0);
  });
});

describe('the bridge actually applies it', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'services/mediaKeyBridge.ts'),
    'utf8',
  );

  it('both remote listeners share ONE handler and one clock', () => {
    expect(src).toMatch(/Event\.RemotePlay, \(\) => onMediaKey\('play'\)/);
    expect(src).toMatch(/Event\.RemotePause, \(\) => onMediaKey\('pause'\)/);
    expect(src).toMatch(/let lastTapForwardedAt: number \| null = null;/);
  });

  it('neither listener can forward a tap without passing the coalescer', () => {
    // The old shape: each listener called notifyEarbudTap() directly.
    const direct = src.match(/addEventListener\([\s\S]{0,200}?notifyEarbudTap\(\)/g) ?? [];
    expect(direct).toEqual([]);
    expect(src).toMatch(/if \(!shouldForwardTap\(now, lastTapForwardedAt, device\)\)/);
  });

  it('the device is resolved at press time, not cached at boot', () => {
    // A player puts earbuds in mid-round; the answer has to change with them.
    expect(src).toMatch(/const device = currentTapDevice\(\);/);
    expect(src).toMatch(/getGlassesStatusSync/);
    expect(src).toMatch(/getCurrentRoute/);
  });
});
