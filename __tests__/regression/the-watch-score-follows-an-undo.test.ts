/**
 * 2026-10-15 (review) — services/watchRoundSync sent vs-par over the known-par holes beside a total
 * over ALL holes, and when an undo left no par-known score it simply stopped sending — so the wrist
 * kept showing the score that had just been taken back. Now the total covers the same holes, and the
 * stale score is cleared with a status line (the watch renders a null vsPar as "+0").
 */
jest.mock('../../services/watchBridge', () => ({
  sendLiveScore: jest.fn(async () => {}),
  sendNotification: jest.fn(async () => {}),
  sendRoundState: jest.fn(async () => {}),
  sendVoicePrompt: jest.fn(async () => {}),
}));

import * as bridge from '../../services/watchBridge';
import { startWatchRoundSync, stopWatchRoundSync } from '../../services/watchRoundSync';
import { useRoundStore } from '../../store/roundStore';

afterAll(() => { delete process.env.EXPO_PUBLIC_OWNER_EMAIL; });

beforeEach(() => {
  stopWatchRoundSync();
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_OWNER_EMAIL = 'owner@build';   // owner is the build (2026-10-27)
  useRoundStore.setState({
    isRoundActive: true, currentHole: 2, scores: {}, lastMutation: null,
    courseHoles: [{ hole: 1, par: 4 }, { hole: 2, par: 0 }, { hole: 3, par: 4 }],
  } as never);
});
afterAll(() => stopWatchRoundSync());

it('the total sent is over the same holes as vs-par', () => {
  startWatchRoundSync();
  useRoundStore.setState({ scores: { 1: 5, 2: 7 } } as never); // hole 2 has no real par
  const last = (bridge.sendLiveScore as jest.Mock).mock.calls.at(-1)![0];
  expect(last.vsPar).toBe(1);
  expect(last.totalScore).toBe(5);
});

it('an undo that leaves no par-known score clears the wrist instead of freezing it', () => {
  startWatchRoundSync();
  useRoundStore.setState({ scores: { 1: 5 } } as never);
  expect(bridge.sendLiveScore as jest.Mock).toHaveBeenCalled();
  useRoundStore.setState({ scores: {} } as never);
  expect(bridge.sendNotification as jest.Mock).toHaveBeenCalledWith('Score —', null);
});
