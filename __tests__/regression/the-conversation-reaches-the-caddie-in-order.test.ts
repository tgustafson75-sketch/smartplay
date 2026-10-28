/**
 * 2026-10-28 (Brain review r2) — THE CONVERSATION REACHES THE CADDIE IN THE ORDER IT HAPPENED.
 *
 * services/caddieRequestBody builds conversationTurns from two histories: services/voice/
 * conversationHistory (brain exchanges, written by askCaddie) and services/conversationState (every
 * utterance, plus the router's command replies). Its comment said "merges by timestamp order"; the
 * code concatenated brain turns first and buffer turns after. A score logged before a brain question
 * therefore read as the LATEST exchange, and api/kevin (slice(-6), "resolve follow-ups like 'and the
 * wind?' against this") resolved the follow-up against the score log.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { appendConversationTurn, clearConversationHistory, setConversationHistory, getConversationHistory } from '../../services/voice/conversationHistory';
import { recordUserTurn, recordKevinTurn, clearConversation } from '../../services/conversationState';

const turns = () =>
  (buildCaddieRequestBody({ message: 'and the wind?', language: 'en' }) as { conversationTurns: { role: string; text: string }[] })
    .conversationTurns.map((t) => `${t.role}: ${t.text}`);

describe('the conversation the caddie reads', () => {
  let now = 1_000_000;
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    clearConversationHistory();
    clearConversation('test');
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it('THE BUG: a command the router answered BEFORE a brain turn stays before it', () => {
    // The router: "5 on this hole" → "Got it, 5" (conversationState only).
    now = 1_000_000; recordUserTurn('5 on this hole');
    now = 1_001_000; recordKevinTurn('Got it, 5');
    // Then the brain: the mic records the words, askCaddie files the exchange, the mic records the reply.
    now = 1_010_000; recordUserTurn('what should I hit?');
    const askedAt = now;
    now = 1_013_000; appendConversationTurn('what should I hit?', 'Smooth 7.', askedAt);
    now = 1_014_000; recordKevinTurn('Smooth 7.');
    now = 1_030_000; recordUserTurn('and the wind?');

    expect(turns()).toEqual([
      'user: 5 on this hole',
      'kevin: Got it, 5',
      'user: what should I hit?',
      'kevin: Smooth 7.',
      'user: and the wind?',
    ]);
  });

  it('a history entry with no time (a server-replaced history) keeps its place', () => {
    now = 1_000_000; appendConversationTurn('how far to the front?', '142 to the front.');
    now = 1_005_000; setConversationHistory([...getConversationHistory(), { role: 'assistant', content: 'Wind is into you.' }]);
    now = 1_008_000; recordUserTurn('so what club?');
    expect(turns()).toEqual([
      'user: how far to the front?',
      'kevin: 142 to the front.',
      'kevin: Wind is into you.',
      'user: so what club?',
    ]);
  });
});
