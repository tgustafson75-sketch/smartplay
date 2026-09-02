/**
 * 2026-09-02 — the harness export exists because a run that never leaves the phone cannot be
 * shared. These lock the three ways a report could quietly lose its findings: a partial run reading
 * as a clean sweep, a slow PASS vanishing because only failures are interesting, and a trace
 * (stalls / swallowed errors) being dropped because every check was green.
 */
import { formatRunReport } from '../../services/harness/report';
import type { ScenarioReport } from '../../services/harness/assert';

const AT = new Date('2026-09-02T12:00:00.000Z');

function rep(over: Partial<ScenarioReport> = {}): ScenarioReport {
  return {
    id: 'SC-01', title: 'A scenario', status: 'pass', durationMs: 100,
    checks: [{ label: 'a check', status: 'pass', atMs: 10 }],
    ...over,
  };
}

describe('formatRunReport', () => {
  it('says so when nothing ran, rather than reading as a clean sweep', () => {
    const out = formatRunReport([], {}, [], AT);
    expect(out).toContain('No scenarios have been run');
  });

  it('names the scenarios that were NOT run', () => {
    const out = formatRunReport([rep()], {}, ['SC-02', 'SC-03'], AT);
    expect(out).toContain('NOT RUN');
    expect(out).toContain('SC-02, SC-03');
  });

  it('leads with the counts and the failing ids', () => {
    const out = formatRunReport([
      rep(),
      rep({ id: 'SC-09', status: 'fail', checks: [{ label: 'broke', status: 'fail', detail: 'why' }] }),
      rep({ id: 'SC-10', status: 'skip', checks: [{ label: 'nope', status: 'skip' }] }),
    ], {}, [], AT);
    expect(out).toContain('1 pass · 1 fail · 1 skip');
    expect(out).toContain('FAILED   SC-09');
    expect(out).toContain('↳ why');
  });

  it('surfaces a SLOW PASS — the finding that no pass/fail row shows', () => {
    const out = formatRunReport([
      rep({ id: 'SC-05', checks: [{ label: 'locate the swing', status: 'pass', ms: 4200 }] }),
    ], {}, [], AT);
    expect(out).toContain('SLOWEST STEPS');
    expect(out).toContain('4200ms  SC-05 · locate the swing');
  });

  it('surfaces stalls and swallowed errors on an all-green run', () => {
    const out = formatRunReport([
      rep({ trace: { maxLagMs: 1180, logs: ['TypeError: nope'], flow: ['+5ms boot'] } }),
    ], {}, [], AT);
    expect(out).toContain('JS THREAD STALLS');
    expect(out).toContain('1180ms  SC-01');
    expect(out).toContain('SWALLOWED CONSOLE ERRORS');
    expect(out).toContain('TypeError: nope');
    expect(out).toContain('+5ms boot');
  });

  it('prints the device facts it was given, and admits when it has none', () => {
    expect(formatRunReport([rep()], { os: 'ios 18.5', poseAvailable: true }, [], AT))
      .toContain('os: ios 18.5');
    expect(formatRunReport([rep()], {}, [], AT)).toContain('DEVICE   unknown');
  });

  it('reports a scenario that threw before its asserts ran', () => {
    const out = formatRunReport([
      rep({ id: 'SC-77', status: 'fail', checks: [], error: 'boom' }),
    ], {}, [], AT);
    expect(out).toContain('THROW · boom');
  });

  it('truncates honestly rather than emitting an unbounded string', () => {
    const huge = Array.from({ length: 4000 }, (_, i) =>
      rep({ id: `SC-${i}`, checks: [{ label: 'x'.repeat(120), status: 'pass' }] }));
    const out = formatRunReport(huge, {}, [], AT);
    expect(out.length).toBeLessThan(101_000);
    expect(out).toContain('[truncated at');
  });
});
