/**
 * 2026-10-29 (Brain review r14) — THE FRESHNESS GATE READS THE PAYLOAD THE SERVER SENDS.
 *
 * Production actions carry `type` (ToolAction, api/kevin.ts:2928). isPositionalAdvice read `name`, so
 * a club call for a shot the player had already hit was judged non-positional and spoken anyway. The
 * dispatch guard also passed a hardcoded literal rather than the action, so it could never tell one
 * payload from another. Both are checked here against the real shape, through the real dispatcher.
 */
import * as freshness from '../../services/adviceFreshness';
import {
  adviceIsStillWorthSaying,
  isPositionalAdvice,
  markAdviceTurnStart,
  currentTurnEpoch,
  _resetAdviceTurnEpoch,
} from '../../services/adviceFreshness';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';
import { useRoundStore } from '../../store/roundStore';

const SERVER_REC = { type: 'recommend_club', club: '7 iron' };

function setRound(hole: number, shotCount: number): void {
  useRoundStore.setState({
    isRoundActive: true,
    currentHole: hole,
    shots: Array.from({ length: shotCount }, () => ({})),
    pendingKevinRec: null,
  } as never);
}

beforeEach(() => {
  _resetAdviceTurnEpoch();
  setRound(1, 0);
});

describe('the speech gate', () => {
  it('a production club call is positional', () => {
    expect(isPositionalAdvice([SERVER_REC])).toBe(true);
  });

  it('a club call for a shot already hit is not worth saying', () => {
    markAdviceTurnStart();
    const epoch = currentTurnEpoch();
    setRound(1, 1); // the player hit it while the brain was thinking
    expect(adviceIsStillWorthSaying(epoch, [SERVER_REC])).toBe(false);
  });
});

describe('the record path', () => {
  it('the dispatch gate is handed the real action, not a stand-in', () => {
    const spy = jest.spyOn(freshness, 'adviceIsStillWorthSaying');
    try {
      dispatchConversationalToolActions([SERVER_REC]);
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][1]).toEqual([SERVER_REC]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a stale club call does not stamp the pending recommendation for the next shot', () => {
    markAdviceTurnStart();
    setRound(1, 1); // hit before the reply landed
    dispatchConversationalToolActions([SERVER_REC]);
    expect((useRoundStore.getState() as unknown as { pendingKevinRec: unknown }).pendingKevinRec).toBeNull();
  });
});
