/**
 * 2026-10-27 (Phase SB5 — recheck R2-1 of the SB3/SB4 work).
 *
 * An old library swing: its body read is an older build's, so the screen says so and offers "Read it again".
 * Tim taps it; the read does not land (the pose stage throws, runs out of budget, no detector answers). A
 * read that is not forced stores nothing then, so the older read is still there and the note offers "Read
 * it again" again — and the second tap set the same key, React kept the state, the request's retrigger did
 * not move, and the lit button asked for nothing.
 *
 * Now every tap is a new ask (hooks/useBodyAsk). Driven through the screen's real hooks on the real store,
 * with only the shot run mocked (its ask is recorded and settled by hand).
 */
const mockAsks: { shotId: string; arc: unknown; settle: () => void }[] = [];
jest.mock('../../services/swing/orchestrator/shotDetail', () => ({
  ...jest.requireActual('../../services/swing/orchestrator/shotDetail'),
  requestShotDetail: (_sessionId: string, shotId: string, opts: { arc?: unknown; onSettled?: () => void }) => {
    mockAsks.push({ shotId, arc: opts.arc, settle: () => opts.onSettled?.() });
    return () => undefined;
  },
}));

import { createElement, useState } from 'react';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { shownShotBiomech, storedShotBiomech, shownSwingHoldsOlderRead } from '../../services/swing/orchestrator/shotDetail';
import { olderBodyReadNote, shotDetailRequestFor } from '../../services/swing/faultSpotlight';
import { useShotDetailRequest } from '../../hooks/useShotDetailRequest';
import { useBodyAsk } from '../../hooks/useBodyAsk';

// react-test-renderer ships no types; only these two are used.
type Renderer = { update: (el: ReturnType<typeof createElement>) => void };
const { create, act: rtrAct } = require('react-test-renderer') as {
  create: (el: ReturnType<typeof createElement>) => Renderer;
  act: (fn: () => void) => void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const act = (fn: () => void): void => { rtrAct(fn); };

/** A minimal renderHook: the hook's latest return, and a rerender with new props. */
function renderHook<P, R>(hook: (p: P) => R, opts: { initialProps: P }) {
  const result = { current: undefined as unknown as R };
  const Probe = (p: { props: P }): null => { result.current = hook(p.props); return null; };
  let r: Renderer | undefined;
  act(() => { r = create(createElement(Probe, { props: opts.initialProps })); });
  return { result, rerender: (props: P) => r!.update(createElement(Probe, { props })) };
}

const oldRead = { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
/** A library swing read before 10-26: two swings, each holding an unstamped (older build's) body read. */
function seed(): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', biomechanics: oldRead,
      shots: [
        { id: 's1_shot_0', club: '7i', clipUri: 'file:///a.mp4' },
        { id: 's1_shot_1', club: '7i', clipUri: 'file:///b.mp4', biomechanics: oldRead },
      ],
    }] as never,
  });
}

/** What the library swing screen wires for the swing shown with Body, Trace and Issue all off. */
function useLibrarySwing(p: { idx: number }) {
  const session = useSwingSessionStore((s) => s.sessionHistory.find((x) => x.id === 's1'));
  const selShot = session?.shots[p.idx];
  const reviewKey = `s1|full|${selShot?.id ?? ''}`;
  const { bodyAsked, bodyAskTaps, askBody } = useBodyAsk(reviewKey);
  const [pending, setPending] = useState<string | null>(null);
  useShotDetailRequest({
    sessionId: 's1',
    shotId: selShot?.clipUri ? selShot.id : null,
    ask: shotDetailRequestFor({ idx: p.idx, showSkeleton: false, traceAsked: false, issueAsked: false, bodyAsked }),
    unread: !!session && !!selShot && storedShotBiomech(session, selShot, p.idx === 0) === undefined,
    retrigger: `${p.idx}|${selShot?.clipUri ?? ''}|false|false|false|${bodyAskTaps}`,
    setPending,
  });
  const shown = shownShotBiomech(session, p.idx);
  return {
    askBody,
    note: () => olderBodyReadNote({ shown: shown != null, olderRead: shownSwingHoldsOlderRead(session, p.idx), pending: !!selShot && pending === selShot.id, asked: bodyAsked }),
  };
}

beforeEach(() => { mockAsks.length = 0; seed(); });

describe('"Read it again" asks again after a read that did not land', () => {
  it('THE REPORT: tap, the read fails (nothing stored), the button is back — and the second tap asks again', () => {
    const { result } = renderHook((p: { idx: number }) => useLibrarySwing(p), { initialProps: { idx: 0 } });
    expect(result.current.note()).toBe('older_read');
    expect(mockAsks).toHaveLength(0);                 // the library is manual: opening asks nothing

    act(() => { result.current.askBody(); });
    expect(mockAsks.map((a) => a.arc)).toEqual([false]);   // body only, no arc
    expect(result.current.note()).toBe('reading');

    act(() => { mockAsks[0].settle(); });                  // the read did not land: nothing was stored
    expect(result.current.note()).toBe('older_read');      // "Read it again" is offered again…

    act(() => { result.current.askBody(); });
    expect(mockAsks).toHaveLength(2);                      // …and it does what it says
    expect(mockAsks[1]).toMatchObject({ shotId: 's1_shot_0', arc: false });
    expect(result.current.note()).toBe('reading');
  });

  it('swings 2+ too: a failed read of swing 2 is asked for again on the next tap', () => {
    const { result } = renderHook((p: { idx: number }) => useLibrarySwing(p), { initialProps: { idx: 1 } });
    // Swing 2 is read on paging (the free pass); that read did not land either.
    const before = mockAsks.length;
    act(() => { mockAsks.forEach((a) => a.settle()); });
    expect(result.current.note()).toBe('older_read');
    act(() => { result.current.askBody(); });
    act(() => { mockAsks[mockAsks.length - 1].settle(); });
    act(() => { result.current.askBody(); });
    expect(mockAsks.length - before).toBe(2);
    expect(mockAsks.slice(before).every((a) => a.shotId === 's1_shot_1')).toBe(true);
  });

  it('the ask stays with its swing: paging away and back does not carry it', () => {
    const { result, rerender } = renderHook((p: { idx: number }) => useLibrarySwing(p), { initialProps: { idx: 0 } });
    act(() => { result.current.askBody(); });
    act(() => { mockAsks.forEach((a) => a.settle()); });
    act(() => { rerender({ idx: 1 }); });
    act(() => { mockAsks.forEach((a) => a.settle()); });
    act(() => { rerender({ idx: 0 }); });
    // Back on swing 1 with everything off: the old tap is not carried, nothing is asked, the offer stands.
    expect(mockAsks.filter((a) => a.shotId === 's1_shot_0')).toHaveLength(1);
    expect(result.current.note()).toBe('older_read');
  });
});
