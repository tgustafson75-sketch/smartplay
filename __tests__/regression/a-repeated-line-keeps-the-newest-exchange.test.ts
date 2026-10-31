/**
 * 2026-10-31 (Brain recheck r24, BRAIN-ENG-R18-1) — A REPEATED LINE KEEPS THE NEWEST EXCHANGE.
 *
 * conversationTurns dropped every role+text repeat across the whole window and kept the FIRST. "five" on
 * hole 3 and "five" on hole 4 are two turns, but the second pair was dropped, so RECENT CONVERSATION read a
 * round-old exchange as the latest one. Only the SAME turn written to both stores (one entry from each
 * history, saying the same thing within moments) is one turn; the same words said again later are not.
 * The gaps stay inside conversationState's 3-minute decay (DECAY_MS): a longer silence evicts the buffer
 * before the repeat arrives, so the window this defect lives in is a live exchange.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { appendConversationTurn, clearConversationHistory } from '../../services/voice/conversationHistory';
import { recordUserTurn, recordKevinTurn, clearConversation } from '../../services/conversationState';

const turns = () =>
  (buildCaddieRequestBody({ message: 'and the wind?', language: 'en' }) as { conversationTurns: { role: string; text: string }[] })
    .conversationTurns.map((t) => `${t.role}: ${t.text}`);

describe('a repeated line keeps the newest exchange (r24)', () => {
  let now = 1_000_000;
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    clearConversationHistory();
    clearConversation('test');
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it('two identical "five" calls a few minutes apart both reach the caddie, in order', () => {
    now = 1_000_000; recordUserTurn('five');
    now = 1_001_000; recordKevinTurn('Got it, 5.');
    now = 1_150_000; recordUserTurn('five');
    now = 1_151_000; recordKevinTurn('Got it, 5.');
    now = 1_160_000;

    expect(turns()).toEqual([
      'user: five',
      'kevin: Got it, 5.',
      'user: five',
      'kevin: Got it, 5.',
    ]);
  });

  it('one store writing the same line twice in one moment is still ONE line', () => {
    now = 1_000_000; recordKevinTurn('Done.'); recordKevinTurn('Done.');
    now = 1_000_500;

    expect(turns()).toEqual(['kevin: Done.']);
  });

  it('the same turn written to both histories is still ONE turn', () => {
    now = 1_000_000; recordUserTurn('five');
    now = 1_001_000; recordKevinTurn('Got it, 5.');
    now = 1_150_000; recordUserTurn('five');
    const askedAt = now;
    now = 1_150_200; appendConversationTurn('five', 'Got it, 5.', askedAt, now);
    now = 1_150_300; recordKevinTurn('Got it, 5.');
    now = 1_160_000;

    expect(turns()).toEqual([
      'user: five',
      'kevin: Got it, 5.',
      'user: five',
      'kevin: Got it, 5.',
    ]);
  });
});
