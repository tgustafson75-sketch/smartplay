/**
 * 2026-10-29 (Brain recheck r16) — A COURSE PICKED ON THE PLAY TAB BEFORE THE ROUND REACHES KEVIN.
 *
 * setPreviewCourse sets previewCourseId and activeCourseId stays null until startRound. courseContext
 * and courseIntelligence were gated on `isRoundActive && activeCourseId`, so "how should I play Pebble
 * tomorrow" reached the brain with no COURSE LOADED card, while proShop (which reads the preview) knew
 * the same course for its phone number. One owner now: the course in play, from the same chain
 * smartFinderService resolves.
 *
 * BEHAVIOURAL: the real stores → the real payload builder with no caller extras → the real api/kevin
 * handler (model stubbed at the provider boundary) → the prompt.
 */
import handler from '../../api/kevin';
import { useRoundStore } from '../../store/roundStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';

const seen: { system: string; user: string } = { system: '', user: '' };
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (_provider: string, _tier: string, system: string, user: string) => {
      seen.system = system;
      seen.user = user;
      return { text: 'ok', provider: 'anthropic', rounds: 1, usage: null };
    }),
  };
});
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) } },
  chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: '' } }] })) } },
})));
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));
// A golfcourseapi course: the record fetch is stubbed; everything after it is real.
const mockGetCourse = jest.fn(async () => ({ id: 'api-123' }));
jest.mock('../../services/golfCourseApi', () => ({
  ...jest.requireActual('../../services/golfCourseApi'),
  getCourse: (...args: unknown[]) => (mockGetCourse as (...a: unknown[]) => unknown)(...args),
  courseSummaryForContext: jest.fn(() => 'Api Pines. Hole 15: Par 3, 162 yds.'),
}));

function callKevin(body: Record<string, unknown>): Promise<number> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      setHeader: () => res,
      status(code: number) { status = code; return res; },
      json() { resolve(status); return res; },
      end() { resolve(status); return res; },
    };
    void handler({ method: 'POST', headers: {}, query: {}, body } as never, res as never);
  });
}

/** What askCaddie sends before the round: the builder with only the message and the language. */
async function offRoundPrompt(message: string): Promise<string> {
  seen.system = ''; seen.user = '';
  await callKevin({ ...buildCaddieRequestBody({ message, language: 'en' }), skip_tts: true });
  return seen.system + '\n' + seen.user;
}

function pickOnPlayTab(previewCourseId: string) {
  useRoundStore.setState({
    isRoundActive: false,
    activeCourseId: null,
    pendingStartCourseId: null,
    previewCourseId,
    courseHoles: [],
  } as never);
}

describe('a course picked before the round is the course the caddie is asked about', () => {
  beforeEach(() => { mockGetCourse.mockClear(); });

  it('a bundled course: the payload carries its card with no round running', () => {
    pickOnPlayTab('local:crane-creek');
    const body = buildCaddieRequestBody({ message: 'how should I play this one tomorrow', language: 'en' });
    expect(body.courseContext).toEqual(expect.stringContaining('Hole 1: Par'));
  });

  it('THE BUG: the brain prompt names COURSE LOADED for the previewed course, off-round', async () => {
    pickOnPlayTab('local:crane-creek');
    const p = await offRoundPrompt('how should I play this one tomorrow');
    expect(p).toContain('COURSE LOADED');
    expect(p).toContain('Hole 1: Par');
  });

  it('a golfcourseapi course: fetched once for the session, not once per turn', async () => {
    pickOnPlayTab('api-123');
    await offRoundPrompt('what is the trouble on the back nine');  // starts the one fetch
    await new Promise((r) => setImmediate(r));
    const p = await offRoundPrompt('what is the trouble on the back nine');
    expect(p).toContain('Api Pines. Hole 15: Par 3, 162 yds.');
    expect(mockGetCourse).toHaveBeenCalledTimes(1);
  });

  it('nothing picked: no course card, and no lookup', () => {
    useRoundStore.setState({ isRoundActive: false, activeCourseId: null, pendingStartCourseId: null, previewCourseId: null, courseHoles: [] } as never);
    const body = buildCaddieRequestBody({ message: 'how should I play tomorrow', language: 'en' });
    expect(body.courseContext).toBeNull();
    expect(mockGetCourse).not.toHaveBeenCalled();
  });
});
