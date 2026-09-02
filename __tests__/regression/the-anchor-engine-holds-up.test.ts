/**
 * 2026-09-01 — deriveSwingAnchors became LOAD-BEARING today.
 *
 * It now decides the club-path search window, the jump-to-stage chips, the on-device locate used by
 * the review, upload and analysis paths, and the capture window when acoustics hear nothing. Until
 * today its only check was one idealised synthetic swing in the sim.
 *
 * A window it gets wrong is not a cosmetic error: everything downstream samples inside it. So these
 * are the cases a real recording actually contains — noise, a swing at the very edge of the clip, a
 * player standing still, a dropped tracker — and the bar is that it either answers sanely or answers
 * null. Never an inverted or out-of-range window.
 */
import { deriveSwingAnchors, wristCentroid, type MotionSample } from '../../services/swing/poseMotion';

/** A swing: settle, backswing to a high slow top, fast downswing to impact, follow-through. */
function syntheticSwing(opts?: { noise?: number; shiftMs?: number; stepMs?: number }): MotionSample[] {
  const noise = opts?.noise ?? 0;
  const shift = opts?.shiftMs ?? 0;
  const step = opts?.stepMs ?? 50;
  const out: MotionSample[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648 - 0.5) * 2; };
  for (let t = 0; t <= 1600; t += step) {
    let x: number, y: number;
    if (t <= 400) { x = 0.50; y = 0.60; }
    else if (t <= 900) { const f = (t - 400) / 500; y = 0.60 - 0.25 * f; x = 0.50 - 0.08 * f; }
    else if (t <= 1150) { const f = (t - 900) / 250; y = 0.35 + 0.27 * f * f; x = 0.42 + 0.08 * f; }
    else { const f = (t - 1150) / 450; y = 0.62 - 0.30 * f; x = 0.50 + 0.10 * f; }
    out.push({ tMs: t + shift, x: x + rnd() * noise, y: y + rnd() * noise });
  }
  return out;
}

const sane = (a: ReturnType<typeof deriveSwingAnchors>, samples: MotionSample[]) => {
  if (!a) return true; // null is always an acceptable answer
  const lo = samples[0].tMs, hi = samples[samples.length - 1].tMs;
  return a.startMs < a.topMs && a.topMs < a.impactMs && a.impactMs < a.endMs
    && a.startMs >= lo && a.endMs <= hi;
};

describe('it finds a clean swing', () => {
  it('top and impact land where the motion says they are', () => {
    const a = deriveSwingAnchors(syntheticSwing())!;
    expect(a).not.toBeNull();
    expect(a.topMs).toBeGreaterThanOrEqual(850);
    expect(a.topMs).toBeLessThanOrEqual(950);
    expect(a.impactMs).toBeGreaterThanOrEqual(1100);
    expect(a.impactMs).toBeLessThanOrEqual(1200);
  });

  it('the window brackets the swing rather than the clip', () => {
    const a = deriveSwingAnchors(syntheticSwing())!;
    expect(a.startMs).toBeLessThan(a.topMs);
    expect(a.endMs).toBeGreaterThan(a.impactMs);
  });
});

describe('it survives what a real recording actually contains', () => {
  it('tracker jitter does not move impact off the downswing', () => {
    for (const noise of [0.005, 0.01, 0.02]) {
      const s = syntheticSwing({ noise });
      const a = deriveSwingAnchors(s);
      expect(sane(a, s)).toBe(true);
      if (a) expect(Math.abs(a.impactMs - 1150)).toBeLessThanOrEqual(250);
    }
  });

  it('a coarse sample rate still resolves the swing — the locate only takes 12 frames', () => {
    const s = syntheticSwing({ stepMs: 140 });
    const a = deriveSwingAnchors(s);
    expect(sane(a, s)).toBe(true);
    if (a) expect(Math.abs(a.impactMs - 1150)).toBeLessThanOrEqual(300);
  });

  it('a clip that does not start at zero keeps real timestamps', () => {
    const s = syntheticSwing({ shiftMs: 8_000 });
    const a = deriveSwingAnchors(s)!;
    expect(a.impactMs).toBeGreaterThan(8_000);
    expect(sane(a, s)).toBe(true);
  });

  it('out-of-order samples are handled — thumbnails can resolve late', () => {
    const s = [...syntheticSwing()].reverse();
    const a = deriveSwingAnchors(s);
    expect(a).not.toBeNull();
    expect(a!.startMs).toBeLessThan(a!.impactMs);
  });
});

describe('it refuses rather than inventing', () => {
  it('too few samples is null, not a guess', () => {
    expect(deriveSwingAnchors([])).toBeNull();
    expect(deriveSwingAnchors(syntheticSwing().slice(0, 4))).toBeNull();
  });

  it('a player standing still never yields an inverted or out-of-range window', () => {
    const still: MotionSample[] = Array.from({ length: 20 }, (_, i) => ({ tMs: i * 80, x: 0.5, y: 0.6 }));
    expect(sane(deriveSwingAnchors(still), still)).toBe(true);
  });

  it('non-finite samples are dropped, not propagated', () => {
    const s = syntheticSwing();
    const dirty = [...s, { tMs: NaN, x: 0.5, y: 0.5 }, { tMs: 500, x: Infinity, y: 0.5 }];
    const a = deriveSwingAnchors(dirty);
    expect(sane(a, s)).toBe(true);
    if (a) for (const v of [a.startMs, a.topMs, a.impactMs, a.endMs]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('wristCentroid only speaks when it can see a wrist', () => {
  const kp = (name: string, x: number, y: number, score = 0.9) => ({ name, x, y, score });

  it('averages both wrists', () => {
    const c = wristCentroid({ timestampMs: 0, keypoints: [kp('left_wrist', 0.4, 0.5), kp('right_wrist', 0.6, 0.7)] } as never);
    expect(c).toEqual({ x: 0.5, y: 0.6 });
  });

  it('accepts one wrist', () => {
    expect(wristCentroid({ timestampMs: 0, keypoints: [kp('left_wrist', 0.4, 0.5)] } as never)).toEqual({ x: 0.4, y: 0.5 });
  });

  it('returns null with no wrist, rather than substituting another joint', () => {
    expect(wristCentroid({ timestampMs: 0, keypoints: [kp('left_shoulder', 0.4, 0.5)] } as never)).toBeNull();
    expect(wristCentroid({ timestampMs: 0, keypoints: [] } as never)).toBeNull();
  });
});
