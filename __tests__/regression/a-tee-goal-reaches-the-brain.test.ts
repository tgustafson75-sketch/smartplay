/**
 * 2026-10-31 (Brain ENG-TEEGOAL-1 — "how am I tracking on my goal?" / "am I going to break 90 from the
 * blues?").
 *
 * A tee-box goal was evaluated live on the Tee Goals screen and read by the round-end celebration, and
 * by nothing a player can ask. The payload builder never read teeGoalStore, so Kevin knew only the
 * free-text profile goal and guessed. The number on screen was not the number he could ask about.
 *
 *   1. The builder emits `teeGoals` on every request (null with no goals), computed by the SAME
 *      evaluator the screen uses, over the same round history.
 *   2. api/kevin reads it and states the progress on the MESSAGE side, never in the cached system block.
 */
import { buildCaddieRequestBody, CADDIE_REQUEST_KEYS } from '../../services/caddieRequestBody';
import { useTeeGoalStore } from '../../store/teeGoalStore';
import { useRoundStore } from '../../store/roundStore';

const seen: { system: string; user: string } = { system: '', user: '' };

jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (
      _provider: string, _tier: string, system: string, user: string,
    ) => {
      seen.system = system;
      seen.user = user;
      return { text: 'ok', provider: 'anthropic', rounds: 1, usage: null };
    }),
  };
});
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    audio: { speech: { create: jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) } },
    chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: '' } }] })) } },
  }));
});
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));

import handler from '../../api/kevin';

function call(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      setHeader: () => res,
      status(code: number) { status = code; return res; },
      json(payload: Record<string, unknown>) { resolve({ status, json: payload }); return res; },
      end() { resolve({ status, json: {} }); return res; },
    };
    void handler({ method: 'POST', headers: {}, query: {}, body } as never, res as never);
  });
}

const breakNinetyFromTheWhites = () => {
  useTeeGoalStore.getState().addGoal(
    { tee: 'white', targetScore: 90, beatPar: false, nine: false, courseId: null, courseName: null },
    'g-break-90-whites',
    Date.now(),
  );
};

beforeEach(() => {
  seen.system = ''; seen.user = '';
  useTeeGoalStore.getState().clearAll();
  useRoundStore.setState({ roundHistory: [] } as never);
});

describe('a tee-box goal reaches the caddie', () => {
  it('the key is in the closed payload contract, so it is sent on every path', () => {
    expect(CADDIE_REQUEST_KEYS).toContain('teeGoals');
  });

  it('is null with no goals, and carries the screen progress when a goal exists', () => {
    expect((buildCaddieRequestBody({ message: 'how am I tracking', language: 'en' }) as Record<string, unknown>).teeGoals).toBeNull();

    breakNinetyFromTheWhites();
    useRoundStore.setState({
      roundHistory: [{
        totalScore: 95, scoreVsPar: 23, holesPlayed: 18, nineHoleMode: false, selectedTee: 'white',
        courseId: 'c1', endedAt: Date.now() - 1000, simulated: false,
      }],
    } as never);
    const body = buildCaddieRequestBody({ message: 'how am I tracking', language: 'en' }) as Record<string, unknown>;
    expect(body.teeGoals).toEqual([{
      goal: 'Break 90 from the whites',
      achieved: false,
      attempts: 1,
      best: 95,
      note: 'Best 95 over 1 attempt — 6 to go.',
    }]);
  });

  it('kevin states the progress on the message side, never in the cached system block', async () => {
    breakNinetyFromTheWhites();
    useRoundStore.setState({
      roundHistory: [{
        totalScore: 95, scoreVsPar: 23, holesPlayed: 18, nineHoleMode: false, selectedTee: 'white',
        courseId: 'c1', endedAt: Date.now() - 1000, simulated: false,
      }],
    } as never);
    const body = buildCaddieRequestBody({ message: 'am I going to break 90 from the blues?', language: 'en' });
    const r = await call(body);
    expect(r.status).toBe(200);
    expect(seen.user).toMatch(/THEIR TEE-BOX GOALS/);
    expect(seen.user).toMatch(/Break 90 from the whites: Best 95 over 1 attempt — 6 to go\./);
    expect(seen.system).not.toMatch(/TEE-BOX GOALS/);
  });

  it('says nothing about tee goals when there are none', async () => {
    await call({ message: 'how am I tracking', teeGoals: null });
    expect(seen.user).not.toMatch(/TEE-BOX GOALS/);
  });
});
