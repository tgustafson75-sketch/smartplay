/**
 * 2026-10-31 (Brain recheck r22, BRAIN-ENG-A) — A NOTE THE BRAIN HAS ANSWERED IS NOT SENT AGAIN AS "WHILE OFFLINE".
 *
 * peekOfflineNotesBlock read every pending note for the round and nothing ever marked them delivered, so a remark captured on
 * hole 7 rode every later caddie turn of the round as "WHILE OFFLINE the player said these". Now a brain turn that answers
 * advances a watermark, and only notes captured since that turn are carried. A turn that fails does not advance it.
 *
 * BEHAVIOURAL: the real askCaddie (fetch stubbed) and the real caddieRequestBody, roundStore and voiceLogStore.
 */
jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
jest.mock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: async () => ({ promptBlock: null }) }));

import { askCaddie } from '../../services/caddieBrain';
import { captureOfflineStatement } from '../../services/voiceLogService';
import { useVoiceLogStore } from '../../store/voiceLogStore';
import { useRoundStore } from '../../store/roundStore';

const NOTE = 'I am pulling everything left';
const realFetch = global.fetch;

/** The offline block the brain was sent on the most recent request. */
function lastSentBlock(fetchMock: jest.Mock): string {
  const calls = fetchMock.mock.calls;
  const body = JSON.parse(String((calls[calls.length - 1][1] as RequestInit).body));
  return String(body.unified_context_block ?? '');
}

function answering(fetchMock: jest.Mock) {
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ text: 'Keep it right of the bunker.', audioBase64: null, toolAction: null }) }));
}

beforeEach(() => {
  useVoiceLogStore.setState({ entries: [], deliveredAt: 0 } as never);
  useRoundStore.setState({ isRoundActive: true, currentRoundId: 'r-stale-note', currentHole: 7 } as never);
});
afterEach(() => { global.fetch = realFetch; });

describe('a note the brain has answered is not sent again', () => {
  it('the note is sent on the turn it was captured for, and not on the turn after that answered', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    answering(fetchMock);
    captureOfflineStatement(NOTE);

    await askCaddie({ message: 'what club from 150', language: 'en', timeoutMs: 5_000 });
    expect(lastSentBlock(fetchMock)).toContain(NOTE);

    await askCaddie({ message: 'and the wind?', language: 'en', timeoutMs: 5_000 });
    expect(lastSentBlock(fetchMock)).not.toContain(NOTE);
  });

  it('control: a turn that fails leaves the note pending, so the next attempt still carries it', async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    captureOfflineStatement(NOTE);

    await askCaddie({ message: 'what club from 150', language: 'en', timeoutMs: 5_000 });
    expect(lastSentBlock(fetchMock)).toContain(NOTE);

    answering(fetchMock);
    await askCaddie({ message: 'what club from 150', language: 'en', timeoutMs: 5_000 });
    expect(lastSentBlock(fetchMock)).toContain(NOTE);
  });

  it('a note captured after the answered turn is new, and is carried once', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    answering(fetchMock);
    captureOfflineStatement(NOTE);
    await askCaddie({ message: 'first', language: 'en', timeoutMs: 5_000 });

    await new Promise((r) => setTimeout(r, 5));
    captureOfflineStatement('felt like I came over the top');
    await askCaddie({ message: 'second', language: 'en', timeoutMs: 5_000 });
    expect(lastSentBlock(fetchMock)).toContain('came over the top');
    expect(lastSentBlock(fetchMock)).not.toContain(NOTE);
  });
});
