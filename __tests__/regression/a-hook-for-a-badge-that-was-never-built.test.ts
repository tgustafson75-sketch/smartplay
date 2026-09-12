/**
 * 2026-09-11 — THREE HALF-BUILDS CLOSED, AND ONE RE-TAGGED AFTER TRACING IT.
 *
 * The orphan baseline carried five exports tagged WIRE — "the app computes this and nothing consumes
 * it; connect it". Working through them properly, rather than wiring all five to clear a number:
 *
 *   useLatestPoseTelemetry   a React hook for the "On-device • 47ms" badge described at the top of
 *                            poseTelemetry.ts. The badge was never built. The plain getter DID find
 *                            a consumer — describePoseTelemetry decorates every pose diagnostic with
 *                            the backend that served it — which is where the value actually was.
 *
 *   subscribePoseTelemetry   the publisher feeding that hook. Deleting the hook orphaned it inside a
 *                            minute, and the notify loop had been running on EVERY pose call with
 *                            nobody listening.
 *
 *   getCachedReading         a sync accessor whose own baseline entry said: every live reader goes
 *                            through isEffectiveCartMode instead, it is no longer waiting on a
 *                            product call, delete it or give it the caller it was written for.
 *
 *   getGpsHealth             RE-TAGGED, not deleted and not wired. Its reason claimed the brain gets
 *                            gpsLost but not this richer read — which invites someone to add a
 *                            redundant field. Both halves are already covered better elsewhere.
 *
 * Wiring something to clear an orphan count is how dead code becomes live code that nobody wanted.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the pose telemetry bus keeps its reader and loses its ghost', () => {
  const pose = code('services/poseTelemetry.ts');

  it('the hook for the badge that does not exist is gone', () => {
    expect(pose).not.toMatch(/export function useLatestPoseTelemetry/);
  });

  it('and the publisher that existed only to feed it', () => {
    expect(pose).not.toMatch(/export function subscribePoseTelemetry/);
    expect(pose).not.toMatch(/const listeners = new Set/);
  });

  it('so recording no longer notifies nobody on every pose call', () => {
    const at = pose.indexOf('export function recordPoseTelemetry');
    expect(at).toBeGreaterThan(-1);
    expect(pose.slice(at, at + 220)).not.toMatch(/for \(const cb of listeners\)/);
  });

  it('it no longer pulls React into a service that does not render', () => {
    expect(pose).not.toMatch(/from 'react'/);
  });

  /**
   * The half that MATTERS keeps working. The value was never the badge — it was that a pose failure
   * in a log reads identically whether MediaPipe ran on-device in 40ms or the cloud proxy timed out.
   */
  it('the diagnostic decorator still has its data', () => {
    expect(pose).toMatch(/export function describePoseTelemetry/);
    expect(pose).toMatch(/export function getLatestPoseTelemetry/);
    expect(pose).toMatch(/export function recordPoseTelemetry/);
  });
});

describe('the walking detector loses a sync accessor with no sync caller', () => {
  it('is gone', () => {
    expect(code('services/walkingDetector.ts')).not.toMatch(/export function getCachedReading/);
  });

  it('and the live path it was competing with is untouched', () => {
    // Every real reader goes through isEffectiveCartMode; that is the one owner.
    expect(code('services/walkingDetector.ts')).toMatch(/cartModeSuggestion|isEffectiveCartMode/);
  });
});

describe('getGpsHealth is kept, and its reason is now true', () => {
  it('still exists — three comments and a regression test cite it as the namer of never_ticked', () => {
    expect(code('services/gpsManager.ts')).toMatch(/export function getGpsHealth/);
  });

  it('is no longer tagged as something to wire', () => {
    const base = read('scripts/simulations/orphanExports.ts');
    const at = base.indexOf("'services/gpsManager.ts :: getGpsHealth'");
    expect(at).toBeGreaterThan(-1);
    const entry = base.slice(at, at + 1400);
    expect(entry).toMatch(/DO NOT WIRE/);
    expect(entry).not.toMatch(/WIRE\/TRIAGE/);
  });

  it('and the reason records what was actually traced', () => {
    const base = read('scripts/simulations/orphanExports.ts');
    const entry = base.slice(base.indexOf("'services/gpsManager.ts :: getGpsHealth'"), base.indexOf("'services/gpsManager.ts :: getGpsHealth'") + 1400);
    // the diagnostic path already logs more than this returns
    expect(entry).toMatch(/gps_error at the moment of failure/);
    // and the claimed UI banner does not exist
    expect(entry).toMatch(/no banner does/);
  });
});

describe('the deleted exports left the baseline with them', () => {
  const base = read('scripts/simulations/orphanExports.ts');
  it.each(['useLatestPoseTelemetry', 'getCachedReading'])('%s has no baseline line', (fn) => {
    // A baseline entry for a deleted export is rot the "cannot rot" guard would catch, but only on
    // the day someone reads it. Removing it with the code is the cheap moment.
    expect(base).not.toMatch(new RegExp(`:: ${fn}'`));
  });
});
