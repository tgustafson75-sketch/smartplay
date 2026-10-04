/**
 * The SmartMotion orchestrator engine — see docs/SMARTMOTION-ORCHESTRATOR.md for the rules.
 *
 * A RUN owns one clip window's analysis. Stages declare what they need; the engine starts each one
 * exactly once, when its dependencies have produced output, critical stages before secondary ones,
 * each under its own budget, all under one AbortSignal. Screens subscribe and render each stage as
 * it lands. Asking for a run that already exists joins it.
 *
 * Pure TypeScript (no React Native) so the scheduling itself is unit-tested.
 */

export type StageStatus = 'pending' | 'running' | 'ok' | 'empty' | 'failed' | 'skipped' | 'cancelled';

export interface StageContext<Input> {
  input: Input;
  /** Outputs of finished stages, by stage id. */
  outputs: Record<string, unknown>;
  signal: AbortSignal;
}

export interface StageDef<Input> {
  id: string;
  /** Must finish OK first; if one fails / is empty / skipped, this stage is skipped. */
  deps?: string[];
  /** Must FINISH first (any outcome) — ordering without requiring an output. */
  after?: string[];
  /** Critical stages run before any secondary stage starts. */
  critical?: boolean;
  budgetMs: number;
  /** Skip this stage for this input (e.g. no ball area). Checked when its deps are done. */
  when?: (ctx: StageContext<Input>) => boolean;
  /** Return the output; `null`/`undefined` means the stage ran and found nothing ('empty'). */
  run: (ctx: StageContext<Input>) => Promise<unknown>;
}

export interface StageState { status: StageStatus; ms?: number; error?: string }

export interface RunSnapshot {
  key: string;
  stages: Record<string, StageState>;
  outputs: Record<string, unknown>;
  done: boolean;
}

type Listener = (s: RunSnapshot) => void;

export interface RunHooks {
  /** Called once per stage that fails (budget overrun or a throw) — the run's single report. */
  onStageFailed?: (key: string, stage: string, error: string) => void;
  /** Called when a stage finishes in any terminal state (observation, e.g. analysisPipeline). */
  onStageDone?: (key: string, stage: string, state: StageState) => void;
  now?: () => number;
}

export class AnalysisRun<Input> {
  readonly key: string;
  private readonly stages: StageDef<Input>[];
  private readonly input: Input;
  private readonly hooks: RunHooks;
  private readonly ctrl = new AbortController();
  private readonly state: Record<string, StageState> = {};
  private readonly outputs: Record<string, unknown> = {};
  private readonly listeners = new Set<Listener>();
  private readonly stageCtrls: Record<string, AbortController> = {};
  private readonly stageCleanup: Record<string, () => void> = {};
  private finished = false;
  readonly done: Promise<RunSnapshot>;
  private resolveDone!: (s: RunSnapshot) => void;

  constructor(key: string, stages: StageDef<Input>[], input: Input, hooks: RunHooks = {}) {
    this.key = key;
    this.stages = stages;
    this.input = input;
    this.hooks = hooks;
    for (const s of stages) this.state[s.id] = { status: 'pending' };
    this.done = new Promise((r) => { this.resolveDone = r; });
  }

  snapshot(): RunSnapshot {
    return { key: this.key, stages: { ...this.state }, outputs: { ...this.outputs }, done: this.finished };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot());
    return () => { this.listeners.delete(l); };
  }

  /** Abort everything still pending or running. */
  cancel(): void {
    if (this.finished) return;
    this.ctrl.abort();
    for (const s of this.stages) {
      const st = this.state[s.id];
      if (st.status === 'pending' || st.status === 'running') this.state[s.id] = { status: 'cancelled' };
    }
    this.finish();
  }

  start(): void { void this.pump(); }

  private emit(): void {
    const snap = this.snapshot();
    this.listeners.forEach((l) => { try { l(snap); } catch { /* a listener never breaks the run */ } });
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.emit();
    this.resolveDone(this.snapshot());
  }

  private ready(s: StageDef<Input>): 'go' | 'wait' | 'blocked' {
    for (const a of s.after ?? []) {
      const st = this.state[a]?.status;
      if (st === 'pending' || st === 'running') return 'wait';
    }
    for (const d of s.deps ?? []) {
      const st = this.state[d]?.status;
      if (st === 'ok') continue;
      if (st === 'pending' || st === 'running') return 'wait';
      return 'blocked';   // a dependency failed, came back empty, was skipped or cancelled
    }
    return 'go';
  }

  private async pump(): Promise<void> {
    if (this.finished) return;
    let started = false;
    // Loop until nothing more can move: a skipped stage can unblock (skip) its dependents at once.
    for (let changed = true; changed;) {
      changed = false;
      const criticalOutstanding = this.stages.some((s) => s.critical && ['pending', 'running'].includes(this.state[s.id].status));
      for (const s of this.stages) {
        if (this.state[s.id].status !== 'pending') continue;
        const r = this.ready(s);
        if (r === 'blocked') { this.settle(s.id, { status: 'skipped' }); changed = true; started = true; continue; }
        if (r === 'wait') continue;
        if (!s.critical && criticalOutstanding) continue;   // critical first — secondary waits its turn
        // 2026-10-04 (sweep) — each stage gets ITS OWN signal, aborted when the run is cancelled OR when
        // this stage overruns its budget. Before, an overrun only lost the race: the stage's work went on
        // and kept writing to the store after the run had moved past it.
        const stageCtrl = new AbortController();
        const onRunAbort = () => stageCtrl.abort();
        if (this.ctrl.signal.aborted) stageCtrl.abort();
        else this.ctrl.signal.addEventListener('abort', onRunAbort, { once: true });
        const ctx: StageContext<Input> = { input: this.input, outputs: { ...this.outputs }, signal: stageCtrl.signal };
        this.stageCleanup[s.id] = () => this.ctrl.signal.removeEventListener('abort', onRunAbort);
        this.stageCtrls[s.id] = stageCtrl;
        if (s.when && !s.when(ctx)) { this.settle(s.id, { status: 'skipped' }); changed = true; started = true; continue; }
        started = true;
        void this.runStage(s, ctx);
      }
    }
    const anyActive = this.stages.some((s) => ['pending', 'running'].includes(this.state[s.id].status));
    if (!anyActive) { this.finish(); return; }
    if (started) this.emit();
  }

  private settle(id: string, st: StageState): void {
    this.state[id] = st;
    try { this.hooks.onStageDone?.(this.key, id, st); } catch { /* observation only */ }
  }

  private async runStage(s: StageDef<Input>, ctx: StageContext<Input>): Promise<void> {
    const now = this.hooks.now ?? Date.now;
    const t0 = now();
    this.state[s.id] = { status: 'running' };
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const out = await Promise.race([
        s.run(ctx),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => { rej(new Error('budget')); this.stageCtrls[s.id]?.abort(); }, s.budgetMs);   // budget wins the race, THEN the work is told to stop
        }),
        new Promise<never>((_, rej) => {
          if (ctx.signal.aborted) rej(new Error('cancelled'));
          ctx.signal.addEventListener('abort', () => rej(new Error('cancelled')), { once: true });
        }),
      ]);
      if (this.finished) return;
      if (out == null) this.settle(s.id, { status: 'empty', ms: now() - t0 });
      else { this.outputs[s.id] = out; this.settle(s.id, { status: 'ok', ms: now() - t0 }); }
    } catch (e) {
      if (this.finished) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'cancelled') { this.settle(s.id, { status: 'cancelled' }); }
      else {
        this.settle(s.id, { status: 'failed', ms: now() - t0, error: msg.slice(0, 160) });
        try { this.hooks.onStageFailed?.(this.key, s.id, msg); } catch { /* never breaks the run */ }
      }
    } finally {
      if (timer) clearTimeout(timer);
      this.stageCleanup[s.id]?.();
    }
    this.emit();
    void this.pump();
  }
}

/**
 * The registry: one run per key, joined if it exists and is still going — unless `restart` says the
 * live run no longer answers this request (the caller decides; uploadRun restarts once the read has
 * settled), in which case it is cancelled and a fresh run starts.
 */
const runs = new Map<string, AnalysisRun<unknown>>();

export function getOrStartRun<Input>(
  key: string,
  build: () => { stages: StageDef<Input>[]; input: Input; hooks?: RunHooks },
  restart?: (live: RunSnapshot) => boolean,
): AnalysisRun<Input> {
  const existing = runs.get(key) as AnalysisRun<Input> | undefined;
  if (existing && !existing.snapshot().done) {
    if (!restart || !restart(existing.snapshot())) return existing;
    existing.cancel();
  }
  const { stages, input, hooks } = build();
  const run = new AnalysisRun<Input>(key, stages, input, hooks);
  runs.set(key, run as AnalysisRun<unknown>);
  void run.done.then(() => { if (runs.get(key) === (run as AnalysisRun<unknown>)) runs.delete(key); });
  run.start();
  return run;
}

/** Test seam. */
export function _clearRunsForTest(): void { runs.clear(); }
