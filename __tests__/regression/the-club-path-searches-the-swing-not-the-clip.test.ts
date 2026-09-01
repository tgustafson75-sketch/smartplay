/**
 * 2026-08-31 (Tim, from the field: "swing trace is a little off", logged alongside
 * `clubpath_arc_too_sparse ... windowMs: 11640`).
 *
 * A DETECTED SWING SEGMENT IS 4,000ms. His window was ELEVEN AND A HALF SECONDS: with no segment
 * `clipEndSeconds` is null and the club-path effect falls through to the whole clip duration, so it
 * hunted a clubhead across eleven seconds of walk-up, waggle and follow-through. Same shape as the
 * analysis frame sampler and the share link the same day — sampling the CLIP instead of the SWING.
 *
 * This test IMPORTS THE SHIPPED RULE. The first version re-implemented the arithmetic beside it,
 * which is a test that stays green no matter what the screen does. [[break-test-every-guard-you-write]]
 */
import fs from 'fs';
import path from 'path';
import {
  impactAnchorMs,
  narrowClubPathWindow,
  MAX_SWING_WINDOW_MS,
} from '../../services/swing/clubPathWindow';
import { PRE_STRIKE_MS, POST_STRIKE_MS } from '../../services/swing/swingSegmentation';

const heard = (sec: number) => ({ detectionMethod: 'audio_transient', detectionOffsetSeconds: sec });
const win = (a: number, b: number) => ({ rawStartMs: a, rawEndMs: b });

describe('the club path searches the swing, not the whole clip', () => {
  it("THE REPORT: an 11.6s window collapses to a swing's worth around the strike", () => {
    const anchor = impactAnchorMs({ ...heard(7), ...win(0, 11640) });
    const r = narrowClubPathWindow(0, 11640, anchor);
    expect(r).toEqual({ startMs: 4500, endMs: 8500 });
    expect(r.endMs - r.startMs).toBe(PRE_STRIKE_MS + POST_STRIKE_MS);
  });

  it('the segmenter owns the pre/post — this does not keep its own copy', () => {
    const r = narrowClubPathWindow(0, 30000, 10000);
    expect(r.startMs).toBe(10000 - PRE_STRIKE_MS);
    expect(r.endMs).toBe(10000 + POST_STRIKE_MS);
    const seg = fs.readFileSync(path.join(__dirname, '..', '..', 'services/swing/swingSegmentation.ts'), 'utf8');
    expect(seg).toMatch(/export const PRE_STRIKE_MS = 2500/);
    expect(seg).toMatch(/export const POST_STRIKE_MS = 1500/);
  });

  it('leaves a NORMAL segment completely alone', () => {
    expect(narrowClubPathWindow(3000, 7000, 5500)).toEqual({ startMs: 3000, endMs: 7000 });
  });

  it('never widens a window, only narrows it', () => {
    for (const [a, b, s] of [[0, 11640, 500], [0, 20000, 19000], [2000, 9000, 2100]] as const) {
      const r = narrowClubPathWindow(a, b, s);
      expect([a, b, s, r.startMs >= a && r.endMs <= b]).toEqual([a, b, s, true]);
    }
  });

  it('a window exactly at the cap is not touched; one millisecond over is', () => {
    expect(narrowClubPathWindow(0, MAX_SWING_WINDOW_MS, 3000).endMs).toBe(MAX_SWING_WINDOW_MS);
    expect(narrowClubPathWindow(0, MAX_SWING_WINDOW_MS + 1, 3000).endMs).toBe(3000 + POST_STRIKE_MS);
  });
});

describe('only an honest impact may move the window', () => {
  it('REFUSES a synthesized strike — 0.6*duration is a guess, not a measurement', () => {
    // SmartMotion fabricates strikeMs = 0.6 * duration when nothing was detected and marks the shot
    // 'manual'. Narrowing on it points the club path confidently at the wrong four seconds.
    const anchor = impactAnchorMs({
      detectionMethod: 'manual',
      detectionOffsetSeconds: (11640 * 0.6) / 1000,
      ...win(0, 11640),
    });
    expect(anchor).toBeNull();
    expect(narrowClubPathWindow(0, 11640, anchor).endMs - narrowClubPathWindow(0, 11640, anchor).startMs).toBe(11640);
  });

  it('ACCEPTS the pose-labelled impact frame — measured from the picture', () => {
    // This is the tier that makes the fix reach Tim's actual swing: a range or uploaded clip has no
    // acoustic strike, so without it the narrowing would never fire on the case that reported it.
    const anchor = impactAnchorMs({ detectionMethod: 'manual', poseImpactMs: 7000, ...win(0, 11640) });
    expect(anchor).toBe(7000);
    expect(narrowClubPathWindow(0, 11640, anchor)).toEqual({ startMs: 4500, endMs: 8500 });
  });

  it('a HEARD strike outranks the pose frame', () => {
    expect(impactAnchorMs({ ...heard(7), poseImpactMs: 2000, ...win(0, 11640) })).toBe(7000);
  });

  it('refuses a pose impact from a DIFFERENT clock (outside the window)', () => {
    // A per-shot biomech read on a carved session can be window-relative; the bounds check makes
    // that mismatch self-detecting instead of silently re-centring on the wrong second.
    expect(impactAnchorMs({ poseImpactMs: 500, ...win(3000, 20000) })).toBeNull();
    expect(impactAnchorMs({ poseImpactMs: 25000, ...win(3000, 20000) })).toBeNull();
    expect(impactAnchorMs({ poseImpactMs: 3000, ...win(3000, 20000) })).toBe(3000);
  });

  it('refuses junk: NaN, negative, zero and missing', () => {
    expect(impactAnchorMs({ ...win(0, 11640) })).toBeNull();
    expect(impactAnchorMs({ detectionMethod: 'audio_transient', detectionOffsetSeconds: 0, ...win(0, 11640) })).toBeNull();
    expect(impactAnchorMs({ detectionMethod: 'audio_transient', detectionOffsetSeconds: -3, ...win(0, 11640) })).toBeNull();
    expect(impactAnchorMs({ detectionMethod: 'audio_transient', detectionOffsetSeconds: NaN, ...win(0, 11640) })).toBeNull();
    expect(impactAnchorMs({ poseImpactMs: NaN, ...win(0, 11640) })).toBeNull();
  });

  it('with NO anchor the window is left alone rather than given a guessed centre', () => {
    expect(narrowClubPathWindow(0, 11640, null)).toEqual({ startMs: 0, endMs: 11640 });
  });

  it('a strike near the very start still yields a forward-running window', () => {
    const r = narrowClubPathWindow(0, 11640, 300);
    expect(r.endMs).toBeGreaterThan(r.startMs);
    expect(r.startMs).toBe(0);
  });
});

describe('the screen actually applies it', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'app/swinglab/swing/[swing_id].tsx'),
    'utf8',
  );

  it('calls the shared rule instead of keeping its own arithmetic', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/\.\.\/services\/swing\/clubPathWindow'/);
    expect(src).toMatch(/const \{ startMs, endMs \} = narrowClubPathWindow\(rawStartMs, rawEndMs, anchorMs\)/);
    // No second copy of the numbers may reappear in the screen.
    expect(src).not.toMatch(/MAX_SWING_WINDOW_MS = 6000/);
    expect(src).not.toMatch(/PRE_MS = 2500/);
    // The old unbounded expression must not survive.
    expect(src).not.toMatch(/const endMs = \(shot\.clipEndSeconds \?\? duration \?\? 0\) \* 1000;/);
  });

  it('feeds it the pose impact frame it derives on screen', () => {
    expect(src).toMatch(/p\.position === 'P6_impact'/);
    expect(src).toMatch(/poseImpactMs,/);
    // and re-runs when any input to the anchor changes
    expect(src).toMatch(/shot\?\.detectionMethod, shot\?\.detectionOffsetSeconds, poseImpactMs,/);
  });
});
