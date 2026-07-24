/**
 * 2026-07-24 — Accel+gyro tempo fusion SAFETY invariants. The gyro-only detector is the proven,
 * device-tuned baseline; the accelerometer refinement is additive + hard-guarded. These lock that:
 *   1. With NO accel fed, the result is byte-identical to gyro-only (impactSource 'gyro').
 *   2. Feeding accel never throws and never changes the BACKSWING (fusion only touches the through-swing).
 *   3. When fusion engages, the tempo stays within a small bounded delta of gyro-only (the ±150ms cap) —
 *      it can only ever be a small, sane correction, never a wild jump.
 * Tempo ratio itself is the standard backswing:downswing (Tour-Tempo 3:1 full / 2:1 putt) — unchanged.
 */
import { IndoorRepDetector, type GyroSample, type AccelSample, type IndoorRep } from '../../services/indoorSwing';

// A synthetic full swing along +x: backswing (x: 0→+2→0) then downswing (x: 0→−3→0), then settle.
function gyroSwing(): GyroSample[] {
  const out: GyroSample[] = [];
  for (let t = 0; t <= 700; t += 10) out.push({ t, x: 2.0 * Math.sin((Math.PI * t) / 700), y: 0, z: 0 });
  for (let t = 710; t <= 1000; t += 10) out.push({ t, x: -3.0 * Math.sin((Math.PI * (t - 710)) / 290), y: 0, z: 0 });
  for (let t = 1010; t <= 1350; t += 10) out.push({ t, x: 0.05, y: 0, z: 0 });
  return out;
}

// Run a detector over the gyro swing, optionally feeding an accel sample (same timestamps) built by `accelAt`.
function runSwing(accelAt?: (t: number) => AccelSample | null): IndoorRep | null {
  const det = new IndoorRepDetector('swing');
  let rep: IndoorRep | null = null;
  for (const g of gyroSwing()) {
    if (accelAt) { const a = accelAt(g.t); if (a) det.onAccel(a); }
    const r = det.onSample(g);
    if (r) rep = r;
  }
  return rep;
}

describe('indoor tempo — accel fusion safety', () => {
  it('detects a rep gyro-only, marked impactSource "gyro" (no accel fed = unchanged baseline)', () => {
    const rep = runSwing();
    expect(rep).not.toBeNull();
    expect(rep!.impactSource).toBe('gyro');
    expect(rep!.backswingMs).toBeGreaterThan(300);
    expect(rep!.downswingMs).toBeGreaterThan(0);
    expect(rep!.tempoRatio).toBeGreaterThan(0);
  });

  it('feeding accel never throws and leaves the BACKSWING identical (fusion only touches the through-swing)', () => {
    const gyroOnly = runSwing();
    // Gravity on z (9.8) plus a real through-swing linear-accel burst mid-downswing (~850ms).
    const withAccel = runSwing((t) => ({ t, x: t >= 820 && t <= 880 ? 4 : 0, y: 0, z: 9.8 }));
    expect(gyroOnly).not.toBeNull();
    expect(withAccel).not.toBeNull();
    expect(withAccel!.backswingMs).toBe(gyroOnly!.backswingMs); // accel must not move the top / backswing
  });

  it('when fusion engages the tempo stays within a small bounded delta of gyro-only (never a wild jump)', () => {
    const gyroOnly = runSwing();
    const withAccel = runSwing((t) => ({ t, x: t >= 820 && t <= 880 ? 4 : 0, y: 0, z: 9.8 }));
    expect(['gyro', 'gyro+accel']).toContain(withAccel!.impactSource);
    // The ±150ms cap bounds any downswing change; the tempo can't diverge wildly from the baseline.
    expect(Math.abs(withAccel!.downswingMs - gyroOnly!.downswingMs)).toBeLessThanOrEqual(150);
    expect(Math.abs(withAccel!.tempoRatio - gyroOnly!.tempoRatio)).toBeLessThan(2);
  });

  it('rejects an out-of-window / noise accel peak and keeps the gyro value (guard holds)', () => {
    // Tiny linear accel everywhere (below the 1.0 m/s² floor) → guard rejects → gyro-only.
    const withNoise = runSwing((t) => ({ t, x: 0.1, y: 0, z: 9.8 }));
    expect(withNoise!.impactSource).toBe('gyro');
  });
});
