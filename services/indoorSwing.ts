/**
 * 2026-07-07 (Tim — Hotel Mode): phone-in-hand swing/putt rep detection from the
 * gyroscope. The IMU rides the HANDS at ~100Hz — the right sensor for everything
 * tempo/rhythm (better temporal resolution than 30fps video). See
 * docs/indoor-hotel-mode-eval.md for the honesty envelope: TEMPO, TRANSITION, and
 * RHYTHM CONSISTENCY only. No clubhead speed, no ball flight — never claimed.
 *
 * Detection model (per rep):
 *   idle → takeaway starts when rotation speed crosses the start threshold →
 *   the initial rotation direction u is captured (~80ms in) → backswing while the
 *   signed projection s = ω·u stays positive → TOP = s zero-crossing (after a real
 *   backswing peak) → downswing to the |s| peak ("impact" proxy) → rep ends when
 *   total speed decays. Tempo = backswing:downswing. Transition = dwell time through
 *   the top (long dwell = smooth, snatched = short).
 *
 * Pure + deterministic state machine (feed samples, get reps) so it unit-tests; the
 * screen owns the Gyroscope subscription. Guards discard unreadable reps honestly.
 */

export interface GyroSample { t: number; x: number; y: number; z: number }
/** 2026-07-24 — accelerometer sample (m/s², includes gravity), same units as expo-sensors Accelerometer. */
export interface AccelSample { t: number; x: number; y: number; z: number }

export type IndoorMode = 'swing' | 'putt';
export type TransitionGrade = 'smooth' | 'quick' | 'snatched';

export interface IndoorRep {
  tempoRatio: number;
  backswingMs: number;
  downswingMs: number;
  transition: TransitionGrade;
  /** Dwell through the top (ms between 30%-of-peak thresholds). */
  transitionDwellMs: number;
  /** Putting only: did the through-stroke keep accelerating to the strike point? */
  throughStroke?: 'accelerating' | 'decelerating';
  /** 2026-07-24 — which signal set produced the impact timing: 'gyro' (rotation only) or 'gyro+accel'
   *  (the accelerometer sharpened the through-swing bottom). 'gyro' whenever fusion is off / not fed /
   *  the refinement failed a sanity gate — so a caller can trust the number is at worst gyro-only. */
  impactSource?: 'gyro' | 'gyro+accel';
}

/**
 * 2026-07-24 — Accel+gyro fusion master switch. The gyro-only tempo detector is the proven, device-tuned
 * baseline; the accelerometer refinement is ADDITIVE and hard-guarded (see refineImpactWithAccel), but
 * this flag lets it be disabled instantly over-the-air if it ever misbehaves on a device, with zero
 * other change. Fusion also self-disables whenever no accel samples are fed (the screen may not stream
 * them), so the detector always degrades cleanly to gyro-only.
 */
export const ACCEL_FUSION_ENABLED = true;

export interface IndoorConfig {
  startThresh: number;   // rad/s to enter a rep
  endThresh: number;     // rad/s (sustained) to end a rep
  minBackswingPeak: number;
  backswingMsRange: [number, number];
  downswingMsRange: [number, number];
  benchmark: number;     // classic tempo benchmark to show against
}

export const INDOOR_CONFIG: Record<IndoorMode, IndoorConfig> = {
  swing: {
    startThresh: 1.2, endThresh: 0.5, minBackswingPeak: 1.6,
    backswingMsRange: [300, 2200], downswingMsRange: [120, 1100], benchmark: 3.0,
  },
  putt: {
    startThresh: 0.3, endThresh: 0.15, minBackswingPeak: 0.4,
    backswingMsRange: [200, 1800], downswingMsRange: [100, 1400], benchmark: 2.0,
  },
};

type Phase = 'idle' | 'backswing' | 'downswing' | 'settling';

export class IndoorRepDetector {
  private cfg: IndoorConfig;
  private mode: IndoorMode;
  private phase: Phase = 'idle';
  private ema = { x: 0, y: 0, z: 0 };
  private u: { x: number; y: number; z: number } | null = null; // initial rotation dir
  private tStart = 0;
  private tTop = 0;
  private tPeakDown = 0;
  private peakBack = 0;
  private peakDown = 0;
  private lastAbove = 0;      // last time |ω| was above endThresh
  private uCaptured = false;
  private sHistory: { t: number; s: number }[] = [];
  // 2026-07-24 — optional accelerometer fusion. grav = complementary low-pass estimate of the gravity
  // vector; linHistory = per-sample LINEAR acceleration magnitude (raw − gravity) over time. Feeding
  // accel is optional; when it isn't fed these stay empty and the detector is pure gyro (see finishRep).
  private grav = { x: 0, y: 0, z: 0 };
  private gravInit = false;
  private linHistory: { t: number; lin: number }[] = [];

  constructor(mode: IndoorMode) {
    this.mode = mode;
    this.cfg = INDOOR_CONFIG[mode];
  }

  reset(): void {
    this.phase = 'idle';
    this.u = null;
    this.uCaptured = false;
    this.peakBack = 0;
    this.peakDown = 0;
    this.sHistory = [];
    // NB: linHistory + grav are NOT reset here — the accel stream is continuous + windowed by time in
    // finishRep, and the gravity estimate should persist across reps (it's the phone's resting tilt).
  }

  /**
   * 2026-07-24 — Feed one accelerometer sample (optional). Maintains a gravity estimate via a textbook
   * complementary low-pass (β≈0.08 → ~2s time-constant at 60Hz, isolates the ~1g DC gravity from the
   * swing's dynamic motion), then stores the LINEAR acceleration magnitude |raw − gravity| over time.
   * finishRep() uses this to sharpen the through-swing bottom timing — hard-guarded, gyro-only fallback.
   * Pure; never throws. No-op when fusion is disabled.
   */
  onAccel(raw: AccelSample): void {
    if (!ACCEL_FUSION_ENABLED) return;
    const beta = 0.08;
    if (!this.gravInit) { this.grav = { x: raw.x, y: raw.y, z: raw.z }; this.gravInit = true; }
    else {
      this.grav.x += (raw.x - this.grav.x) * beta;
      this.grav.y += (raw.y - this.grav.y) * beta;
      this.grav.z += (raw.z - this.grav.z) * beta;
    }
    const lin = Math.hypot(raw.x - this.grav.x, raw.y - this.grav.y, raw.z - this.grav.z);
    this.linHistory.push({ t: raw.t, lin });
    if (this.linHistory.length > 900) this.linHistory.shift(); // ~9s at 100Hz
  }

  /** Feed one gyro sample; returns a completed rep when one just finished. */
  onSample(raw: GyroSample): IndoorRep | null {
    // Light EMA smoothing (α=0.35) — kills sensor jitter, keeps the swing shape.
    const a = 0.35;
    this.ema = {
      x: this.ema.x + (raw.x - this.ema.x) * a,
      y: this.ema.y + (raw.y - this.ema.y) * a,
      z: this.ema.z + (raw.z - this.ema.z) * a,
    };
    const { x, y, z } = this.ema;
    const mag = Math.hypot(x, y, z);
    const t = raw.t;
    if (mag > this.cfg.endThresh) this.lastAbove = t;

    if (this.phase === 'idle') {
      if (mag > this.cfg.startThresh) {
        this.phase = 'backswing';
        this.tStart = t;
        this.uCaptured = false;
        this.peakBack = 0;
        this.peakDown = 0;
        this.sHistory = [];
      }
      return null;
    }

    // Capture the takeaway direction ~80ms in (past the initial jitter).
    if (!this.uCaptured && t - this.tStart >= 80 && mag > 1e-3) {
      this.u = { x: x / mag, y: y / mag, z: z / mag };
      this.uCaptured = true;
    }
    if (!this.u) {
      // Motion died before we could even capture a direction — false start.
      if (mag < this.cfg.endThresh && t - this.tStart > 250) this.reset();
      return null;
    }

    const s = x * this.u.x + y * this.u.y + z * this.u.z; // signed speed along takeaway dir
    this.sHistory.push({ t, s });
    if (this.sHistory.length > 600) this.sHistory.shift(); // ~6s cap

    if (this.phase === 'backswing') {
      if (s > this.peakBack) this.peakBack = s;
      // TOP = zero-crossing after a REAL backswing (peak floor beats hand jitter).
      if (s <= 0 && this.peakBack >= this.cfg.minBackswingPeak) {
        this.phase = 'downswing';
        this.tTop = t;
      } else if (mag < this.cfg.endThresh && t - this.lastAbove > 300) {
        this.reset(); // fizzled without a top — not a rep
      } else if (t - this.tStart > 4000) {
        this.reset(); // way too long — waggling, not swinging
      }
      return null;
    }

    if (this.phase === 'downswing') {
      const down = -s; // speed in the downswing direction
      if (down > this.peakDown) { this.peakDown = down; this.tPeakDown = t; }
      // Rep completes when rotation settles (follow-through decayed) or times out.
      const settled = mag < this.cfg.endThresh && t - this.lastAbove > 150;
      if (settled || t - this.tTop > 2500) {
        const rep = this.finishRep();
        this.reset();
        return rep;
      }
      return null;
    }

    return null;
  }

  private finishRep(): IndoorRep | null {
    const backswingMs = this.tTop - this.tStart;
    const downswingMs = this.tPeakDown - this.tTop;
    const [bLo, bHi] = this.cfg.backswingMsRange;
    const [dLo, dHi] = this.cfg.downswingMsRange;
    // Honest guards: out-of-range = unreadable rep, discarded (never a junk number).
    if (backswingMs < bLo || backswingMs > bHi) return null;
    if (downswingMs < dLo || downswingMs > dHi) return null;
    if (this.peakDown < this.peakBack * 0.4) return null; // no real "strike" motion

    // Transition dwell: time spent between 30%-of-peak thresholds through the top.
    const backGate = this.peakBack * 0.3;
    const downGate = this.peakDown * 0.3;
    let tBackGate = this.tTop;
    let tDownGate = this.tTop;
    for (let i = this.sHistory.length - 1; i >= 0; i--) {
      const h = this.sHistory[i];
      if (h.t <= this.tTop && h.s >= backGate) { tBackGate = h.t; break; }
    }
    for (const h of this.sHistory) {
      if (h.t >= this.tTop && -h.s >= downGate) { tDownGate = h.t; break; }
    }
    const transitionDwellMs = Math.max(0, tDownGate - tBackGate);
    const transition: TransitionGrade =
      transitionDwellMs >= 140 ? 'smooth' : transitionDwellMs >= 70 ? 'quick' : 'snatched';

    // 2026-07-24 — accel fusion refines ONLY the through-swing (downswing) timing, and only as a small,
    // hard-guarded nudge; backswing (top via the gyro zero-crossing) is already solid. Degrades to the
    // exact gyro value when accel isn't fed or a guard fails.
    const refined = this.refineImpactWithAccel(dLo, dHi, downswingMs);

    const rep: IndoorRep = {
      tempoRatio: backswingMs / Math.max(1, refined.downswingMs),
      backswingMs,
      downswingMs: refined.downswingMs,
      transition,
      transitionDwellMs,
      impactSource: refined.source,
    };

    // Putting: decel-into-the-ball read (the #1 amateur putting fault). Compare the
    // through-stroke speed at 60% vs 90% of the way to the strike-point peak.
    if (this.mode === 'putt') {
      const t60 = this.tTop + (this.tPeakDown - this.tTop) * 0.6;
      const t90 = this.tTop + (this.tPeakDown - this.tTop) * 0.9;
      let s60 = 0, s90 = 0;
      for (const h of this.sHistory) {
        if (h.t <= t60) s60 = -h.s;
        if (h.t <= t90) s90 = -h.s;
      }
      rep.throughStroke = s90 >= s60 * 0.92 ? 'accelerating' : 'decelerating';
    }
    return rep;
  }

  /**
   * 2026-07-24 — Sharpen the downswing (through-swing) duration using the accelerometer, hard-guarded.
   * The gyro fixes the through-swing bottom at the ANGULAR-speed peak (tPeakDown); the swing's LINEAR
   * acceleration peaks fractionally later (max force through the impact zone), a slightly truer bottom.
   * We take the linear-accel peak in the through-swing window, but only ACCEPT it as a small correction:
   *   - accel must actually be streaming (window coverage) — else this is a no-op → pure gyro,
   *   - the peak must be a real swing force (≥1 m/s²), not sensor noise,
   *   - the shift stays within ±150 ms of the gyro bottom (a bounded nudge, never a wild jump),
   *   - the refined downswing stays physically in range.
   * Any miss → the gyro value. So the fusion can only ever make a small, sane improvement, and the
   * feature is byte-identical to the proven baseline whenever accel is absent or uncertain.
   */
  private refineImpactWithAccel(dLo: number, dHi: number, gyroDownswingMs: number): { downswingMs: number; source: 'gyro' | 'gyro+accel' } {
    if (!ACCEL_FUSION_ENABLED) return { downswingMs: gyroDownswingMs, source: 'gyro' };
    const win = this.linHistory.filter((h) => h.t >= this.tTop && h.t <= this.tPeakDown + 250);
    if (win.length < 5) return { downswingMs: gyroDownswingMs, source: 'gyro' }; // no accel coverage → gyro-only
    let tImpact = this.tPeakDown;
    let peakLin = 0;
    for (const h of win) if (h.lin > peakLin) { peakLin = h.lin; tImpact = h.t; }
    const refined = tImpact - this.tTop;
    const SHIFT_CAP_MS = 150;
    if (peakLin >= 1.0 && Math.abs(tImpact - this.tPeakDown) <= SHIFT_CAP_MS && refined >= dLo && refined <= dHi) {
      return { downswingMs: refined, source: 'gyro+accel' };
    }
    return { downswingMs: gyroDownswingMs, source: 'gyro' };
  }
}

export interface IndoorSummary {
  reps: number;
  avgTempo: number | null;
  /** 0-100 — how repeatable the tempo was (100 = metronome). */
  consistency: number | null;
  benchmark: number;
  smoothCount: number;
  quickCount: number;
  snatchedCount: number;
  /** Putting only: how many reps decelerated into the ball. */
  decelCount: number | null;
  headline: string;
}

/** Summarize a set of detected reps. Pure; honest floors (null until 3 reps). */
export function summarizeIndoorReps(reps: IndoorRep[], mode: IndoorMode): IndoorSummary {
  const benchmark = INDOOR_CONFIG[mode].benchmark;
  const n = reps.length;
  const empty: IndoorSummary = {
    reps: n, avgTempo: null, consistency: null, benchmark,
    smoothCount: 0, quickCount: 0, snatchedCount: 0, decelCount: mode === 'putt' ? 0 : null,
    headline: 'Take a few swings and I\'ll read your rhythm.',
  };
  if (n === 0) return empty;
  const tempos = reps.map((r) => r.tempoRatio);
  const avg = tempos.reduce((a, b) => a + b, 0) / n;
  const smoothCount = reps.filter((r) => r.transition === 'smooth').length;
  const quickCount = reps.filter((r) => r.transition === 'quick').length;
  const snatchedCount = reps.filter((r) => r.transition === 'snatched').length;
  const decelCount = mode === 'putt' ? reps.filter((r) => r.throughStroke === 'decelerating').length : null;
  if (n < 3) {
    return { ...empty, reps: n, avgTempo: avg, smoothCount, quickCount, snatchedCount, decelCount,
      headline: 'A few more reps and I\'ll grade the consistency.' };
  }
  const sd = Math.sqrt(tempos.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
  const cv = sd / Math.max(0.1, avg);
  const consistency = Math.round(Math.max(0, Math.min(100, 100 - cv * 220)));

  let headline: string;
  const offBench = avg - benchmark;
  if (consistency >= 75 && Math.abs(offBench) <= 0.4) headline = `Dialed — ${avg.toFixed(1)}:1 and repeating. That's the rhythm to take outside.`;
  else if (consistency >= 75) headline = offBench > 0
    ? `Repeatable but long — ${avg.toFixed(1)}:1 vs the ${benchmark.toFixed(0)}:1 benchmark. Feel a touch quicker to the top.`
    : `Repeatable but rushed — ${avg.toFixed(1)}:1 vs ${benchmark.toFixed(0)}:1. Give the backswing one more beat.`;
  else if (snatchedCount > n / 2) headline = 'The change of direction is the story — you\'re snatching it from the top. Feel the pause.';
  else if (mode === 'putt' && decelCount != null && decelCount > n / 2) headline = 'You\'re decelerating into the ball — the classic three-putt move. Shorter back, accelerate through.';
  else headline = `Tempo is wandering (${avg.toFixed(1)}:1 average). Pick one feel and groove it — consistency beats perfect.`;

  return { reps: n, avgTempo: avg, consistency, benchmark, smoothCount, quickCount, snatchedCount, decelCount, headline };
}
