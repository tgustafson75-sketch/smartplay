/**
 * 2026-10-27 (Phase SB4x seam review — "reanalyze #3" / "issue #4" against the library's manual rule).
 *
 * SB4x made the library draw only a body read TODAY'S code stored (shotDetail.shownShotBiomech). Every swing
 * read before 2026-10-26 has no analysis_version, so its read is now UNREAD. Swings 2+ are asked for on
 * paging (the free pass), but swing 1 with everything off asks for nothing — the library is manual (Tim
 * 06-15) — so on every old single-swing session the Biomechanics card, the body tiles and the Swing
 * Breakdown that used to show simply VANISHED: no "Reading…", no reason, nothing asked. Silence.
 *
 * Now: the screen says the read is an older version's and offers to read the swing again; that tap asks the
 * shot run for the body read only (no arc, free or paid), and the line says "Reading…" while it is out.
 * Driven through the real request hook the screen calls, on the real store, with only the shot run mocked.
 */
import { renderHook, act } from '@testing-library/react-native';

const mockAsks: { shotId: string; arc: unknown }[] = [];
jest.mock('../../services/swing/orchestrator/shotDetail', () => ({
  ...jest.requireActual('../../services/swing/orchestrator/shotDetail'),
  requestShotDetail: (_sessionId: string, shotId: string, opts: { arc?: unknown }) => {
    mockAsks.push({ shotId, arc: opts.arc });
    return () => undefined;
  },
}));

import { useState } from 'react';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { shownShotBiomech, storedShotBiomech, shownSwingHoldsOlderRead } from '../../services/swing/orchestrator/shotDetail';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';
import { olderBodyReadNote, shotDetailRequestFor } from '../../services/swing/faultSpotlight';
import { useShotDetailRequest } from '../../hooks/useShotDetailRequest';

const read = { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
function seed(stamp: number | undefined): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i',
      biomechanics: read, ...(stamp != null ? { analysis_version: stamp } : {}),
      shots: [{ id: 's1_shot_0', club: '7i', clipUri: 'file:///c.mp4' }],
    }] as never,
  });
}

/** What the library swing screen wires for swing 1 with Body, Trace and Issue all off. */
function useLibrarySwingOne(p: { bodyAsked: boolean }) {
  const session = useSwingSessionStore((s) => s.sessionHistory.find((x) => x.id === 's1'));
  const selShot = session?.shots[0];
  const [pending, setPending] = useState<string | null>(null);
  useShotDetailRequest({
    sessionId: 's1',
    shotId: selShot?.clipUri ? selShot.id : null,
    ask: shotDetailRequestFor({ idx: 0, showSkeleton: false, traceAsked: false, issueAsked: false, bodyAsked: p.bodyAsked }),
    unread: !!session && !!selShot && storedShotBiomech(session, selShot, true) === undefined,
    retrigger: `0|${selShot?.clipUri ?? ''}|false|false|false|${p.bodyAsked}`,
    setPending,
  });
  const shown = shownShotBiomech(session, 0);
  return {
    shown,
    // Read when asserted (not during render), so each assertion fails on its own behaviour.
    note: () => olderBodyReadNote({ shown: shown != null, olderRead: shownSwingHoldsOlderRead(session, 0), pending: !!selShot && pending === selShot.id, asked: p.bodyAsked }),
  };
}

beforeEach(() => { mockAsks.length = 0; });

describe('an old swing 1 in the library is never silently blank', () => {
  it('THE REPORT: an old build\'s read is not drawn — the screen SAYS so and offers a read; nothing is asked until the tap', () => {
    seed(undefined);
    const { result } = renderHook((p: { bodyAsked: boolean }) => useLibrarySwingOne(p), { initialProps: { bodyAsked: false } });
    expect(result.current.shown).toBeNull();
    expect(mockAsks).toHaveLength(0);               // the library is manual: opening asks nothing
    expect(result.current.note()).toBe('older_read');  // …but it is not silent
  });

  it('the tap asks the shot run for the body read only (no arc, free or paid), and the line says Reading…', () => {
    seed(undefined);
    const { result, rerender } = renderHook((p: { bodyAsked: boolean }) => useLibrarySwingOne(p), { initialProps: { bodyAsked: false } });
    act(() => { rerender({ bodyAsked: true }); });
    expect(mockAsks).toEqual([{ shotId: 's1_shot_0', arc: false }]);
    expect(result.current.note()).toBe('reading');
  });

  it('read again on the tap and today\'s code found no body: the line says so (never just disappears)', () => {
    seed(undefined);
    const { result, rerender } = renderHook((p: { bodyAsked: boolean }) => useLibrarySwingOne(p), { initialProps: { bodyAsked: false } });
    act(() => { rerender({ bodyAsked: true }); });
    act(() => {
      useSwingSessionStore.setState((st) => ({
        sessionHistory: st.sessionHistory.map((x) => ({ ...x, biomechanics: null, analysis_version: BODY_READ_VERSION })),
      }));
    });
    expect(result.current.shown).toBeNull();
    // pending is the screen's own (the mocked run never settles): with it cleared the honest line is "no body read".
    expect(olderBodyReadNote({ shown: false, olderRead: shownSwingHoldsOlderRead(useSwingSessionStore.getState().sessionHistory[0], 0), pending: false, asked: true })).toBe('no_read');
  });

  it('today\'s read is drawn and says nothing; a swing never read says nothing here (the Body chip owns that)', () => {
    seed(BODY_READ_VERSION);
    const { result } = renderHook(() => useLibrarySwingOne({ bodyAsked: false }));
    expect(result.current.shown).toBe(read);
    expect(result.current.note()).toBeNull();
    useSwingSessionStore.setState({
      sessionHistory: [{ id: 's1', source: 'uploaded_video', analysis_status: 'ok', shots: [{ id: 's1_shot_0', clipUri: 'file:///c.mp4' }] }] as never,
    });
    const r2 = renderHook(() => useLibrarySwingOne({ bodyAsked: false }));
    expect(r2.result.current.note()).toBeNull();
  });

  it('an older stamp is an older read too; an old EMPTY read (null) was never drawn, so it is not offered', () => {
    seed(BODY_READ_VERSION - 1);
    expect(renderHook(() => useLibrarySwingOne({ bodyAsked: false })).result.current.note()).toBe('older_read');
    useSwingSessionStore.setState({
      sessionHistory: [{ id: 's1', source: 'uploaded_video', biomechanics: null, shots: [{ id: 's1_shot_0', clipUri: 'file:///c.mp4' }] }] as never,
    });
    expect(renderHook(() => useLibrarySwingOne({ bodyAsked: false })).result.current.note()).toBeNull();
  });
});
