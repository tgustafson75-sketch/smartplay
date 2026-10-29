/**
 * 2026-10-28 (voice engineering review, VOICE-ENG-1, the iOS half) — iOS answers ONE earbud press
 * with TWO remote commands (play/pause and togglePlayPause; BluetoothMediaButtonModule registers all
 * three), and voiceTriggers forwarded each to earbudControl. So every iOS press was classified as a
 * 'double': after a shush, handsFreeOrchestrator replayed the very line the player had just stopped.
 * mediaKeyBridge has coalesced the same duplicate since 09-01 (services/tapCoalescer); this path never
 * did. Driven through the real voiceTriggers → earbudControl pattern classifier.
 */
const mockBt = { listener: null as null | ((p: unknown) => void) };

jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'ios' } }));
jest.mock('../../services/bluetoothMediaEvents', () => ({
  onBluetoothMediaEvent: (_name: string, l: (p: unknown) => void) => { mockBt.listener = l; return { remove: () => undefined }; },
}));
jest.mock('../../services/mediaKeyBridge', () => ({ currentTapDevice: () => 'earbuds' }));

import { initVoiceTriggers } from '../../services/voiceTriggers';
import { subscribeTapPattern, subscribeEarbudTap } from '../../services/earbudControl';

describe('one iOS press is one tap', () => {
  it('play + togglePlayPause from one press reach the session once and classify as a single', async () => {
    jest.useFakeTimers();
    const teardown = initVoiceTriggers();
    const taps: number[] = [];
    const patterns: string[] = [];
    const u1 = subscribeEarbudTap(() => taps.push(Date.now()));
    const u2 = subscribeTapPattern((p) => patterns.push(p));
    mockBt.listener!({ type: 'play' });
    jest.advanceTimersByTime(8);
    mockBt.listener!({ type: 'playPause' });
    jest.advanceTimersByTime(500);
    expect(taps).toHaveLength(1);
    expect(patterns).toEqual(['single']);

    // A deliberate second press a second later is still its own tap.
    mockBt.listener!({ type: 'pause' });
    jest.advanceTimersByTime(500);
    expect(taps).toHaveLength(2);
    u1(); u2(); teardown();
    jest.useRealTimers();
  });
});
