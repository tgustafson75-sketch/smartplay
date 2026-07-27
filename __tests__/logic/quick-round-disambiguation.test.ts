/**
 * 2026-07-27 (tester UX — wrong-course trap). Starting a round by voice for a course NOT in our
 * bundle resolves through golfcourseapi, which returns MANY courses for a common name. The old
 * handler silently started at the FIRST hit — a tester who meant their local "Riverside" could get
 * dropped onto a namesake states away (wrong yardages on hole 1). These lock the fix:
 *   - multiple DISTINCT matches → ask which, naming the cities (no silent wrong start)
 *   - the same club appearing as multiple tees/nines → collapsed to one, starts normally
 *   - a single confident match → starts AND voices the city so a wrong hit is caught by ear
 * The country ("US") is dropped from spoken locations to keep the confirmation tight.
 */
jest.mock('../../services/golfCourseApi', () => ({ searchCourses: jest.fn() }));
// roundStore transitively require()s bundled course JPGs, which the node/logic jest env can't
// transform. We assert on the handler's returned IntentResult (not store state), so stub the two
// stores it touches. resolveSpokenCourse stays REAL — it only reads static COURSES data, so the
// non-bundled hints below correctly fall through to the (mocked) API search.
jest.mock('../../store/roundStore', () => ({
  useRoundStore: { getState: () => ({ setPendingStartCourse() {}, setPendingStartFactors() {} }) },
}));
jest.mock('../../store/guestProfileStore', () => ({
  useGuestProfileStore: { getState: () => ({ addGuest: (n: string) => ({ displayName: n }) }) },
}));

import { searchCourses } from '../../services/golfCourseApi';
import { quickRoundHandler } from '../../services/intents/quickRoundHandler';
import type { VoiceIntent } from '../../types/voiceIntent';

const mockSearch = searchCourses as jest.MockedFunction<typeof searchCourses>;
const hit = (id: string, club: string, location: string) =>
  ({ id, club_name: club, course_name: club, location });

const intent = (parameters: Record<string, unknown>): VoiceIntent => ({
  intent_type: 'quick_round', parameters, confidence: 'high', follow_up_question: null, raw_text: '',
});

beforeEach(() => mockSearch.mockReset());

describe('quickRoundHandler — non-listed course disambiguation', () => {
  it('asks which one when the name matches several distinct courses (no silent wrong start)', async () => {
    mockSearch.mockResolvedValue([
      hit('1', 'Riverside Golf Club', 'Austin, TX, US'),
      hit('2', 'Riverside Country Club', 'Indianapolis, IN, US'),
    ]);
    const r = await quickRoundHandler.execute(intent({ course_hint: 'Riverside' }), {} as never);
    expect(r.success).toBe(false);
    expect(r.follow_up_needed).toBe(true);
    expect(r.voice_response).toContain('Austin, TX');
    expect(r.voice_response).toContain('Indianapolis, IN');
    expect(r.voice_response).not.toContain('US'); // country trimmed
    expect(r.side_effects).toContain('quick_round:ambiguous_course=2');
    // crucially, it did NOT start a round
    expect(r.side_effects.some(s => s.startsWith('quick_round:course='))).toBe(false);
  });

  it('collapses the same club appearing as multiple tees/nines and starts normally', async () => {
    mockSearch.mockResolvedValue([
      hit('a', 'Westbrook National', 'Denver, CO, US'),
      hit('a2', 'Westbrook National', 'Denver, CO, US'), // same club, different tee record
    ]);
    const r = await quickRoundHandler.execute(intent({ course_hint: 'Westbrook' }), {} as never);
    expect(r.success).toBe(true);
    expect(r.side_effects).toContain('quick_round:course=a');
    expect(r.voice_response).toContain('Denver, CO');
  });

  it('starts on a single confident match and voices the city for auditability', async () => {
    mockSearch.mockResolvedValue([hit('9', 'Pine Valley Golf Club', 'Pine Valley, NJ, US')]);
    const r = await quickRoundHandler.execute(intent({ course_hint: 'Pine Valley' }), {} as never);
    expect(r.success).toBe(true);
    expect(r.side_effects).toContain('quick_round:course=9');
    expect(r.voice_response).toContain('in Pine Valley, NJ');
    expect(r.voice_response).not.toContain('US');
  });
});
