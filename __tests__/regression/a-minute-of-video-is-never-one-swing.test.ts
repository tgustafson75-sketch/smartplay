/**
 * 2026-10-17 — Tim's range session, session 1792271029197_ndibo6_cage (driver, live capture, 60s clip,
 * no strike heard). Its analysis trace, verbatim where it matters:
 *
 *   smartmotion capture · window=0.0-59.8s strike=guessed
 *   on-device locate · {"frames":16,"topMs":17401,"impactMs":42416}
 *   locate ok · via=on_device startSec=12.40 endSec=47.42
 *   window chosen · via=on_device start_s=11.90 end_s=47.92 impact_s=42.42
 *   pose frames · requested=20 got=19 window=0-59817ms
 *   body read named the verdict · issue=pose_lead_arm_bent
 *
 * A 36-second "swing" with a 25-second downswing was accepted as located, and the read and the body read
 * were then given the whole minute. The height read (S1e) refuses that shape; its fallback, the speed
 * read, had no sense of size, and nothing downstream asked whether a window could be one swing.
 */
import tim from '../fixtures/locate-3870-wrists.json';
import { searchSwingWindow, sampleTimesMs } from '../../services/swing/onDeviceLocate';
import { deriveSwingAnchors, type MotionSample } from '../../services/swing/poseMotion';

const DUR = 59_817;
const ADDRESS = { x: 0.49, y: 0.61 };

/**
 * The field capture's wrist track at the twelve coarse times the locate samples on a 59.8s clip
 * (2393ms … 57424ms, ~5s apart): the player standing at the mat, the hands raised once at 17.4s (picking
 * the club up / looking down the range) and a step to the side to tee the next ball from 42s — the two
 * things the speed read named "top" and "impact" (topMs 17401, impactMs 42414 — the trace's 42416 within a
 * frame).
 */
const COARSE = new Set(sampleTimesMs(DUR));
function fieldReadAt(tMs: number): MotionSample | null {
  // The refine reads land on a player walking / bending over a ball bucket: no usable wrists.
  if (!COARSE.has(tMs)) return null;
  if (tMs === 17_401) return { tMs, x: 0.5, y: 0.47 };
  if (tMs >= 42_000) return { tMs, x: 0.72, y: 0.6 };
  return { tMs, ...ADDRESS };
}

/** A clock that advances 400ms per frame read (the phone's thumbnail + MediaPipe cost). */
function fakeClock() {
  let t = 0;
  return { now: () => t, tick: () => { t += 400; } };
}

async function locate(durMs: number, readAt: (t: number) => MotionSample | null) {
  const c = fakeClock();
  return searchSwingWindow(durMs, async (t) => { c.tick(); return readAt(t); }, c.now);
}

describe('a located window bigger than a swing is a failed locate', () => {
  it('the field capture: these are the times the phone sampled', () => {
    const t = sampleTimesMs(DUR);
    expect(t).toContain(17_401);
    expect(t.some((x) => Math.abs(x - 42_416) < 5)).toBe(true);
  });

  it('the replay reproduces the field read: the motion read names top 17.4s, impact 42.4s', () => {
    const pts = [...COARSE].map((t) => fieldReadAt(t)!).filter(Boolean);
    const a = deriveSwingAnchors(pts)!;
    expect(a.topMs).toBe(17_401);
    expect(Math.abs(a.impactMs - 42_416)).toBeLessThan(5);
  });

  it('the 60s field capture (top 17.4s, impact 42.4s) is NOT a located swing', async () => {
    const w = await locate(DUR, fieldReadAt);
    // Before the fix: a ~35s window around a 25s "downswing".
    expect(w).toBeNull();
  });

  it("Tim's real 3870 swing still locates (14.5s clip, strike heard at 7.00s)", async () => {
    const real = (tim.samples as number[][]).map(([tMs, x, y]) => ({ tMs, x, y }));
    const nearest = (t: number) => {
      let best = real[0];
      for (const p of real) if (Math.abs(p.tMs - t) < Math.abs(best.tMs - t)) best = p;
      return Math.abs(best.tMs - t) <= 1 ? { tMs: t, x: best.x, y: best.y } : null;
    };
    // The fixture IS the phone's locate (coarse + refine reads); replayed with no time pressure.
    const w = await searchSwingWindow(tim.durationMs, async (t) => nearest(t), () => 0);
    expect(w).not.toBeNull();
    expect(w!.endSec - w!.startSec).toBeLessThanOrEqual(6);
    expect(Math.abs(w!.swingTimeSec - 7.0)).toBeLessThanOrEqual(0.5);
  });
});
