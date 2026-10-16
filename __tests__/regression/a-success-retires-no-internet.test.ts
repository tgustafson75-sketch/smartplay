/**
 * 2026-10-15 (review G2, findings 9 + 10) — the reachability verdict and the issue log it writes to.
 *
 * 9. A cached "offline" verdict held for 20s even after one of our calls had just WORKED, so the
 *    next failed turn said "I can't get online right now" on a connection that was demonstrably up.
 * 10. The issue log is one capped list. Every fresh probe logged 'reachability' (the offline banner
 *    re-probes all through a dead zone) and every failed turn logged 'caddie_failure_reply', so a
 *    couple of hours offline pushed the unsent REPORTABLE entries out before they could be sent.
 */
jest.mock('../../services/issueLogExport', () => ({ scheduleIssueAutoSend: () => undefined }));

import { probeReachability, _resetReachabilityForTests } from '../../services/reachability';
import { failureNoticeSync } from '../../services/caddieFailureReply';
import { useConnectivityStore } from '../../store/connectivityStore';
import { useIssueLogStore } from '../../store/issueLogStore';
import { CADDIE_NOTICE_OFFLINE } from '../../services/caddieAckLines';

jest.setTimeout(60_000);

beforeEach(() => {
  _resetReachabilityForTests();
  useIssueLogStore.setState({ entries: [] } as never);
  // No control host answers: the phone is offline.
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
});

describe('finding 9 — a success retires a cached "no internet"', () => {
  it('after a working call, the next failure is not told "I can\'t get online"', async () => {
    // Frozen clock: the 20s cache window is the subject here, and a loaded test machine must not age it.
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    expect((await probeReachability()).verdict).toBe('offline');
    expect(failureNoticeSync('en')).toBe(CADDIE_NOTICE_OFFLINE.en);
    useConnectivityStore.getState().reportOnline(); // one of our requests just succeeded
    expect(failureNoticeSync('en')).not.toBe(CADDIE_NOTICE_OFFLINE.en);
    now.mockRestore();
  });
});

describe('finding 10 — diagnostics never evict reportable entries', () => {
  it('the banner re-probing an unchanged "offline" logs it once, not once per poll', async () => {
    for (let i = 0; i < 4; i++) await probeReachability({ force: true });
    const logged = useIssueLogStore.getState().entries.filter((e) => e.stage === 'reachability');
    expect(logged).toHaveLength(1);
  });

  it('300 diag entries after 30 unsent reports leave every report in place', () => {
    const log = useIssueLogStore.getState();
    const ctx = { route: null, persona: null, isRoundActive: false, courseId: null, currentHole: null, appVersion: 't' };
    for (let i = 0; i < 30; i++) log.addVoiceEvent('voice_silent_fail', `real_${i}`, ctx, {});
    for (let i = 0; i < 300; i++) useIssueLogStore.getState().addAppEvent('caddie_failure_reply', { i }, 'diag');
    const entries = useIssueLogStore.getState().entries;
    expect(entries.filter((e) => e.kind === 'voice_silent_fail')).toHaveLength(30);
    // and the log stays bounded
    expect(entries.length).toBeLessThanOrEqual(160);
  });
});
