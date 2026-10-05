/**
 * 2026-10-04 (Tim: "make sure that everything can be diagnostically checked in my issue log in owner
 * tools from now on when i try smartmotion analysis or uploads in swing library. I dont think they are
 * being captured or we probably could have fixed this a long time ago").
 *
 * He was right. Every step of an analysis logged to the CONSOLE (V6-DIAG, uploadLog, [window],
 * [locate], [frames]) — visible only with a cable — and the issue log kept only FAILURES. The read
 * that analysed him turning to watch the ball instead of his swing was a "success": nothing was
 * captured, so it could only be found by reproducing it on an emulator.
 *
 * Now every analysis — a Swing Library upload or a SmartMotion review — writes ONE issue-log entry,
 * kind 'analysis_trace': the whole timeline (where the swing was looked for and how, which window was
 * chosen, frames, pose, the server's read and its answer, every fallback), each step stamped with
 * seconds since the start. It shows in Owner Tools → Issue Log → Analysis, and travels with Send
 * Report. A run that went wrong (failed, tentative, couldn't read, low confidence, never finished)
 * is flagged `problem` so it is auto-sent like an error.
 *
 * Steps reach the trace from the existing breadcrumbs (V6 in poseDetection, uploadLog, the window
 * finder, the frame engine, the clip-copy pool) without threading an id: a step is added to every
 * trace currently open — in practice one analysis runs at a time.
 */

type Step = { t: number; s: string };
type Trace = {
  id: string;
  source: 'upload' | 'smartmotion';
  startedAt: number;
  meta: Record<string, unknown>;
  steps: Step[];
  dropped: number;
  endTimer: ReturnType<typeof setTimeout> | null;
  outcome: Record<string, unknown> | null;
  /** Written if the run never reports an end (a hang is exactly what must be visible). */
  deadline: ReturnType<typeof setTimeout> | null;
};

const MAX_STEPS = 90;
const NEVER_FINISHED_MS = 4 * 60_000;
const open = new Map<string, Trace>();

function short(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  try {
    const j = JSON.stringify(v);
    return j.length > 120 ? `${j.slice(0, 117)}…` : j;
  } catch { return '?'; }
}

function render(step: string, data?: Record<string, unknown> | null): string {
  if (!data) return step;
  const parts = Object.entries(data)
    .filter(([k, v]) => v !== undefined && k !== 'ts' && k !== 'delta_ms' && k !== 'elapsed_total_ms' && k !== 'session_key')
    .map(([k, v]) => `${k}=${short(v)}`);
  return parts.length ? `${step} · ${parts.join(' ')}` : step;
}

/** Open a trace for one analysis. Idempotent per id (a joined run does not restart its timeline). */
export function beginAnalysisTrace(id: string, source: Trace['source'], meta: Record<string, unknown> = {}): void {
  if (open.has(id)) return;
  const tr: Trace = { id, source, startedAt: Date.now(), meta, steps: [], dropped: 0, endTimer: null, outcome: null, deadline: null };
  tr.deadline = setTimeout(() => {
    if (open.get(id) === tr) write(tr, { result: 'never_finished', problem: true });
  }, NEVER_FINISHED_MS);
  open.set(id, tr);
}

/** Add a step to every open trace. Never throws; cheap when nothing is open. */
export function traceStep(step: string, data?: Record<string, unknown> | null): void {
  if (open.size === 0) return;
  try {
    const now = Date.now();
    const s = render(step, data);
    for (const tr of open.values()) {
      if (tr.steps.length >= MAX_STEPS) { tr.dropped++; continue; }
      tr.steps.push({ t: now - tr.startedAt, s });
    }
  } catch { /* a trace must never break an analysis */ }
}

/**
 * Close a trace. `lingerMs` keeps it open a little longer so the second pass (pose, club path) that
 * runs after the read lands in the same entry. The outcome decides whether it is a `problem`.
 */
export function endAnalysisTrace(id: string, outcome: Record<string, unknown>, lingerMs = 0): void {
  const tr = open.get(id);
  if (!tr) return;
  tr.outcome = { ...(tr.outcome ?? {}), ...outcome };
  if (tr.endTimer) clearTimeout(tr.endTimer);
  if (lingerMs <= 0) { write(tr, tr.outcome); return; }
  tr.endTimer = setTimeout(() => write(tr, tr.outcome ?? outcome), lingerMs);
}

/** A run that went wrong — failed, tentative, unread, low confidence, never finished. */
export function isProblemOutcome(o: Record<string, unknown>): boolean {
  if (o.problem === true) return true;
  const r = String(o.result ?? '');
  if (/fail|error|never_finished|no_frames|tentative|cancel/i.test(r)) return true;
  const issue = String(o.issue ?? '');
  const conf = String(o.confidence ?? '');
  // "none" alone is a clean swing, not a problem; low confidence or "couldn't see" is.
  return conf === 'low' || (/couldn|inconclusive/i.test(issue) && conf !== 'high');
}

function write(tr: Trace, outcome: Record<string, unknown>): void {
  if (open.get(tr.id) !== tr) return;
  open.delete(tr.id);
  if (tr.endTimer) clearTimeout(tr.endTimer);
  if (tr.deadline) clearTimeout(tr.deadline);
  const totalMs = Date.now() - tr.startedAt;
  // What the timeline itself says went wrong, even when the run "succeeded" (a tentative one-frame
  // read, frames that never came, a failed copy) — the class of run that was invisible until now.
  // Case-SENSITIVE on purpose: "motion pass failed" is an ordinary fallback (the finder moves on); the
  // red ones are the tentative one-frame read, no frames, a FAILED clip copy, and the refusal to decode.
  const red = tr.steps.find((st) => /tentative|TENTATIVE|no_frames|copy FAILED|never_finished|refusing to decode/.test(st.s));
  if (red && outcome.flag == null) outcome = { ...outcome, flag: red.s.slice(0, 90) };
  const problem = isProblemOutcome(outcome) || !!red;
  const timeline = tr.steps.map((st) => `+${(st.t / 1000).toFixed(1)}s ${st.s}`);
  if (tr.dropped) timeline.push(`(+${tr.dropped} more steps not kept)`);
  try {
    const { useIssueLogStore } = require('../store/issueLogStore') as typeof import('../store/issueLogStore');
    useIssueLogStore.getState().addAnalysisTrace({
      source: tr.source,
      summary: `${tr.source === 'upload' ? 'Swing Library upload' : 'SmartMotion'} · ${render('', outcome).replace(/^ · /, '')} · ${(totalMs / 1000).toFixed(0)}s`,
      problem,
      details: { ...tr.meta, ...outcome, total_s: Math.round(totalMs / 100) / 10, timeline },
    });
  } catch { /* never break the analysis for its own log */ }
}

/** Test seam. */
export function _resetAnalysisTracesForTest(): void {
  for (const tr of open.values()) { if (tr.endTimer) clearTimeout(tr.endTimer); if (tr.deadline) clearTimeout(tr.deadline); }
  open.clear();
}
