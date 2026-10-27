/**
 * 2026-10-27 (Phase SB4x — review of SB3a-h, findings "reanalyze #1" and "issue #2/#3").
 *
 * 1. RE-ANALYZE WIPED SWING 2's READ AND NOTHING ASKED AGAIN. Re-analyze clears every swing's body read and
 *    arc (uploadRun.invalidateForReanalysis → store.resetDerivedAnalysis) but re-reads only swing 1. The
 *    library screen's ask was keyed on the selection, the shot id and the toggles — none of which a
 *    Re-analyze changes — so swing 2, on screen with Body on, stayed blank. SmartMotion's review the same.
 * 2. A STALE "ASKED TO SEE THE ISSUE" LEAKED TO THE NEXT SWING. The ask was a plain boolean reset by an
 *    effect declared AFTER the request effect: paging from swing 2 (Issue asked) to swing 1 with everything
 *    off asked swing 1 for a body read nobody wanted.
 * 3. A PILL-HELD FAULT TIME SURVIVED A RE-SPLIT that reused `_shot_0`: the replay kept stopping at the old
 *    swing's second with no caption saying why.
 *
 * Driven through the real hooks both screens call, on the real store, with only the shot run mocked.
 */
import { renderHook, act } from '@testing-library/react-native';

const mockAsks: { sessionId: string; shotId: string; arc: unknown }[] = [];
jest.mock('../../services/swing/orchestrator/shotDetail', () => ({
  ...jest.requireActual('../../services/swing/orchestrator/shotDetail'),
  requestShotDetail: (sessionId: string, shotId: string, opts: { arc?: unknown }) => {
    mockAsks.push({ sessionId, shotId, arc: opts.arc });
    return () => undefined;
  },
}));

import { useState } from 'react';
import { useSwingSessionStore, type SwingSession } from '../../store/swingSessionStore';
import { storedShotBiomech } from '../../services/swing/orchestrator/shotDetail';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';
import { shotDetailRequestFor } from '../../services/swing/faultSpotlight';
import { swingLayoutKey } from '../../services/swing/practiceSwings';
import { useShotDetailRequest } from '../../hooks/useShotDetailRequest';
import { useIssueAsk } from '../../hooks/useIssueAsk';

const read = { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
function seed(): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'live_capture', analysis_status: 'ok', club: '7i',
      biomechanics: read, analysis_version: BODY_READ_VERSION,
      shots: [0, 1, 2].map((i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: i * 4, clipEndSeconds: i * 4 + 3,
        biomechanics: read, analysis_version: BODY_READ_VERSION,
      })),
    }] as never,
  });
}
const sess = (): SwingSession => useSwingSessionStore.getState().sessionHistory[0];

/** Exactly what the library swing screen wires: its issue ask, then its request for the swing selected. */
function useLibrary(p: { idx: number; showSkeleton: boolean; showTrace: boolean }) {
  const session = useSwingSessionStore((s) => s.sessionHistory.find((x) => x.id === 's1'));
  const shot = session?.shots[p.idx] ?? session?.shots[0];
  const issue = useIssueAsk(`s1|${swingLayoutKey(session)}|${shot?.id ?? ''}`);
  const [pending, setPending] = useState<string | null>(null);
  const selShot = session?.shots[p.idx];
  useShotDetailRequest({
    sessionId: 's1',
    shotId: selShot?.clipUri ? selShot.id : null,
    ask: shotDetailRequestFor({ idx: p.idx, showSkeleton: p.showSkeleton, traceAsked: p.showTrace, issueAsked: issue.issueAsked }),
    unread: !!session && !!selShot && storedShotBiomech(session, selShot, session.shots.find((x) => x.clipUri)?.id === selShot.id) === undefined,
    retrigger: `${p.idx}|${selShot?.clipUri ?? ''}|${p.showSkeleton}|${p.showTrace}|${issue.issueAsked}`,
    setPending,
  });
  return { ...issue, pending };
}

/** Exactly what SmartMotion's review wires. */
function useSmartMotion(p: { swing: number }) {
  const cage = useSwingSessionStore((s) => s.sessionHistory.find((x) => x.id === 's1') ?? null);
  const sh = cage?.shots[p.swing];
  const bio = cage && sh ? storedShotBiomech(cage, sh, cage.shots.find((x) => x.clipUri)?.id === sh.id) : undefined;
  const [, setPending] = useState<string | null>(null);
  useShotDetailRequest({
    sessionId: 's1', shotId: sh?.id ?? null, ask: { arc: 'tracker' }, unread: bio === undefined,
    retrigger: `${p.swing}`, setPending,
  });
}

const asksFor = (shotId: string) => mockAsks.filter((a) => a.shotId === shotId);

beforeEach(() => { mockAsks.length = 0; seed(); });

describe('Re-analyze: the swing on screen is asked for again', () => {
  it('THE REPORT: library, swing 2 selected with Body on — Re-analyze wipes its read, and it is asked for again', () => {
    renderHook(() => useLibrary({ idx: 1, showSkeleton: true, showTrace: false }));
    expect(asksFor('s1_shot_1')).toHaveLength(1);
    act(() => { useSwingSessionStore.getState().resetDerivedAnalysis('s1'); });   // what a Re-analyze does first
    expect(storedShotBiomech(sess(), sess().shots[1], false)).toBeUndefined();
    expect(asksFor('s1_shot_1')).toHaveLength(2);
    expect(asksFor('s1_shot_1')[1].arc).toBe('tracker');
  });

  it('SmartMotion review, swing 3 shown: the same', () => {
    renderHook(() => useSmartMotion({ swing: 2 }));
    expect(asksFor('s1_shot_2')).toHaveLength(1);
    act(() => { useSwingSessionStore.getState().resetDerivedAnalysis('s1'); });
    expect(asksFor('s1_shot_2')).toHaveLength(2);
  });

  it('a read LANDING is not a new ask (no second run when the answer arrives)', () => {
    act(() => { useSwingSessionStore.getState().resetDerivedAnalysis('s1'); });
    renderHook(() => useLibrary({ idx: 1, showSkeleton: true, showTrace: false }));
    expect(asksFor('s1_shot_1')).toHaveLength(1);
    act(() => {
      useSwingSessionStore.setState((st) => ({
        sessionHistory: st.sessionHistory.map((s) => ({
          ...s, shots: s.shots.map((x) => (x.id === 's1_shot_1' ? { ...x, biomechanics: read as never, analysis_version: BODY_READ_VERSION } : x)),
        })),
      }));
    });
    expect(storedShotBiomech(sess(), sess().shots[1], false)).toBeDefined();
    expect(asksFor('s1_shot_1')).toHaveLength(1);
  });

  it('nothing asked (swing 1, everything off): a Re-analyze still asks for nothing — the library is manual', () => {
    renderHook(() => useLibrary({ idx: 0, showSkeleton: false, showTrace: false }));
    act(() => { useSwingSessionStore.getState().resetDerivedAnalysis('s1'); });
    expect(mockAsks).toHaveLength(0);
  });
});

describe('asking to see the issue belongs to the swing it was asked on', () => {
  it('THE REPORT: Issue asked on swing 2, page to swing 1 with everything off — swing 1 is asked for nothing', () => {
    const h = renderHook((p: { idx: number }) => useLibrary({ idx: p.idx, showSkeleton: false, showTrace: false }), { initialProps: { idx: 1 } });
    act(() => { h.result.current.markIssueAsked(); });
    expect(h.result.current.issueAsked).toBe(true);
    h.rerender({ idx: 0 });
    expect(h.result.current.issueAsked).toBe(false);
    expect(asksFor('s1_shot_0')).toHaveLength(0);
  });

  it('a passive stop with Highlight on asks on THIS swing (the callback marks whatever swing is on screen now)', () => {
    const h = renderHook((p: { idx: number }) => useLibrary({ idx: p.idx, showSkeleton: false, showTrace: false }), { initialProps: { idx: 1 } });
    const mark = h.result.current.markIssueAsked;   // the playback callback is created once and keeps this
    h.rerender({ idx: 0 });
    act(() => { mark(); });
    expect(h.result.current.issueAsked).toBe(true);
    expect(asksFor('s1_shot_0')).toEqual([{ sessionId: 's1', shotId: 's1_shot_0', arc: false }]);
  });

  it('a re-split that reuses `_shot_0` is a new swing: the ask does not carry over', () => {
    const h = renderHook(() => useLibrary({ idx: 0, showSkeleton: false, showTrace: false }));
    act(() => { h.result.current.markIssueAsked(); });
    expect(h.result.current.issueAsked).toBe(true);
    act(() => { useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((s) => ({ ...s, swings_split_at: 99 })) })); });
    expect(h.result.current.issueAsked).toBe(false);
  });
});

describe('a Fault-moment pill time is held only for the swing it was tapped on', () => {
  it('THE REPORT: held on swing 1, a re-split reuses `_shot_0` — the replay no longer stops at the old second', () => {
    const h = renderHook(() => useLibrary({ idx: 0, showSkeleton: false, showTrace: false }));
    act(() => { h.result.current.holdAskedFault(6.04); });
    expect(h.result.current.faultSecRef.current).toBe(6.04);
    expect(h.result.current.askedFaultSec).toBe(6.04);
    act(() => { useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((s) => ({ ...s, swings_split_at: 99 })) })); });
    expect(h.result.current.faultSecRef.current).toBeNull();
    expect(h.result.current.askedFaultSec).toBeNull();
  });

  it('a COMPUTED moment is not the pill\'s: a new review does not drop it (the moment effect owns it)', () => {
    const h = renderHook(() => useLibrary({ idx: 0, showSkeleton: false, showTrace: false }));
    act(() => { h.result.current.faultSecRef.current = 5.5; });   // the screen's fault-moment effect
    act(() => { useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((s) => ({ ...s, swings_split_at: 99 })) })); });
    expect(h.result.current.faultSecRef.current).toBe(5.5);
  });
});
