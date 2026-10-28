/**
 * 2026-10-28 (Brain review r2) — "WHY AM I SLICING IT" GETS THE BRAIN'S WHOLE BUDGET, AND A TIMEOUT
 * IS NOT A SECOND BILLED TURN.
 *
 * services/intents/inRoundDiagnosticHandler asked the brain with a flat 15s while api/kevin lets a
 * turn run to ~22s, so a cold or cache-write Sonnet coach read was aborted on the phone and billed on
 * the server. It then returned success:false with a line — which the caddie-tab mic (useVoiceCaddie
 * isCommandHit) reads as "not a command" and sends to the brain AGAIN: two billed turns for one
 * question, the second starting after a 15s wait.
 */
const mockAsk = {
  opts: [] as Array<{ timeoutMs: number; heard?: string; onNoAnswer?: (r: string) => void }>,
  reason: null as null | 'timeout' | 'failed',
  reply: null as null | { text: string },
};
let mockWarm = true;

jest.mock('../../services/caddieBrain', () => ({
  askCaddie: jest.fn(async (o: { timeoutMs: number; onNoAnswer?: (r: string) => void }) => {
    mockAsk.opts.push(o);
    if (mockAsk.reply) return { ...mockAsk.reply, audioBase64: null, toolActions: [] };
    if (mockAsk.reason) o.onNoAnswer?.(mockAsk.reason);
    return null;
  }),
}));
jest.mock('../../services/apiBase', () => ({ isEndpointWarmed: () => mockWarm }));
jest.mock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: async () => ({ promptBlock: null }) }));
jest.mock('../../services/caddieFailureReply', () => ({
  caddieFailureReply: jest.fn(async () => ({ text: 'That one got away from me — say it again?', source: 'on_us', verdict: 'internet_ok' })),
}));

import { inRoundDiagnosticHandler } from '../../services/intents/inRoundDiagnosticHandler';
import { BRAIN_FETCH_TIMEOUT_MS, COLD_BRAIN_FETCH_TIMEOUT_MS } from '../../constants/voiceTimeouts';
import type { VoiceIntent, AppContext } from '../../types/voiceIntent';

const intent = {
  intent_type: 'in_round_diagnostic',
  confidence: 'high',
  raw_text: 'why is my driver starting right and slicing off the tee',
  parameters: { pattern_text: 'driver starts right and slices off the tee' },
} as unknown as VoiceIntent;
const ctx = { language: 'en' } as unknown as AppContext;

/** useVoiceCaddie's rule: a non-success result is not a command, so the words go to the brain again. */
const caddieTabAsksAgain = (r: { success: boolean; follow_up_needed: boolean }) => !(r.success || r.follow_up_needed);

beforeEach(() => {
  mockAsk.opts = [];
  mockAsk.reason = null;
  mockAsk.reply = null;
  mockWarm = true;
});

describe('the in-round diagnostic read', () => {
  it('THE BUG: waits the shared brain budget, warm and cold — not a flat 15s', async () => {
    mockAsk.reply = { text: 'Face is open to the path.' };
    await inRoundDiagnosticHandler.execute(intent, ctx);
    mockWarm = false;
    await inRoundDiagnosticHandler.execute(intent, ctx);
    expect(mockAsk.opts.map((o) => o.timeoutMs)).toEqual([BRAIN_FETCH_TIMEOUT_MS, COLD_BRAIN_FETCH_TIMEOUT_MS]);
    expect(BRAIN_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('THE BUG: a read our timer gave up on is answered by the failure owner, and not asked again', async () => {
    mockAsk.reason = 'timeout';
    const r = await inRoundDiagnosticHandler.execute(intent, ctx);
    expect(r.voice_response).toBe('That one got away from me — say it again?');
    expect(caddieTabAsksAgain(r)).toBe(false);
    const { resultWantsBrain } = require('../../services/voiceCommandRouter') as typeof import('../../services/voiceCommandRouter');
    expect(resultWantsBrain(r)).toBe(false);
    expect(mockAsk.opts).toHaveLength(1);
  });

  it('a read that failed fast goes to the caddie, with no canned "try once more" line', async () => {
    mockAsk.reason = 'failed';
    const r = await inRoundDiagnosticHandler.execute(intent, ctx);
    expect(r.voice_response).toBeNull();
    const { resultWantsBrain } = require('../../services/voiceCommandRouter') as typeof import('../../services/voiceCommandRouter');
    expect(resultWantsBrain(r)).toBe(true);
  });

  it('the history keeps the words he said, not the classifier summary', async () => {
    mockAsk.reply = { text: 'Face is open to the path.' };
    await inRoundDiagnosticHandler.execute(intent, ctx);
    expect(mockAsk.opts[0].heard).toBe('why is my driver starting right and slicing off the tee');
  });
});
