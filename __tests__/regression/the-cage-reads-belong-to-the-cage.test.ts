/**
 * 2026-10-27 (Brain review B2) — THE CAGE TEMPLATES BELONG TO THE CAGE.
 *
 * The classifier sends "tell me more", "what's wrong with my swing" and "what'd you see" to
 * query_status tell_me_more / swing_observation from ANY screen. Both handlers read only the LAST Cage
 * session, so after a hole strategy "tell me more" spoke a feel cue from a weeks-old session, and a
 * player with no session heard "That's the main thing — nothing more to add." next_focus read the same
 * stale issue whenever there was no SmartPlan. Measured at HEAD: every one came back as a
 * voice_response template.
 *
 * BEHAVIOURAL: the real router dispatch on the real handler. Off the practice overlay, or with a
 * session that is not today's, the turn belongs to the caddie (route_to_brain, nothing spoken). On the
 * overlay with today's session the template still answers.
 */
import { VoiceCommandRouter } from '../../services/voiceCommandRouter';
import { queryStatusHandler } from '../../services/intents/queryStatusHandler';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { setActiveSurface } from '../../services/activeSurfaceRegistry';
import type { AppContext, VoiceIntent } from '../../types/voiceIntent';

const router = new VoiceCommandRouter();
router.registerHandler(queryStatusHandler);

const ctx: AppContext = {
  active_screen: 'caddie', active_round: null, current_hole: null, recent_shots: [], trust_spectrum_level: 2,
};
const ask = (topic: string, raw: string): VoiceIntent => ({
  intent_type: 'query_status', parameters: { query_topic: topic }, confidence: 'high', follow_up_question: null, raw_text: raw,
});
const DAY = 24 * 60 * 60 * 1000;
const session = (date: number) => ({
  id: `s${date}`, date, club: '7i', shots: [], dominantMiss: null, rootCause: null, summary: null,
  primary_issue: {
    issue_id: 'early_ext', name: 'Early extension', category: 'setup', severity: 'moderate', occurrence_count: 4,
    visual_reference_path: null, mechanical_breakdown: 'Hips move toward the ball.', feel_cue: 'Keep your seat back.',
    detected_in_shots: [],
  },
  drill_recommendation: { reason: 'Chair drill builds it.' },
});

beforeEach(() => {
  setActiveSurface(null);
  useSwingSessionStore.setState({ sessionHistory: [] } as never);
});

describe('anywhere but the practice overlay, these are questions for the caddie', () => {
  it.each([
    ['tell_me_more', 'tell me more'],
    ['swing_observation', "what's wrong with my swing"],
    ['swing_observation', "what'd you see"],
  ])('%s ("%s") with an OLD session → the brain, nothing spoken', async (topic, raw) => {
    useSwingSessionStore.setState({ sessionHistory: [session(Date.now() - 20 * DAY)] } as never);
    setActiveSurface('caddie');
    const r = await router.dispatch(ask(topic, raw), ctx);
    expect([r.route_to_brain, r.voice_response]).toEqual([true, null]);
  });

  it.each([
    ['tell_me_more', 'tell me more'],
    ['swing_observation', 'what did you notice'],
  ])('%s with NO session at all → the brain, not "nothing more to add"', async (topic, raw) => {
    const r = await router.dispatch(ask(topic, raw), ctx);
    expect([r.route_to_brain, r.voice_response]).toEqual([true, null]);
  });

  it('even TODAY\'s session is not the answer when the overlay is not up', async () => {
    useSwingSessionStore.setState({ sessionHistory: [session(Date.now())] } as never);
    setActiveSurface('caddie');
    const r = await router.dispatch(ask('tell_me_more', 'tell me more'), ctx);
    expect(r.route_to_brain).toBe(true);
  });

  it('next_focus with a session that is not from today → the brain', async () => {
    useSwingSessionStore.setState({ sessionHistory: [session(Date.now() - 3 * DAY)] } as never);
    const r = await router.dispatch(ask('next_focus', 'what did I do wrong'), ctx);
    expect([r.route_to_brain, r.voice_response]).toEqual([true, null]);
  });
});

describe('on the practice overlay, with today\'s session, the template still answers', () => {
  beforeEach(() => {
    useSwingSessionStore.setState({ sessionHistory: [session(Date.now())] } as never);
    setActiveSurface('cage');
  });

  it('swing_observation names the issue', async () => {
    const r = await router.dispatch(ask('swing_observation', "what'd you see"), ctx);
    expect(r.voice_response).toBe('Early extension. Hips move toward the ball.');
    expect(r.route_to_brain).toBeFalsy();
  });

  it('tell_me_more gives the feel cue and the drill reason', async () => {
    const r = await router.dispatch(ask('tell_me_more', 'tell me more'), ctx);
    expect(r.voice_response).toBe('Keep your seat back. Chair drill builds it.');
  });

  it('next_focus with today\'s issue answers from it', async () => {
    const r = await router.dispatch(ask('next_focus', 'what should I work on'), ctx);
    expect(r.voice_response).toBe('Early extension. Keep your seat back.');
  });
});
