/**
 * 2026-09-03 — the first-run order was wrong, and nothing could have told us.
 *
 * app/index.tsx decided what a launching player saw by falling through a chain of early
 * <Redirect> returns. Readable, and impossible to verify — the order IS the behaviour, every new
 * install depends on it, and no test could reach it. The order was intro → PERMISSIONS → welcome,
 * so a brand-new install got camera, microphone and location dialogs before the player had been
 * told what the app does or agreed to anything. Welcome is the only place consent lives.
 *
 * Now a pure function, so the sequence every user of the release build walks exactly once — and can
 * never re-walk — is enumerable.
 */
import fs from 'fs';
import path from 'path';
import { decideFirstRunRoute, type FirstRunState } from '../../services/firstRunRoute';

const fresh: FirstRunState = {
  corePermissionsAsked: false,
  termsAccepted: false,
  hasName: false,
  bagSetupOffered: false,
  bagEmpty: true,
};

describe('decideFirstRunRoute', () => {
  it('walks a fresh install in the right order', () => {
    let s = { ...fresh };
    // CONSENT before any sensitive permission is requested — this is the whole fix.
    expect(decideFirstRunRoute(s)).toBe('/welcome');
    s = { ...s, termsAccepted: true, hasName: true };
    expect(decideFirstRunRoute(s)).toBe('/permissions');
    s = { ...s, corePermissionsAsked: true };
    // 2026-09-13 — the bag, once: an empty bag means the caddie starts with bagClubs: [].
    expect(decideFirstRunRoute(s)).toBe('/bag-scan');
    s = { ...s, bagSetupOffered: true };
    expect(decideFirstRunRoute(s)).toBeNull();
    s = { ...s, corePermissionsAsked: true };
    expect(decideFirstRunRoute(s)).toBeNull();
  });

  it('NEVER asks for permissions before consent', () => {
    // The regression this file exists for. Every state where consent is outstanding must not route
    // to the permission pre-flight, whatever else is true.
    for (const corePermissionsAsked of [false, true]) {
      const s = { ...fresh, corePermissionsAsked };
      expect(decideFirstRunRoute(s)).not.toBe('/permissions');
    }
  });

  it('accepting terms does not skip the permission pre-flight', () => {
    // welcome.tsx used to jump straight to /(tabs)/caddie. With consent moved ahead of permissions,
    // that would have skipped the pre-flight entirely and never asked at all.
    expect(decideFirstRunRoute({ ...fresh, termsAccepted: true })).toBe('/permissions');
  });

  it('resumes a half-finished first run rather than restarting or falling through', () => {
    // Force-quit during welcome: consent is still outstanding, so it asks again.
    expect(decideFirstRunRoute({ ...fresh })).toBe('/welcome');
    // Force-quit after consent but before permissions: it picks up at permissions.
    expect(decideFirstRunRoute({ ...fresh, termsAccepted: true })).toBe('/permissions');
  });

  /**
   * 2026-09-18 (Tim — "I thought we removed that intro video? its okay but if it causes any issues
   * it needs to go").
   *
   * IT HAD NOT BEEN REMOVED. It was step one: an 11 MB bundled mp4 played at a new install before
   * the consent screen, on a cold launch, giving the player nothing. Asserted as an ABSENCE across
   * every reachable state rather than by deleting the case that used to expect it — a state the
   * enumeration does not reach is a state where it could come back.
   * [[a-guard-can-enforce-a-stale-premise]]
   */
  it('never plays a video at anybody — the intro is not part of first run', () => {
    for (const termsAccepted of [false, true]) {
      for (const hasName of [false, true]) {
        for (const corePermissionsAsked of [false, true]) {
          for (const bagSetupOffered of [false, true]) {
            for (const bagEmpty of [false, true]) {
              const route = decideFirstRunRoute({ termsAccepted, hasName, corePermissionsAsked, bagSetupOffered, bagEmpty });
              expect(route).not.toBe('/intro-video');
            }
          }
        }
      }
    }
    // And the very first thing a brand-new install sees is the screen that asks for consent.
    expect(decideFirstRunRoute({ ...fresh })).toBe('/welcome');
  });

  it('lets a returning player who has a name straight through', () => {
    // Narrow on purpose: BOTH must be missing to re-prompt, so an existing player whose consent
    // predates the timestamp field is not sent back to the welcome screen.
    expect(decideFirstRunRoute({
      corePermissionsAsked: true, termsAccepted: false, hasName: true,
      bagSetupOffered: true, bagEmpty: false,
    })).toBeNull();
  });

  it('does not trap a player who SKIPPED the bag', () => {
    /**
     * bag-scan marks 'bag_setup_offered' ON MOUNT, because a first-run arrival has no back stack:
     * safeBack() returns to '/', the router re-evaluates, and an unset flag would put the player
     * straight back on the screen they just left. Offered once, never again.
     */
    expect(decideFirstRunRoute({
      corePermissionsAsked: true, termsAccepted: true, hasName: true,
      bagSetupOffered: true, bagEmpty: true,
    })).toBeNull();
  });

  it('never asks a player who already registered clubs', () => {
    expect(decideFirstRunRoute({
      corePermissionsAsked: true, termsAccepted: true, hasName: true,
      bagSetupOffered: false, bagEmpty: false,
    })).toBeNull();
  });

  it('bag-scan actually SETS the flag on mount — the pure function cannot save us here', () => {
    /**
     * The order above is only safe if the screen marks itself offered. Assert the call exists, with
     * comments stripped, because the sentence explaining this trap names the very string it forbids.
     * [[strip-comments-before-a-guard-matches]] [[an-invariant-has-three-homes]]
     */
    const src = fs.readFileSync(path.join(__dirname, '../../app/bag-scan.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
    expect(src).toMatch(/markTutorialSeen\('bag_setup_offered'\)/);
    expect(src).toMatch(/useEffect\(\s*\(\)\s*=>/);
  });

  it('does not trap a player who DECLINED the permissions', () => {
    // permissions.tsx sets its flag on EVERY exit — grant, denial, or a thrown request — so
    // declining advances. (It had a skip button until 2026-09-17; App Review 5.1.1(iv) removed it.)
    expect(decideFirstRunRoute({
      corePermissionsAsked: true, termsAccepted: true, hasName: true,
      bagSetupOffered: true, bagEmpty: false,
    })).toBeNull();
  });
});
