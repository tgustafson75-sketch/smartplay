/**
 * 2026-09-01 — THE HARNESS PROBES, TESTED IN CI.
 *
 * services/harness/probe.ts is what makes every on-device scenario report honest: it captures
 * swallowed console errors, the app's own issue-log flow, and JS-thread stalls. A probe that stopped
 * observing would fail nothing — it would report a clean device forever. C24 break-tests them on the
 * phone; this does the same on every commit, so a regression cannot reach a build. [[the-marshal-wire-integrity-score]]
 */
import { ConsoleProbe, IssueEventProbe, LoopLagProbe, LAG_NOISE_FLOOR_MS, SELFTEST_SCENARIO_ID } from '../../services/harness/probe';

describe('harness probes', () => {
  describe('ConsoleProbe', () => {
    it('captures console.error and console.warn while started', () => {
      const p = new ConsoleProbe(true);
      p.start();
      console.error('boom one');
      console.warn('boom two');
      const lines = p.stop();
      expect(lines.some((l) => l.includes('boom one') && l.includes('ERROR'))).toBe(true);
      expect(lines.some((l) => l.includes('boom two') && l.includes('WARN'))).toBe(true);
    });

    it('restores console after stop — a leaked patch would follow the app around', () => {
      const before = console.error;
      const p = new ConsoleProbe(true);
      p.start();
      expect(console.error).not.toBe(before);
      p.stop();
      expect(console.error).toBe(before);
    });

    it('still passes the line through to the real console', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const p = new ConsoleProbe(true);
      p.start();
      console.error('passthrough');
      p.stop();
      expect(spy).toHaveBeenCalledWith('passthrough');
      spy.mockRestore();
    });

    it('filters the harness\'s own echo lines by default', () => {
      const p = new ConsoleProbe();
      p.start();
      console.error('[harness C1] FAIL something');
      console.error('a real app error');
      const lines = p.stop();
      expect(lines.some((l) => l.includes('a real app error'))).toBe(true);
      expect(lines.some((l) => l.includes('[harness C1]'))).toBe(false);
    });

    it('stamps every line with an offset so the ORDER is readable', () => {
      const p = new ConsoleProbe(true);
      p.start();
      console.error('first');
      const lines = p.stop();
      expect(lines[0]).toMatch(/^\+\d+ms ERROR /);
    });

    it('caps capture so a log storm cannot balloon a report', () => {
      const p = new ConsoleProbe(true);
      p.start();
      for (let i = 0; i < 120; i++) console.error(`spam ${i}`);
      expect(p.stop().length).toBeLessThanOrEqual(40);
    });

    it('never throws when an argument cannot be stringified', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const p = new ConsoleProbe(true);
      p.start();
      expect(() => console.error('cyclic', cyclic)).not.toThrow();
      p.stop();
    });
  });

  describe('LoopLagProbe', () => {
    it('measures a real blocked thread', async () => {
      const p = new LoopLagProbe();
      p.start();
      const until = Date.now() + LAG_NOISE_FLOOR_MS + 180;
      while (Date.now() < until) { /* deliberately blocking */ }
      await new Promise((r) => setTimeout(r, 260));
      expect(p.stop()).toBeGreaterThan(0);
    });

    it('stays silent on a responsive thread — a probe that always fires is noise', async () => {
      const p = new LoopLagProbe();
      p.start();
      await new Promise((r) => setTimeout(r, 320));
      expect(p.stop()).toBe(0);
    });

    it('clears its interval on stop — a leaked sampler would tick for the life of the app', () => {
      const spy = jest.spyOn(global, 'clearInterval');
      const p = new LoopLagProbe();
      p.start();
      p.stop();
      expect(spy).toHaveBeenCalled();
      spy.mockClear();
      p.stop();                        // idempotent: no second clear, no throw
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('does not keep sampling after stop', async () => {
      const p = new LoopLagProbe();
      p.start();
      expect(p.stop()).toBe(0);
      // Block AFTER stopping. A live sampler would record this stall; a stopped one cannot.
      const until = Date.now() + LAG_NOISE_FLOOR_MS + 180;
      while (Date.now() < until) { /* deliberately blocking */ }
      await new Promise((r) => setTimeout(r, 260));
      expect(p.stop()).toBe(0);
    });
  });

  it('names the self-test scenario so the run summary can exclude its deliberate noise', () => {
    expect(SELFTEST_SCENARIO_ID).toBe('C24');
  });

  describe('IssueEventProbe', () => {
    it('returns only entries added AFTER start, oldest first', () => {
      const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
      useIssueLogStore.getState().addAppEvent('before_probe', { n: 0 }, 'diag');
      const p = new IssueEventProbe(true);
      p.start();
      useIssueLogStore.getState().addAppEvent('during_one', { n: 1 }, 'diag');
      useIssueLogStore.getState().addAppEvent('during_two', { n: 2 }, 'diag');
      const flow = p.stop();
      expect(flow.some((f) => f.includes('before_probe'))).toBe(false);
      const one = flow.findIndex((f) => f.includes('during_one'));
      const two = flow.findIndex((f) => f.includes('during_two'));
      expect(one).toBeGreaterThanOrEqual(0);
      expect(two).toBeGreaterThan(one); // oldest first — a flow read backwards is not a flow
    });

    it('hides the harness\'s own entries from app flow by default', () => {
      const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
      const p = new IssueEventProbe();
      p.start();
      useIssueLogStore.getState().addAppEvent('harness_run', { x: 1 }, 'diag');
      useIssueLogStore.getState().addAppEvent('real_app_stage', { x: 2 }, 'diag');
      const flow = p.stop();
      expect(flow.some((f) => f.includes('real_app_stage'))).toBe(true);
      expect(flow.some((f) => f.includes('harness_run'))).toBe(false);
    });
  });
});
