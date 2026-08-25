/**
 * 2026-08-24 (Tim: "check all swing lab cards… drills that engage smartmotion and supposed to be
 * focused on specific things. I see now it's probably made up or at best half built").
 *
 * He was right, and the code admitted it. app/drills/[issue].tsx renders the practice CTA under a
 * comment reading "sub-text names what Smart Motion will look at" and passes `drillFocus` on the
 * route; SmartMotion routed it ONLY to setScreenContext (the caddie's conversational awareness) and
 * never to the analysis. All 17 drills produced the same generic biomech read, so "we'll look at
 * your posture" and "we'll look at your path" did identical work.
 *
 * The measurements already existed. These cases pin two things: the focus is answered from a REAL
 * measurement where one exists, and where it does not exist we say so instead of inventing one.
 */
import { drillFocusRead } from '../../services/swing/drillFocusRead';
import type { SwingBiomechanics } from '../../services/poseAnalysisApi';

const bio = (over: Partial<SwingBiomechanics> = {}) => ({
  hipTurnDeg: null, shoulderTurnDeg: null, weightShiftPct: null, spineAngleDeltaDeg: null,
  headDriftPxNorm: null, hipSlideRatio: null, frames: [], verdicts: {
    hipTurn: null, shoulderTurn: null, weightShift: null, posture: null,
  }, ...over,
} as unknown as SwingBiomechanics);

describe('a drill answers the thing it said it would look at', () => {
  it('POSTURE is answered from the measured spine-angle change', () => {
    const r = drillFocusRead('posture', { biomech: bio({ spineAngleDeltaDeg: 3 }) });
    expect(r?.measured).toBe(true);
    expect(r?.line).toMatch(/3°/);
    expect(r?.line.toLowerCase()).toContain('held your posture');
  });

  it('...and calls out a big change as the thing to feel', () => {
    const r = drillFocusRead('posture', { biomech: bio({ spineAngleDeltaDeg: -14 }) });
    expect(r?.measured).toBe(true);
    expect(r?.line).toMatch(/14°/);
  });

  it('TEMPO is answered from the real ratio, against the tour window', () => {
    expect(drillFocusRead('tempo', { tempoRatio: 3.0 })?.line).toMatch(/tour window/i);
    expect(drillFocusRead('tempo', { tempoRatio: 1.9 })?.line).toMatch(/quick from the top/i);
    expect(drillFocusRead('tempo', { tempoRatio: 4.2 })?.line).toMatch(/slow coming down/i);
  });

  it('CONTACT is answered from the acoustic strike grade', () => {
    expect(drillFocusRead('contact', { contactGrade: 'pure' })?.measured).toBe(true);
    expect(drillFocusRead('contact', { contactGrade: 'thin' })?.line).toMatch(/chase/i);
  });

  it('PATH uses the club-path read when the camera could see it', () => {
    const r = drillFocusRead('path', { pathVerdict: 'Slightly in-to-out, 2° right of neutral.' });
    expect(r?.measured).toBe(true);
    expect(r?.line).toMatch(/in-to-out/);
  });

  it('...and says what camera it needs when it could not', () => {
    const r = drillFocusRead('path', {});
    expect(r?.measured).toBe(false);
    expect(r?.line).toMatch(/down-the-line/i);
  });

  it('GRIP is NOT faked — it says why, and where it CAN be read', () => {
    const r = drillFocusRead('grip', { biomech: bio({ spineAngleDeltaDeg: 3 }) });
    expect(r?.measured).toBe(false);
    expect(r?.line).toMatch(/Setup Check/);
  });

  it('CONNECTION is not faked either', () => {
    expect(drillFocusRead('connection', {})?.measured).toBe(false);
  });

  it('SPEED points at the strike and the watch, not at a turn metric dressed up', () => {
    const r = drillFocusRead('speed', { biomech: bio({ shoulderTurnDeg: 95 }) });
    expect(r?.measured).toBe(false);
    expect(r?.line).toMatch(/watch/i);
  });

  it('says it could not read the focus rather than going silent', () => {
    const r = drillFocusRead('posture', { biomech: bio() });   // nothing measured
    expect(r).not.toBeNull();
    expect(r?.measured).toBe(false);
  });

  it('an unknown focus returns null so the caller falls back, not an empty card', () => {
    expect(drillFocusRead('interpretive_dance', {})).toBeNull();
    expect(drillFocusRead('', {})).toBeNull();
    expect(drillFocusRead(null, {})).toBeNull();
  });

  it('covers every focus the drill catalog actually declares', () => {
    // data/drillCatalog uses exactly these seven across its 17 practice blocks.
    for (const f of ['posture', 'path', 'grip', 'connection', 'tempo', 'speed', 'contact']) {
      expect(drillFocusRead(f, {})).not.toBeNull();
    }
  });
});
