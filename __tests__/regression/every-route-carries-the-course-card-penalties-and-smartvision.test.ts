/**
 * 2026-10-27 (Brain review F5) — THE COURSE CARD, THE PENALTY HISTORY AND SMARTVISION'S TARGET REACH
 * THE CADDIE ON EVERY ROUTE, NOT ONLY THE FOLLOW-UP LOOP.
 *
 * courseContext, penaltyContext and smartVisionContext were filled only by caller overrides, and the
 * only caller that supplied them was useVoiceCaddie.sendToBrain — now the follow-up listen loop only.
 * The caddie-tab first turn, the earbud, the global mic, the typed box and the watch all go through
 * askCaddie → buildCaddieRequestBody with NO overrides, so on every primary turn:
 *   - "what do I hit to that?" with a SmartVision target tapped had no [SMARTVISION OPEN] block,
 *   - "what's the par on 15?" had no COURSE LOADED card (a lookup_hole round instead),
 *   - PENALTY HISTORY never rendered, though the builder computes the pattern read itself.
 *
 * BEHAVIOURAL: the real stores → the real payload builder with no caller extras (exactly what askCaddie sends) → the
 * real api/kevin handler (model stubbed at the provider boundary) → the prompt.
 */
import handler from '../../api/kevin';
import { useRoundStore } from '../../store/roundStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useSmartVisionSignalStore } from '../../store/smartVisionSignalStore';

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
jest.mock('../../services/golfCourseApi', () => ({
  ...jest.requireActual('../../services/golfCourseApi'),
  getCourse: jest.fn(async () => ({ id: 'api-123' })),
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

const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 3, 3, 5, 4];
const shot = (hole: number, outcome: string) => ({
  id: `s${hole}${outcome}${Math.random()}`, hole, club: '7i', distance: 150, direction: 'right',
  feel: 'solid', outcome, timestamp: Date.now(),
});

function startRound(currentHole: number, shots: unknown[] = []) {
  useRoundStore.setState({
    isRoundActive: true,
    activeCourse: 'Test Links',
    activeCourseId: 'local:test-links',
    currentHole,
    courseHoles: PARS.map((par, i) => ({ hole: i + 1, par, distance: 300 + i * 10 })),
    scores: {},
    shots,
  } as never);
}

/** What askCaddie sends: the builder with only the message and the language. */
async function primaryTurnPrompt(message: string): Promise<string> {
  seen.system = ''; seen.user = '';
  await callKevin({ ...buildCaddieRequestBody({ message, language: 'en' }), skip_tts: true });
  return seen.system + '\n' + seen.user;
}

describe('a primary turn (no caller overrides) carries what the follow-up loop used to supply', () => {
  it('the course card: "what\'s the par on 15?" has COURSE LOADED with hole 15 on it', async () => {
    startRound(3);
    const p = await primaryTurnPrompt("what's the par on 15?");
    expect(p).toContain('COURSE LOADED');
    expect(p).toContain('Hole 15: Par 3');
  });

  it('a golfcourseapi course: the card is fetched once and rides every turn after', async () => {
    startRound(3);
    useRoundStore.setState({ activeCourseId: 'api-123', activeCourse: 'Api Pines' } as never);
    await primaryTurnPrompt('how far is it?'); // the first turn starts the one fetch it needs
    await new Promise((r) => setImmediate(r));
    const p = await primaryTurnPrompt("what's the par on 15?");
    expect(p).toContain('COURSE LOADED');
    expect(p).toContain('Api Pines. Hole 15: Par 3, 162 yds.');
  });

  it('the penalty history: two waters on 6 render PENALTY HISTORY', async () => {
    startRound(8, [shot(6, 'water'), shot(6, 'water'), shot(2, 'clean')]);
    const p = await primaryTurnPrompt('what should I hit here?');
    expect(p).toContain('PENALTY HISTORY');
    expect(p).toContain('Recent penalties: 2 water.');
    expect(p).toContain('Recurring trouble holes: 6.');
  });

  it('no penalties renders no penalty heading', async () => {
    startRound(8, [shot(2, 'clean')]);
    expect(await primaryTurnPrompt('what should I hit here?')).not.toContain('PENALTY HISTORY');
  });

  /**
   * The provider half (SmartVisionProvider mirroring its state into smartVisionSignalStore as the screen
   * opens, taps and closes) is driven in __tests__/components/smartvision-view-reaches-the-store.test.tsx;
   * the logic project cannot load a .tsx provider. Here the store holds what that provider writes.
   */
  it('SmartVision: the tapped target is in the prompt while it is open, and gone once it closes', async () => {
    startRound(5);
    const liveView = { isOpen: true, holeNumber: 5, par: 4, centerYards: 171, measureYards: 143, analysisText: null };
    useSmartVisionSignalStore.setState({ liveView } as never);
    const open = await primaryTurnPrompt('what do I hit to that?');
    expect(open).toContain('[SMARTVISION OPEN]\nHole 5, par 4');
    expect(open).toContain('143 yards to tapped target');
    expect(open).toContain('171 yards to center of green');

    useSmartVisionSignalStore.setState({ liveView: null } as never);
    const closed = await primaryTurnPrompt('what do I hit to that?');
    // (the system prompt names the block in its instructions, so match the block itself)
    expect(closed).not.toContain('[SMARTVISION OPEN]\nHole');
    expect(closed).not.toContain('143 yards to tapped target');
  });
});
