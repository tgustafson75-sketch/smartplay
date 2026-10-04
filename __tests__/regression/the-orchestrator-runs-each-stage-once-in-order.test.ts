/**
 * 2026-10-04 — the SmartMotion orchestrator engine (docs/SMARTMOTION-ORCHESTRATOR.md). Nothing owned the
 * order of 27 analysis stages; this engine does. These pin its rules: dependencies, critical first,
 * once only, budgets, cancellation, joining, one report per failure.
 */
import { AnalysisRun, getOrStartRun, _clearRunsForTest, type StageDef } from '../../services/swing/orchestrator/engine';

const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => _clearRunsForTest());

describe('the orchestrator engine', () => {
  it('runs dependencies first, critical before secondary, each stage once', async () => {
    const order: string[] = [];
    const st = (id: string, deps: string[] = [], critical = false): StageDef<null> => ({
      id, deps, critical, budgetMs: 1000, run: async () => { order.push(id); return id; },
    });
    // 'tempo' only depends on window, but it is secondary — it must wait for the critical read.
    const run = new AnalysisRun('k', [st('window', [], true), st('read', ['window'], true), st('tempo', ['window']), st('pose', ['read'])], null);
    run.start();
    const snap = await run.done;
    expect(order).toEqual(['window', 'read', 'tempo', 'pose']);
    expect(Object.values(snap.stages).every((s) => s.status === 'ok')).toBe(true);
  });

  it('a stage over its budget fails, is reported once, and its dependents are skipped — the run still ends', async () => {
    const failed: string[] = [];
    const run = new AnalysisRun('k', [
      { id: 'read', critical: true, budgetMs: 20, run: () => new Promise((r) => setTimeout(() => r('late'), 200)) },
      { id: 'pose', deps: ['read'], budgetMs: 1000, run: async () => 'x' },
      { id: 'arc', deps: ['pose'], budgetMs: 1000, run: async () => 'y' },
    ], null, { onStageFailed: (_k, s) => failed.push(s) });
    run.start();
    const snap = await run.done;
    expect(snap.stages.read.status).toBe('failed');
    expect(snap.stages.read.error).toBe('budget');
    expect(snap.stages.pose.status).toBe('skipped');
    expect(snap.stages.arc.status).toBe('skipped');
    expect(failed).toEqual(['read']);
  });

  it('an empty result is not a failure, and its dependents skip', async () => {
    const run = new AnalysisRun('k', [
      { id: 'ball', budgetMs: 100, run: async () => null },
      { id: 'path', deps: ['ball'], budgetMs: 100, run: async () => 'p' },
    ], null);
    run.start();
    const snap = await run.done;
    expect(snap.stages.ball.status).toBe('empty');
    expect(snap.stages.path.status).toBe('skipped');
  });

  it('when() can skip a stage for this input', async () => {
    const run = new AnalysisRun('k', [{ id: 'ballPath', budgetMs: 100, when: () => false, run: async () => 'p' }], null);
    run.start();
    expect((await run.done).stages.ballPath.status).toBe('skipped');
  });

  it('cancel aborts what is running and pending, and every stage sees the signal', async () => {
    let sawAbort = false;
    const run = new AnalysisRun('k', [
      { id: 'read', critical: true, budgetMs: 5000, run: ({ signal }) => new Promise((r) => { signal.addEventListener('abort', () => { sawAbort = true; r(null); }); }) },
      { id: 'pose', deps: ['read'], budgetMs: 100, run: async () => 'x' },
    ], null);
    run.start();
    await tick();
    run.cancel();
    const snap = await run.done;
    expect(sawAbort).toBe(true);
    expect(snap.stages.read.status).toBe('cancelled');
    expect(snap.stages.pose.status).toBe('cancelled');
  });

  it('asking again while a run is going joins it; after it ends, a new run starts', async () => {
    let builds = 0;
    const build = () => { builds++; return { stages: [{ id: 'read', critical: true, budgetMs: 100, run: async () => { await tick(); return 'r'; } }] as StageDef<null>[], input: null }; };
    const a = getOrStartRun('s1', build);
    const b = getOrStartRun('s1', build);
    expect(a).toBe(b);
    expect(builds).toBe(1);
    await a.done;
    await tick();
    getOrStartRun('s1', build);
    expect(builds).toBe(2);
  });

  it('subscribers see each stage land (progressive results)', async () => {
    const seen: string[] = [];
    const run = new AnalysisRun('k', [
      { id: 'read', critical: true, budgetMs: 100, run: async () => 'r' },
      { id: 'pose', deps: ['read'], budgetMs: 100, run: async () => 'p' },
    ], null);
    run.subscribe((s) => { for (const [id, st] of Object.entries(s.stages)) if (st.status === 'ok' && !seen.includes(id)) seen.push(id); });
    run.start();
    await run.done;
    expect(seen).toEqual(['read', 'pose']);
  });
});

/**
 * 2026-10-04 (sweep) — a stage that overran its budget used to lose the race and keep WORKING: the
 * real stages ignored the run's signal and wrote stale windows/verdicts over the next run. The engine
 * now aborts the stage's own signal, and the store handle the read and pose pass write through goes
 * quiet once it is aborted.
 */
describe('an abandoned stage stops writing', () => {
  it('budget overrun aborts that stage\'s signal', async () => {
    jest.useRealTimers();
    const { AnalysisRun } = await import('../../services/swing/orchestrator/engine');
    let seen: AbortSignal | null = null;
    const run = new AnalysisRun('k', [{ id: 'slow', budgetMs: 20, run: ({ signal }) => { seen = signal; return new Promise(() => undefined); } }], {});
    run.start();
    const snap = await run.done;
    expect(snap.stages.slow.status).toBe('failed');
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
  });

  it('the guarded store passes writes through until the signal aborts, then drops them', async () => {
    const { liveSessionStore } = await import('../../services/swing/orchestrator/liveSessionStore');
    const { useSwingSessionStore } = await import('../../store/swingSessionStore');
    useSwingSessionStore.setState({ sessionHistory: [{ id: 'g1', analysis_status: 'pending', shots: [] }] as never });
    const ctrl = new AbortController();
    const store = liveSessionStore(ctrl.signal);            // captured BEFORE the abort, like the real code
    store.setSessionAnalysisStatus('g1', 'analyzing_pose' as never);
    expect(useSwingSessionStore.getState().sessionHistory[0].analysis_status).toBe('analyzing_pose');
    ctrl.abort();
    store.setSessionAnalysisStatus('g1', 'ok');
    expect(useSwingSessionStore.getState().sessionHistory[0].analysis_status).toBe('analyzing_pose');
    expect(store.sessionHistory[0].id).toBe('g1');         // reads still work
  });

  it('the read and the pose pass take the store only through that handle', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services/videoUpload.ts'), 'utf8');
    for (const head of ['async function runPhaseKOnSessionImpl(sessionId: string, signal?: AbortSignal)', 'export async function runUploadPosePass(sessionId: string, signal?: AbortSignal)']) {
      const i = src.indexOf(head);
      expect(i).toBeGreaterThan(-1);
      const rest = src.slice(i + head.length);
      const end = rest.search(/\n(export |async function |function )/);
      const body = rest.slice(0, end);
      expect(body).not.toMatch(/useSwingSessionStore\.getState\(\)/);
      expect(body).toMatch(/liveSessionStore\(signal\)/);
    }
  });
});
