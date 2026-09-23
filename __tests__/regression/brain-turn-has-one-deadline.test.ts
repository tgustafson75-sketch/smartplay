/**
 * 2026-09-23 — a paid round that finishes after the player hung up is billed and heard by nobody.
 *
 * The brain allowed three rounds at a 14s hang guard each (42s); a warm phone aborts at 30s and, until
 * today, then re-sent the whole turn while the first was still running. `deadlineAt` bounds the TURN:
 * no round starts that cannot finish before it.
 */
let now = 1_000_000;
let seq = 0;
const create = jest.fn(async (): Promise<unknown> => {
  now += 12_000;
  seq += 1;
  return {
    content: [{ type: 'tool_use', id: `t${seq}`, name: 'lookup_hole', input: {} }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
});
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({ messages: { create } })));

import { runAgenticLoop } from '../../api/_aiProvider';

const TOOLS = [{ name: 'lookup_hole', description: 'd', parameters: { type: 'object', properties: {} } }];

describe('brain: one deadline for the whole turn', () => {
  beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'test'; jest.spyOn(Date, 'now').mockImplementation(() => now); });
  beforeEach(() => { create.mockClear(); now = 1_000_000; });

  it('without a deadline all three 12s rounds run (the 36s turn a 30s client never hears)', async () => {
    await runAgenticLoop('anthropic', 'quality', 'sys', 'hi', [], TOOLS as never, async () => 'ok',
      { maxRounds: 3, timeoutMs: 14_000, continuationTools: ['lookup_hole'] }).catch(() => undefined);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('with a 24s deadline no round starts that cannot finish inside it', async () => {
    await runAgenticLoop('anthropic', 'quality', 'sys', 'hi', [], TOOLS as never, async () => 'ok',
      { maxRounds: 3, timeoutMs: 14_000, continuationTools: ['lookup_hole'], deadlineAt: now + 24_000 } as never).catch(() => undefined);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
