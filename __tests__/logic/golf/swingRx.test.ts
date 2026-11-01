import { QUALITY_BY_MOVEMENT, QUALITY_ORDER } from '../../../services/golf/golfProgram';
import {
  FAULT_RX,
  RX_ELIGIBLE_MOVEMENTS,
  RX_EXTRA_MOVEMENT_QUALITY,
  RX_TARGET_SETS,
  SWING_FAULTS,
  buildRxSession,
  computeRxProgress,
  isTrainableFault,
  rxSession,
  type SwingPrescription,
} from '../../../services/golf/swingRx';
import { parseBullet, parseSwingRx, resolveExerciseId } from '../../../services/golf/swingRxParse';
import { EXERCISE_LIBRARY } from '../../../services/golf/exerciseLibrary';
import type { LoggedSetEvent } from '../../../services/golf/sessionTypes';

/** Converted from scripts/verify-swing-rx.ts. */

const IMPORTED_AT = Date.UTC(2026, 6, 25, 12, 0, 0);
const DAY = 86_400_000;

const GOLF_QUALITY_KEYS = new Set<string>(QUALITY_ORDER);
const GOLF_ATTRIBUTION: Record<string, string> = {
  ...QUALITY_BY_MOVEMENT,
  ...RX_EXTRA_MOVEMENT_QUALITY,
};

function setEvent(
  exerciseId: string,
  weight: number,
  reps: number,
  atMs: number,
): LoggedSetEvent {
  return {
    type: 'set.complete',
    timestamp: new Date(atMs).toISOString(),
    payload: { exerciseId, weight, reps },
  };
}

describe.each(SWING_FAULTS)('fault: %s', (fault) => {
  const rx = FAULT_RX[fault];

  it('has an entry', () => {
    expect(rx).toBeDefined();
  });

  it('prescribes coherently for its trainability', () => {
    if (!isTrainableFault(fault)) {
      // A timing fault has no physical prescription, and inventing one
      // would be the bridge fabricating work.
      expect(rx.exercises).toHaveLength(0);
      return;
    }
    expect(rx.exercises.length).toBeGreaterThanOrEqual(3);
  });

  it('prescribes only movements the golf path can actually track', () => {
    for (const spec of rx.exercises) {
      expect(EXERCISE_LIBRARY[spec.exerciseId]).toBeDefined();
      expect(RX_ELIGIBLE_MOVEMENTS.has(spec.exerciseId)).toBe(true);
      expect(GOLF_ATTRIBUTION[spec.exerciseId]).toBe(spec.quality);
      expect(GOLF_QUALITY_KEYS.has(spec.quality)).toBe(true);
    }
  });

  it('declares only qualities its movements actually load', () => {
    expect(rx.qualities.every((q) => rx.exercises.some((e) => e.quality === q))).toBe(true);
  });
});

describe("Caddie's real dashboard export", () => {
  const REAL_EXPORT = `SmartPlay Caddie — training for your swing
Focus: reverse pivot

• Step-through weight-shift drill (drill) — Trains driving onto the lead side through impact instead of hanging back.
• Lateral lunges (strength) — Strength in the lateral shift so your weight actually gets forward.
• Med-ball rotational throw (to lead side) (strength) — Builds the transfer of weight + speed toward the target.

— Generated from your swing analysis`;

  const parsed = parseSwingRx(REAL_EXPORT, IMPORTED_AT);

  it('parses', () => {
    expect(parsed.ok).toBe(true);
  });

  if (!parsed.ok) return;
  const rx = parsed.rx;

  it('coerces the prose fault to a slug', () => {
    expect(rx.fault).toBe('reverse_pivot');
  });

  it.each([
    ['Lateral lunges', 'lunge'],
    ['Med-ball rotational throw (to lead side)', 'medBallRotThrow'],
  ])('resolves %s to a tracked movement', (_name, id) => {
    expect(rx.movements.some((m) => m.exerciseId === id && m.origin === 'caddie')).toBe(true);
  });

  it("keeps Caddie's own rationale", () => {
    expect(rx.movements.find((m) => m.exerciseId === 'medBallRotThrow')?.why).toBe(
      'Builds the transfer of weight + speed toward the target.',
    );
  });

  it('carries a swing drill as a drill, never as gym work', () => {
    // SmartPump owns the exercise prescription; a range drill isn't a set.
    expect(
      rx.drills.some(
        (d) => d.name === 'Step-through weight-shift drill' && d.category === 'drill',
      ),
    ).toBe(true);
    expect(rx.movements.every((m) => !/step/i.test(m.exerciseId))).toBe(true);
  });

  it('still prescribes SmartPump\'s own work for the fault', () => {
    for (const id of ['gobletSquat', 'dbRdl', 'boxJump']) {
      expect(rx.movements.some((m) => m.exerciseId === id)).toBe(true);
    }
  });

  it('does not read the footer as a bullet', () => {
    expect(rx.drills.every((d) => !/Generated from/.test(d.name))).toBe(true);
  });

  it('keeps the movement count sane and buildable', () => {
    expect(rx.movements.length).toBeLessThanOrEqual(6);
    const lunge = buildRxSession(rx, 200).find((e) => e.exerciseId === 'lunge');
    expect(lunge?.sets.length).toBeGreaterThan(0);
  });

  it('attributes every movement to a golf quality the panel shows', () => {
    expect(rx.movements.every((m) => GOLF_ATTRIBUTION[m.exerciseId] === m.quality)).toBe(true);
  });
});

describe('bullet parsing', () => {
  it('treats the LAST parenthetical as the category', () => {
    const b = parseBullet(
      'Med-ball rotational throw (to lead side) (strength) — Builds the transfer.',
    );
    expect(b.category).toBe('strength');
    expect(b.name).toBe('Med-ball rotational throw (to lead side)');
    expect(b.why).toBe('Builds the transfer.');
  });

  it('keeps a non-category parenthetical in the name', () => {
    const b = parseBullet('Pallof press (anti-rotation) (strength) — Teaches your core to resist.');
    expect(b.name).toBe('Pallof press (anti-rotation)');
    expect(resolveExerciseId(b.name)).toBe('pallofPress');
  });

  it('parses a category-only name cleanly', () => {
    const b = parseBullet('Hip airplanes (stability) — Trains single-leg rotation control.');
    expect(b.name).toBe('Hip airplanes');
    expect(b.category).toBe('stability');
  });
});

describe.each([
  'Glute bridges',
  'Hip airplanes',
  'Single-leg balance (trail leg)',
  'Pallof press (anti-rotation)',
  'Lateral lunges',
  'Med-ball rotational throw (to lead side)',
  'Thoracic rotation mobility',
  'Med-ball scoop toss',
  'Thoracic spine rotation (open book)',
  'Seated shoulder-turn stretch',
  'Forearm + grip strength',
  'Deadbug core stability',
])('Caddie vocabulary: %s', (name) => {
  it('resolves to an attributed movement', () => {
    const id = resolveExerciseId(name);
    expect(id).not.toBeNull();
    expect(GOLF_ATTRIBUTION[id!]).toBeDefined();
  });
});

describe('other payload shapes', () => {
  it('parses the canonical envelope', () => {
    const r = parseSwingRx(
      JSON.stringify({
        version: 1,
        source: 'smartplay-caddie',
        exported_at: '2026-07-25T18:04:00.000Z',
        swing: {
          primary_fault: 'early_extension',
          confidence: 'high',
          cause: 'Hips move toward the ball through the downswing.',
          fix: 'Feel the belt buckle stay back as the arms drop.',
          drill: 'Butt-against-the-wall swings, half speed.',
          secondary_faults: ['casting'],
        },
        prescription: { exercises: [{ name: 'Trap-Bar Deadlift' }, 'Bench Press'] },
      }),
      IMPORTED_AT,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rx.fault).toBe('early_extension');
    expect(r.rx.confidence).toBe('high');
    expect(r.rx.secondaryFaults).toContain('casting');
    expect(r.rx.cause).not.toBeNull();
    expect(r.rx.importedAt).toBe(new Date(IMPORTED_AT).toISOString());
  });

  it('builds a Caddie-named trackable lift but leaves an untrackable one as drill work', () => {
    const r = parseSwingRx(
      JSON.stringify({
        swing: { primary_fault: 'early_extension' },
        prescription: { exercises: [{ name: 'Trap-Bar Deadlift' }, 'Bench Press'] },
      }),
      IMPORTED_AT,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rx.movements.some((m) => m.exerciseId === 'trapBarDeadlift')).toBe(true);
    // Bench isn't golf-attributed, so it must not enter the tracked block.
    expect(r.rx.movements.every((m) => m.exerciseId !== 'bench')).toBe(true);
    expect(r.rx.drills.some((d) => d.name === 'Bench Press')).toBe(true);
  });

  it.each([
    [
      'a bare PrimaryIssue',
      { issue_id: 'over_the_top', primary_fault: 'over_the_top', confidence: 'medium' },
      'over_the_top',
    ],
    [
      'a display label',
      { primary_fault: 'Loss of Spine Angle' },
      'spine_angle_loss',
    ],
    [
      'a nested wrapper',
      { meta: { app: 'caddie' }, data: { session: { analysis: { primary_fault: 'chicken_wing' } } } },
      'chicken_wing',
    ],
  ])('parses %s', (_label, payload, fault) => {
    const r = parseSwingRx(JSON.stringify(payload), IMPORTED_AT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rx.fault).toBe(fault);
  });

  it('reads a CageSession slice and falls back to its drill recommendation', () => {
    const r = parseSwingRx(
      JSON.stringify({
        primary_issue: { primary_fault: 'sway', cause: 'Trail hip slides.' },
        drill_recommendation: { drill_name: 'Wall-touch backswing', reason: 'Feel the turn.' },
      }),
      IMPORTED_AT,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rx.fault).toBe('sway');
    expect(r.rx.drill).toBe('Wall-touch backswing');
  });

  it('picks the first TRAINABLE fault out of an array', () => {
    const r = parseSwingRx(
      JSON.stringify([{ primary_fault: 'inconclusive' }, { primary_fault: 'casting' }]),
      IMPORTED_AT,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rx.fault).toBe('casting');
  });
});

describe('honest refusals', () => {
  it.each([
    ['empty input', '', 'empty'],
    ['non-JSON prose', 'my swing is bad', 'not_json'],
    ['JSON with no fault', '{"foo":1}', 'no_fault'],
    ['a fault outside the allowlist', '{"primary_fault":"banana_slice"}', 'unknown_fault'],
    ['inconclusive', '{"primary_fault":"inconclusive"}', 'not_trainable'],
    ['no dominant fault', '{"primary_fault":"no_dominant_fault"}', 'not_trainable'],
    ['quick tempo (timing, not physical)', 'Focus: quick tempo', 'not_trainable'],
    ['slow tempo (timing, not physical)', 'Focus: slow_tempo', 'not_trainable'],
  ])('refuses %s', (_label, input, reason) => {
    const r = parseSwingRx(input, IMPORTED_AT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as { reason?: string }).reason).toBe(reason);
  });

  it('builds for under_coil — a real mobility limit Caddie can emit', () => {
    const r = parseSwingRx('Focus: under coil', IMPORTED_AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rx.fault).toBe('under_coil');
    expect(r.rx.movements.some((m) => m.exerciseId === 'thoracicRotation')).toBe(true);
  });
});

describe('building a session from an Rx', () => {
  const parsed = parseSwingRx('{"primary_fault":"spine_angle_loss"}', IMPORTED_AT);
  const rx = (parsed as { ok: true; rx: SwingPrescription }).rx;

  it('is a strength session carrying every movement', () => {
    const session = rxSession(rx);
    expect(session.kind).toBe('strength');
    expect(session.exercises).toHaveLength(rx.movements.length);
  });

  it('loads a weighted movement with warm-ups', () => {
    const built = buildRxSession(rx, 200);
    const rdl = built.find((e) => e.exerciseId === 'rdl');
    expect(rdl?.sets.some((s) => s.isWorking && s.weight > 0)).toBe(true);
    expect(rdl?.sets.filter((s) => s.isWarmup)).toHaveLength(2);
  });

  it('keeps a qualitative movement reps-only', () => {
    const deadBug = buildRxSession(rx, 200).find((e) => e.exerciseId === 'deadBug');
    expect(deadBug?.sets.every((s) => s.weight === 0)).toBe(true);
  });

  it('still builds without a bodyweight', () => {
    expect(buildRxSession(rx, undefined)).toHaveLength(rx.movements.length);
  });
});

describe('progress counts only real post-import work', () => {
  const parsed = parseSwingRx('{"primary_fault":"spine_angle_loss"}', IMPORTED_AT);
  const rx = (parsed as { ok: true; rx: SwingPrescription }).rx;

  const events: LoggedSetEvent[] = [
    setEvent('rdl', 185, 6, IMPORTED_AT - DAY), // before import
    setEvent('rdl', 185, 6, IMPORTED_AT + DAY),
    setEvent('rdl', 205, 6, IMPORTED_AT + DAY),
    setEvent('hipThrust', 225, 10, IMPORTED_AT + 2 * DAY),
    setEvent('deadBug', 0, 10, IMPORTED_AT + 2 * DAY),
    setEvent('bench', 185, 5, IMPORTED_AT + 2 * DAY), // not prescribed
    setEvent('rdl', 205, 0, IMPORTED_AT + 3 * DAY), // zero reps
  ];
  const prog = computeRxProgress(rx, events);

  it('excludes sets logged before the import', () => {
    expect(prog.setsLogged).toBe(4);
  });

  it('excludes an unprescribed exercise', () => {
    expect(prog.movements.some((m) => m.exerciseId === 'bench')).toBe(false);
  });

  it('excludes a zero-rep set', () => {
    expect(prog.movements.find((m) => m.exerciseId === 'rdl')?.setsLogged).toBe(2);
  });

  it('tracks the top load', () => {
    expect(prog.movements.find((m) => m.exerciseId === 'rdl')?.topLoad).toBe(205);
  });

  it('scales the target with movement count', () => {
    expect(prog.targetSets).toBe(rx.movements.length * RX_TARGET_SETS);
  });

  it('counts distinct movements started', () => {
    expect(prog.movementsStarted).toBe(3);
  });

  it('reports completion as volume over target', () => {
    expect(prog.completion).toBeCloseTo(4 / (rx.movements.length * RX_TARGET_SETS), 9);
  });

  it('stamps the newest counted set', () => {
    expect(prog.lastLoggedAt).toBe(new Date(IMPORTED_AT + 2 * DAY).toISOString());
  });

  it('reads 0% with no logged work', () => {
    const empty = computeRxProgress(rx, []);
    expect(empty.completion).toBe(0);
    expect(empty.setsLogged).toBe(0);
  });
});

