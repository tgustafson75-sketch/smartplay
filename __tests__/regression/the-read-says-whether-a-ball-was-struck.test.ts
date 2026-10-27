/**
 * 2026-10-26 (Tim: "practice swings still show") — the two signals the practice classifier weighs.
 *
 * 1. The per-swing read now answers `ball_struck` (api/swing-analysis.ts): 'no' only on visible evidence
 *    of a practice swing, 'unknown' by default, forced 'unknown' when there is no valid swing or the model
 *    answers off the enum. A client on an older server sees nothing — unknown, never a demotion.
 * 2. Since S2m the range locate asks two passes and UNIONS them (a swing between frames must not be lost).
 *    A swing only ONE pass saw was kept at the group's best confidence, so a practice swing one pass
 *    happened to catch came back 'high'. It is kept, at 'low'.
 */
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: async () => ({ text: '{}' }) } })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER', ARRAY: 'ARRAY', NUMBER: 'NUMBER' },
}));
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: async () => ({}) } } })) }));
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ messages: { create: async () => ({}) } })) }));

import { normalizeAnalysis } from '../../api/swing-analysis';
import { mergeSwingDetections as mergeTyped } from '../../services/swing/swingSegmentation';

// Called untyped so this file also RUNS against the pre-fix two-argument signature (and fails on behaviour).
const mergeSwingDetections = mergeTyped as unknown as (raw: { timeSec: number; confidence: string; pass?: number }[], sep: number, passes: number) => unknown;

const reply = (extra: Record<string, unknown>) => JSON.stringify({
  valid_swing: true, detected_issue: 'none', severity: 'none', confidence: 'medium', observation: 'o',
  fault_frame_index: -1, primary_fault: 'no_dominant_fault', cause: 'c', fix: 'f', drill: 'd', evidence: 'Frame 1: x',
  layman_explanation: '', strengths: [], contact_read: 'unknown', ...extra,
});

describe('the read answers ball_struck honestly', () => {
  it("passes 'no' / 'yes' through", () => {
    expect((normalizeAnalysis(reply({ ball_struck: 'no' }), 9, 'analysis') as { ball_struck?: string }).ball_struck).toBe('no');
    expect((normalizeAnalysis(reply({ ball_struck: 'yes' }), 9, 'analysis') as { ball_struck?: string }).ball_struck).toBe('yes');
  });
  it("an off-enum or missing answer is 'unknown', never 'no'", () => {
    expect((normalizeAnalysis(reply({ ball_struck: 'maybe' }), 9, 'analysis') as { ball_struck?: string }).ball_struck).toBe('unknown');
    expect((normalizeAnalysis(reply({}), 9, 'analysis') as { ball_struck?: string }).ball_struck).toBe('unknown');
  });
  it("no valid swing → 'unknown' (an unreadable clip is not a practice swing)", () => {
    expect((normalizeAnalysis(reply({ valid_swing: false, ball_struck: 'no', validity_reason: 'dark' }), 9, 'analysis') as { ball_struck?: string }).ball_struck).toBe('unknown');
  });
});

describe('a swing only one of the two locate passes saw is kept, unsure', () => {
  it('seen by both passes → its best confidence; seen by one → low', () => {
    const out = mergeSwingDetections([
      { timeSec: 10, confidence: 'high', pass: 0 }, { timeSec: 10.4, confidence: 'high', pass: 1 },   // both saw it
      { timeSec: 20, confidence: 'high', pass: 1 },                                                    // only the half-step pass
    ], 2.5, 2);
    expect(out).toEqual([{ timeSec: 10.4, confidence: 'high' }, { timeSec: 20, confidence: 'low' }]);
  });
  it('a lone detection one pass of two saw is low too', () => {
    expect(mergeSwingDetections([{ timeSec: 5, confidence: 'high', pass: 0 }], 2.5, 2)).toEqual([{ timeSec: 5, confidence: 'low' }]);
  });
  it('one pass answering (the other failed) downgrades nothing', () => {
    expect(mergeSwingDetections([{ timeSec: 5, confidence: 'high', pass: 0 }, { timeSec: 20, confidence: 'high', pass: 0 }], 2.5, 1))
      .toEqual([{ timeSec: 5, confidence: 'high' }, { timeSec: 20, confidence: 'high' }]);
  });
});
