/**
 * 2026-10-03 — Tim's 14.5s driver upload "WILL NOT ANALYZE". Two layers, both measured on the clip:
 *
 *   1. The on-device locator sampled 12 frames across the clip (1.2s apart) and called the fastest
 *      wrist move between two of them "impact". A downswing is ~0.3s; the coarse winner was the walk
 *      to the next tee. It returned nothing usable, the network locate guessed 8.94s at low
 *      confidence, and every pose frame downstream was centred 2s after the strike (heard at 7.00s).
 *   2. Refine: look again at 100ms inside the two fastest coarse gaps.
 *
 * The fixture is the wrist track MediaPipe actually produced on the emulator from his file (the
 * coarse 12 + the refine reads), so this is the real signal, not a synthetic one.
 */
import fixture from '../fixtures/locate-3870-wrists.json';
import { searchSwingWindow, sampleTimesMs } from '../../services/swing/onDeviceLocate';
import { deriveSwingAnchors } from '../../services/swing/poseMotion';

const STRIKE_MS = 7000; // the loudest moment in the clip's audio — the ball
const byT = new Map((fixture.samples as number[][]).map(([t, x, y]) => [t, { tMs: t, x, y }]));
const readAt = async (t: number) => byT.get(t) ?? null;

describe('the located swing is the swing, not the walk-off', () => {
  it('the coarse 12 alone cannot find it (this is what shipped)', () => {
    const coarse = sampleTimesMs(fixture.durationMs).map((t) => byT.get(t)!).filter(Boolean);
    expect(coarse.length).toBe(12);
    const a = deriveSwingAnchors(coarse);
    // Either no answer at all, or an impact nowhere near the strike.
    expect(a == null || Math.abs(a.impactMs - STRIKE_MS) > 300).toBe(true);
  });

  it('with the refine pass, impact lands on the strike and the top just before it', async () => {
    const w = await searchSwingWindow(fixture.durationMs, readAt);
    expect(w).not.toBeNull();
    expect(Math.abs(w!.swingTimeSec * 1000 - STRIKE_MS)).toBeLessThanOrEqual(150);
    expect(w!.startSec).toBeLessThan(6.5);   // address/takeaway, before the top
    expect(w!.endSec).toBeLessThan(8);       // not the turn-and-walk that follows
  });
});
