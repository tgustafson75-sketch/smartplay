/**
 * 2026-10-01 — Tim: "first question she thought, then didn't answer at all." He waited; no tap. The
 * session had several exits that ended a turn with nothing heard or read and filed no report, so
 * the case left no evidence. Every state change now goes through services/voice/turnAnswerWatch.
 */
import { noteTurnState, noteTurnIntent, noteTurnClosing } from '../../services/voice/turnAnswerWatch';

// jest.mock is hoisted above the import, so these factories still apply.
const mockSeq = { n: 0 };
const mockSilentFail = jest.fn();
const mockDiag = jest.fn();
jest.mock('../../services/voiceService', () => ({ getCaptionSeq: () => mockSeq.n }));
jest.mock('../../services/voiceErrorLog', () => ({
  logVoiceSilentFail: (...a: unknown[]) => mockSilentFail(...a),
  logVoiceDiag: (...a: unknown[]) => mockDiag(...a),
}));

beforeEach(() => { mockSeq.n = 0; mockSilentFail.mockClear(); mockDiag.mockClear(); noteTurnClosing(null); });

describe('a turn that ends with nothing said reports itself', () => {
  it('thinking → responding → idle with no line given IS a failure report', () => {
    noteTurnState('listening', 'thinking');
    noteTurnIntent('conversational');
    noteTurnState('thinking', 'responding');
    noteTurnState('responding', 'idle');
    expect(mockSilentFail).toHaveBeenCalledWith('turn_ended_silent',
      expect.objectContaining({ from: 'responding', intent: 'conversational', close: null }));
  });

  it('a hang the dormancy watchdog closed is reported, attributed to it', () => {
    noteTurnState('listening', 'thinking');
    noteTurnClosing('dormancy_timeout');
    noteTurnState('thinking', 'idle');
    expect(mockSilentFail).toHaveBeenCalledWith('turn_ended_silent',
      expect.objectContaining({ from: 'thinking', close: 'dormancy_timeout' }));
  });

  it('an answered turn reports nothing', () => {
    noteTurnState('listening', 'thinking');
    noteTurnState('thinking', 'responding');
    mockSeq.n += 1; // the reply's words reached the player
    noteTurnState('responding', 'idle');
    expect(mockSilentFail).not.toHaveBeenCalled();
    expect(mockDiag).not.toHaveBeenCalled();
  });

  it("the player's own close and a silent 'thanks' are diag, not failures", () => {
    noteTurnState('listening', 'thinking');
    noteTurnClosing('user_close');
    noteTurnState('thinking', 'idle');
    noteTurnClosing(null);
    noteTurnState('listening', 'thinking');
    noteTurnIntent('acknowledge');
    noteTurnState('thinking', 'idle');
    expect(mockSilentFail).not.toHaveBeenCalled();
    expect(mockDiag).toHaveBeenCalledTimes(2);
  });

  it('an idle that was never a turn (opener, listening cancelled) is not a turn', () => {
    noteTurnState('opening', 'listening');
    noteTurnState('listening', 'idle');
    expect(mockSilentFail).not.toHaveBeenCalled();
  });
});

describe('it is wired to the session and to every line the player is given', () => {
  it('voiceService counts a caption (speak, speakFromBase64 and flashCaption all pass through it)', () => {
    jest.isolateModules(() => {
      const vs = jest.requireActual('../../services/voiceService') as typeof import('../../services/voiceService');
      const before = vs.getCaptionSeq();
      vs.flashCaption('Seven iron.', 10);
      expect(vs.getCaptionSeq()).toBe(before + 1);
    });
  });
});
