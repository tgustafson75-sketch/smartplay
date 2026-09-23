/**
 * 2026-09-23 (triple-check) — "start a round at Crystal Springs" said mid-round replaced the live
 * round: the voice handler set the pending start, and the Caddie tab's runStartRound filed the round
 * in progress as a degraded save (no par, no stats, no recap, no WHS) and restarted at hole 1.
 */
let mockActive = true;
const mockSetPending = jest.fn();
jest.mock('../../services/golfCourseApi', () => ({
  searchCourses: jest.fn(async () => [{ id: '9', club_name: 'Pine Valley Golf Club', course_name: 'Pine Valley Golf Club', location: 'Pine Valley, NJ, US' }]),
}));
jest.mock('../../store/roundStore', () => ({
  useRoundStore: {
    getState: () => ({
      isRoundActive: mockActive,
      activeCourse: 'Echo Hills',
      setPendingStartCourse: mockSetPending,
      setPendingStartFactors() {},
    }),
  },
}));
jest.mock('../../store/guestProfileStore', () => ({
  useGuestProfileStore: { getState: () => ({ addGuest: (n: string) => ({ displayName: n }) }) },
}));

import { quickRoundHandler } from '../../services/intents/quickRoundHandler';
import type { VoiceIntent } from '../../types/voiceIntent';

const intent = (course_hint: string): VoiceIntent => ({
  intent_type: 'quick_round', parameters: { course_hint }, confidence: 'high', follow_up_question: null, raw_text: '',
} as unknown as VoiceIntent);

describe('voice quick round and a round in progress', () => {
  beforeEach(() => mockSetPending.mockClear());

  it('mid-round it refuses, says so, and starts nothing', async () => {
    mockActive = true;
    const r = await quickRoundHandler.execute(intent('Pine Valley'), {} as never);
    expect(mockSetPending).not.toHaveBeenCalled();
    expect(r.voice_response).toMatch(/mid-round at Echo Hills/);
    expect(r.side_effects).toContain('quick_round:refused_round_active');
  });

  it('with no round in progress it still starts one', async () => {
    mockActive = false;
    await quickRoundHandler.execute(intent('Pine Valley'), {} as never);
    expect(mockSetPending).toHaveBeenCalledWith('9');
  });
});
