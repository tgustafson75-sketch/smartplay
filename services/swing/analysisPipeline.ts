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
  const r = runs.get(key);
  const stages = r?.stages ?? {};
  return STAGE_DEPS[stage].filter((d) => {
    const rec = stages[d];
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
    getRun(key).stages[stage] = { status, at: Date.now(), detail };
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
    const r = runs.get(key);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../../store/issueLogStore') as typeof import('../../store/issueLogStore'))
      .useIssueLogStore.getState().addAppEvent(
        'analysis_stage_out_of_order',
        {
          stage,
          missing: missing.join(','),
          // What HAD reported, so the report reads as a sequence rather than a single complaint.
          seen: STAGE_ORDER
            .filter(s => r?.stages[s])
            .map(s => `${s}:${r?.stages[s]?.status}`)
            .join(' → ') || 'none',
          runKey: key.slice(-60),
        },
        'diag',
      );
  } catch { /* diagnostics are best-effort */ }
  return missing;
}

/** The run so far, for a report. Null when nothing has been recorded for this key. */
export function describeRun(key: string): { key: string; stages: string } | null {
  const r = runs.get(key);
  if (!r) return null;
  return {
    key,
    stages: STAGE_ORDER.filter(s => r.stages[s]).map(s => `${s}:${r.stages[s]?.status}`).join(' → '),
  };
}

/** Test seam. Not called in app code. */
export function __resetPipelineForTest(): void {
  runs.clear();
}
