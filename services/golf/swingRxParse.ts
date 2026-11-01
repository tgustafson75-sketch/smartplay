import { z } from 'zod';
import { EXERCISE_LIBRARY } from './exerciseLibrary';
import {
  RX_ELIGIBLE_MOVEMENTS,
  SWING_FAULTS,
  buildPrescription,
  isSwingFault,
  isTrainableFault,
  type CaddieDrill,
  type SwingFault,
  type SwingPrescription,
} from './swingRx';

/**
 * Parse a SmartPlay Caddie swing payload into a SwingPrescription.
 *
 * This is a system boundary, so it validates (zod) and it is deliberately
 * LENIENT about shape. Three payloads must all work:
 *
 *  1. **Caddie's real dashboard export** (SmartPlay app/(tabs)/dashboard.tsx
 *     → onExportWorkouts). Plain text, shared via the system share sheet:
 *
 *       SmartPlay Caddie — training for your swing
 *       Focus: reverse pivot
 *
 *       • Step-through weight-shift drill (drill) — Trains driving onto…
 *       • Lateral lunges (strength) — Strength in the lateral shift…
 *
 *       — Generated from your swing analysis
 *
 *  2. A bare `PrimaryIssue` JSON object (SmartPlay store/cageStore.ts).
 *  3. A CageSession slice: `{ primary_issue, drill_recommendation }`.
 *  4. The structured v1 envelope in docs/CADDIE_SWING_RX_CONTRACT.md, if the
 *     Caddie side ever emits JSON instead of prose.
 *
 * JSON is tried first; anything that isn't JSON falls through to the text
 * reader. Never throws — returns a typed result the UI turns into a message.
 */

const Confidence = z.enum(['high', 'medium', 'low']);

/** An exercise hint from Caddie. Only `name`/`exercise_id` are used to
 *  resolve a library movement; dose comes from SmartPump. */
const ExerciseHint = z.union([
  z.string(),
  z
    .object({
      name: z.string().optional(),
      exercise_id: z.string().optional(),
      exerciseId: z.string().optional(),
      label: z.string().optional(),
      /** Caddie's WorkoutCategory — 'drill' is never built as gym work. */
      category: z.string().optional(),
      why: z.string().optional(),
    })
    .passthrough(),
]);

const Prescription = z
  .object({
    exercises: z.array(ExerciseHint).optional(),
    movements: z.array(ExerciseHint).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

/** The fault-bearing object, in any of the accepted shapes. */
const SwingBlock = z
  .object({
    primary_fault: z.string().optional(),
    fault: z.string().optional(),
    issue_id: z.string().optional(),
    confidence: Confidence.optional(),
    cause: z.string().optional(),
    fix: z.string().optional(),
    drill: z.string().optional(),
    captured_at: z.string().optional(),
    capturedAt: z.string().optional(),
    analyzed_at: z.string().optional(),
    downstream_symptoms: z.array(z.string()).optional(),
    secondary_faults: z.array(z.string()).optional(),
  })
  .passthrough();

const Envelope = z
  .object({
    version: z.number().optional(),
    source: z.string().optional(),
    exported_at: z.string().optional(),
    swing: SwingBlock.optional(),
    primary_issue: SwingBlock.optional(),
    analysis: SwingBlock.optional(),
    prescription: Prescription.optional(),
    drill_recommendation: z
      .object({ drill_name: z.string().optional(), reason: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ParseResult =
  | { ok: true; rx: SwingPrescription }
  | { ok: false; reason: ParseFailure; detail?: string };

export type ParseFailure =
  | 'empty'
  | 'not_json'
  | 'no_fault'
  | 'unknown_fault'
  | 'not_trainable';

/** Human-readable message for a parse failure. */
export function parseFailureMessage(reason: ParseFailure, detail?: string): string {
  switch (reason) {
    case 'empty':
      return 'Nothing to import — paste the swing analysis from Caddie first.';
    case 'not_json':
      return 'That doesn’t look like a Caddie export. Share the training summary from SmartPlay Caddie’s dashboard and paste the whole thing — the “Focus:” line is the part SmartPump reads.';
    case 'no_fault':
      return 'No swing fault in that export. Caddie has to name a fault before SmartPump can build against it.';
    case 'unknown_fault':
      return `Caddie reported "${detail ?? 'unknown'}", which isn’t a fault SmartPump has a prescription for yet.`;
    case 'not_trainable':
      switch (detail) {
        case 'inconclusive':
          return 'Caddie couldn’t read that swing well enough to name a fault. Capture a cleaner swing — there’s nothing honest to train against yet.';
        case 'quick_tempo':
        case 'slow_tempo':
          return 'Tempo is a timing pattern, not a physical limitation — there’s no strength work that makes a transition slower or quicker. Caddie’s drills are the right work here.';
        default:
          return 'Caddie found no dominant fault. Nothing specific to prescribe — run the Long Game block as written.';
      }
  }
}

/* ------------------------------------------------------------------ *
 * Exercise-name resolution
 * ------------------------------------------------------------------ */

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Coach-language → library id. The first block is Caddie's ACTUAL curated
 * vocabulary, taken name-for-name from SmartPlay
 * services/swing/faultWorkouts.ts → FAULT_EXERCISES, so every strength /
 * mobility / stability item Caddie can emit either resolves to a tracked
 * movement or is deliberately left to the "not tracked here" list.
 */
const EXERCISE_ALIASES: Record<string, string> = {
  // ── Caddie's curated table (faultWorkouts.ts) ──
  glutebridges: 'gluteBridge',
  hipairplanes: 'singleLegRdl',
  singlelegbalance: 'singleLegRdl',
  singlelegbalancetrailleg: 'singleLegRdl',
  pallofpressantirotation: 'pallofPress',
  laterallunges: 'lunge',
  laterallunge: 'lunge',
  medballrotationalthrow: 'medBallRotThrow',
  medballrotationalthrowtoleadside: 'medBallRotThrow',
  medballscooptoss: 'medBallRotThrow',
  thoracicrotationmobility: 'thoracicRotation',
  thoracicspinerotationopenbook: 'thoracicRotation',
  seatedshoulderturnstretch: 'thoracicRotation',
  forearmgripstrength: 'farmerCarry',
  deadbugcorestability: 'deadBug',
  deadbug: 'deadBug',

  // ── General coach language ──
  romaniandeadlift: 'rdl',
  dumbbellromaniandeadlift: 'dbRdl',
  dbromaniandeadlift: 'dbRdl',
  singlelegromaniandeadlift: 'singleLegRdl',
  slrdl: 'singleLegRdl',
  glutebridge: 'gluteBridge',
  barbellhipthrust: 'hipThrust',
  medicineballrotationalthrow: 'medBallRotThrow',
  rotationalmedicineballthrow: 'medBallRotThrow',
  medicineballslam: 'medBallSlam',
  medballslam: 'medBallSlam',
  antirotationpress: 'pallofPress',
  cablewoodchop: 'cableRotation',
  woodchop: 'cableRotation',
  openbookstretch: 'thoracicRotation',
  tspinerotation: 'thoracicRotation',
  thoracicspinerotation: 'thoracicRotation',
  ninetyninety: 'hipMobility90',
  '9090': 'hipMobility90',
  '9090hipstretch': 'hipMobility90',
  splitsquat: 'bulgarianSplitSquat',
  rearfootelevatedsplitsquat: 'bulgarianSplitSquat',
  suitcasecarry: 'farmerCarry',
  farmerswalk: 'farmerCarry',
  farmerscarry: 'farmerCarry',
  trapbardeadlift: 'trapBarDeadlift',
  hexbardeadlift: 'trapBarDeadlift',
  landminetwist: 'landmineRotation',
  reverselunge: 'lunge',
  walkinglunge: 'lunge',
  lunges: 'lunge',
  squats: 'squat',
  deadlifts: 'deadlift',
  planks: 'plank',
};

const BY_NORMALIZED: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [id, meta] of Object.entries(EXERCISE_LIBRARY)) {
    map[normalize(id)] = id;
    map[normalize(meta.label)] = id;
  }
  // Aliases last so they can't be shadowed by a coincidental label match.
  for (const [alias, id] of Object.entries(EXERCISE_ALIASES)) map[alias] = id;
  return map;
})();

/**
 * Resolve a Caddie-named exercise to a SmartPump library id the golf path can
 * attribute to a quality. Returns null when it can't be tracked — an
 * unresolved item is kept on the prescription as Caddie's own work, never
 * silently dropped and never faked into a tracked movement.
 *
 * Two passes: the name as written, then with parentheticals stripped, because
 * Caddie qualifies its names ("Pallof press (anti-rotation)", "Med-ball
 * rotational throw (to lead side)").
 */
export function resolveExerciseId(raw: string): string | null {
  const attempts = [raw, raw.replace(/\([^)]*\)/g, ' ')];
  for (const attempt of attempts) {
    const id = BY_NORMALIZED[normalize(attempt)];
    if (id && RX_ELIGIBLE_MOVEMENTS.has(id)) return id;
  }
  return null;
}

function hintName(hint: z.infer<typeof ExerciseHint>): string {
  if (typeof hint === 'string') return hint;
  return hint.exercise_id ?? hint.exerciseId ?? hint.name ?? hint.label ?? '';
}

function hintCategory(hint: z.infer<typeof ExerciseHint>): string {
  if (typeof hint === 'string') return '';
  const c = String(hint.category ?? '').trim().toLowerCase();
  return CATEGORIES.has(c) ? c : '';
}

function hintWhy(hint: z.infer<typeof ExerciseHint>): string | undefined {
  if (typeof hint === 'string') return undefined;
  const why = typeof hint.why === 'string' ? hint.why.trim() : '';
  return why || undefined;
}

/* ------------------------------------------------------------------ *
 * Fault extraction
 * ------------------------------------------------------------------ */

/** Map a free-text fault name onto the allowlist (Caddie sends slugs, but a
 *  human copy-paste may carry the display label). */
function coerceFault(raw: string): SwingFault | null {
  const n = normalize(raw);
  for (const f of SWING_FAULTS) {
    if (normalize(f) === n) return f;
  }
  const byLabel: Record<string, SwingFault> = {
    overthetop: 'over_the_top',
    earlyextension: 'early_extension',
    casting: 'casting',
    earlyrelease: 'casting',
    sway: 'sway',
    swaying: 'sway',
    reversepivot: 'reverse_pivot',
    chickenwing: 'chicken_wing',
    flatplane: 'plane_too_flat',
    planetooflat: 'plane_too_flat',
    steepplane: 'plane_too_steep',
    planetoosteep: 'plane_too_steep',
    headmovement: 'head_movement',
    lossofspineangle: 'spine_angle_loss',
    spineangleloss: 'spine_angle_loss',
    earlyextensionloss: 'early_extension',
    nodominantfault: 'no_dominant_fault',
    inconclusive: 'inconclusive',
  };
  return byLabel[n] ?? null;
}

/** Last-resort deep scan for a fault-bearing key in an unknown wrapper. */
function deepFindFault(node: unknown, depth = 0): string | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = deepFindFault(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  for (const key of ['primary_fault', 'fault', 'primaryFault']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  for (const v of Object.values(obj)) {
    const hit = deepFindFault(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Text format — Caddie's real dashboard export
 * ------------------------------------------------------------------ */

/** Caddie's WorkoutCategory (SmartPlay services/swing/faultWorkouts.ts). */
const CATEGORIES = new Set(['mobility', 'stability', 'strength', 'drill']);

/** A bullet line, split into its three parts. */
interface BulletItem {
  name: string;
  category: string;
  why: string;
}

const BULLET_RE = /^\s*[•*\-–]\s+(.*)$/;
/** Caddie joins name and rationale with an em dash; accept the common
 *  alternatives a copy-paste can introduce. */
const WHY_SPLIT_RE = /\s+[—–]\s+|\s+-\s+/;

/**
 * Split "Name (category) — why" into parts.
 *
 * The category is the LAST parenthetical and only when it's one of Caddie's
 * four categories — because the exercise NAME can itself contain parentheses
 * ("Med-ball rotational throw (to lead side) (strength)", "Pallof press
 * (anti-rotation)"). Taking the first parenthetical, or any parenthetical,
 * would eat part of the name or invent a category.
 */
export function parseBullet(body: string): BulletItem {
  const [head, ...rest] = body.split(WHY_SPLIT_RE);
  const why = rest.join(' — ').trim();

  let name = head.trim();
  let category = '';
  const trailing = name.match(/\(([^()]*)\)\s*$/);
  if (trailing && CATEGORIES.has(trailing[1].trim().toLowerCase())) {
    category = trailing[1].trim().toLowerCase();
    name = name.slice(0, trailing.index).trim();
  }

  return { name, category, why };
}

/** Read Caddie's prose export. Returns null when it isn't that format. */
function parseTextExport(text: string, now: number): ParseResult | null {
  const lines = text.split(/\r?\n/);

  const focusLine = lines.find((l) => /^\s*(focus|fault|primary fault|issue)\s*:/i.test(l));
  if (!focusLine) return null;
  const rawFault = focusLine.slice(focusLine.indexOf(':') + 1).trim();
  if (!rawFault) return { ok: false, reason: 'no_fault' };

  const fault = isSwingFault(rawFault) ? rawFault : coerceFault(rawFault);
  if (!fault) return { ok: false, reason: 'unknown_fault', detail: rawFault };

  const items: BulletItem[] = [];
  for (const line of lines) {
    const m = line.match(BULLET_RE);
    if (!m) continue;
    const item = parseBullet(m[1]);
    if (item.name) items.push(item);
  }

  const caddieExercises: { exerciseId: string; why?: string }[] = [];
  const drills: CaddieDrill[] = [];
  for (const item of items) {
    // A range drill is never a gym movement — don't even try to resolve it.
    const id = item.category === 'drill' ? null : resolveExerciseId(item.name);
    if (id && !caddieExercises.some((e) => e.exerciseId === id)) {
      caddieExercises.push({ exerciseId: id, why: item.why || undefined });
    } else if (!id) {
      drills.push({ name: item.name, why: item.why, category: item.category || 'drill' });
    }
  }

  // A fault SmartPump can't build against still carries Caddie's work over —
  // but there's no prescription, so say so rather than store an empty Rx.
  if (!isTrainableFault(fault)) {
    return { ok: false, reason: 'not_trainable', detail: fault };
  }

  return {
    ok: true,
    rx: buildPrescription(fault, { caddieExercises, drills }, now),
  };
}

/* ------------------------------------------------------------------ *
 * Parse
 * ------------------------------------------------------------------ */

/** Pull the fault block out of whichever envelope shape arrived. */
function pickSwingBlock(env: z.infer<typeof Envelope>): z.infer<typeof SwingBlock> | null {
  const candidates = [env.swing, env.primary_issue, env.analysis];
  for (const c of candidates) {
    if (c && (c.primary_fault || c.fault || c.issue_id)) return c;
  }
  // The envelope may itself BE the fault block (a bare PrimaryIssue paste).
  const asBlock = SwingBlock.safeParse(env);
  if (asBlock.success && (asBlock.data.primary_fault || asBlock.data.fault || asBlock.data.issue_id)) {
    return asBlock.data;
  }
  return null;
}

/**
 * Parse raw pasted/read text into a prescription. `now` is injectable so the
 * import timestamp (the tracking epoch) is testable.
 */
export function parseSwingRx(raw: string, now: number = Date.now()): ParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty' };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON — try Caddie's prose export before giving up.
    return parseTextExport(text, now) ?? { ok: false, reason: 'not_json' };
  }

  // An array export → use the first entry that carries a trainable fault,
  // falling back to the first entry with any fault at all.
  if (Array.isArray(json)) {
    let firstAny: ParseResult | null = null;
    for (const item of json) {
      const r = parseSwingRx(JSON.stringify(item), now);
      if (r.ok && isTrainableFault(r.rx.fault)) return r;
      if (!firstAny) firstAny = r;
    }
    return firstAny ?? { ok: false, reason: 'no_fault' };
  }

  const parsed = Envelope.safeParse(json);
  const env = parsed.success ? parsed.data : ({} as z.infer<typeof Envelope>);
  const block = pickSwingBlock(env);

  const rawFault = block?.primary_fault ?? block?.fault ?? block?.issue_id ?? deepFindFault(json);
  if (!rawFault) return { ok: false, reason: 'no_fault' };

  const fault = isSwingFault(rawFault) ? rawFault : coerceFault(rawFault);
  if (!fault) return { ok: false, reason: 'unknown_fault', detail: rawFault };
  if (!isTrainableFault(fault)) return { ok: false, reason: 'not_trainable', detail: fault };

  // Exercise hints — resolved against the library; anything that doesn't
  // resolve is kept as Caddie's own work rather than discarded.
  const hints = [
    ...(env.prescription?.exercises ?? []),
    ...(env.prescription?.movements ?? []),
  ];
  const caddieExercises: { exerciseId: string; why?: string }[] = [];
  const drills: CaddieDrill[] = [];
  for (const hint of hints) {
    const name = hintName(hint).trim();
    if (!name) continue;
    const category = hintCategory(hint);
    const id = category === 'drill' ? null : resolveExerciseId(name);
    if (id && !caddieExercises.some((e) => e.exerciseId === id)) {
      caddieExercises.push({ exerciseId: id, why: hintWhy(hint) });
    } else if (!id) {
      drills.push({ name, why: hintWhy(hint) ?? '', category: category || 'drill' });
    }
  }

  const secondaryRaw = [
    ...(block?.secondary_faults ?? []),
    ...(block?.downstream_symptoms ?? []),
  ];
  const secondaryFaults: SwingFault[] = [];
  for (const s of secondaryRaw) {
    const f = isSwingFault(s) ? s : coerceFault(s);
    if (f && f !== fault && isTrainableFault(f) && !secondaryFaults.includes(f)) {
      secondaryFaults.push(f);
    }
  }

  const rx = buildPrescription(
    fault,
    {
      capturedAt:
        block?.captured_at ?? block?.capturedAt ?? block?.analyzed_at ?? env.exported_at ?? null,
      confidence: block?.confidence ?? null,
      cause: block?.cause ?? null,
      fix: block?.fix ?? null,
      drill: block?.drill ?? env.drill_recommendation?.drill_name ?? null,
      secondaryFaults,
      caddieExercises,
      drills,
    },
    now,
  );

  return { ok: true, rx };
}
