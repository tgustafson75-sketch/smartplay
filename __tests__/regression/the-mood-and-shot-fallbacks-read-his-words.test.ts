/**
 * 2026-10-28 (Brain review r3) — THE MOOD AND SHOT FALLBACKS READ WHAT HE SAID, NOT THE WHOLE TURN.
 *
 * When the model did not call log_emotional_state / log_shot itself, api/kevin ran
 * detectEmotionalState and extractShotReport over `userMessage` — the ASSEMBLED turn: the coaching
 * KB, [RECENT PATTERN], [HOW TIM SAYS HE FEELS], the round facts, and only then his question. Both
 * question guards are anchored to the start (a '[' never trips them) and the keyword tests matched
 * the context. So one logged "frustrated" was echoed into every later message and re-logged itself
 * each turn, and "I chunked my wedge, came up short" was stored as a 9 iron to the green lifted from
 * RECENT PATTERN — wrong-club data in the ladder Kevin learns from.
 *
 * BEHAVIOURAL: the real api/kevin handler (model stubbed at the provider boundary, no tool calls) and
 * what it hands the phone back as fallback actions.
 */
import handler from '../../api/kevin';

jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));

const seen = { user: '' };
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (_p: string, _t: string, _s: string, user: string) => {
      seen.user = user;
      return { text: 'Smooth one at the middle.', provider: 'anthropic', rounds: 1, usage: null };
    }),
  };
});
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) } },
  chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: '' } }] })) } },
})));
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));

type Action = { type?: string; state?: string; club?: string; direction?: string; outcome?: string; contactQuality?: string };
type Reply = { toolAction?: Action | null; toolActions?: Action[] };

function callKevin(body: Record<string, unknown>): Promise<Reply> {
  return new Promise((resolve) => {
    const res = {
      setHeader: () => res,
      status() { return res; },
      json(payload: Reply) { resolve(payload); return res; },
      end() { resolve({}); return res; },
    };
    void handler({ method: 'POST', headers: {}, query: {}, body } as never, res as never);
  });
}
const actions = (r: Reply): Action[] => [...(r.toolActions ?? []), ...(r.toolAction ? [r.toolAction] : [])];
const ofType = (r: Reply, type: string) => actions(r).filter((a) => a.type === type);

/** A round in progress: a fat 9 iron that found the green, and one mood he already reported. */
const IN_ROUND = {
  isRoundActive: true,
  currentHole: 6,
  skip_tts: true,
  recentShots: [{ hole: 5, shotIndex: 2, club: '9 iron', direction: 'fat', outcome: 'green', distance_yards: 140 }],
  emotionalLog: [{ state: 'frustrated', valence: 'negative', hole: 4 }],
};

describe('the fallback extractors read the player\'s words', () => {
  it('THE BUG: a neutral yardage line does not re-log the mood echoed in [HOW TIM SAYS HE FEELS]', async () => {
    const r = await callKevin({ ...IN_ROUND, message: "I've got 120 to a back pin" });
    // The context really was there — this is the message the extractor used to read.
    expect(seen.user).toContain('frustrated');
    expect(seen.user).toContain('9 iron');
    expect(ofType(r, 'log_emotional_state')).toEqual([]);
  });

  it('THE BUG: a question over water does not log a mood out of the coaching KB', async () => {
    const r = await callKevin({ ...IN_ROUND, emotionalLog: [], message: "I'm 150 out over water, what do you like" });
    expect(ofType(r, 'log_emotional_state')).toEqual([]);
  });

  it('THE BUG: "I chunked my wedge" is logged as the wedge he hit, not the 9 iron in RECENT PATTERN', async () => {
    const r = await callKevin({ ...IN_ROUND, message: 'I chunked my wedge, came up short' });
    const shots = ofType(r, 'log_shot');
    expect(shots).toHaveLength(1);
    expect(shots[0].club).toBe('wedge');
    expect(shots[0].outcome).not.toBe('green');
  });

  it('a real report in his words still logs', async () => {
    const r = await callKevin({ ...IN_ROUND, emotionalLog: [], message: "I'm so frustrated with my putting today" });
    expect(ofType(r, 'log_emotional_state').map((a) => a.state)).toEqual(['frustrated']);
  });

  it('a proactive turn (our prompt, not his words) logs nothing', async () => {
    const r = await callKevin({ ...IN_ROUND, is_proactive: true, message: "I'm so frustrated — I chunked my wedge" });
    expect(ofType(r, 'log_emotional_state')).toEqual([]);
    expect(ofType(r, 'log_shot')).toEqual([]);
  });
});
