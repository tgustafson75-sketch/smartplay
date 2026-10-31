/**
 * 2026-10-31 (Tim: "watch: round sync reaches every user") — THE OWNER GATE IS GONE.
 *
 * It was removed because a production player paired to a watch got nothing: round state, live score,
 * toasts and the caddie's spoken lines were all decided by an owner-build check. Now every push runs
 * for every user, and the boundary that matters is that a phone with no paired watch never errors.
 */
jest.mock('../../services/watchBridge', () => ({
  sendLiveScore: jest.fn(async () => {}),
  sendNotification: jest.fn(async () => {}),
  sendRoundState: jest.fn(async () => {}),
  sendVoicePrompt: jest.fn(async () => {}),
}));

import * as bridge from '../../services/watchBridge';
import { pushWatchVoicePrompt, pushWatchNotification, startWatchRoundSync, stopWatchRoundSync } from '../../services/watchRoundSync';
import { useRoundStore } from '../../store/roundStore';

beforeEach(() => {
  stopWatchRoundSync();
  jest.clearAllMocks();
});

describe('watch round sync reaches every user', () => {
  it('a non-owner with an active round gets the hole number on the watch', () => {
    useRoundStore.setState({ isRoundActive: true, currentHole: 3 } as never);
    startWatchRoundSync();
    expect(bridge.sendRoundState as jest.Mock).toHaveBeenCalledWith(true, 3);
  });

  it('a non-owner gets the caddie spoken line mirrored to the wrist', () => {
    pushWatchVoicePrompt('smooth seven');
    expect(bridge.sendVoicePrompt as jest.Mock).toHaveBeenCalledWith('smooth seven');
  });

  it('a non-owner gets a proactive notification', () => {
    pushWatchNotification('course is ready');
    expect(bridge.sendNotification as jest.Mock).toHaveBeenCalledWith('course is ready', null);
  });

  it('a phone with no paired watch: a rejected send is swallowed, nothing throws', () => {
    (bridge.sendRoundState as jest.Mock).mockImplementationOnce(async () => { throw new Error('no watch paired'); });
    useRoundStore.setState({ isRoundActive: true, currentHole: 4 } as never);
    expect(() => startWatchRoundSync()).not.toThrow();
  });

  it('a throwing sender cannot escape into the caller of a spoken line', () => {
    (bridge.sendVoicePrompt as jest.Mock).mockImplementationOnce(() => { throw new Error('watch is asleep'); });
    expect(() => pushWatchVoicePrompt('smooth seven')).not.toThrow();
  });

  it('an empty line is still never pushed — the wrist does not buzz for nothing', () => {
    pushWatchVoicePrompt('   ');
    pushWatchNotification('');
    expect(bridge.sendVoicePrompt as jest.Mock).not.toHaveBeenCalled();
    expect(bridge.sendNotification as jest.Mock).not.toHaveBeenCalled();
  });
});
