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
import { decideFirstRunRoute, type FirstRunState } from '../../services/firstRunRoute';

const fresh: FirstRunState = {
  introVideoSeen: false,
  corePermissionsAsked: false,
  termsAccepted: false,
  hasName: false,
};

describe('decideFirstRunRoute', () => {
  it('walks a fresh install in the right order', () => {
    let s = { ...fresh };
    expect(decideFirstRunRoute(s)).toBe('/intro-video');
    s = { ...s, introVideoSeen: true };
    // CONSENT before any sensitive permission is requested — this is the whole fix.
    expect(decideFirstRunRoute(s)).toBe('/welcome');
    s = { ...s, termsAccepted: true, hasName: true };
    expect(decideFirstRunRoute(s)).toBe('/permissions');
    s = { ...s, corePermissionsAsked: true };
    expect(decideFirstRunRoute(s)).toBeNull();
  });

  it('NEVER asks for permissions before consent', () => {
    // The regression this file exists for. Every state where consent is outstanding must not route
    // to the permission pre-flight, whatever else is true.
    for (const corePermissionsAsked of [false, true]) {
      const s = { ...fresh, introVideoSeen: true, corePermissionsAsked };
      expect(decideFirstRunRoute(s)).not.toBe('/permissions');
    }
  });

  it('accepting terms does not skip the permission pre-flight', () => {
    // welcome.tsx used to jump straight to /(tabs)/caddie. With consent moved ahead of permissions,
    // that would have skipped the pre-flight entirely and never asked at all.
    expect(decideFirstRunRoute({ ...fresh, introVideoSeen: true, termsAccepted: true })).toBe('/permissions');
  });

  it('resumes a half-finished first run rather than restarting or falling through', () => {
    // Force-quit during welcome: consent is still outstanding, so it asks again.
    expect(decideFirstRunRoute({ ...fresh, introVideoSeen: true })).toBe('/welcome');
    // Force-quit after consent but before permissions: it picks up at permissions.
    expect(decideFirstRunRoute({ ...fresh, introVideoSeen: true, termsAccepted: true })).toBe('/permissions');
    // Force-quit before the intro finished: it replays the intro, not the app.
    expect(decideFirstRunRoute({ ...fresh, termsAccepted: true, corePermissionsAsked: true })).toBe('/intro-video');
  });

  it('lets a returning player who has a name straight through', () => {
    // Narrow on purpose: BOTH must be missing to re-prompt, so an existing player whose consent
    // predates the timestamp field is not sent back to the welcome screen.
    expect(decideFirstRunRoute({
      introVideoSeen: true, corePermissionsAsked: true, termsAccepted: false, hasName: true,
    })).toBeNull();
  });

  it('does not trap a player who DECLINED the permissions', () => {
    // permissions.tsx sets its flag on Skip as well as Allow, so declining advances.
    expect(decideFirstRunRoute({
      introVideoSeen: true, corePermissionsAsked: true, termsAccepted: true, hasName: true,
    })).toBeNull();
  });
});
