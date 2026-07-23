/**
 * Elite Coach Caddie — the diagnosis brain. diagnose() must pick the ONE priority a real coach
 * would (root cause over symptom), stay honest when a metric is null, and evaluateRep() must
 * recognize a fixed rep, an improving rep, and a stalled rep. These are the guardrails on the
 * coaching quality, so they're pinned.
 */
import { diagnose, topPriority, isDiagnosable, COACH_FAULTS } from '../../services/coachKnowledge';
import { evaluateRep, diagnoseBaseline, missConnectionLine, memoryLine } from '../../services/coachSession';
import type { SwingBiomechanics } from '../../services/poseAnalysisApi';

const swing = (over: Partial<SwingBiomechanics>): SwingBiomechanics => ({
  hipTurnDeg: 45, shoulderTurnDeg: 90, shoulderTiltDeg: 30, weightShiftPct: 58,
  spineAngleDeltaDeg: 5, headDriftPxNorm: 0.03, hipSlideRatio: 0.8, sequencingScore: 75,
  frames: [], verdicts: {} as never, ...over,
} as SwingBiomechanics);

describe('diagnose', () => {
  it('flags early extension when spine angle changes a lot', () => {
    const d = topPriority(swing({ spineAngleDeltaDeg: 20 }));
    expect(d?.fault.id).toBe('early_extension');
  });

  it('flags a pressure-shift problem when weight hangs back', () => {
    const d = topPriority(swing({ weightShiftPct: 38 }));
    expect(d?.fault.id).toBe('pressure_shift');
  });

  it('prefers the ROOT cause over a symptom (early extension outranks a short turn)', () => {
    const d = topPriority(swing({ spineAngleDeltaDeg: 20, shoulderTurnDeg: 70 }));
    expect(d?.fault.id).toBe('early_extension');
  });

  it('returns no priority for a fundamentally sound swing', () => {
    expect(topPriority(swing({}))).toBeNull();
    expect(diagnose(swing({})).length).toBe(0);
  });

  it('never diagnoses a fault from a null (unseen) metric', () => {
    // Face-on metrics null (down-the-line read) — weight shift can't be judged, so no pressure fault.
    const d = diagnose(swing({ weightShiftPct: null, spineAngleDeltaDeg: null, headDriftPxNorm: null }));
    expect(d.some((x) => x.fault.id === 'pressure_shift')).toBe(false);
    expect(d.some((x) => x.fault.id === 'early_extension')).toBe(false);
  });
});

describe('isDiagnosable (honesty gate — do not praise a swing we could not read)', () => {
  it('is false when fewer than 3 fault metrics are readable', () => {
    // down-the-line: turn/weight/sequence/hip-slide nulled; only 2 left → not diagnosable
    expect(isDiagnosable(swing({ weightShiftPct: null, sequencingScore: null, shoulderTurnDeg: null, hipTurnDeg: null }))).toBe(false);
    expect(isDiagnosable(swing({ spineAngleDeltaDeg: null, weightShiftPct: null, sequencingScore: null, shoulderTurnDeg: null, headDriftPxNorm: null, hipTurnDeg: null }))).toBe(false);
  });
  it('is true for a normal face-on read', () => {
    expect(isDiagnosable(swing({}))).toBe(true);
  });
});

describe('evaluateRep', () => {
  const earlyExt = COACH_FAULTS.find((f) => f.id === 'early_extension')!;
  const pressure = COACH_FAULTS.find((f) => f.id === 'pressure_shift')!;
  const sway = COACH_FAULTS.find((f) => f.id === 'sway')!;

  it('detects sway improvement on the sub-unity head-drift scale (epsilon bug fix)', () => {
    // 0.14 → 0.10 is real progress (lower is better); a 0.5 epsilon would have missed it entirely.
    const r = evaluateRep(sway, swing({ headDriftPxNorm: 0.10 }), 0.14);
    expect(r.improved).toBe(true);
    expect(r.line.toLowerCase()).toContain('better');
  });

  it('calls a fixed rep a win (metric reached target)', () => {
    const r = evaluateRep(earlyExt, swing({ spineAngleDeltaDeg: 7 }), 18);
    expect(r.fixed).toBe(true);
    expect(r.line).toContain(earlyExt.win);
  });

  it('recognizes improvement toward the target (lower spine change is better)', () => {
    const r = evaluateRep(earlyExt, swing({ spineAngleDeltaDeg: 14 }), 20);
    expect(r.fixed).toBe(false);
    expect(r.improved).toBe(true);
  });

  it('recognizes improvement where higher is better (weight shift up)', () => {
    const r = evaluateRep(pressure, swing({ weightShiftPct: 52 }), 40);
    expect(r.improved).toBe(true);
  });

  it('re-cues (exaggerate the feel) when the rep did not improve', () => {
    const r = evaluateRep(earlyExt, swing({ spineAngleDeltaDeg: 20 }), 20);
    expect(r.improved).toBe(false);
    expect(r.line.toLowerCase()).toContain('exaggerate');
  });

  it('is honest when the priority metric is unreadable', () => {
    const r = evaluateRep(earlyExt, swing({ spineAngleDeltaDeg: null }), 18);
    expect(r.value).toBeNull();
    expect(r.fixed).toBe(false);
  });
});

describe('personalization', () => {
  it('connects the fault to the player’s known miss when it matches', () => {
    // over-the-top sequence causes slice/pull
    expect(missConnectionLine('sequence', 'slice')).toContain('slice');
    // pressure_shift causes thin/fat/slice
    expect(missConnectionLine('pressure_shift', 'fat')).toContain('fat');
  });
  it('does NOT force a connection when the miss does not match (no false link)', () => {
    expect(missConnectionLine('sequence', 'hook')).toBeNull();   // over-the-top doesn't cause hooks
    expect(missConnectionLine('coil', 'slice')).toBeNull();      // coil causes no directional miss
  });
  it('is silent when the miss is unknown or "varies"', () => {
    expect(missConnectionLine('sequence', null)).toBeNull();
    expect(missConnectionLine('sequence', 'varies')).toBeNull();
  });

  it('memoryLine acknowledges a prior lesson, and is null on first-ever', () => {
    expect(memoryLine('Hold your posture', null)).toBeNull();
    expect(memoryLine('Hold your posture', 1)).toBeTruthy();
    expect(memoryLine('Hold your posture', 30)).toMatch(/last time/i);
  });
});

describe('diagnoseBaseline mirrors topPriority', () => {
  it('returns the same priority', () => {
    const s = swing({ weightShiftPct: 38 });
    expect(diagnoseBaseline(s)?.fault.id).toBe(topPriority(s)?.fault.id);
  });
});
