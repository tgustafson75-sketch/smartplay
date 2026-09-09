/**
 * services/swing/analysisPipeline.ts — the STAGE ORDER for swing analysis, in one place.
 *
 * 2026-09-06 (Tim) — "just to make sure those things happen in the order that we know they need to
 * happen. If not, we get fired some diagnostic."
 *
 * ── WHAT THIS IS, AND DELIBERATELY IS NOT ───────────────────────────────────────────────────────
 *
 * This does NOT execute anything, reorder anything, or cache any result. It is an OBSERVER: stages
 * report what they did, and it says — loudly, into the issue log — when they did it in an order that
 * cannot be correct. Every existing call site keeps working exactly as it does today.
 *
 * That restraint is the whole point of shipping it tonight. The real orchestrator (one that owns
 * execution and caches per clip+window) is parked in docs/v1.2-deferred.md until after App Store,
 * because an engine that OWNS the analysis path is not something to write tired. An engine that only
 * WATCHES it cannot break a swing read, and it starts collecting the evidence that tells us whether
 * the deeper refactor is even needed.
 *
 * ── WHY ORDER WAS WORTH GUARDING AT ALL ─────────────────────────────────────────────────────────
 *
 * Today the order is an emergent property of React effects rather than a decision anything makes,
 * and on 2026-09-06 that produced three defects in one evening — none of which looked like an
 * ordering bug from inside the file it lived in:
 *
 *   - `bodyBoundsFromPose` lived in a SCREEN, so the pose pipeline could not reach the crop engine
 *     and ran full-frame forever. Nobody owned "who gets the roi".
 *   - The club stage ran from a useEffect with `isPlaying` in its deps, so a play/pause toggle
 *     re-fired a PAID vision call on a swing already answered.
 *   - `roiFromBodyBounds` was wired to club but not pose, because FRAME feeding both 4 and 6 was
 *     written down nowhere.
 *
 * The third is the one this file exists for. `frame` has two dependents, and an edge with two
 * dependents is exactly the edge a per-screen effect forgets.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────────────────────────
 *
 * A run is identified by `(clipUri, startMs, endMs)` — the same key the club-arc effect already uses,
 * so two screens analysing the same swing share a run rather than inventing two.
 */

export type Stage = 'locate' | 'anchor' | 'pose' | 'frame' | 'metrics' | 'club';

export type StageStatus = 'ok' | 'partial' | 'empty' | 'skipped' | 'failed';

/**
 * What each stage needs to have HAPPENED before it can be correct.
 *
 * `frame` depends on `pose` and not the reverse, which reads backwards until you remember where the
 * crop rectangle comes from: the body bounds of a pose we already got. The slow parts of the swing
 * read fine full-frame and tell us where to look for the fast parts. So pose runs, frame derives,
 * and pose may then RETRY the frames it missed inside that crop. A cycle in the graph would be a
 * design error; a retry inside an already-completed stage is not.
 */
export const STAGE_DEPS: Readonly<Record<Stage, readonly Stage[]>> = {
  locate: [],
  anchor: ['locate'],
  pose: ['locate'],
  frame: ['pose'],
  metrics: ['pose'],
  club: ['pose', 'frame'],
};

/** Canonical order, for reporting. Not enforced as a sequence — only STAGE_DEPS is. */
export const STAGE_ORDER: readonly Stage[] = ['locate', 'anchor', 'pose', 'frame', 'metrics', 'club'];

/**
 * 2026-09-09 (Tim: "locate and anchor are fundamental though") — WHAT A STAGE IS KEYED BY.
 *
 * The first version of this file could not report `locate` at all, and I wrote that off as an
 * unavoidable circularity: a run is keyed by `(clipUri, startMs, endMs)` and locate is the stage
 * that PRODUCES startMs and endMs. Tim was right to push. It is not circular — it is a SCOPE
 * distinction the key never modelled, and locate is the most consequential stage in the graph to
 * leave unobservable. If locate returns the wrong seconds, every stage after it measures the wrong
 * part of the swing and reports a confident, clean, completely wrong read. That failure is
 * indistinguishable from "the model is bad" from the outside, which is the worst kind of bug to be
 * blind to.
 *
 * locate is CLIP-scoped: it searches a whole clip and finds the window(s) in it, once, for every
 * swing in that clip. Everything after it is WINDOW-scoped: it runs per swing, on one window.
 *
 * So a clip-scoped stage records against the clip alone, and a window-scoped stage that depends on
 * it resolves that dependency against the clip too. A caller never has to know: it passes whatever
 * run key it has — `runKeyFor(clip, 0, 0)` before a window exists — and the routing below puts the
 * record where it belongs. One owner for the scope rule. [[two-owners-is-the-root-cause]]
 */
export const STAGE_SCOPE: Readonly<Record<Stage, 'clip' | 'window'>> = {
  locate: 'clip',
  anchor: 'window',
  pose: 'window',
  frame: 'window',
  metrics: 'window',
  club: 'window',
};

/** The clip part of a run key — `${clipUri}|${start}|${end}` → `${clipUri}|0|0`. */
export function clipKeyOf(key: string): string {
  const cut = key.lastIndexOf('|', key.lastIndexOf('|') - 1);
  return cut < 0 ? `${key}|0|0` : `${key.slice(0, cut)}|0|0`;
}

/** Where a stage's record lives, given the key a caller happened to have. */
function keyForStage(key: string, stage: Stage): string {
  return STAGE_SCOPE[stage] === 'clip' ? clipKeyOf(key) : key;
}

export type StageRecord = { status: StageStatus; at: number; detail?: Record<string, unknown> };

/** One analysis run, keyed by clip + window. */
type Run = { key: string; startedAt: number; stages: Partial<Record<Stage, StageRecord>> };

/**
 * Bounded so a long session cannot grow this without limit. Small on purpose: a run is only
 * interesting while it is in flight or immediately after, and the log carries anything durable.
 */
const MAX_RUNS = 8;
const runs = new Map<string, Run>();

export function runKeyFor(clipUri: string | null | undefined, startMs: number, endMs: number): string {
  return `${clipUri ?? 'nil'}|${Math.round(startMs)}|${Math.round(endMs)}`;
}

function getRun(key: string): Run {
  let r = runs.get(key);
  if (!r) {
    r = { key, startedAt: Date.now(), stages: {} };
    runs.set(key, r);
    // Evict oldest. Insertion order is Map order, so the first key is the oldest run.
    while (runs.size > MAX_RUNS) {
      const oldest = runs.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      runs.delete(oldest);
    }
  }
  return r;
}

/**
 * A stage's unmet dependencies — the ones that never reported at all, or reported a status that
 * cannot support a dependent.
 *
 * 'partial' counts as MET on purpose. A half-read pose is exactly the case where we still want the
 * club stage to try: it may have the frames it needs even if the skeleton has gaps, and refusing
 * would trade a real failure for a self-inflicted one. 'empty' and 'failed' do not: there is nothing
 * downstream can be computed from.
 */
export function unmetDeps(key: string, stage: Stage): Stage[] {
  return STAGE_DEPS[stage].filter((d) => {
    // A clip-scoped dep (locate) is resolved against the CLIP, not this swing's window — otherwise
    // every window-scoped stage would report locate missing forever, which is a guard that cries
    // wolf on every sound run.
    const rec = runs.get(keyForStage(key, d))?.stages[d];
    if (!rec) return true;
    return rec.status === 'empty' || rec.status === 'failed';
  });
}

/** Record what a stage did. Never throws — this is observation, and observation must not be able to
 *  break the thing it observes. */
export function noteStage(
  key: string,
  stage: Stage,
  status: StageStatus,
  detail?: Record<string, unknown>,
): void {
  try {
    getRun(keyForStage(key, stage)).stages[stage] = { status, at: Date.now(), detail };
  } catch { /* observation must never break analysis */ }
}

/**
 * Call BEFORE running a stage. Returns the unmet dependencies (empty when the order is sound) and
 * fires a diagnostic when it is not.
 *
 * It returns rather than throws, and callers are expected to proceed anyway. That is deliberate: a
 * stage running early is usually still better than not running, and the point of tonight's version
 * is to LEARN whether it happens in the field — not to start refusing work on a swing Tim is
 * standing over. When the real orchestrator owns execution it can make that call properly.
 */
export function checkOrder(key: string, stage: Stage): Stage[] {
  const missing = unmetDeps(key, stage);
  if (missing.length === 0) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../../store/issueLogStore') as typeof import('../../store/issueLogStore'))
      .useIssueLogStore.getState().addAppEvent(
        'analysis_stage_out_of_order',
        {
          stage,
          missing: missing.join(','),
          /**
           * What HAD reported, so the report reads as a sequence rather than a single complaint.
           *
           * 2026-09-09 (triple-check) — through `describeRun`, which is the ONE place that knows
           * clip-scoped stages live under a different key. This built the sequence itself from
           * `runs.get(key)`, so the moment locate became clip-scoped it silently dropped out of every
           * diagnostic — the stage Tim had just called fundamental, missing from the event that
           * exists to explain a bad read. Two readers of the same data and I updated one.
           * [[two-owners-is-the-root-cause]]
           */
          seen: describeRun(key)?.stages || 'none',
          runKey: key.slice(-60),
        },
        'diag',
      );
  } catch { /* diagnostics are best-effort */ }
  return missing;
}

/**
 * 2026-09-09 — REPORT A LOCATE WITHOUT KNOWING ANYTHING ABOUT KEYS.
 *
 * The locate functions run before a window exists, and none of them should have to reason about run
 * keys or scope to say what they found. They know the clip; that is the whole key a clip-scoped
 * stage needs. One entry point, so the three locate mechanisms cannot key themselves three ways.
 */
export function noteLocate(
  clipUri: string | null | undefined,
  status: StageStatus,
  detail?: Record<string, unknown>,
): void {
  noteStage(runKeyFor(clipUri, 0, 0), 'locate', status, detail);
}

/** The run so far, for a report. Null when nothing has been recorded for this key. */
export function describeRun(key: string): { key: string; stages: string } | null {
  const r = runs.get(key);
  const clip = runs.get(clipKeyOf(key));
  if (!r && !clip) return null;
  // Clip-scoped stages are merged in, so a run reads as ONE sequence — `locate:ok → pose:ok → …` —
  // rather than hiding the stage that decided which seconds everything else read.
  const recOf = (s: Stage) => (STAGE_SCOPE[s] === 'clip' ? clip : r)?.stages[s];
  return {
    key,
    stages: STAGE_ORDER.filter(s => recOf(s)).map(s => `${s}:${recOf(s)?.status}`).join(' → '),
  };
}

/** Test seam. Not called in app code. */
export function __resetPipelineForTest(): void {
  runs.clear();
}
