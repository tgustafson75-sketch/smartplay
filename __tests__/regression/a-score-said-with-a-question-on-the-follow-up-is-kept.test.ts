/**
 * 2026-10-31 (Brain recheck r21, BRAIN-R21-1) — A SCORE SAID WITH A QUESTION IS KEPT ON THE FOLLOW-UP PATH TOO.
 *
 * R20-1 kept the score on the caddie-tab mic and the hands-free path. The caddie-tab FOLLOW-UP loop reaches the brain
 * through followUpBrainTurn, and its failed turn went straight to caddieFailureReply with no keep: a proven-offline
 * "I got a 6, how far to the green?" was answered "say it again" and the 6 was never written.
 *
 * BEHAVIOURAL: the real followUpBrainTurn and caddieFailureReply; the brain call fails, the network verdict and the
 * voice-log store are stubbed.
 */
const mockVerdict = { v: 'offline' as string };
const mockCapture = jest.fn((_t: string) => true);

jest.mock('../../services/gpsManager', () => ({ getLastFix: () => null }));
jest.mock('../../services/smartFinderService', () => ({
  resolveGreenCoords: () => null,
  classifyAccuracy: () => ({ level: 'good' }),
  holeData: () => null,
}));
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  probeReachability: jest.fn(async () => ({ verdict: mockVerdict.v, at: Date.now() })),
}));
jest.mock('../../services/voiceLogService', () => ({ captureOfflineStatement: (t: string) => mockCapture(t) }));
jest.mock('../../services/caddieBrain', () => ({
  askCaddie: jest.fn(async (opts: { onNoAnswer?: (r: string) => void }) => {
    opts.onNoAnswer?.('failed');
    return null;
  }),
}));
jest.mock('../../services/apiBase', () => ({ isEndpointWarmed: () => true }));

import { followUpBrainTurn } from '../../services/voice/followUpBrainTurn';
import { scoreSaidButNotLogged } from '../../services/localIntentPrecheck';
import { CADDIE_NOTICE_SAVED_OFFLINE, CADDIE_NOTICE_SCORE_NOT_LOGGED } from '../../services/caddieAckLines';

const SAID = 'I got a 6, how far to the green?';

beforeEach(() => {
  mockVerdict.v = 'offline';
  mockCapture.mockClear();
});

describe('a score said with a question, on a follow-up turn that failed, is kept before the notice', () => {
  it('the score is captured and the saved line leads the reply', async () => {
    const reply = await followUpBrainTurn(SAID, { language: 'en' });
    expect(mockCapture).toHaveBeenCalledWith(SAID);
    expect(reply.text.startsWith(CADDIE_NOTICE_SAVED_OFFLINE.en)).toBe(true);
    expect(reply.text).not.toContain(CADDIE_NOTICE_SCORE_NOT_LOGGED.en);
  });
});

describe('the predicate reads the score the words report, not the question the precheck answers first', () => {
  it('"I got a 6, how far to the green?" is a score said with a question', () => {
    expect(scoreSaidButNotLogged(SAID)).toBe(true);
  });

  it.each([
    'I got a 6 yesterday, how far to the green?',
    'I almost birdied it, how far to the green?',
    'my buddy got a 6, how far to the pin?',
    'I had a 5 iron, what should I hit?',
  ])('"%s" is not a score said by the player', (said) => {
    expect(scoreSaidButNotLogged(said)).toBe(false);
  });
});

describe('control: the same words on a phone that is online are not kept', () => {
  it('nothing is captured and the score-not-logged notice is what is said', async () => {
    mockVerdict.v = 'internet_ok';
    const reply = await followUpBrainTurn(SAID, { language: 'en' });
    expect(mockCapture).not.toHaveBeenCalled();
    expect(reply.text).toContain(CADDIE_NOTICE_SCORE_NOT_LOGGED.en);
  });
});

/**
 * The on-device retry branch of the caddie-tab voice path (useVoiceCaddie, failTranscribeOffline) has the same
 * gap. The hook cannot load under jest, so this is structural: the keep runs before the reply that uses it.
 */
describe('the on-device retry branch keeps the score before it answers', () => {
  const root = require('path').join(__dirname, '..', '..');
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hook = code(require('fs').readFileSync(require('path').join(root, 'hooks/useVoiceCaddie.ts'), 'utf8'));

  it('keepScoreIfProvenOffline runs before caddieFailureReply is given the kept flag', () => {
    const keep = hook.indexOf('failure.keepScoreIfProvenOffline(heard)');
    const reply = hook.indexOf('failure.caddieFailureReply({ heard, language: langSafe, kept })');
    expect(keep).toBeGreaterThan(0);
    expect(reply).toBeGreaterThan(keep);
  });
});
