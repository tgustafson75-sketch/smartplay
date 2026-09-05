/**
 * 2026-09-05 (Tim — thirteen "ROUND TRACE — Menifee Lakes Palms" emails overnight, from a tester who
 * does not exist) — THE TEST SUITE WAS THE FIELD REPORTER.
 *
 * Nobody played those rounds. `auto-sim-round-plays-the-real-pipeline` calls the REAL endRound(),
 * endRound() fire-and-forgets sendRoundTrace(), the `logic` jest project had no setup file, and
 * services/apiBase falls back to production when EXPO_PUBLIC_API_URL is unset — which it always is
 * under jest. Measured on the full suite: one `npm test` = one fake round-trace email + seven PAID
 * /api/kevin-read calls + one /api/course-geometry, all against the live host.
 *
 * Three guards, because three separate things had to be true for that inbox to be readable again:
 * the socket is closed, the emails that DO arrive name their build, and the summary agrees with the
 * timeline printed underneath it. [[field-report-was-the-test-suite]] [[no-half-fixes-enforce-every-surface]]
 */
import fs from 'fs';
import path from 'path';
import { formatRoundTrace, sendRoundTrace, startRoundTrace, trace, _resetRoundTraceSendGuard } from '../../services/roundTrace';
import { useRoundTraceStore } from '../../store/roundTraceStore';
import { useSettingsStore } from '../../store/settingsStore';

const root = path.join(__dirname, '..', '..');

describe('no test can reach the live network', () => {
  it('a production URL is rejected, not quietly answered', async () => {
    // Behavioural, not a source match: this is the actual fetch every test inherits.
    await expect(fetch('https://api.smartplaycaddie.com/api/issue-report', { method: 'POST' }))
      .rejects.toThrow(/BLOCKED: a test tried to reach the live network/);
  });

  it('the block is wired into BOTH jest projects, or half the suite is still open', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require(path.join(root, 'jest.config.js')) as { projects: { displayName?: string; preset?: string; setupFilesAfterEnv?: string[] }[] };
    expect(cfg.projects.length).toBeGreaterThan(0);
    for (const p of cfg.projects) {
      expect([p.displayName ?? p.preset, (p.setupFilesAfterEnv ?? []).some(f => f.includes('setupNoNetwork'))])
        .toEqual([p.displayName ?? p.preset, true]);
    }
  });
});

describe('the round trace sender obeys the same two gates as the other one', () => {
  const env = { ...process.env };
  beforeEach(() => { _resetRoundTraceSendGuard(); useRoundTraceStore.getState().clear(); });
  afterEach(() => { process.env = { ...env }; useSettingsStore.setState({ shareDiagnostics: true }); });

  /** Stand in for the app: no jest env vars, so isTestRunner() is false the way it is on a phone. */
  function asTheApp(): void {
    delete process.env.JEST_WORKER_ID;
    (process.env as Record<string, string>).NODE_ENV = 'production';
  }
  function captureFetch(): string[] {
    const bodies: string[] = [];
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async (_u: unknown, init: { body?: string }) => {
      bodies.push(String(init?.body ?? ''));
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }) as unknown as typeof fetch;
    return bodies;
  }
  function seedTrace(): void {
    startRoundTrace('Menifee Lakes Palms');
    trace('round', 'start', { course: 'Menifee Lakes Palms', holes: 18 });
  }

  it('a test run never mails a trace, however it got called', async () => {
    const bodies = captureFetch();  // JEST_WORKER_ID is set — this IS a test run
    seedTrace();
    expect(await sendRoundTrace('tester')).toBe(false);
    expect(bodies).toEqual([]);
  });

  it('a player who turned diagnostics OFF does not mail their round', async () => {
    asTheApp();
    useSettingsStore.setState({ shareDiagnostics: false });
    const bodies = captureFetch();
    seedTrace();
    expect(await sendRoundTrace('tester')).toBe(false);
    expect(bodies).toEqual([]);
  });

  it('and with consent, the trace carries an installId so the email names the build', async () => {
    asTheApp();
    useSettingsStore.setState({ shareDiagnostics: true });
    const bodies = captureFetch();
    seedTrace();
    expect(await sendRoundTrace('tester')).toBe(true);

    expect(bodies).toHaveLength(1);
    const entry = JSON.parse(bodies[0]).entries[0];
    expect(entry.context.kind).toBe('round_trace');
    // api/issue-report reads context.installId; without it the email misattributes the build.
    expect(typeof entry.context.installId === 'string' && entry.context.installId.length > 0).toBe(true);
    // ...and the trace still arrives as an OBJECT, or the renderer drops the whole payload.
    expect(typeof entry.details.trace).toBe('string');
  });
});

describe('the trace summary agrees with the timeline under it', () => {
  beforeEach(() => { _resetRoundTraceSendGuard(); useRoundTraceStore.getState().clear(); });

  it('counts hole 1 — the round OPENS on it, so it never emits a hole-advance row', () => {
    startRoundTrace('Menifee Lakes Palms');
    trace('round', 'start', { course: 'Menifee Lakes Palms', holes: 18, nineHole: true });
    trace('shot', 'score', { hole: 1, score: 4 });
    for (let h = 2; h <= 9; h++) {
      trace('round', 'hole', { hole: h });
      trace('shot', 'score', { hole: h, score: 4 });
    }
    const out = formatRoundTrace();
    // The exact regression: "holes seen 8" printed above a timeline listing nine.
    expect(out).toMatch(/holes seen {8}9\b/);
    expect(out).not.toMatch(/holes seen {8}8\b/);
  });
});
