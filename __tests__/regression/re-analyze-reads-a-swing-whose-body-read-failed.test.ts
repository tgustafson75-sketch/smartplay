/**
 * 2026-10-27 (Phase SB5 — recheck R1 of the SB3/SB4 work).
 *
 * "No body read for this swing — Re-analyze to see where", on swing 2. Swing 2's body read had FAILED (the
 * pose stage threw or ran past its budget, as in Tim's 10-17 range session; or no detector answered), so
 * nothing was stored and the read was already unread. Tapping Re-analyze re-read swing 1 only. The screen's
 * ask (hooks/useShotDetailRequest) asked again only when the read went from read to unread — and swing 2 was
 * unread before and after — while the shot id, the selection and the toggles did not change. Swing 2 was
 * never asked for again and the same note came back.
 *
 * Driven through the real hook, the real swing run (uploadRun.runSwingAnalysis) and the real shot runs,
 * with the read and the pose decode stubbed.
 */
const mockPoseCalls: number[] = [];
let mockSwing2Fails = true;

jest.mock('../../services/poseDetection', () => ({
  analyzeSwing: async () => ({
    kind: 'ok',
    analysis: {
      detected_issue: 'over_the_top', severity: 'moderate', confidence: 'high', observation: 'steep',
      fault_frame_index: -1, primary_fault: 'over_the_top',
      phases_visible: { address: true, top: true, impact: true, finish: true },
    },
    locate_degraded: null, frame_timestamps_sec: [], fault_frame_uri: null, fault_frame_display_uri: null, fault_frame_fraction: null,
  }),
  analyzeSwingTentative: async () => ({ kind: 'no_network' }),
  probeDurationMs: async () => 12000,
  locateSwings: async () => [],
}));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: async (_uri: string, _dur: number, _a: unknown, _p: boolean, window: { startMs: number } | null) => {
    mockPoseCalls.push(window?.startMs ?? -1);
    if (window?.startMs === 5000 && mockSwing2Fails) throw new Error('pose stage overran its budget');
    return { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
  },
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swingCommentaryService', () => ({ getTranscriptionStatus: () => 'done' }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({ findUploadSwingWindow: async () => ({ via: 'middle', startSec: 0, endSec: 1, impactSec: null }) }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../services/contextSynthesizer', () => ({ synthesizeCageInsight: async () => null }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

import { createElement, useState } from 'react';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { storedShotBiomech } from '../../services/swing/orchestrator/shotDetail';
import { runSwingAnalysis } from '../../services/swing/orchestrator/uploadRun';
import { _clearRunsForTest, liveRunKeys, liveRun } from '../../services/swing/orchestrator/engine';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';
import { shotDetailRequestFor } from '../../services/swing/faultSpotlight';
import { useShotDetailRequest } from '../../hooks/useShotDetailRequest';

// react-test-renderer ships no types; only these two are used.
type Renderer = { unmount: () => void };
const { create, act } = require('react-test-renderer') as {
  create: (el: ReturnType<typeof createElement>) => Renderer;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
const session = () => useSwingSessionStore.getState().sessionHistory.find((s) => s.id === 'w')!;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 100 && liveRunKeys().length > 0; i++) await act(async () => { await tick(10); }); };
const swing2Asks = () => mockPoseCalls.filter((ms) => ms === 5000).length;

/** What the library swing screen wires for the selected swing, with Body on. */
function LibrarySwing2(): null {
  const s = useSwingSessionStore((st) => st.sessionHistory.find((x) => x.id === 'w'));
  const sh = s?.shots[1];
  const [, setPending] = useState<string | null>(null);
  useShotDetailRequest({
    sessionId: 'w',
    shotId: sh?.clipUri ? sh.id : null,
    ask: shotDetailRequestFor({ idx: 1, showSkeleton: true, traceAsked: false, issueAsked: false, bodyAsked: false }),
    unread: !!s && !!sh && storedShotBiomech(s, sh, false) === undefined,
    retrigger: `1|${sh?.clipUri ?? ''}|true|false|false|false`,
    setPending,
  });
  return null;
}

beforeEach(() => {
  mockPoseCalls.length = 0;
  mockSwing2Fails = true;
  _clearRunsForTest();
  useSwingSessionStore.setState({
    activeSession: null, hasHydrated: true,
    sessionHistory: [{
      id: 'w', date: 1, source: 'live_capture', analysis_status: 'ok', club: '7i',
      biomechanics: read, analysis_version: BODY_READ_VERSION,
      shots: [
        { id: 'w_shot_0', club: '7i', clipUri: 'https://clips/w.mp4', clipStartSeconds: 1, clipEndSeconds: 3, biomechanics: read, analysis_version: BODY_READ_VERSION },
        { id: 'w_shot_1', club: '7i', clipUri: 'https://clips/w.mp4', clipStartSeconds: 5, clipEndSeconds: 7 },
      ],
    }] as never,
  });
});
afterEach(() => { for (const k of liveRunKeys()) liveRun(k)?.cancel(); });
afterAll(() => { require('../../services/analytics').teardownAnalytics(); });

describe('Re-analyze under "No body read for this swing" reads that swing again', () => {
  it('THE REPORT: swing 2\'s body read fails, Re-analyze — swing 2 is asked for again and read', async () => {
    let r!: Renderer;
    await act(async () => { r = create(createElement(LibrarySwing2)); });
    await settle();
    expect(swing2Asks()).toBe(1);
    expect(storedShotBiomech(session(), session().shots[1], false)).toBeUndefined();   // the "No body read" note

    mockSwing2Fails = false;
    await act(async () => { void runSwingAnalysis('w'); });   // the note's Re-analyze (runPhaseKOnSession)
    await settle();
    expect(swing2Asks()).toBe(2);
    expect(storedShotBiomech(session(), session().shots[1], false)).toEqual(read);
    await act(() => { r.unmount(); });
  });

  it('a swing 2 that HAS a read is not asked twice by one Re-analyze (the wipe and the start are one ask)', async () => {
    useSwingSessionStore.setState((st) => ({
      sessionHistory: st.sessionHistory.map((s) => ({ ...s, shots: s.shots.map((x) => ({ ...x, biomechanics: read as never, analysis_version: BODY_READ_VERSION })) })),
    }));
    mockSwing2Fails = false;
    let r!: Renderer;
    await act(async () => { r = create(createElement(LibrarySwing2)); });
    await settle();
    expect(swing2Asks()).toBe(0);   // stored by today's code: nothing to read
    await act(async () => { void runSwingAnalysis('w'); });
    await settle();
    expect(swing2Asks()).toBe(1);
    await act(() => { r.unmount(); });
  });
});
