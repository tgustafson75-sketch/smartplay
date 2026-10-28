/**
 * 2026-10-27 (Phase SB6 — recheck R4-2 of the SB3/SB4 work).
 *
 * A swing with no computed fault moment (no anchors, the stored frame is another fault's) shows its stored
 * read times as two Fault-moment pills. Tim taps pill 1: it is held as the fault (faultSecRef = t1). He taps
 * pill 2: the jump handed faultSecRef — pill 1's held time — to issueJumpSec as if it were the computed
 * moment, which always wins, so the replay seeked BACK to t1 and the hold, ring and caption stayed there.
 * Pill 2 could not be reached until he left the swing.
 *
 * Driven through the library screen's real hook (hooks/useIssueAsk.issueJumpTo).
 */
import { createElement } from 'react';
import { useIssueAsk } from '../../hooks/useIssueAsk';

// react-test-renderer ships no types; only these two are used.
type Renderer = { update: (el: ReturnType<typeof createElement>) => void };
const { create, act: rtrAct } = require('react-test-renderer') as {
  create: (el: ReturnType<typeof createElement>) => Renderer;
  act: (fn: () => void) => void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const act = (fn: () => void): void => { rtrAct(fn); };

function renderIssueAsk(key: string) {
  const result = { current: undefined as unknown as ReturnType<typeof useIssueAsk> };
  const Probe = (p: { k: string }): null => { result.current = useIssueAsk(p.k); return null; };
  act(() => { create(createElement(Probe, { k: key })); });
  return result;
}

describe('each Fault-moment pill goes to its own time', () => {
  it('THE REPORT: pill 1 then pill 2 — the second jump is to t2, and t2 is what is held', () => {
    const h = renderIssueAsk('s|L|s_shot_0');
    let f: number | null = null;
    act(() => { f = h.current.issueJumpTo(6.1); });
    expect(f).toBe(6.1);
    expect(h.current.askedFaultSec).toBe(6.1);
    act(() => { f = h.current.issueJumpTo(6.4); });
    expect(f).toBe(6.4);
    expect(h.current.faultSecRef.current).toBe(6.4);
    expect(h.current.askedFaultSec).toBe(6.4);
    act(() => { f = h.current.issueJumpTo(6.1); });                 // and back again
    expect(f).toBe(6.1);
    expect(h.current.askedFaultSec).toBe(6.1);
  });

  it('a computed moment still wins over a tapped time (its pill IS the moment)', () => {
    const h = renderIssueAsk('s|L|s_shot_0');
    act(() => { h.current.faultSecRef.current = 6.25; h.current.clearAskedFault(); });
    let f: number | null = null;
    act(() => { f = h.current.issueJumpTo(6.4); });
    expect(f).toBe(6.25);
    expect(h.current.askedFaultSec).toBeNull();                       // nothing held over the moment
    act(() => { f = h.current.issueJumpTo(); });                      // the Issue chip
    expect(f).toBe(6.25);
  });

  it('nothing to jump to: no moment, no tapped time', () => {
    const h = renderIssueAsk('s|L|s_shot_0');
    let f: number | null = 1;
    act(() => { f = h.current.issueJumpTo(); });
    expect(f).toBeNull();
    expect(h.current.faultSecRef.current).toBeNull();
  });
});
