/**
 * 2026-09-10 — THE SECOND SENDER MISSED THE MIRROR, FOR THE THIRD TIME.
 *
 * The 2026-09-06 refactor merged the issue log into Sentry and DELETED the server emailer. It was
 * wired into services/issueLogExport only. services/roundTrace POSTs its OWN entry to the same
 * /api/issue-report and never joins that `unsent` list, so for four days the round trace — and the
 * owner Field Test report built on it — landed in Supabase and nowhere anyone reads.
 *
 * Same shape as 2026-08-29 (test-runner guard) and 2026-09-05 (shareDiagnostics consent). The rule
 * now lives in services/issueFeedback and BOTH senders call it; these tests run the real sender and
 * watch both destinations, rather than string-matching the source.
 * [[field-report-was-the-test-suite]] [[two-owners-is-the-root-cause]]
 */
const captureFeedback = jest.fn();
jest.mock('@sentry/react-native', () => ({ captureFeedback: (...a: unknown[]) => captureFeedback(...a) }));

import { sendRoundTrace, startRoundTrace, trace, _resetRoundTraceSendGuard } from '../../services/roundTrace';
import { useRoundTraceStore } from '../../store/roundTraceStore';
import { useSettingsStore } from '../../store/settingsStore';

type Feedback = { message: string; name: string; source: string; tags: Record<string, string> };

describe('a round trace reaches Sentry, not just Supabase', () => {
  const env = { ...process.env };
  let bodies: string[] = [];

  beforeEach(() => {
    _resetRoundTraceSendGuard();
    useRoundTraceStore.getState().clear();
    captureFeedback.mockClear();
    bodies = [];
    // Stand in for the app: no jest env vars, so isTestRunner() is false the way it is on a phone.
    delete process.env.JEST_WORKER_ID;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    useSettingsStore.setState({ shareDiagnostics: true });
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async (_u: unknown, init: { body?: string }) => {
      bodies.push(String(init?.body ?? ''));
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { process.env = { ...env }; useSettingsStore.setState({ shareDiagnostics: true }); });

  const fb = (): Feedback => captureFeedback.mock.calls[0][0] as Feedback;
  const posted = () => JSON.parse(bodies[0]).entries[0];

  it('mirrors an ordinary trace into Sentry after the POST succeeds', async () => {
    startRoundTrace('Menifee Lakes Palms');
    trace('round', 'start', { course: 'Menifee Lakes Palms', holes: 18 });
    expect(await sendRoundTrace('tester')).toBe(true);

    expect(captureFeedback).toHaveBeenCalledTimes(1);
    expect(fb().source).toBe('issue-log');
    expect(fb().name).toBe('tester');
  });

  it('tags an OWNER FIELD TEST distinctly, so it filters out of the trace noise in one click', async () => {
    startRoundTrace('Hemet Golf Club', true);   // deep === field test
    trace('round', 'start', { course: 'Hemet Golf Club', holes: 18 });
    expect(await sendRoundTrace('owner')).toBe(true);

    expect(fb().tags.kind).toBe('field_test');
  });

  it('says the SAME kind in Supabase and in Sentry — one entry, one fact', async () => {
    // These were briefly written out twice and disagreed: the POST hard-coded 'round_trace' while
    // the mirror computed 'field_test'. One entry must not describe itself two ways.
    startRoundTrace('Hemet Golf Club', true);
    trace('round', 'start', { course: 'Hemet Golf Club', holes: 18 });
    await sendRoundTrace('owner');

    expect(posted().context.kind).toBe('field_test');
    expect(fb().tags.kind).toBe(posted().context.kind);
  });

  it('carries the actual trace text, not "[object Object]"', async () => {
    // details is `{ trace: body }` on this path; interpolating it loses the entire document.
    startRoundTrace('Hemet Golf Club');
    trace('round', 'start', { course: 'Hemet Golf Club', holes: 18 });
    await sendRoundTrace('owner');

    expect(fb().message).not.toContain('[object Object]');
    expect(fb().message).toContain('Hemet Golf Club');
  });

  it('carries the install id, so a report can be tied to one build', async () => {
    startRoundTrace('Hemet Golf Club');
    trace('round', 'start', { course: 'Hemet Golf Club', holes: 18 });
    await sendRoundTrace('owner');

    expect(fb().tags.install_id).toEqual(expect.any(String));
    expect(fb().tags.install_id).not.toBe('unknown');
    expect(fb().tags.install_id).toBe(posted().context.installId);
  });

  it('does NOT mirror when the POST failed — Supabase is the durable record', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => (
      { ok: false, status: 500, json: async () => ({}), text: async () => '' }
    )) as unknown as typeof fetch;
    startRoundTrace('Hemet Golf Club');
    trace('round', 'start', { course: 'Hemet Golf Club', holes: 18 });
    await sendRoundTrace('owner');

    expect(captureFeedback).not.toHaveBeenCalled();
  });

  it('does NOT mirror when the player withheld consent — the gate covers BOTH destinations', async () => {
    // The 2026-09-05 defect was this sender ignoring shareDiagnostics. Adding a second destination
    // must not re-open it on the new path.
    useSettingsStore.setState({ shareDiagnostics: false });
    startRoundTrace('Hemet Golf Club');
    trace('round', 'start', { course: 'Hemet Golf Club', holes: 18 });
    expect(await sendRoundTrace('owner')).toBe(false);

    expect(bodies).toEqual([]);
    expect(captureFeedback).not.toHaveBeenCalled();
  });

  it('never lets a Sentry failure cost a trace that already sent', async () => {
    captureFeedback.mockImplementationOnce(() => { throw new Error('sentry down'); });
    startRoundTrace('Hemet Golf Club');
    trace('round', 'start', { course: 'Hemet Golf Club', holes: 18 });

    expect(await sendRoundTrace('owner')).toBe(true);
  });
});
