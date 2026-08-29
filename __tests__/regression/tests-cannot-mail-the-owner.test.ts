/**
 * 2026-08-29 — the test suite must not be able to file a field issue.
 *
 * On 2026-08-28 twelve entries arrived in Tim's inbox as "voice_silent_fail: stated_yardage_refused"
 * from a beta tester on hole 4, twelve of them inside 20ms. The values were NaN, ±Infinity, 0, -1,
 * -120, 850, 900 and 10000 — the fixture table of stated-yardage-is-a-yardage.test.ts, whose
 * freshRound() sets currentHole 4. There was no tester. The first version of the
 * setUserStatedYardage guard filed its refusals to the issue log, the store auto-sends on every
 * entry, and the logic suite runs under plain node with real global fetch against the production
 * host — so the suite mailed its own passing assertions in as field failures.
 *
 * The setter was fixed to log to console. This asserts the thing that actually keeps it from
 * happening again, which is not about yardages at all:
 *
 *      UNDER A TEST RUNNER, NOTHING LEAVES THE DEVICE.
 *
 * Asserted at the wire — a fetch spy — rather than by reading the source, so it fails if the guard
 * is removed, moved, or short-circuited by a caller that reaches autoSendIssues() directly. The spy
 * is also what makes this test safe to run: if the guard were gone, the POST is captured here
 * instead of reaching production.
 */

import { useIssueLogStore } from '../../store/issueLogStore';
import { autoSendIssues, scheduleIssueAutoSend } from '../../services/issueLogExport';

const realFetch = global.fetch;
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  global.fetch = jest.fn(async (url: unknown) => {
    calls.push(String(url));
    // Never a real request: if the guard has regressed we record it and hand back a plausible
    // response, so the failure shows up as an assertion rather than as network traffic.
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as never;
  }) as never;
  useIssueLogStore.setState({ entries: [] } as never);
});

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

const ctx = {
  route: 'caddie', persona: 'kevin', isRoundActive: true,
  courseId: null, currentHole: 4, appVersion: '1.0.0',
} as never;

describe('a test run cannot reach /api/issue-report', () => {
  it('recognises that it is running under a test runner', () => {
    // The premise the guard rests on. If this is ever false in CI, the guard below is inert and
    // every assertion in this file passes for the wrong reason.
    expect(process.env.JEST_WORKER_ID != null || process.env.NODE_ENV === 'test').toBe(true);
  });

  it('does not send when a voice failure is logged, debounce elapsed', async () => {
    jest.useFakeTimers();
    // The exact shape of the 08-28 incident: a store guard refusing a value and filing it.
    useIssueLogStore.getState().addVoiceEvent('voice_silent_fail', 'stated_yardage_refused', ctx, {
      value: 850, source: 'user', hole: 4,
    });
    expect(useIssueLogStore.getState().entries.length).toBe(1); // it IS logged — device-side only
    jest.advanceTimersByTime(60_000);                            // past the 4s debounce and the 20s cap
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it('does not send for a burst, the way a fixture table arrives', async () => {
    jest.useFakeTimers();
    for (const value of [NaN, Infinity, -Infinity, 0, -1, -120, 850, 900, 10_000]) {
      useIssueLogStore.getState().addVoiceEvent('voice_silent_fail', 'stated_yardage_refused', ctx, { value });
    }
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it('does not arm a timer at all, so nothing survives the run', () => {
    jest.useFakeTimers();
    scheduleIssueAutoSend();
    // A pending timer is both a send waiting to happen and an open handle that outlives the suite.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('refuses a direct call, not just the scheduled one', async () => {
    useIssueLogStore.getState().addVoiceEvent('voice_error', 'speak_api_error', ctx, { status: 500 });
    await expect(autoSendIssues()).resolves.toBe(false);
    expect(calls).toEqual([]);
  });
});
