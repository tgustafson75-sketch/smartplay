/**
 * 2026-08-24 (Tim: "wire them owner-only") — THE GATE IS WHAT MAKES THIS SHIPPABLE MID-FREEZE.
 *
 * services/watchCaddieBridge has registered the watchBridge sender since 07-06 and its header says
 * "sendNotification/sendLiveScore/sendVoicePrompt/sendRoundState from anywhere in the app now
 * actually reach the watch." The transport was real; all four senders had ZERO callers. The pipe was
 * built, connected, and nothing was ever put into it.
 *
 * Watch extras are Beta 2 under the feature freeze, so this ships now ONLY because it cannot appear
 * for anyone but the owner. That is the property worth a test — not the plumbing, the boundary.
 */
jest.mock('../../services/watchBridge', () => ({
  sendLiveScore: jest.fn(async () => {}),
  sendNotification: jest.fn(async () => {}),
  sendRoundState: jest.fn(async () => {}),
  sendVoicePrompt: jest.fn(async () => {}),
}));

import * as bridge from '../../services/watchBridge';
import { pushWatchVoicePrompt, pushWatchNotification, startWatchRoundSync, stopWatchRoundSync } from '../../services/watchRoundSync';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRoundStore } from '../../store/roundStore';

const setEmail = (email: string | null) => usePlayerProfileStore.setState({ email } as never);
const sends = () =>
  (bridge.sendVoicePrompt as jest.Mock).mock.calls.length +
  (bridge.sendNotification as jest.Mock).mock.calls.length +
  (bridge.sendLiveScore as jest.Mock).mock.calls.length +
  (bridge.sendRoundState as jest.Mock).mock.calls.length;

beforeEach(() => {
  stopWatchRoundSync();
  jest.clearAllMocks();
});

describe('the watch stays owner-only', () => {
  it('a tester gets NOTHING — no spoken line, no toast, no score, no state', () => {
    setEmail('someone.else@example.com');
    pushWatchVoicePrompt('smooth seven');
    pushWatchNotification('course is ready');
    startWatchRoundSync();
    useRoundStore.setState({ isRoundActive: true, currentHole: 3 } as never);
    expect(sends()).toBe(0);
  });

  it('an ABSENT email is treated as not-owner, not as owner-by-default', () => {
    setEmail(null);
    pushWatchVoicePrompt('smooth seven');
    startWatchRoundSync();
    expect(sends()).toBe(0);
  });

  it('the owner does get the spoken line', () => {
    setEmail('t.gustafson75@gmail.com');
    pushWatchVoicePrompt('smooth seven');
    expect(bridge.sendVoicePrompt as jest.Mock).toHaveBeenCalledWith('smooth seven');
  });

  it('the owner gets round state on a hole change', () => {
    setEmail('t.gustafson75@gmail.com');
    useRoundStore.setState({ isRoundActive: true, currentHole: 3 } as never);
    startWatchRoundSync();
    expect(bridge.sendRoundState as jest.Mock).toHaveBeenCalledWith(true, 3);
  });

  it('an empty line is never pushed — the wrist does not buzz for nothing', () => {
    setEmail('t.gustafson75@gmail.com');
    pushWatchVoicePrompt('   ');
    pushWatchNotification('');
    expect(sends()).toBe(0);
  });

  it('a push can never throw into its caller — a dead watch must not break the phone', () => {
    setEmail('t.gustafson75@gmail.com');
    (bridge.sendVoicePrompt as jest.Mock).mockImplementationOnce(() => { throw new Error('watch is asleep'); });
    expect(() => pushWatchVoicePrompt('smooth seven')).not.toThrow();
  });

  it('a rejected send is swallowed too, not left as an unhandled rejection', () => {
    setEmail('t.gustafson75@gmail.com');
    (bridge.sendVoicePrompt as jest.Mock).mockImplementationOnce(async () => { throw new Error('no route'); });
    expect(() => pushWatchVoicePrompt('smooth seven')).not.toThrow();
  });

  /**
   * 2026-08-24 (verification pass) — HYDRATION ORDER MUST NOT DECIDE THE FEATURE.
   *
   * startWatchRoundSync used to early-return when the owner check failed, and never retry. But
   * playerProfileStore is async-persisted and the watch bridge initialises off a DIFFERENT store's
   * hydration flag, so on a cold boot the email could still be null — and the watch would then
   * receive nothing for the whole session. The owner check now lives at every push instead of being
   * decided once, too early.
   */
  it('an owner whose profile hydrates LATE still gets the watch, without a restart', () => {
    setEmail(null);                       // profile not hydrated yet
    useRoundStore.setState({ isRoundActive: true, currentHole: 7 } as never);
    startWatchRoundSync();
    expect(sends()).toBe(0);              // correctly silent while we do not know who this is

    setEmail('t.gustafson75@gmail.com');  // hydration lands
    expect(bridge.sendRoundState as jest.Mock).toHaveBeenCalledWith(true, 7);
  });

  it('a tester whose profile hydrates late still gets nothing', () => {
    setEmail(null);
    startWatchRoundSync();
    setEmail('someone.else@example.com');
    useRoundStore.setState({ isRoundActive: true, currentHole: 2 } as never);
    expect(sends()).toBe(0);
  });
});
